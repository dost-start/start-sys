"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Password reset (BUILD_PLAN S2-T38 — US-A4, the PRD's hardest auth line).
//
//   "As a privileged user resetting my password, I must pass a second factor before
//    the new password is accepted, so that mailbox access alone cannot take over my
//    account. The reset link alone does not permit a password change. The password
//    change is rejected unless the session has satisfied the second factor, CHECKED
//    SERVER-SIDE AND NOT BYPASSABLE BY CALLING THE ENDPOINT DIRECTLY."
//
// That last clause is why the assurance level is re-read HERE, inside the action,
// rather than being trusted from the page that rendered the form. `/auth/reset`
// re-reads it too; the two checks are independent on purpose, and this one is the
// one that holds when the action is invoked without ever loading that page.
//
// THE ORDER IS THE SECURITY PROPERTY: the guard runs BEFORE `updateUser` is called,
// so a refused reset cannot change a credential on its way to being refused. The unit
// test asserts the `updateUser` spy count is 0 in the denied case — a check that
// happens after the write would still "return unauthorized" and be worthless.
//
// The Member exception (aal1 is enough) is risk-proportionate and DOCUMENTED, not
// implicit: ADR 0004, `docs/decisions/0004-member-password-reset-exception.md`.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { err, mapDbError, ok, validationFailure } from "@/lib/action-result";
import { getSessionContext } from "@/lib/auth/queries";

/**
 * Length only. Composition rules (a digit, a symbol, a capital) push people toward
 * `Password1!` and are not what a stolen-mailbox attack turns on; a second factor is.
 */
const updatePasswordSchema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters."),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "The two passwords do not match.",
    path: ["confirm"],
  });

export async function updatePassword(input: unknown): Promise<ActionResult<null>> {
  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) return validationFailure<null>(parsed.error);

  const ctx = await getSessionContext();
  if (ctx === null) return err<null>("unauthorized");

  const { data: aal, error: aalError } =
    await ctx.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) return err<null>("upstream");

  // ── The gate. Nothing above this line has written anything. ──────────────
  // Allowed iff the session is aal2, OR the account is a Member — who holds no
  // organizational data at all and resets by emailed one-time code alone (ADR 0004).
  const satisfied = aal?.currentLevel === "aal2" || ctx.role === "member";

  if (!satisfied) {
    return err<null>(
      "unauthorized",
      "Confirm your authenticator code before setting a new password.",
    );
  }

  const { error } = await ctx.supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    // GoTrue rejects a password on its own strength/breach rules. That is a field
    // error the user can act on, not an opaque failure.
    if (error.code === "weak_password" || error.code === "same_password") {
      return err<null>("validation", "Choose a different password.", {
        password: ["Choose a different password."],
      });
    }
    return err<null>(mapDbError(error).code);
  }

  return ok<null>(null);
}
