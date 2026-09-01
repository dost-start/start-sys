// ─────────────────────────────────────────────────────────────────────────────
// /auth/mfa/verify — the aal1 -> aal2 challenge (BUILD_PLAN S2-T36 / S2-T37).
//
// The middleware sends an enrolled-but-unverified privileged account here with
// `?next=<the page they wanted>`; on success they land there. Members never reach it:
// `requiresMfa('member')` is false and they pass at aal1 by design (ADR 0004).
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { TotpVerify, type TotpFactorOption } from "@/components/auth/totp-verify";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/route-access";

export const dynamic = "force-dynamic";

export default async function MfaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);

  const params = await searchParams;
  const rawNext = params["next"];
  const next = typeof rawNext === "string" ? rawNext : null;
  const home = homeForRole(ctx.role);

  const { data: aal } = await ctx.supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  // Already satisfied. Do not make an admin type a second code because they hit Back.
  if (aal?.currentLevel === "aal2") {
    redirect(next !== null && next.startsWith("/") && !next.startsWith("//") ? next : home);
  }

  const { data: factorData } = await ctx.supabase.auth.mfa.listFactors();
  const factors: TotpFactorOption[] = (factorData?.totp ?? [])
    .filter((factor) => factor.status === "verified")
    .map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name ?? "Authenticator" }));

  if (factors.length === 0) redirect("/auth/mfa/enroll");

  return (
    <main className="px-4 py-10">
      <TotpVerify factors={factors} next={next} homePath={home} />
    </main>
  );
}
