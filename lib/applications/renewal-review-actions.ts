"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Renewal decisions (PRD US-G7, US-H5; SRS "CRRD Chiefs and Deputies … manage
// membership applications"). withRole([...]) is defence in depth; approve_renewal() and
// reject_renewal() (0044) refuse the same calls independently.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";

import { err, mapDbError, ok, validationFailure } from "@/lib/action-result";
import { withRole } from "@/lib/auth/with-role";

import { renewalApproveSchema, renewalRejectSchema } from "./renewal-schema";

const REVIEWER_ROLES = ["exec_admin", "crrd_admin"] as const;
const RENEWALS_PATH = "/renewals";

export type ApproveRenewalResult = { member_id: string };

export const approveRenewal = withRole<unknown, ApproveRenewalResult>(
  REVIEWER_ROLES,
  async (ctx, input) => {
    const parsed = renewalApproveSchema.safeParse(input);
    if (!parsed.success) return validationFailure<ApproveRenewalResult>(parsed.error);

    const { data, error } = await ctx.supabase.rpc("approve_renewal", { p_id: parsed.data.id });
    if (error) {
      const mapped = mapDbError(error);
      if (error.code === "55000") return err<ApproveRenewalResult>("conflict");
      return { ok: false, error: mapped };
    }
    if (!data) return err<ApproveRenewalResult>("unknown");

    revalidatePath(RENEWALS_PATH);
    revalidatePath(`${RENEWALS_PATH}/${parsed.data.id}`);
    return ok({ member_id: data });
  },
);

export const rejectRenewal = withRole<unknown, { status: "rejected" }>(
  REVIEWER_ROLES,
  async (ctx, input) => {
    const parsed = renewalRejectSchema.safeParse(input);
    if (!parsed.success) return validationFailure<{ status: "rejected" }>(parsed.error);

    const { error } = await ctx.supabase.rpc("reject_renewal", {
      p_id: parsed.data.id,
      p_note: parsed.data.review_note,
    });
    if (error) {
      if (error.code === "55000") return err<{ status: "rejected" }>("conflict");
      if (error.code === "23514") {
        return {
          ok: false,
          error: {
            code: "validation",
            message: "Give a reason of at least 10 characters.",
            fields: { review_note: ["Give a reason of at least 10 characters."] },
          },
        };
      }
      return { ok: false, error: mapDbError(error) };
    }

    revalidatePath(RENEWALS_PATH);
    revalidatePath(`${RENEWALS_PATH}/${parsed.data.id}`);
    return ok({ status: "rejected" as const });
  },
);
