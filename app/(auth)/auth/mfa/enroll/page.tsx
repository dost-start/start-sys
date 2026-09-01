// ─────────────────────────────────────────────────────────────────────────────
// /auth/mfa/enroll — the screen an officer-or-above sees until a second factor exists
// (BUILD_PLAN S2-T36, PRD MVP item 2 / US-A3).
//
// The middleware gate sends every unenrolled privileged account here and refuses every
// other route while `listFactors()` is empty. This page renders nothing but the
// enrolment flow: no member records, no counts, no navigation into the org.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { TotpEnroll } from "@/components/auth/totp-enroll";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/route-access";

export const dynamic = "force-dynamic";

export default async function MfaEnrollPage() {
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);

  const { data } = await ctx.supabase.auth.mfa.listFactors();
  const alreadyEnrolled = (data?.totp ?? []).some((factor) => factor.status === "verified");

  // Enrolment is a one-time act. Re-visiting this URL after enrolling must NOT restart
  // it, and must not offer another look at the recovery codes — they were shown once.
  if (alreadyEnrolled) redirect(homeForRole(ctx.role));

  return (
    <main className="px-4 py-10">
      <TotpEnroll homePath={homeForRole(ctx.role)} />
    </main>
  );
}
