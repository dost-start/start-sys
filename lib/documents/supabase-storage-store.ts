// ─────────────────────────────────────────────────────────────────────────────
// The Supabase Storage driver — `DOCUMENT_STORE=supabase_storage`. BUILD_PLAN S3-T11.
//
// **WRITTEN AND ITS BUCKET MIGRATED ON DAY 3 WHETHER OR NOT IT IS USED.** OQ-1 is
// unanswered — START-DOST may have no Workspace tenant supporting Shared Drives, and
// Workspace for Nonprofits' base tier does not include them. An empty private bucket
// costs nothing and removes the last migration from the swap path, so taking the
// fallback at the S3-T3 midday timebox is an environment-variable flip and a redeploy
// rather than a build. The full price of that swap is ADR 0005; the item most easily
// missed is that **storage objects are NOT included in `supabase db dump`**, so the
// nightly backup job (S7-T14) must gain an object-sync step or every proof document
// falls outside the Backup & Recovery NFR.
//
// The `applications` table is UNCHANGED by this driver: `proof_drive_file_id` holds a
// Drive file id under one driver and an object path under this one, and nothing outside
// `lib/documents/` interprets it (DATA_MODEL.md §6/0008).
//
// THE BUCKET IS PRIVATE AND MUST STAY PRIVATE. `public: false` in migration 0021. An
// anonymous GET of an object's public URL must return 400/404 and never the bytes —
// that is the same requirement as "never anyone-with-the-link on Drive" (PRD US-J2),
// enforced by a different mechanism.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, randomUUID } from "node:crypto";

// ── The one sanctioned service-role import outside lib/server/ ───────────────────────
// This is a DOCUMENT STORE BACKEND — a job/server-only surface, never request-scoped
// authorization. Storage admin operations (minting a signed upload URL, reading provider
// metadata, deleting an object whose bytes contradicted its declared type) act as the
// SYSTEM, not as a person, and there is no caller whose JWT could carry them: the applicant
// uploading a Certificate of Registration is anonymous by design.
//
// **This client never makes an authorization decision.** Authorization for reading a
// document is unchanged and lives where it always has: `GET /api/applications/[id]/proof`
// does an ordinary RLS-checked SELECT with the caller's own JWT first, and only then calls
// `streamDocument` here. Same sanctioned exception as `app/api/jobs/**`
// (lib/server/admin-client.ts, permitted caller 2). If you are reading this because you
// want a service-role client somewhere else: the answer is almost certainly no — read
// ARCHITECTURE.md § "If your query returns nothing, read this first."
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from "@/lib/server/admin-client";

import { resolveVerifiedMime, sniffMime } from "./sniff-mime";
import {
  type AllowedMime,
  type CreateUploadSessionInput,
  type DocumentStore,
  type DocumentStream,
  DocumentRejectedError,
  DocumentUnavailableError,
  type UploadSession,
  type VerifiedUpload,
  MAX_PROOF_BYTES,
  SNIFF_BYTES,
  assertAcceptableUpload,
  extensionForMime,
} from "./types";

/** Mirrored by `storage.buckets.id` in migration 0021. Named in exactly these two places. */
export const PROOF_BUCKET = "proof-of-enrollment";

/** How long a signed read URL used for the 512-byte sniff stays valid. Seconds. */
const SNIFF_URL_TTL_SECONDS = 60;

function storage() {
  return createAdminClient().storage.from(PROOF_BUCKET);
}

/** Object paths are `<applicationId>/<random>.<ext>` — one directory per application. */
function splitRef(storageRef: string): { dir: string; name: string } | null {
  const slash = storageRef.lastIndexOf("/");
  if (slash <= 0 || slash === storageRef.length - 1) return null;
  const dir = storageRef.slice(0, slash);
  const name = storageRef.slice(slash + 1);
  if (dir.includes("..") || name.includes("..") || name.includes("/")) return null;
  return { dir, name };
}

/** Supabase Storage reports a missing object through the message, not a typed code. */
function isNotFoundMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("not found") || lower.includes("does not exist");
}

export const supabaseStorageDocumentStore: DocumentStore = {
  async createUploadSession(input: CreateUploadSessionInput): Promise<UploadSession> {
    // FIRST, before the provider is contacted at all. Same order as the Drive driver.
    const mime: AllowedMime = assertAcceptableUpload(input);

    const applicationId = /^[0-9a-f-]{36}$/.test(input.applicationId)
      ? input.applicationId
      : randomUUID();

    // The stored name is derived from the VERIFIED-CANDIDATE type, never from
    // `input.fileName`: a client-supplied name is the path-traversal and
    // double-extension vector, and is routinely a scholar's own name.
    const storageRef = `${applicationId}/${randomBytes(8).toString("hex")}.${extensionForMime(mime)}`;

    const { data, error } = await storage().createSignedUploadUrl(storageRef);
    if (error !== null || data === null) {
      throw new DocumentUnavailableError(
        "Supabase Storage document store: could not mint an upload URL",
      );
    }

    // Absolute URL to the storage endpoint. The browser PUTs the bytes straight there,
    // bypassing Vercel's 4.5MB request-body cap exactly as the Drive resumable session
    // does — the reason this fallback is a swap and not a redesign.
    return { uploadUrl: data.signedUrl, storageRef };
  },

  async verifyUpload(storageRef: string): Promise<VerifiedUpload> {
    const parts = splitRef(storageRef);
    if (parts === null) {
      throw new DocumentUnavailableError(
        "Supabase Storage document store: malformed storage ref",
        404,
      );
    }

    // 1 — the PROVIDER'S OWN metadata, via a directory listing. Not the client's claim,
    // and not a full download: pulling 10MB through a serverless function to read 12
    // bytes is how this route times out on the day it matters.
    const listed = await storage().list(parts.dir, { limit: 100, search: parts.name });
    if (listed.error !== null) {
      throw new DocumentUnavailableError(
        "Supabase Storage document store: could not list the object",
      );
    }

    const object = (listed.data ?? []).find((entry) => entry.name === parts.name);
    if (object === undefined) {
      throw new DocumentUnavailableError("Supabase Storage document store: object not found", 404);
    }

    const metadata = object.metadata as { size?: unknown; mimetype?: unknown } | null;
    const size = typeof metadata?.size === "number" ? metadata.size : Number.NaN;
    const providerMime = typeof metadata?.mimetype === "string" ? metadata.mimetype : null;

    if (!Number.isFinite(size) || size <= 0) {
      await supabaseStorageDocumentStore.deleteDocument(storageRef);
      throw new DocumentRejectedError("empty_file");
    }
    if (size > MAX_PROOF_BYTES) {
      await supabaseStorageDocumentStore.deleteDocument(storageRef);
      throw new DocumentRejectedError("too_large");
    }

    // 2 — the bytes. A short-lived signed URL plus a Range request, because supabase-js's
    // `download()` has no range option and would pull the whole object.
    const signed = await storage().createSignedUrl(storageRef, SNIFF_URL_TTL_SECONDS);
    if (signed.error !== null || signed.data === null) {
      throw new DocumentUnavailableError(
        "Supabase Storage document store: could not read the object header",
      );
    }

    let head: Uint8Array;
    try {
      const response = await fetch(signed.data.signedUrl, {
        headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` },
      });
      if (!response.ok) {
        throw new DocumentUnavailableError(
          "Supabase Storage document store: could not read the object header",
          response.status,
        );
      }
      // 206 (Range honoured) or 200 (ignored, whole object); slicing covers both.
      head = new Uint8Array(await response.arrayBuffer()).subarray(0, SNIFF_BYTES);
    } catch (error) {
      if (error instanceof DocumentUnavailableError) throw error;
      throw new DocumentUnavailableError(
        "Supabase Storage document store: could not read the object header",
      );
    }

    const resolved = resolveVerifiedMime(providerMime, sniffMime(head));
    if (!resolved.ok) {
      // Delete THEN throw, identically to the Drive driver. The shared contract suite
      // exists so the two cannot drift on exactly this.
      await supabaseStorageDocumentStore.deleteDocument(storageRef);
      throw new DocumentRejectedError(resolved.reason);
    }

    // `webViewLink` is null by design: this driver has no durable view URL, and the only
    // one it could mint would be a time-limited signed URL — which must never be
    // persisted or returned to a browser anyway (PRD US-J2).
    return { sizeBytes: size, mimeType: resolved.mimeType, webViewLink: null };
  },

  async streamDocument(storageRef: string): Promise<DocumentStream> {
    const { data, error } = await storage().download(storageRef);
    if (error !== null || data === null) {
      const message = error?.message ?? "";
      throw new DocumentUnavailableError(
        "Supabase Storage document store: could not open a read stream",
        isNotFoundMessage(message) ? 404 : null,
      );
    }

    return {
      stream: data.stream() as ReadableStream<Uint8Array>,
      contentLength: Number.isFinite(data.size) ? data.size : null,
    };
  },

  async deleteDocument(storageRef: string): Promise<void> {
    const { error } = await storage().remove([storageRef]);
    // Idempotent by contract. `remove()` on an absent object is already a success in
    // supabase-js; the message check covers the providers that disagree.
    if (error !== null && !isNotFoundMessage(error.message)) {
      throw new DocumentUnavailableError(
        "Supabase Storage document store: could not delete the object",
      );
    }
  },

  async listOrphans(knownRefs: string[]): Promise<string[]> {
    const known = new Set(knownRefs);
    const orphans: string[] = [];

    // Two levels: one directory per application, then the object(s) inside it.
    const dirs = await storage().list("", { limit: 1000 });
    if (dirs.error !== null) {
      throw new DocumentUnavailableError(
        "Supabase Storage document store: could not list the bucket",
      );
    }

    for (const dir of dirs.data ?? []) {
      // A directory placeholder has no metadata; a stray object at the root does.
      if (dir.metadata !== null && dir.metadata !== undefined) {
        if (!known.has(dir.name)) orphans.push(dir.name);
        continue;
      }

      const objects = await storage().list(dir.name, { limit: 1000 });
      if (objects.error !== null) continue;

      for (const object of objects.data ?? []) {
        const ref = `${dir.name}/${object.name}`;
        if (!known.has(ref)) orphans.push(ref);
      }
    }

    return orphans.sort();
  },
};

/**
 * Cheap liveness probe for `GET /api/health/drive` (BUILD_PLAN S7-T5) when this driver
 * is the active one. A root listing exercises the key, the bucket and its policies in a
 * single call — which is what actually breaks.
 */
export async function pingSupabaseStorage(): Promise<void> {
  const { error } = await storage().list("", { limit: 1 });
  if (error !== null) {
    throw new DocumentUnavailableError(
      "Supabase Storage document store: health check could not list the bucket",
    );
  }
}
