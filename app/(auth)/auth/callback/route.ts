// ─────────────────────────────────────────────────────────────────────────────
// /auth/callback — where an emailed link lands (BUILD_PLAN S2-T38).
//
// Two kinds of link arrive here: a password-recovery link and an invitation
// (`inviteUserByEmail`, S2-T39 — public signup is disabled, so this is the only way an
// account is ever created). Both carry `token_hash` + `type`, which `verifyOtp`
// exchanges for a session.
//
// ⚠️ THE SESSION THIS CREATES IS aal1 AND IS NOT PERMISSION TO CHANGE A PASSWORD.
// US-A4: "the reset link alone does not permit a password change." Possession of the
// mailbox is factor one. `/auth/reset` re-reads the assurance level server-side and
// renders the TOTP challenge first for every role above Member, and
// `updatePassword()` re-asserts it again before calling `updateUser` — so redirecting
// here is a navigation, not an authorization.
//
// Errors never say whether the token was unknown, already used, or expired: all three
// return the same generic failure, because distinguishing them tells an attacker
// holding a stolen link which case they are in.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The only `type` values this handler will act on. */
const ALLOWED_TYPES: readonly EmailOtpType[] = ["recovery", "invite", "email", "magiclink"];

function isAllowedType(value: string | null): value is EmailOtpType {
  return value !== null && (ALLOWED_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  const failure = new URL("/login?error=link_invalid", url.origin);

  if (tokenHash === null || !isAllowedType(type)) {
    return NextResponse.redirect(failure);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  // One generic outcome for unknown / consumed / expired. Never echo the Supabase
  // message: it distinguishes those cases and it is not ours to leak.
  if (error) return NextResponse.redirect(failure);

  // A recovery or invitation link exists to set a password. Everything else goes to
  // login, where the normal role-aware landing logic takes over.
  const destination = type === "recovery" || type === "invite" ? "/auth/reset" : "/login";

  return NextResponse.redirect(new URL(destination, url.origin));
}
