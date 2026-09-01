// ─────────────────────────────────────────────────────────────────────────────
// /auth/reset — US-A4 (BUILD_PLAN S2-T38).
//
// A recovery link gets you here with an aal1 session. That session is factor one
// (possession of the mailbox) and nothing more. For every role above Member this page
// renders the TOTP challenge FIRST and the password form only afterwards.
//
// The assurance level is re-read here SERVER-SIDE on every render — never from a query
// param, never from client state, never from a cookie the browser could shape. And
// this check is not the only one: `updatePassword()` re-asserts it independently, so
// the endpoint cannot be called directly to skip this page. Two independent checks is
// the design, not redundancy to be tidied away.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { TotpVerify, type TotpFactorOption } from "@/components/auth/totp-verify";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH, requiresMfa } from "@/lib/auth/route-access";

export const dynamic = "force-dynamic";

const RESET_PATH = "/auth/reset";

export default async function ResetPasswordPage() {
  // No session at all: the link was never followed, or it has already been consumed.
  // Back to login with no explanation of which — see the callback route's note.
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);

  const home = homeForRole(ctx.role);

  if (requiresMfa(ctx.role)) {
    const { data: aal } = await ctx.supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aal?.currentLevel !== "aal2") {
      const { data: factorData } = await ctx.supabase.auth.mfa.listFactors();
      const factors: TotpFactorOption[] = (factorData?.totp ?? [])
        .filter((factor) => factor.status === "verified")
        .map((factor) => ({
          id: factor.id,
          friendlyName: factor.friendly_name ?? "Authenticator",
        }));

      // Privileged, but no second factor exists yet — an invited account setting its
      // first password. Enrolment comes first; the middleware gate would send them
      // there on the next request regardless.
      if (factors.length === 0) redirect("/auth/mfa/enroll");

      return (
        <main className="px-4 py-10">
          <TotpVerify
            factors={factors}
            next={RESET_PATH}
            homePath={home}
            heading="Confirm your identity"
            description="An emailed link is not enough to change the password on an account that can reach member data. Enter the code from your authenticator app to continue."
          />
        </main>
      );
    }
  }

  return (
    <main className="px-4 py-10">
      <ResetPasswordForm homePath={home} />
    </main>
  );
}
