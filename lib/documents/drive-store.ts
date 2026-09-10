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
//      system (ARCHITECTURE.md §7). The START-DOST Google account owns the file; the ONLY
//      read path is `GET /api/applications/[id]/proof`, which re-checks RLS and audits.
//   2. **Never use a scope other than `drive.file`.** `drive` and `drive.readonly` are
//      both classified *sensitive* by Google — they trigger app verification and they
//      grant access far beyond files this app created. `drive.file` is least-privilege
//      and ships without review.
//   3. **Never return a `webViewLink` to a caller other than `verifyUpload`**, whose
//      return value is persisted server-side into a sensitive column and never granted.
//   4. **Never log a token, a private key, a file name or a Drive URL.** `no-console` is
//      an ESLint error under `lib/**`; the errors thrown here are deliberately generic
//      because a Google error body names the account, the folder and the Drive.
//
// WHY `files.generateIds` (the non-obvious bit): a resumable upload session does not
// hand back a file id until the bytes have finished moving, which would mean the SERVER
// learning the ref from the CLIENT — believing a stranger about which object to verify.
// Pre-allocating the id keeps `UploadSession.storageRef` known before a single byte
// moves, so the client's report is never load-bearing and a retried upload is idempotent.
// ─────────────────────────────────────────────────────────────────────────────

import { Readable } from "node:stream";

// `google.auth.OAuth2` rather than a direct `google-auth-library` import: that package is
// a transitive dependency of googleapis and is not declared in package.json, and reaching
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

/**
 * Least privilege, and the only scope this integration may ever hold. See rule 2 above.
 *
 * Not passed to the client: the scope is baked into the refresh token at consent time,
 * so widening it means minting a new token, not editing this constant. It stays here as
 * the single written record of what that token is allowed to do.
 */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const RESUMABLE_ENDPOINT =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true";

type DriveConfig = { folderId: string; auth: InstanceType<typeof google.auth.OAuth2> };

let cached: DriveConfig | null = null;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A USER CREDENTIAL AND NOT A SERVICE ACCOUNT (ADR 0018)
 * ═══════════════════════════════════════════════════════════════════════════════
 * Until 2026-09-10 this authenticated as a service account. It could mint an upload
 * session and it could be granted access to a folder, and then every commit failed:
 *
 *     403 "Service Accounts do not have storage quota. Leverage shared drives"
 *
 * A service account owns no Drive storage. The documented escape is a Shared Drive,
 * which the drive itself owns — but Shared Drives exist only on paid Google Workspace,
 * and START-DOST runs on a consumer @gmail.com. There was no configuration that could
 * make the service-account path work, and it never had.
 *
 * So the app now acts AS the START-DOST Google account, via the refresh token minted
 * once at setup (docs/runbooks/06). Files are owned by that account and consume its
 * quota, which exists. Scope is unchanged: `drive.file`, least privilege, per rule 2
 * in the file header.
 *
 * The cost, stated because it does not go away: the documents live in one Google
 * account. ARCHITECTURE.md §10 names personal-account ownership as the likeliest cause
 * of system death at handover. Runbook 03 carries the rotation step; the annual
 * handover checklist carries the transfer.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Built lazily, from the environment, at first use. Lazy on purpose: a build-time
 * analysis pass, a typecheck, or a deployment running the fake store must not require
 * Google credentials to be present. A missing variable then fails loudly at first use
 * naming exactly what is absent, rather than producing a client that authenticates as
 * nobody and returns an opaque 401 an hour later.
 */
function driveConfig(): DriveConfig {
  if (cached !== null) return cached;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const folderId = process.env.GOOGLE_DRIVE_PROOF_FOLDER_ID;

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!refreshToken) missing.push("GOOGLE_DRIVE_REFRESH_TOKEN");
  if (!folderId) missing.push("GOOGLE_DRIVE_PROOF_FOLDER_ID");

  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    throw new Error(
      `Drive document store: missing required environment variable(s): ${missing.join(", ")}. ` +
        `Real values live in Bitwarden ("Google — START-SYS Drive — OAuth client"). ` +
        `To mint a new refresh token or folder, see docs/runbooks/06-GOOGLE-DRIVE-SETUP-FOR-CCDO.md. ` +
        `To run without Drive, set DOCUMENT_STORE=supabase_storage (ADR 0005) or =fake.`,
    );
  }

  const auth = new google.auth.OAuth2({ clientId, clientSecret });
  // No access token is stored: googleapis exchanges the refresh token for one on demand
  // and caches it in memory for the lifetime of the function instance. The refresh token
  // itself does not expire — which is true ONLY because the OAuth consent screen is
  // published ("In production"). On "Testing" Google expires it after 7 days, silently,
  // and this integration would die exactly the way it died on 2026-09-10.
  auth.setCredentials({ refresh_token: refreshToken });

  cached = { folderId, auth };

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
 * account, the parent folder and often the Drive itself, and this error can end
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
    throw unavailable(error, "could not exchange the refresh token for an access token");
  }
}

/**
 * Normalise whatever gaxios hands back for `responseType: "stream"` into a web stream.
 *
 * WHY THIS IS NOT JUST `Readable.toWeb`: gaxios 7 (which googleapis pulls in on its own
 * cadence) returns a WHATWG `ReadableStream`; earlier majors returned a Node `Readable`.
 * Calling `Readable.toWeb()` on something that is already a web stream produces a stream
 * that Next tears down mid-response with `Error: The destination stream closed early` —
 * a 500 on the proof proxy that says nothing about its cause. Detect, do not assume; the
 * same defensive shape as `headerValue` above and for the same reason.
 */
function toWebStream(data: unknown): ReadableStream<Uint8Array> {
  if (
    typeof data === "object" &&
    data !== null &&
    typeof (data as ReadableStream).getReader === "function"
  ) {
    return data as ReadableStream<Uint8Array>;
  }
  return Readable.toWeb(data as Readable) as ReadableStream<Uint8Array>;
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
    const name = input.documentKind
      ? `${input.applicationId}-${input.documentKind}.${extensionForMime(mime)}`
      : `${input.applicationId}.${extensionForMime(mime)}`;

    let response: Response;
    try {
      const initHeaders: Record<string, string> = {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(input.sizeBytes),
      };

      // THE HEADER THAT MAKES THE BROWSER PUT READABLE. Google binds CORS on a resumable
      // session to the origin given HERE, at initiation — not to the origin of the PUT.
      // Without it the upload completes and Google answers 200 with no
      // `Access-Control-Allow-Origin`, so the browser discards a successful upload as a
      // network error and the applicant is told to check their connection. See
      // `lib/documents/request-origin.ts` for the measurement.
      if (input.browserOrigin) initHeaders["Origin"] = input.browserOrigin;

      response = await fetch(RESUMABLE_ENDPOINT, {
        method: "POST",
        headers: initHeaders,
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
        stream: toWebStream(media.data),
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
  const drive = driveClient();

  // 1. Can we see the folder at all?
  //
  // Under `drive.file` this answers a sharper question than it looks like: the scope
  // grants access ONLY to files this app created, so a folder someone made by hand in
  // the Drive web UI returns 404 here no matter how it is shared. That 404 is precisely
  // what `GOOGLE_DRIVE_PROOF_FOLDER_ID` pointed at before 2026-09-10, and it is why the
  // folder must be created THROUGH the API (docs/runbooks/06), never in the browser.
  let canAddChildren: boolean | null = null;
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: "id, capabilities(canAddChildren)",
      supportsAllDrives: true,
    });
    canAddChildren = response.data.capabilities?.canAddChildren ?? null;
  } catch (error) {
    throw unavailable(error, "health check could not read the proof-of-enrollment folder");
  }

  // 2. May we write into it? A readable-but-not-writable folder passes step 1 and then
  //    fails every upload, which is a worse failure than an outright 404 because the
  //    probe would have said "ok".
  if (canAddChildren === false) {
    throw new DocumentUnavailableError(
      "Drive document store: health check found the proof-of-enrollment folder is not writable",
      403,
    );
  }

  // 3. Is there quota to commit bytes into?
  //
  // THE CHECK THAT WOULD HAVE CAUGHT THE 2026-09-10 OUTAGE. Steps 1 and 2 both passed
  // for the service account; the failure only appeared on the final PUT, as
  // `403 "Service Accounts do not have storage quota"`. A principal with no quota
  // reports no `limit` and no `usage` at all, so an absent quota block is itself the
  // signal — not a missing field to shrug at.
  try {
    const about = await drive.about.get({ fields: "storageQuota(limit,usage)" });
    const quota = about.data.storageQuota;

    if (!quota || (quota.limit == null && quota.usage == null)) {
      throw new DocumentUnavailableError(
        "Drive document store: health check found no storage quota for the Drive principal — " +
          "uploads will be refused on commit (ADR 0018)",
        403,
      );
    }

    if (quota.limit != null && quota.usage != null && BigInt(quota.usage) >= BigInt(quota.limit)) {
      throw new DocumentUnavailableError(
        "Drive document store: health check found the Drive account is out of storage",
        507,
      );
    }
  } catch (error) {
    if (error instanceof DocumentUnavailableError) throw error;
    throw unavailable(error, "health check could not read the Drive storage quota");
  }
}
