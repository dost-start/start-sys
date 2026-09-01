// ─────────────────────────────────────────────────────────────────────────────
// The document boundary's entry point. BUILD_PLAN S3-T9, S3-T12, S4-T16.
//
// EVERYTHING OUTSIDE `lib/documents/` IMPORTS FROM HERE AND FROM NOWHERE ELSE. Not from
// `./drive-store`, not from `./supabase-storage-store`, not from `./fake-store`. That
// single rule is what makes ADR 0005's fallback an environment-variable flip: swapping
// `DOCUMENT_STORE` changes which module this file loads and nothing else in the
// repository moves — not `lib/applications/`, not `app/(public)/apply/`, not S4's proof
// proxy, and not the schema.
//
// `getDocumentStore()` IS SYNCHRONOUS, and the three drivers are imported statically. A
// dynamic-import version would keep `googleapis` out of functions that never read a
// document, but it would make the selector async, and the S3 intake lane consumes this
// contract as `getDocumentStore().createUploadSession(...)`. A cheaper cold start is not
// worth a shape the rest of the slice has to bend around. If the parse cost of googleapis
// ever shows up in the S7 benchmark, the fix is a lazy driver behind this same synchronous
// signature — not a change to the signature.
//
// TWO CONSEQUENCES OF THE STATIC IMPORTS, both fine and both worth knowing:
//   · This module reaches `lib/server/admin-client.ts` (through the Storage driver), which
//     imports the `server-only` package. **So this module is server-only in the strict
//     sense: importing it from a Client Component is a build error.** That is the correct
//     direction — every caller here is a Server Action, a Route Handler or a job.
//   · For the same reason it cannot be imported from a Vitest suite. The contract test
//     therefore imports the drivers directly (`./fake-store`, `./types`) rather than
//     through here, which is also what lets it parameterise over them.
// ─────────────────────────────────────────────────────────────────────────────

import { driveDocumentStore, pingDrive } from "./drive-store";
import { fakeDocumentStore } from "./fake-store";
import { pingSupabaseStorage, supabaseStorageDocumentStore } from "./supabase-storage-store";
import type { DocumentStore, DocumentStream } from "./types";

export {
  ALLOWED_MIME,
  MAX_PROOF_BYTES,
  SNIFF_BYTES,
  DocumentRejectedError,
  DocumentUnavailableError,
  assertAcceptableUpload,
  extensionForMime,
  isAllowedMime,
} from "./types";

export type {
  AllowedMime,
  CreateUploadSessionInput,
  DocumentStore,
  DocumentStream,
  RejectionReason,
  UploadSession,
  VerifiedUpload,
} from "./types";

export { resolveVerifiedMime, sniffMime } from "./sniff-mime";

/** The three drivers. `DOCUMENT_STORE` must be exactly one of these. */
export const DOCUMENT_STORE_NAMES = ["fake", "drive", "supabase_storage"] as const;

export type DocumentStoreName = (typeof DOCUMENT_STORE_NAMES)[number];

function isDocumentStoreName(value: string): value is DocumentStoreName {
  return (DOCUMENT_STORE_NAMES as readonly string[]).includes(value);
}

/**
 * Which driver is active, read from the environment AT CALL TIME.
 *
 * At call time, never at module load: a build that has no environment — a CI typecheck,
 * a static analysis pass — must still succeed, and a test must be able to switch drivers
 * between cases.
 *
 * @throws on any value outside the three names, naming what was found. An unrecognised
 *         `DOCUMENT_STORE` must be a loud failure and never a silent fallback to a
 *         default: quietly selecting the fake store in production would accept a
 *         scholar's Certificate of Registration into a temp directory and report success.
 */
export function documentStoreName(): DocumentStoreName {
  const raw = process.env.DOCUMENT_STORE;

  if (raw === undefined || raw === "") {
    throw new Error(
      `DOCUMENT_STORE is not set. Expected one of: ${DOCUMENT_STORE_NAMES.join(", ")}. ` +
        `See .env.example and docs/decisions/0005-document-store-fallback.md.`,
    );
  }

  if (!isDocumentStoreName(raw)) {
    throw new Error(
      `DOCUMENT_STORE="${raw}" is not a known document store. ` +
        `Expected one of: ${DOCUMENT_STORE_NAMES.join(", ")}. ` +
        `See docs/decisions/0005-document-store-fallback.md.`,
    );
  }

  return raw;
}

const STORES: Record<DocumentStoreName, DocumentStore> = {
  fake: fakeDocumentStore,
  drive: driveDocumentStore,
  supabase_storage: supabaseStorageDocumentStore,
};

/**
 * The active document store.
 *
 * @throws if `DOCUMENT_STORE` is unset or unrecognised. Driver-specific configuration
 *         (Google credentials, the Supabase service-role key) is validated lazily by the
 *         driver at first real use, so a misconfigured deployment fails naming the exact
 *         missing variable rather than failing here with something vaguer.
 */
export function getDocumentStore(): DocumentStore {
  return STORES[documentStoreName()];
}

/**
 * Open a read stream over a stored proof-of-enrollment document.
 *
 * **DEFINED HERE, IN S3, SO S4 DOES NOT INVENT A SECOND SHAPE** (BUILD_PLAN S4-T16). The
 * proof proxy — `GET /api/applications/[id]/proof` — must import this and must NOT
 * import `googleapis`, because S3's fallback swaps the backend behind this function and
 * that swap must not touch the route.
 *
 * ⚠️ **THIS FUNCTION PERFORMS NO AUTHORIZATION AND NO AUDIT WRITE.** It is a byte pipe.
 * The caller is responsible, IN THIS ORDER, for: an ordinary RLS-checked SELECT with the
 * CALLER'S OWN JWT (a row returned means authorized; nothing returned means 404, never
 * 403 — a 403 confirms the application exists); then the `log_document_view()` audit
 * write, which FAILS CLOSED — if it errors, return 500 and do not call this function. An
 * unlogged view is a compliance failure under RA 10173 and CBL Art. VIII §6, so the
 * record is written before a single byte moves.
 *
 * @throws {DocumentUnavailableError} on 404 / 403 / network failure, carrying no provider
 *         message — a Google error body names the service account, the folder and the
 *         Drive, and this error can end up in a response.
 */
export async function getProofStream(storageRef: string): Promise<DocumentStream> {
  return getDocumentStore().streamDocument(storageRef);
}

/**
 * Liveness probe for `GET /api/health/drive` (BUILD_PLAN S7-T5).
 *
 * Reports **the driver that actually shipped**, which S7 needs for two things beyond the
 * health check itself: the privacy notice's processor list, and the RA 10173 processing
 * register. A notice that names Google Drive while the files are in Supabase Storage
 * misstates where personal data lives, which is worse than no notice.
 */
export async function pingDocumentStore(): Promise<{ driver: DocumentStoreName }> {
  const name = documentStoreName();

  switch (name) {
    case "fake": {
      // Nothing to probe: no network, no credential. Reporting healthy is correct, and
      // reporting the driver name is what tells the operator this is not production.
      break;
    }
    case "drive": {
      await pingDrive();
      break;
    }
    case "supabase_storage": {
      await pingSupabaseStorage();
      break;
    }
  }

  return { driver: name };
}
