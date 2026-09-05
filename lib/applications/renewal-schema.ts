// ─────────────────────────────────────────────────────────────────────────────
// Shared zod schemas for the accountless Membership Renewal Form (PRD US-G7, US-H5;
// SRS "Membership Renewal Form"; meeting 2026-09-05 §D).
//
// The renewal body IS the application body plus one identity field: the member ID. The
// email is already collected by the personal section and must match the address on
// file — `start_renewal()` (0044) resolves the person from the pair. Reusing
// `applicationSubmitSchema` wholesale keeps the section components, the payload keys
// and `approve_renewal()`'s `payload ->>` reads in one place (CONVENTIONS §6).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

import { applicationSubmitSchema, DECLARED_ALLOWED_MIME, MAX_DECLARED_PROOF_BYTES } from "./schema";

/** `YYYY-NNN` or wider (0039: new IDs pad to four digits; older three-digit IDs stay valid). */
export const MEMBER_ID_RE = /^\d{4}-\d{3,}$/;

export const renewalSubmitSchema = applicationSubmitSchema
  .extend({
    member_id: z
      .string()
      .trim()
      .regex(MEMBER_ID_RE, "Enter your member ID as it appears on your records, e.g. 2024-0012"),
  })
  .strict();

export type RenewalSubmitInput = z.infer<typeof renewalSubmitSchema>;

const proofDeclarationShape = {
  proof_file_name: z.string().trim().min(1).max(255),
  proof_mime_type: z.enum(DECLARED_ALLOWED_MIME, "Upload a PDF, JPEG, PNG or HEIC file"),
  proof_size_bytes: z.number().int().positive().max(MAX_DECLARED_PROOF_BYTES),
  noa_file_name: z.string().trim().min(1).max(255),
  noa_mime_type: z.enum(DECLARED_ALLOWED_MIME, "Upload a PDF, JPEG, PNG or HEIC file"),
  noa_size_bytes: z.number().int().positive().max(MAX_DECLARED_PROOF_BYTES),
};

export const startRenewalSchema = renewalSubmitSchema.extend(proofDeclarationShape);
export type StartRenewalInput = z.infer<typeof startRenewalSchema>;

export const finalizeRenewalSchema = z
  .object({
    renewal_id: z.uuid(),
    upload_token: z.string().regex(/^[0-9a-f]{64}$/),
    storage_ref: z.string().min(1).max(512),
    noa_storage_ref: z.string().min(1).max(512),
  })
  .strict();
export type FinalizeRenewalInput = z.infer<typeof finalizeRenewalSchema>;

// ── review ───────────────────────────────────────────────────────────────────

export const renewalApproveSchema = z.object({ id: z.uuid() }).strict();
export type RenewalApproveInput = z.infer<typeof renewalApproveSchema>;

export const RENEWAL_REJECT_REASON_MIN_LENGTH = 10;

export const renewalRejectSchema = z
  .object({
    id: z.uuid(),
    review_note: z
      .string()
      .trim()
      .min(RENEWAL_REJECT_REASON_MIN_LENGTH, "Give a reason of at least 10 characters")
      .max(2000, "Keep the reason under 2,000 characters"),
  })
  .strict();
export type RenewalRejectInput = z.infer<typeof renewalRejectSchema>;

export const RENEWAL_QUEUE_STATUSES = ["pending", "approved", "rejected"] as const;
export type RenewalQueueStatus = (typeof RENEWAL_QUEUE_STATUSES)[number];
