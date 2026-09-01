"use server";

// ─────────────────────────────────────────────────────────────────────────────
// TOTP enrolment and challenge (BUILD_PLAN S2-T36; PRD MVP item 2, US-A3).
//
// Mandatory second factor for every account above Member tier. The UX half of that
// rule is `requiresMfa()` in `lib/auth/route-access.ts` plus the middleware gate; the
// enforcement half is the `(auth.jwt() ->> 'aal') = 'aal2'` predicate on the
// privileged write policies (ARCHITECTURE.md §5, pgTAP 031). These actions are the
// screens in between — if they were deleted, an unverified `tech_admin` still could
// not write `user_roles`.
//
// Password hashing, TOTP secret storage and challenge verification are GoTrue's, not
// ours (ARCHITECTURE.md §1: "code we do not write and therefore cannot get wrong").
// The ONE thing that is ours is the recovery-code set — Supabase Auth's TOTP has no
// recovery codes, and US-A3 requires them — which lives behind
// `issue_recovery_codes()` (migration 0017, S2-T35): hashed at rest, plaintext
// returned exactly once, never re-derivable.
//
// PRIVACY: nothing here logs. `no-console` is an error under `lib/**`, and a TOTP
// secret, a factor id and a recovery code are all credential material.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { err, mapDbError, ok, validationFailure } from "@/lib/action-result";
import { getSessionContext } from "@/lib/auth/queries";

/** What the enrolment screen needs to render. */
export type TotpEnrolment = {
  factorId: string;
  /** An SVG document string produced by GoTrue. Never a remote image URL. */
  qrCode: string;
  /** The manual-entry secret, for an authenticator that cannot scan. */
  secret: string;
};

/** A six-digit authenticator code. Trimmed and stripped of the spaces apps insert. */
const codeSchema = z.object({
  factorId: z.uuid(),
  code: z
    .string()
    .transform((raw) => raw.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.")),
});

/**
 * The friendly name every START-SYS factor carries. Fixed rather than user-supplied:
 * one authenticator per account is the whole model, and a stable name is what lets
 * `enrollTotp` clean up an abandoned half-finished enrolment below.
 */
const FACTOR_NAME = "START-SYS";

/**
 * Begin TOTP enrolment. Returns the QR SVG and the manual secret.
 *
 * Deliberately NOT wrapped in `withRole([...])`: every signed-in account may enrol,
 * including a `member` for whom it is optional (ADR 0004). The guard that matters is
 * "is there a session at all", and an account with no `user_roles` row has no
 * capability worth protecting with a second factor anyway.
 *
 * Idempotent in the way that matters: an applicant who opened this screen, never
 * finished, and came back would otherwise hit GoTrue's duplicate-friendly-name error.
 * Any UNVERIFIED factor is unenrolled first. A VERIFIED factor is never touched here —
 * replacing one is the `tech_admin`-mediated recovery path (runbook 04), which is
 * itself audited.
 */
export async function enrollTotp(): Promise<ActionResult<TotpEnrolment>> {
  const ctx = await getSessionContext();
  if (ctx === null) return err<TotpEnrolment>("unauthorized");

  const { data: factors, error: listError } = await ctx.supabase.auth.mfa.listFactors();
  if (listError) return err<TotpEnrolment>("upstream");

  const totp = factors?.totp ?? [];

  // Already enrolled and verified: the caller should be challenging, not enrolling.
  if (totp.some((factor) => factor.status === "verified")) {
    return err<TotpEnrolment>(
      "conflict",
      "This account already has an authenticator app enrolled. Ask a Technical Admin to reset it if you have lost the device.",
    );
  }

  for (const stale of totp) {
    if (stale.status !== "verified") {
      await ctx.supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
  }

  const { data, error } = await ctx.supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: FACTOR_NAME,
  });

  if (error || !data) return err<TotpEnrolment>("upstream");

  return ok<TotpEnrolment>({
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  });
}

/**
 * Finish enrolment: verify the first code, then mint the recovery codes.
 *
 * The codes are returned HERE AND NOWHERE ELSE. `issue_recovery_codes()` stores only
 * a salted digest, so no route, no query and no support request can reproduce this
 * list — which is exactly the property that makes a recovery code a second factor
 * rather than a second password. The client holds them in component state only, and
 * navigating away loses them permanently (US-A3: "displayed exactly once").
 */
export async function verifyEnrolment(input: unknown): Promise<ActionResult<string[]>> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return validationFailure<string[]>(parsed.error);

  const ctx = await getSessionContext();
  if (ctx === null) return err<string[]>("unauthorized");

  const { error: verifyError } = await ctx.supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });

  if (verifyError) {
    return err<string[]>(
      "validation",
      "That code was not accepted. Check your app and try again.",
      {
        code: ["That code was not accepted. Check your app and try again."],
      },
    );
  }

  // The session is now aal2, which is what the INSERT policy on `mfa_recovery_codes`
  // ... (there is none: the table has no policy at all, deliberately) requires the
  // definer function for. See migration 0017.
  const { data, error } = await ctx.supabase.rpc("issue_recovery_codes");
  if (error) return err<string[]>(mapDbError(error).code);
  if (!data) return err<string[]>("upstream");

  return ok<string[]>(data);
}

/**
 * The aal1 -> aal2 challenge for an account that is already enrolled.
 *
 * Used by `/auth/mfa/verify` and, critically, by `/auth/reset`: US-A4 requires a
 * privileged user to pass a second factor BEFORE a new password is accepted, and the
 * reset screen re-reads the assurance level server-side rather than trusting that this
 * action was ever called (see `lib/auth/reset-actions.ts`).
 */
export async function verifyMfa(input: unknown): Promise<ActionResult<null>> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return validationFailure<null>(parsed.error);

  const ctx = await getSessionContext();
  if (ctx === null) return err<null>("unauthorized");

  const { error } = await ctx.supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });

  if (error) {
    return err<null>("validation", "That code was not accepted. Check your app and try again.", {
      code: ["That code was not accepted. Check your app and try again."],
    });
  }

  return ok<null>(null);
}
