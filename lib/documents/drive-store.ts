// ─────────────────────────────────────────────────────────────────────────────
// The Google Drive driver — `DOCUMENT_STORE=drive`. BUILD_PLAN S3-T10.
//
// **THE ONLY FILE IN THIS REPOSITORY THAT MAY IMPORT `googleapis`.** That is not a
// style rule: it is what makes ADR 0005's fallback an environment-variable flip. The
// grep guard, which S3-T12 records and S7 re-runs:
//     grep -rn "googleapis" app/ components/ lib/ --exclude-dir=documents   # → empty
//
// FOUR THINGS THIS FILE MUST NEVER DO, each a named banned pattern in CLAUDE.md:
//   1. **Never create a permission on a file.** No `permissions.create`, no "anyone with
//      the link", not even a per-user grant. A Certificate of Registration one forwarded
//      URL away from the public internet is the single most likely breach vector in this
//      system (ARCHITECTURE.md §7). The service account owns the file; the ONLY read path
//      is `GET /api/applications/[id]/proof`, which re-checks RLS and writes an audit row.
//   2. **Never use a scope other than `drive.file`.** `drive` and `drive.readonly` are
//      both classified *sensitive* by Google — they trigger app verification and they
//      grant access far beyond files this app created. `drive.file` is least-privilege
//      and ships without review.
//   3. **Never return a `webViewLink` to a caller other than `verifyUpload`**, whose
//      return value is persisted server-side into a sensitive column and never granted.
//   4. **Never log a token, a private key, a file name or a Drive URL.** `no-console` is
//      an ESLint error under `lib/**`; the errors thrown here are deliberately generic
//      because a Google error body names the service account, the folder and the Drive.
//
// WHY `files.generateIds` (the non-obvious bit): a resumable upload session does not
// hand back a file id until the bytes have finished moving, which would mean the SERVER
// learning the ref from the CLIENT — believing a stranger about which object to verify.
// Pre-allocating the id keeps `UploadSession.storageRef` known before a single byte
// moves, so the client's report is never load-bearing and a retried upload is idempotent.
// ─────────────────────────────────────────────────────────────────────────────

import { Readable } from "node:stream";

// `google.auth.JWT` rather than a direct `google-auth-library` import: that package is a
// transitive dependency of googleapis and is not declared in package.json, and reaching
// past a declared dependency into its own tree is how a lockfile bump silently breaks a
// build (CONVENTIONS.md §12.6 — every dependency is something a 2029 officer must upgrade).
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";

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

/** Least privilege, and the only scope this integration may ever hold. See rule 2 above. */
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const RESUMABLE_ENDPOINT =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true";

type DriveConfig = { folderId: string; auth: InstanceType<typeof google.auth.JWT> };

let cached: DriveConfig | null = null;

/**
 * Build the JWT client lazily, from the environment, at first use.
 *
 * Lazy on purpose: a build-time analysis pass, a typecheck, or a deployment running the
 * fake store must not require Google credentials to be present. A missing variable then
 * fails loudly at first use naming exactly what is absent, rather than producing a
 * client that authenticates as nobody and returns an opaque 401 an hour later.
 */
function driveConfig(): DriveConfig {
  if (cached !== null) return cached;

  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  const folderId = process.env.GOOGLE_DRIVE_PROOF_FOLDER_ID;

  const missing: string[] = [];
  if (!clientEmail) missing.push("GOOGLE_SA_CLIENT_EMAIL");
  if (!privateKey) missing.push("GOOGLE_SA_PRIVATE_KEY");
  if (!folderId) missing.push("GOOGLE_DRIVE_PROOF_FOLDER_ID");

  if (!clientEmail || !privateKey || !folderId) {
    throw new Error(
      `Drive document store: missing required environment variable(s): ${missing.join(", ")}. ` +
        `Real values live in Bitwarden ("Google Cloud — START-SYS — service account"). ` +
        `To run without Drive, set DOCUMENT_STORE=supabase_storage (ADR 0005) or =fake.`,
    );
  }

  cached = {
    folderId,
    auth: new google.auth.JWT({
      email: clientEmail,
      // Vercel and GitHub Actions store the PEM with literal "\n" sequences.
      key: privateKey.replace(/\\n/g, "\n"),
      scopes: [DRIVE_FILE_SCOPE],
    }),
  };

  return cached;
}

function driveClient(): drive_v3.Drive {
  return google.drive({ version: "v3", auth: driveConfig().auth });
}

/** Read an HTTP status off whatever googleapis threw, without an `any` and without assuming a shape. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  for (const value of [candidate.code, candidate.status, candidate.response?.status]) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  }
  return null;
}

/**
 * Collapse a provider failure into our own error type.
 *
 * The provider's message is DISCARDED, never wrapped: a Google error body names the
 * service account, the parent folder and often the Shared Drive, and this error can end
 * up in a Sentry event or an HTTP response.
 */
function unavailable(error: unknown, what: string): DocumentUnavailableError {
  return new DocumentUnavailableError(`Drive document store: ${what}`, statusOf(error));
}

function isGone(error: unknown): boolean {
  const status = statusOf(error);
  return status === 404 || status === 410;
}

/**
 * Read one response header without assuming which shape gaxios is handing back.
 *
 * gaxios 7 returns a WHATWG `Headers`; earlier majors returned a plain record. googleapis
 * moves between the two on its own release cadence, so this reads either. Without it a
 * routine dependency bump turns `Content-Length` on the proof proxy silently undefined.
 */
function headerValue(headers: unknown, name: string): string | null {
  if (typeof headers !== "object" || headers === null) return null;

  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    const value = (headers as Headers).get(name);
    return typeof value === "string" ? value : null;
  }

  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

async function accessToken(): Promise<string> {
  try {
    const { token } = await driveConfig().auth.getAccessToken();
    if (!token) throw new Error("no token");
    return token;
  } catch (error) {
    throw unavailable(error, "could not obtain an access token for the service account");
  }
}

export const driveDocumentStore: DocumentStore = {
  async createUploadSession(input: CreateUploadSessionInput): Promise<UploadSession> {
    // FIRST, before a single Google API call is spent. An anonymous caller must not be
    // able to consume quota, or create an object we then have to clean up, by declaring
    // a 4GB file (S3-T10 acceptance).
    const mime: AllowedMime = assertAcceptableUpload(input);

    const { folderId } = driveConfig();
    const drive = driveClient();

    // Pre-allocate the id so `storageRef` is known before the bytes move. See the header.
    let fileId: string;
    try {
      const generated = await drive.files.generateIds({ count: 1, space: "drive" });
      const first = generated.data.ids?.[0];
      if (!first) throw new Error("Drive returned no generated id");
      fileId = first;
    } catch (error) {
      throw unavailable(error, "could not allocate a file id");
    }

    // The stored name carries the application id and the VERIFIED-CANDIDATE extension —
    // never the client's file name, which is attacker-controlled and is, routinely, a
    // scholar's own name.
    const name = `${input.applicationId}.${extensionForMime(mime)}`;

    let response: Response;
    try {
      response = await fetch(RESUMABLE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mime,
          "X-Upload-Content-Length": String(input.sizeBytes),
        },
        body: JSON.stringify({ id: fileId, name, parents: [folderId], mimeType: mime }),
      });
    } catch (error) {
      throw unavailable(error, "could not reach Drive to open an upload session");
    }

    if (!response.ok) {
      throw new DocumentUnavailableError(
        "Drive document store: Drive refused to open an upload session",
        response.status,
      );
    }

    const uploadUrl = response.headers.get("location");
    if (!uploadUrl) {
      throw new DocumentUnavailableError(
        "Drive document store: Drive opened a session with no upload location",
        response.status,
      );
    }

    return { uploadUrl, storageRef: fileId };
  },

  async verifyUpload(storageRef: string): Promise<VerifiedUpload> {
    const drive = driveClient();

    // 1 — the PROVIDER'S OWN metadata. Not the client's claim about what it uploaded.
    let size: number;
    let providerMime: string | null;
    let webViewLink: string | null;
    try {
      const meta = await drive.files.get({
        fileId: storageRef,
        fields: "id,size,mimeType,webViewLink",
        supportsAllDrives: true,
      });
      size = Number(meta.data.size ?? 0);
      providerMime = meta.data.mimeType ?? null;
      webViewLink = meta.data.webViewLink ?? null;
    } catch (error) {
      if (isGone(error)) {
        throw new DocumentUnavailableError("Drive document store: file not found", 404);
      }
      throw unavailable(error, "could not read file metadata");
    }

    if (!Number.isFinite(size) || size <= 0) {
      await driveDocumentStore.deleteDocument(storageRef);
      throw new DocumentRejectedError("empty_file");
    }
    if (size > MAX_PROOF_BYTES) {
      // The resumable session was opened for a declared size within the cap; a file this
      // large means the declaration was a lie. Delete it — we have no basis to keep it.
      await driveDocumentStore.deleteDocument(storageRef);
      throw new DocumentRejectedError("too_large");
    }

    // 2 — the bytes. A Range read of the first 512 is enough for every signature we
    // accept and avoids pulling 10MB through a serverless function to check 12 bytes.
    let head: Uint8Array;
    try {
      const media = await drive.files.get(
        { fileId: storageRef, alt: "media", supportsAllDrives: true },
        {
          responseType: "arraybuffer",
          headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` },
        },
      );
      // Drive may honour the Range (206) or ignore it (200, whole file); slicing covers both.
      // The double cast is unavoidable: googleapis types `data` from the API schema and
      // has no overload for `responseType: "arraybuffer"`.
      const buffer = media.data as unknown as ArrayBuffer | Uint8Array;
      const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      head = view.subarray(0, SNIFF_BYTES);
    } catch (error) {
      if (isGone(error)) {
        throw new DocumentUnavailableError("Drive document store: file not found", 404);
      }
      throw unavailable(error, "could not read the file header");
    }

    const resolved = resolveVerifiedMime(providerMime, sniffMime(head));
    if (!resolved.ok) {
      // DELETE THEN THROW. A PNG renamed .pdf must not be left in the Shared Drive:
      // it is somebody's file, we have no basis to hold it, and it would be an orphan
      // no purge job ever finds because no row points at it (S3-T10 acceptance).
      await driveDocumentStore.deleteDocument(storageRef);
      throw new DocumentRejectedError(resolved.reason);
    }

    return { sizeBytes: size, mimeType: resolved.mimeType, webViewLink };
  },

  async streamDocument(storageRef: string): Promise<DocumentStream> {
    const drive = driveClient();

    try {
      const media = await drive.files.get(
        { fileId: storageRef, alt: "media", supportsAllDrives: true },
        { responseType: "stream" },
      );

      const header = headerValue(media.headers, "content-length");
      const length = header === null ? Number.NaN : Number(header);

      return {
        // The proxy route hands this straight to a `Response`. The Drive URL itself
        // never leaves the server — that is the entire point of proxying (PRD US-J2).
        stream: Readable.toWeb(media.data as unknown as Readable) as ReadableStream<Uint8Array>,
        contentLength: Number.isFinite(length) ? length : null,
      };
    } catch (error) {
      if (isGone(error)) {
        throw new DocumentUnavailableError("Drive document store: file not found", 404);
      }
      throw unavailable(error, "could not open a read stream");
    }
  },

  async deleteDocument(storageRef: string): Promise<void> {
    try {
      await driveClient().files.delete({ fileId: storageRef, supportsAllDrives: true });
    } catch (error) {
      // Idempotent by contract: an already-deleted file is a success. The sweep (S3-T22)
      // relies on this — it deletes refs that may already be gone.
      if (isGone(error)) return;
      throw unavailable(error, "could not delete the file");
    }
  },

  async listOrphans(knownRefs: string[]): Promise<string[]> {
    const { folderId } = driveConfig();
    const drive = driveClient();
    const known = new Set(knownRefs);
    const orphans: string[] = [];

    let pageToken: string | undefined;
    try {
      do {
        const page = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: "nextPageToken, files(id)",
          pageSize: 1000,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          ...(pageToken === undefined ? {} : { pageToken }),
        });

        for (const file of page.data.files ?? []) {
          if (file.id && !known.has(file.id)) orphans.push(file.id);
        }

        pageToken = page.data.nextPageToken ?? undefined;
      } while (pageToken !== undefined);
    } catch (error) {
      throw unavailable(error, "could not list the proof-of-enrollment folder");
    }

    return orphans;
  },
};

/**
 * Cheap liveness probe for `GET /api/health/drive` (BUILD_PLAN S7-T5).
 *
 * A metadata read of the configured folder: it exercises the credential, the scope and
 * the folder grant in one call, which is what actually breaks — a rotated key or a
 * revoked folder share. Throws `DocumentUnavailableError`; the route maps it to a 500
 * with no credential material in the body.
 */
export async function pingDrive(): Promise<void> {
  const { folderId } = driveConfig();
  try {
    await driveClient().files.get({
      fileId: folderId,
      fields: "id",
      supportsAllDrives: true,
    });
  } catch (error) {
    throw unavailable(error, "health check could not read the proof-of-enrollment folder");
  }
}
