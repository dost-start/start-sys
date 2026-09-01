"use server";

// ─────────────────────────────────────────────────────────────────────────────
// THE ONLY UNAUTHENTICATED WRITE PATH IN START-SYS (BUILD_PLAN S3-T15, S3-T16).
//
// Two actions, one flow, three trust boundaries:
//
//   startApplication     anon INSERT of a `draft` row + a submit token + a resumable
//                        upload session. The applicant's browser then PUTs the bytes
//                        DIRECTLY to the document store — they never pass through a
//                        Vercel function, which caps request bodies at 4.5MB while a
//                        phone photo of a Certificate of Registration is routinely
//                        6MB (ARCHITECTURE.md §4.1 step 4).
//
//   finalizeApplication  re-verifies the uploaded file against the PROVIDER'S OWN
//                        metadata, then flips draft -> pending through a token-gated
//                        SECURITY DEFINER function.
//
// ═══════════════════════════════════════════════════════════════════════════════
// FOUR RULES THAT ARE NOT STYLE
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. NOTHING IS LOGGED. Not a field, not the payload, not the token, not an error
//    message that might contain one. This file builds the highest-PII request bodies
//    in the system on the one surface a stranger can reach; a stray `console.log` here
//    is a reportable disclosure under RA 10173 (CBL Art. VIII §6 makes that a
//    constitutional obligation too). `no-console` is an eslint ERROR under `lib/**`
//    (S3-T24) so this is enforced, not remembered.
//
// 2. THE CLIENT NEVER SUPPLIES `term_id`. It comes from `current_term_id()`, called
//    server-side. The anon INSERT policy pins it independently, so this is the second
//    of two locks, not the only one.
//
// 3. THE CLIENT'S CLAIM ABOUT ITS FILE IS NEVER STORED. `finalizeApplication` calls
//    `verifyUpload`, which re-fetches provider metadata and sniffs magic bytes, and it
//    is THOSE values that reach the database. A finalize declaring 2MB for a 6MB file
//    stores 6MB.
//
// 4. NO APPLICATION ID IS RETURNED FROM `finalizeApplication`, AND NO REDIRECT TO
//    `/apply/{id}` EXISTS. That would be a shareable, guessable status-lookup surface,
//    and there is deliberately NO anon SELECT policy on `applications` to serve it
//    (0008). "Let the applicant check their status later" is the obvious feature
//    request that would undo the anti-enumeration design; the answer to "I typo'd my
//    birthdate" is that the applicant contacts CRRD and CRRD edits it (PRD §4).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";

import { type ActionResult, err, mapDbError, ok } from "@/lib/action-result";
import {
  finalizeApplicationSchema,
  startApplicationSchema,
  buildApplicationPayload,
  type StartApplicationInput,
} from "@/lib/applications/schema";
import { withPublic } from "@/lib/auth/with-public";
import { getDocumentStore } from "@/lib/documents";
import {
  DocumentRejectedError,
  DocumentUnavailableError,
  isAllowedMime,
  MAX_PROOF_BYTES,
  type VerifiedUpload,
} from "@/lib/documents/types";

/** How long a submit token is good for. Long enough for a slow upload on mobile data. */
const SUBMIT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** 32 bytes. The capability that replaces an anon UPDATE policy — see 0019's header. */
const SUBMIT_TOKEN_BYTES = 32;

export type StartApplicationResult = {
  applicationId: string;
  /**
   * The PLAINTEXT submit token, returned exactly once. Only its sha256 is stored.
   *
   * ⚠ The form holds this in memory and echoes it to `finalizeApplication`. It must
   * never be rendered into the DOM, written to the URL, or put in a data attribute
   * (S3-T19).
   */
  uploadToken: string;
  /** Where the browser PUTs the bytes. Short-lived, one file, one folder. */
  uploadUrl: string;
  /** Provider-opaque. Echoed back to `finalizeApplication`; never interpreted here. */
  storageRef: string;
};

export type FinalizeApplicationResult = {
  /** Always `"pending"`. See the note in `finalizeApplication` about why it is constant. */
  status: "pending";
};

/** sha256 hex over the UTF-8 bytes of the token — byte-identical to 0019's SQL. */
function hashSubmitToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// startApplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the draft row and mint the upload session (PRD US-B1, US-B2; item 5, 6).
 *
 * Rate limits: 10/hour per IP, 3/hour per email address. The email bucket runs after
 * parsing because the subject is a field; both refusals return the SAME generic
 * validation failure a malformed body gets, so neither is a probe.
 */
export const startApplication = withPublic<StartApplicationInput, StartApplicationResult>(
  {
    rateLimit: [
      { bucket: "apply_ip", limit: 10 },
      { bucket: "apply_email", limit: 3, key: (input) => input.applicant_email.toLowerCase() },
    ],
    schema: startApplicationSchema,
  },
  async (ctx, input) => {
    // ── 1. Resolve the term SERVER-SIDE. The client is never asked. ──────────
    const { data: termId, error: termError } = await ctx.supabase.rpc("current_term_id");

    if (termError || !termId) {
      // No active term means no window can be open. Same answer as a closed window,
      // and the closure is public information — this is the one place a distinct code
      // is correct (lib/action-result.ts header).
      return err<StartApplicationResult>("window_closed");
    }

    // ── 2. Mint the submit-token capability ─────────────────────────────────
    // `randomBytes` from node:crypto, not Math.random. The plaintext is returned to
    // the browser once and is NEVER logged; only the digest is stored.
    const uploadToken = randomBytes(SUBMIT_TOKEN_BYTES).toString("hex");
    const expiresAt = new Date(Date.now() + SUBMIT_TOKEN_TTL_MS).toISOString();

    // ── 3. Insert as `anon` ─────────────────────────────────────────────────
    // `ctx.supabase` carries no session on the public form, so this statement runs as
    // the `anon` database role and is evaluated against `applications_insert_anon`.
    // That policy — not this code — is what makes a bookmarked /apply link inert
    // outside the application period (PRD US-B4).
    //
    // `status`, `person_id`, `reviewed_*`, `proof_*` and `submitted_at` are all
    // deliberately OMITTED: the policy requires each of them to be its default/null,
    // and naming them here would invite someone to "fix" a failure by setting one.
    const consentGivenAt = new Date().toISOString();
    const payload = buildApplicationPayload(input, consentGivenAt);

    const { data: inserted, error: insertError } = await ctx.supabase
      .from("applications")
      .insert({
        term_id: termId,
        applicant_email: input.applicant_email,
        applicant_given_name: input.applicant_given_name,
        applicant_family_name: input.applicant_family_name,
        payload,
        submit_token_hash: hashSubmitToken(uploadToken),
        submit_token_expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      // 42501 here is the anon INSERT policy refusing, and by far the likeliest reason
      // is that no window is open. Saying so is correct and is not a leak: whether
      // applications are open is something the org publishes.
      const mapped = mapDbError(insertError);
      if (mapped.code === "unauthorized") return err<StartApplicationResult>("window_closed");
      return { ok: false, error: mapped };
    }

    // ── 4. Mint the resumable upload session ────────────────────────────────
    // If this fails the draft row already exists. That is the correct order and not a
    // leak: a draft holds PII with the weakest retention basis in the system, and the
    // nightly `purge_abandoned_drafts` sweep (0020) redacts it after 30 days along with
    // any object it produced. The alternative — session first, row second — would
    // create objects with no row pointing at them, which nothing sweeps.
    try {
      const session = await getDocumentStore().createUploadSession({
        applicationId: inserted.id,
        fileName: input.proof_file_name,
        mimeType: input.proof_mime_type,
        sizeBytes: input.proof_size_bytes,
      });

      return ok({
        applicationId: inserted.id,
        uploadToken,
        uploadUrl: session.uploadUrl,
        storageRef: session.storageRef,
      });
    } catch (caught) {
      // The store's own message never reaches the applicant: a provider error body can
      // name a service account, a folder and a Drive.
      if (caught instanceof DocumentRejectedError) {
        return err<StartApplicationResult>("validation");
      }
      return err<StartApplicationResult>("upstream");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// finalizeApplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify the uploaded document, then flip the draft to `pending` (PRD US-B2, US-B3).
 *
 * ⚠ THE RESPONSE IS CONSTANT. `finalize_application()` swallows the unique violation
 * raised when the applicant already has a live application for this term and returns
 * success anyway, leaving the duplicate row as a draft for the sweep. This action
 * therefore returns the IDENTICAL `{ status: "pending" }` whether the submission was
 * the first for that email or the fourth — asserted by comparing two serialized
 * responses in the e2e suite. Adding an "already applied" branch here would rebuild the
 * email-enumeration oracle the partial unique index was reshaped to remove (S3-T4).
 */
export const finalizeApplication = withPublic(
  {
    rateLimit: { bucket: "finalize_ip", limit: 20 },
    schema: finalizeApplicationSchema,
  },
  async (ctx, input): Promise<ActionResult<FinalizeApplicationResult>> => {
    const store = getDocumentStore();

    // ── 1. Never trust the browser about what it uploaded ───────────────────
    let verified: VerifiedUpload;
    try {
      verified = await store.verifyUpload(input.storage_ref);
    } catch (caught) {
      if (caught instanceof DocumentRejectedError) {
        // The file itself is unacceptable — wrong type, oversize, or its magic bytes
        // contradict what was declared. Remove it: an object nothing will ever point
        // at is PII with no record and no retention basis.
        await store.deleteDocument(input.storage_ref).catch(() => undefined);
        return err<FinalizeApplicationResult>("validation");
      }
      if (caught instanceof DocumentUnavailableError) {
        // Do NOT delete: we could not reach it, so we do not know what we would be
        // deleting. The orphan reconciliation in the nightly sweep covers this.
        return err<FinalizeApplicationResult>("upstream");
      }
      return err<FinalizeApplicationResult>("upstream");
    }

    // Belt to the store's brace. The `DocumentStore` contract promises an allowed MIME
    // and a checked size, and this asserts it at the boundary anyway — the cost is two
    // comparisons and the thing it protects is a Certificate of Registration.
    if (!isAllowedMime(verified.mimeType) || verified.sizeBytes > MAX_PROOF_BYTES) {
      await store.deleteDocument(input.storage_ref).catch(() => undefined);
      return err<FinalizeApplicationResult>("validation");
    }

    // ── 2. The token-gated flip ─────────────────────────────────────────────
    // Real mime and real size, from the provider. Never `input`'s claim — there is no
    // claim in `finalizeApplicationSchema` for exactly this reason.
    const { error } = await ctx.supabase.rpc("finalize_application", {
      p_app_id: input.application_id,
      p_token: input.upload_token,
      p_file_ref: input.storage_ref,
      p_mime: verified.mimeType,
      p_size: verified.sizeBytes,
    });

    if (error) {
      const mapped = mapDbError(error);
      // 42501 is a wrong or expired token. Returning `unauthorized` would distinguish
      // "that application exists and your token is wrong" from every other failure —
      // and 0019 goes to the trouble of returning SILENTLY for an unknown id precisely
      // so that distinction cannot be drawn. Generic validation keeps the two the same.
      if (mapped.code === "unauthorized") return err<FinalizeApplicationResult>("validation");
      return { ok: false, error: mapped };
    }

    return ok({ status: "pending" as const });
  },
);
