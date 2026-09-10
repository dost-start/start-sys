// ─────────────────────────────────────────────────────────────────────────────
// THE DOCUMENT BOUNDARY — the interface, the limits, and the two error types.
//
// BUILD_PLAN S3-T9. This file is the whole reason the Google Drive → Supabase Storage
// fallback (ADR 0005) is an environment-variable flip rather than a rewrite: NO
// SIGNATURE BELOW CONTAINS PROVIDER VOCABULARY. There is no `fileId`, no `bucket`, no
// `webContentLink` in any parameter name. A caller holds a `storageRef`, which is
// PROVIDER-OPAQUE BY CONTRACT — a Google Drive file id under one driver, a Supabase
// Storage object path under another — and nothing outside `lib/documents/` may
// interpret, parse, split or construct one. `applications.proof_drive_file_id` stores
// exactly this opaque string, which is why swapping drivers needs no migration
// (DATA_MODEL.md §6/0008; ARCHITECTURE.md §4.1 "Fallback").
//
// THE INVARIANT THIS DIRECTORY EXISTS TO KEEP:
//   `googleapis` is imported by `lib/documents/drive-store.ts` and by nothing else in
//   the repository. Same for the Supabase Storage bucket name. Grep is the test:
//     grep -rn "googleapis" app/ components/ lib/ --exclude-dir=documents   # → empty
//
// TWO PRIVACY RULES THAT ARE NOT NEGOTIABLE, both PRD US-J2 read with CBL Art. VIII §6:
//   1. A provider URL — a Drive `webViewLink`, a Storage public URL, a signed read URL —
//      NEVER REACHES A BROWSER. `verifyUpload` returns `webViewLink` so the server can
//      persist it in `applications.proof_web_view_link` for auditing and for the 5-year
//      purge; it is a sensitive column (0008) and is not in any GRANT. Documents are
//      read through `GET /api/applications/[id]/proof`, which authorizes with an
//      ordinary RLS-checked SELECT and writes an audit row (ARCHITECTURE.md §4.1 step 7).
//   2. No store implementation ever creates a sharing permission on a file. Not
//      "anyone with the link", not a per-user grant. The proxy is the only read path.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The only MIME type a proof-of-enrollment document may be: PDF.
 *
 * Narrowed from four types to one on 2026-09-09 (migration 0060). Ethan, relaying the
 * CCDO: the Certificate of Registration and the Notice of Award are both issued as PDFs
 * — "most of the documents right now is online" — so accepting camera rolls bought
 * nothing and cost a real failure mode.
 *
 * THE FAILURE MODE IT COST, because it is worth not re-introducing: `image/heic` was
 * accepted because it is what an iPhone produces by default. NO BROWSER RENDERS HEIC, so
 * the review screen could not display one, and the designed response was to reject the
 * application and ask for a re-upload. Read together with the decision of the same day
 * that REJECTION IS FINAL FOR THE TERM, that would have permanently rejected qualified
 * scholars for owning an iPhone.
 *
 * Mirrored — deliberately, because each is the last gate on its own side of a trust
 * boundary — by `finalize_application()` and `finalize_renewal()` (migration 0060) and
 * by `storage.buckets.allowed_mime_types` (0021, narrowed by 0060). If you change this
 * list, change those in a NEW migration. A gate that trusts its caller is not a gate.
 */
export const ALLOWED_MIME = ["application/pdf"] as const;

export type AllowedMime = (typeof ALLOWED_MIME)[number];

/**
 * What the magic-byte sniffer can RECOGNISE — deliberately wider than what we ACCEPT.
 *
 * The distinction earns its keep in the error message. If the sniffer only knew about
 * PDF, a scholar who uploaded a photo would be told their file was "unidentifiable",
 * which is both untrue and unactionable. Because the sniffer still recognises the three
 * image types, they are told the file is an image and that only PDFs are accepted.
 *
 * It also keeps the mismatch check meaningful: a PNG renamed `.pdf` is caught as a PNG,
 * not as an unreadable blob.
 */
export const SNIFFABLE_MIME = ["application/pdf", "image/jpeg", "image/png", "image/heic"] as const;

export type SniffableMime = (typeof SNIFFABLE_MIME)[number];

/**
 * What the proof proxy will put in a `Content-Type` header — the types we can still
 * SERVE, as distinct from the one type we still ACCEPT.
 *
 * WHY THIS IS SEPARATE FROM `ALLOWED_MIME`. Narrowing intake to PDF (0060) says nothing
 * about documents that were already uploaded and accepted under the old four-type rule.
 * Those are real Certificates of Registration belonging to real applicants, already
 * reviewed or awaiting review. Guarding the read path on `ALLOWED_MIME` would turn every
 * one of them into an HTTP 500 the moment the allowlist moved — a narrowing of what we
 * accept must never retroactively destroy what we hold.
 *
 * WHY IT IS SEPARATE FROM `SNIFFABLE_MIME` DESPITE HAVING THE SAME MEMBERS TODAY. They
 * answer different questions. `SNIFFABLE_MIME` is "byte signatures the sniffer can
 * identify", which grows if we ever teach it a new format. This is "types the proxy is
 * willing to hand a browser", which is a header-injection surface and a rendering
 * decision. Collapsing them would mean that teaching the sniffer a new format silently
 * widened what the proxy serves.
 *
 * **THIS LIST IS FROZEN AND CAN ONLY EVER SHRINK.** It is a record of what intake
 * accepted in the past, so nothing new can enter it: a new type would have to be
 * accepted by `ALLOWED_MIME` first, and PDF is already here. Entries leave only when no
 * stored row can still carry them — realistically after the five-year purge
 * (DATA_MODEL.md §8.2), not before. It is verifiably exactly these four: every database
 * allowlist from 0019 through 0045 named the same set, so no other value can be in a
 * stored row. (`image/heif` appears in the viewer's unviewable set but was NEVER
 * accepted by any gate, so it is deliberately absent here.)
 *
 * ⚠ **NOTHING SCRIPT-BEARING MAY EVER JOIN THIS LIST.** It is the source of a
 * `Content-Type` on a route that streams user-uploaded bytes, which is precisely a
 * stored-XSS delivery mechanism. `image/svg+xml` and `text/html` are permanently
 * excluded by name — an SVG is a script container, and both would execute in the
 * viewer's origin. `x-content-type-options: nosniff` on the response is the second
 * layer, not the first.
 *
 * ⚠ **NOT THE CONSTANT TO USE AT INTAKE.** `assertAcceptableUpload()` deliberately uses
 * `ALLOWED_MIME`. Reaching for this one there "for symmetry" would silently undo the
 * PDF-only narrowing.
 *
 * The read path stays as safe as it was: the value still comes from the STORED
 * `proof_mime_type` column, checked against this allowlist, and never from the
 * provider's response header or a query parameter.
 */
export const SERVABLE_MIME = ["application/pdf", "image/jpeg", "image/png", "image/heic"] as const;

export type ServableMime = (typeof SERVABLE_MIME)[number];

/**
 * Maximum accepted size, 10 MiB. Mirrored by the `p_size > 10485760` check in
 * `finalize_application()` and by `storage.buckets.file_size_limit` in migration 0021.
 *
 * Note this is well above Vercel's 4.5 MB request-body cap, which is exactly why the
 * browser PUTs directly to the provider and never through a Route Handler
 * (ARCHITECTURE.md §4.1 step 4). If you find yourself proxying bytes through a function
 * to make something work, that path fails in the field on a real phone photo.
 */
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

/** How many bytes of the stored object are read back to sniff its magic bytes. */
export const SNIFF_BYTES = 512;

// ── The interface ────────────────────────────────────────────────────────────

export type CreateUploadSessionInput = {
  /** The `applications.id` the document belongs to. Used only to shape the ref. */
  applicationId: string;
  /** The client's file name. Used for an extension and a human-readable object name. NEVER trusted for type. */
  fileName: string;
  /** The client's CLAIM about the type. Checked against `ALLOWED_MIME` here and re-verified after upload. */
  mimeType: string;
  /** The client's CLAIM about the size. Checked against `MAX_PROOF_BYTES` here and re-verified after upload. */
  sizeBytes: number;
  /** Which of an application's documents this is ("registration" | "noa"). Naming only. */
  documentKind?: string;
  /**
   * The origin of the page that will PUT the bytes, e.g. `https://start-sys.vercel.app`.
   *
   * REQUIRED, and required on purpose. Google binds CORS on a resumable upload to the
   * origin named at INITIATION: omit it and the PUT still succeeds server-side but comes
   * back without `Access-Control-Allow-Origin`, so the browser throws away a completed
   * upload as a network failure. That was half of the 2026-09-10 outage. Making it
   * optional would let a future caller reintroduce it silently — see
   * `lib/documents/request-origin.ts`.
   *
   * `null` is accepted only for callers with no request context (a job, a test).
   */
  browserOrigin: string | null;
};

export type UploadSession = {
  /**
   * Where the browser PUTs the bytes. Short-lived, single-file, single-folder.
   *
   * Leaking this URL is uninteresting: it accepts one upload into one location and then
   * expires. It must still never be rendered into the DOM, the URL bar or a data
   * attribute (S3-T19) — not because it is a secret, but because anything on the page is
   * something a support screenshot can carry.
   */
  uploadUrl: string;
  /**
   * The provider-opaque reference to the object that upload will produce. Known BEFORE
   * the bytes move under every driver — the Drive driver pre-allocates a file id with
   * `files.generateIds` precisely so this is true — which means the server never has to
   * believe a client's claim about what it created.
   */
  storageRef: string;
};

export type VerifiedUpload = {
  /** The provider's OWN byte count. Never the client's claim. */
  sizeBytes: number;
  /** The type established by magic bytes, cross-checked against provider metadata. Always in `ALLOWED_MIME`. */
  mimeType: AllowedMime;
  /** The provider's view URL, for `applications.proof_web_view_link`. **Server-side only — never returned to a browser.** */
  webViewLink: string | null;
};

export type DocumentStream = {
  stream: ReadableStream<Uint8Array>;
  /** `null` when the provider does not report a length; the proxy then omits `Content-Length`. */
  contentLength: number | null;
};

/**
 * The five operations the rest of the system is allowed to perform on a document.
 *
 * `streamDocument` is here rather than in S4 on purpose (BUILD_PLAN S4-T16): defining it
 * now means the proof proxy consumes this interface instead of inventing a second,
 * provider-shaped one that the fallback would then have to swap twice.
 */
export interface DocumentStore {
  /** Mint a short-lived, single-file upload session. Rejects an oversize or disallowed file BEFORE contacting the provider. */
  createUploadSession(input: CreateUploadSessionInput): Promise<UploadSession>;

  /**
   * Re-fetch the provider's own metadata and sniff the stored bytes.
   *
   * THE CLIENT IS NOT BELIEVED. On any disagreement — unidentifiable bytes, a declared
   * type the magic bytes contradict, a size over the cap — the implementation DELETES
   * the object and throws `DocumentRejectedError`. A rejected upload must not be left
   * sitting in the store: it is somebody's file, we have no basis to keep it, and an
   * orphan is a retention problem nobody owns.
   */
  verifyUpload(storageRef: string): Promise<VerifiedUpload>;

  /** Open a read stream. Used ONLY by `GET /api/applications/[id]/proof`, after its own RLS check and audit write. */
  streamDocument(storageRef: string): Promise<DocumentStream>;

  /** Remove an object. IDEMPOTENT: deleting an absent object succeeds silently. */
  deleteDocument(storageRef: string): Promise<void>;

  /**
   * Every ref the store holds that is not in `knownRefs`.
   *
   * The case this exists for: the browser's PUT succeeded but `finalize_application()`
   * never ran, so the bytes exist and the database has no pointer to them. Nothing else
   * would ever find that file (S3-T22).
   */
  listOrphans(knownRefs: string[]): Promise<string[]>;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * The document is gone, unreachable, or the provider refused us.
 *
 * Named in BUILD_PLAN S4-T16 so the proof proxy maps it to a 500 (or a 404 where the
 * ref itself is unknown) WITHOUT leaking the provider's own message — a Google error
 * body can name a service account, a folder and a Drive.
 */
export class DocumentUnavailableError extends Error {
  readonly name = "DocumentUnavailableError";
  /** Provider HTTP status where one was observed. Diagnostic only; never rendered. */
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

/** Why a file was refused. Maps to a user-facing message in the action layer, never here. */
export type RejectionReason =
  "mime_not_allowed" | "too_large" | "empty_file" | "mime_mismatch" | "unidentifiable";

/**
 * The file itself is unacceptable — wrong type, too big, or its magic bytes contradict
 * what was declared.
 *
 * Distinct from `DocumentUnavailableError` because the caller does something different:
 * S3-T16 maps this to `validation` and keeps the applicant's form state intact so they
 * can pick another file without re-entering anything, whereas unavailability is an
 * upstream failure.
 *
 * The message is deliberately generic and carries no file name, no path and no ref —
 * it can end up in a log line, and a file name is frequently a person's own name.
 */
export class DocumentRejectedError extends Error {
  readonly name = "DocumentRejectedError";
  readonly reason: RejectionReason;

  constructor(reason: RejectionReason, message?: string) {
    super(message ?? DEFAULT_REJECTION_MESSAGE[reason]);
    this.reason = reason;
  }
}

const DEFAULT_REJECTION_MESSAGE: Record<RejectionReason, string> = {
  mime_not_allowed: "Only PDF files are accepted. Please upload your document as a PDF.",
  too_large: "File is larger than the 10MB limit.",
  empty_file: "File is empty.",
  mime_mismatch: "File contents do not match the declared file type.",
  unidentifiable: "File contents could not be identified as an accepted document type.",
};

// ── Shared pre-flight ────────────────────────────────────────────────────────

/** Narrowing predicate over the allowlist — what we ACCEPT. */
export function isAllowedMime(value: string): value is AllowedMime {
  return (ALLOWED_MIME as readonly string[]).includes(value);
}

/** Narrowing predicate over what the sniffer can RECOGNISE. Wider than the allowlist. */
export function isSniffableMime(value: string): value is SniffableMime {
  return (SNIFFABLE_MIME as readonly string[]).includes(value);
}

/**
 * Narrowing predicate over what the proxy may SERVE. Wider than the allowlist because it
 * covers documents stored before the PDF-only narrowing — see `SERVABLE_MIME`.
 *
 * Use this in the proof proxies. Using `isAllowedMime` there instead makes every
 * pre-0060 document a 500.
 */
export function isServableMime(value: string): value is ServableMime {
  return (SERVABLE_MIME as readonly string[]).includes(value);
}

/**
 * The check every driver runs FIRST, before a single provider API call.
 *
 * "Reject bad MIME/size before touching the provider" is BUILD_PLAN S3-T10's acceptance
 * criterion and it is not merely an optimisation: an unauthenticated caller must not be
 * able to make us spend a Google API quota unit, or create an object we then have to
 * clean up, by declaring a 4GB file.
 *
 * @throws {DocumentRejectedError}
 */
export function assertAcceptableUpload(input: CreateUploadSessionInput): AllowedMime {
  if (!isAllowedMime(input.mimeType)) {
    throw new DocumentRejectedError("mime_not_allowed");
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new DocumentRejectedError("empty_file");
  }
  if (input.sizeBytes > MAX_PROOF_BYTES) {
    throw new DocumentRejectedError("too_large");
  }
  return input.mimeType;
}

/** The file extension each accepted type is stored with. Never taken from the client's file name. */
const EXTENSION_FOR_MIME: Record<AllowedMime, string> = {
  "application/pdf": "pdf",
};

/**
 * The extension to store the object under, derived from the VERIFIED-CANDIDATE type
 * rather than from the client's file name.
 *
 * A client-supplied name is attacker-controlled and is the classic path-traversal and
 * double-extension vector; it is also, routinely, a scholar's full name. It is used for
 * neither the ref nor the stored name.
 */
export function extensionForMime(mime: AllowedMime): string {
  return EXTENSION_FOR_MIME[mime];
}
