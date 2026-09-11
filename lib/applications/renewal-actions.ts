"use server";

// ─────────────────────────────────────────────────────────────────────────────
// The accountless Membership Renewal Form — the two public Server Actions (PRD US-G7,
// US-H5; SRS "Membership Renewal Form"; meeting 2026-09-05 §D).
//
//   startRenewal      verify member ID + email against the record, write the draft, mint
//                     the two upload sessions
//   finalizeRenewal   re-verify both uploads from provider metadata, then draft → pending
//
// Same shape as lib/applications/actions.ts, and deliberately so: withPublic() (rate
// limits + the shared schema), a submit token instead of an anon UPDATE policy, the
// documents PUT straight to the store, the server never trusting the browser's claim
// about what it uploaded. What differs is identity: `start_renewal()` (0044) resolves the
// person from the member ID + email pair and refuses a mismatch with P0002, which this
// action maps to a field error — see 0044's header for why that is an explicit answer
// rather than /apply's uniform one.
//
// Nothing here logs a field value or the token.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";

import { err, mapDbError, ok, type ActionResult } from "@/lib/action-result";
import { withPublic } from "@/lib/auth/with-public";
import { getDocumentStore } from "@/lib/documents";
import { browserOriginFromRequest } from "@/lib/documents/request-origin";
import {
  DocumentRejectedError,
  isAllowedMime,
  MAX_PROOF_BYTES,
  type DocumentStore,
  type UploadSession,
  type VerifiedUpload,
} from "@/lib/documents/types";

import {
  buildApplicationPayload,
  declaredDocumentRefusedMessage,
  DOCUMENT_REFUSED_GENERIC_MESSAGE,
  documentRefusalFromReason,
  submissionStandardsFieldErrors,
  SUBMISSION_STANDARDS_GENERIC_MESSAGE,
  uploadedDocumentRefusedMessage,
  type DocumentRefusal,
} from "./schema";
import {
  finalizeRenewalSchema,
  startRenewalSchema,
  type StartRenewalInput,
} from "./renewal-schema";

const SUBMIT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const SUBMIT_TOKEN_BYTES = 32;

export type StartRenewalResult = {
  renewalId: string;
  /** Plaintext, returned once; only its sha256 is stored. Never rendered, never logged. */
  uploadToken: string;
  uploadUrl: string;
  storageRef: string;
  noaUploadUrl: string;
  noaStorageRef: string;
};

export type FinalizeRenewalResult = { status: "pending" };

function hashSubmitToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ── Per-document checks (Officer feedback 2026-09-11) ────────────────────────
// Mirrors lib/applications/actions.ts: one try per document, so a refusal names the
// document it belongs to. It describes the scholar's own file and nothing else.

/** One document's upload session, or why it was not minted. */
type SessionMint =
  | { kind: "minted"; session: UploadSession }
  | { kind: "refused"; refusal: DocumentRefusal }
  | { kind: "unavailable" };

/** Mint one document's upload session. The store's own message never reaches the scholar. */
async function mintUploadSession(mint: () => Promise<UploadSession>): Promise<SessionMint> {
  try {
    return { kind: "minted", session: await mint() };
  } catch (caught) {
    if (caught instanceof DocumentRejectedError) {
      return { kind: "refused", refusal: documentRefusalFromReason(caught.reason) };
    }
    return { kind: "unavailable" };
  }
}

/** One stored document, verified, or why it failed verification. */
type DocumentCheck =
  | { kind: "verified"; upload: VerifiedUpload }
  | { kind: "refused"; refusal: DocumentRefusal }
  | { kind: "unavailable" };

/** Re-verify one stored document from provider metadata and magic bytes. */
async function verifyStoredDocument(store: DocumentStore, ref: string): Promise<DocumentCheck> {
  try {
    const upload = await store.verifyUpload(ref);
    if (!isAllowedMime(upload.mimeType)) return { kind: "refused", refusal: "not_pdf" };
    if (upload.sizeBytes > MAX_PROOF_BYTES) return { kind: "refused", refusal: "too_large" };
    return { kind: "verified", upload };
  } catch (caught) {
    if (caught instanceof DocumentRejectedError) {
      return { kind: "refused", refusal: documentRefusalFromReason(caught.reason) };
    }
    return { kind: "unavailable" };
  }
}

const MISMATCH_MESSAGE =
  "We could not match that member ID and email address. Check both against your records — the email must be the one START-DOST has on file. If it has changed, contact CRRD.";

const NOT_RENEWABLE_MESSAGE =
  "This membership cannot be renewed through this form. You may already be an active member this term, or a renewal may already have been submitted. Contact CRRD if you think this is wrong.";

export const startRenewal = withPublic<StartRenewalInput, StartRenewalResult>(
  {
    // The same buckets and budgets as /apply: the mismatch answer is a probe, and the
    // limiter is what makes it an impractical one (0044's header).
    rateLimit: [
      { bucket: "apply_ip", limit: process.env.E2E_RATE_LIMIT_BOOST ? 10_000 : 10 },
      {
        bucket: "apply_email",
        limit: process.env.E2E_RATE_LIMIT_BOOST ? 10_000 : 3,
        key: (input) => input.applicant_email.toLowerCase(),
      },
    ],
    schema: startRenewalSchema,
  },
  async (ctx, input) => {
    const uploadToken = randomBytes(SUBMIT_TOKEN_BYTES).toString("hex");
    const expiresAt = new Date(Date.now() + SUBMIT_TOKEN_TTL_MS).toISOString();
    const consentGivenAt = new Date().toISOString();

    // The renewal body is the application body (same keys, same section components), so
    // approve_renewal()'s payload ->> reads line up with approve_application()'s.
    const { member_id, ...applicationFields } = input;
    const payload = buildApplicationPayload(applicationFields, consentGivenAt);

    // ── Submission-time standards (ADR 0013 §1/§4) ──────────────────────────
    // Same five standards as /apply, checked BEFORE start_renewal() so a renewal that
    // fails one is refused here rather than reaching a `pending` row.
    const { data: standardsFailures, error: standardsError } = await ctx.supabase.rpc(
      "check_submission_standards",
      { p_email: input.applicant_email, p_payload: payload },
    );
    if (standardsError) {
      return { ok: false, error: mapDbError(standardsError) };
    }
    if (standardsFailures && standardsFailures.length > 0) {
      if (standardsFailures.includes("term")) {
        return err<StartRenewalResult>("window_closed");
      }
      return err<StartRenewalResult>(
        "validation",
        SUBMISSION_STANDARDS_GENERIC_MESSAGE,
        submissionStandardsFieldErrors(standardsFailures),
      );
    }

    const { data: renewalId, error } = await ctx.supabase.rpc("start_renewal", {
      p_member_id: member_id,
      p_email: input.applicant_email,
      p_payload: payload,
      p_token_hash: hashSubmitToken(uploadToken),
      p_token_expires_at: expiresAt,
    });

    if (error || !renewalId) {
      const code = typeof error?.code === "string" ? error.code : "";
      if (code === "P0002") {
        return {
          ok: false,
          error: {
            code: "validation",
            message: MISMATCH_MESSAGE,
            fields: { member_id: [MISMATCH_MESSAGE] },
          },
        };
      }
      if (code === "55000") return err<StartRenewalResult>("conflict", NOT_RENEWABLE_MESSAGE);
      const mapped = mapDbError(error);
      if (mapped.code === "unauthorized") return err<StartRenewalResult>("window_closed");
      return { ok: false, error: mapped };
    }

    let browserOrigin: string | null;
    let store: DocumentStore;
    try {
      browserOrigin = await browserOriginFromRequest();
      store = getDocumentStore();
    } catch {
      return err<StartRenewalResult>("upstream");
    }

    const registration = await mintUploadSession(() =>
      store.createUploadSession({
        applicationId: renewalId,
        fileName: input.proof_file_name,
        mimeType: input.proof_mime_type,
        sizeBytes: input.proof_size_bytes,
        documentKind: "registration",
        browserOrigin,
      }),
    );
    if (registration.kind === "unavailable") return err<StartRenewalResult>("upstream");
    const noa = await mintUploadSession(() =>
      store.createUploadSession({
        applicationId: renewalId,
        fileName: input.noa_file_name,
        mimeType: input.noa_mime_type,
        sizeBytes: input.noa_size_bytes,
        documentKind: "noa",
        browserOrigin,
      }),
    );

    if (registration.kind === "refused" || noa.kind === "refused") {
      const fields: Record<string, string[]> = {};
      if (registration.kind === "refused") {
        fields["proof_file"] = [declaredDocumentRefusedMessage("proof_file", registration.refusal)];
      }
      if (noa.kind === "refused") {
        fields["noa_file"] = [declaredDocumentRefusedMessage("noa_file", noa.refusal)];
      }
      return err<StartRenewalResult>("validation", DOCUMENT_REFUSED_GENERIC_MESSAGE, fields);
    }
    if (noa.kind === "unavailable") return err<StartRenewalResult>("upstream");

    return ok({
      renewalId,
      uploadToken,
      uploadUrl: registration.session.uploadUrl,
      storageRef: registration.session.storageRef,
      noaUploadUrl: noa.session.uploadUrl,
      noaStorageRef: noa.session.storageRef,
    });
  },
);

export const finalizeRenewal = withPublic(
  {
    rateLimit: { bucket: "finalize_ip", limit: 20 },
    schema: finalizeRenewalSchema,
  },
  async (ctx, input): Promise<ActionResult<FinalizeRenewalResult>> => {
    const store = getDocumentStore();

    // Both documents re-verified from provider metadata; on any refusal both objects are
    // deleted and the scholar picks both again. The refusal names WHICH document failed
    // and why (Officer feedback 2026-09-11).
    const [registrationCheck, noaCheck] = await Promise.all([
      verifyStoredDocument(store, input.storage_ref),
      verifyStoredDocument(store, input.noa_storage_ref),
    ]);

    if (registrationCheck.kind === "refused" || noaCheck.kind === "refused") {
      await Promise.all([
        store.deleteDocument(input.storage_ref).catch(() => undefined),
        store.deleteDocument(input.noa_storage_ref).catch(() => undefined),
      ]);
      const fields: Record<string, string[]> = {};
      if (registrationCheck.kind === "refused") {
        fields["proof_file"] = [
          uploadedDocumentRefusedMessage("proof_file", registrationCheck.refusal),
        ];
      }
      if (noaCheck.kind === "refused") {
        fields["noa_file"] = [uploadedDocumentRefusedMessage("noa_file", noaCheck.refusal)];
      }
      return err<FinalizeRenewalResult>("validation", DOCUMENT_REFUSED_GENERIC_MESSAGE, fields);
    }
    if (registrationCheck.kind === "unavailable" || noaCheck.kind === "unavailable") {
      return err<FinalizeRenewalResult>("upstream");
    }
    const verified = registrationCheck.upload;
    const noaVerified = noaCheck.upload;

    const { error } = await ctx.supabase.rpc("finalize_renewal", {
      p_id: input.renewal_id,
      p_token: input.upload_token,
      p_file_ref: input.storage_ref,
      p_mime: verified.mimeType,
      p_size: verified.sizeBytes,
      p_noa_ref: input.noa_storage_ref,
      p_noa_mime: noaVerified.mimeType,
      p_noa_size: noaVerified.sizeBytes,
    });
    if (error) {
      const mapped = mapDbError(error);
      if (mapped.code === "unauthorized") return err<FinalizeRenewalResult>("validation");
      return { ok: false, error: mapped };
    }

    return ok({ status: "pending" as const });
  },
);
