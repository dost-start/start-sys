// ─────────────────────────────────────────────────────────────────────────────
// The front door. Runs before any render, on every path except the public and auth
// surfaces (see `config.matcher` at the bottom).
//
// ⚠️ THIS FILE IS UX AND DEFENCE IN DEPTH. IT IS NOT THE SECURITY BOUNDARY.
//
// Postgres RLS is (ARCHITECTURE.md §5). Delete this file and the pgTAP suite stays
// byte-identically green, every admin route returns zero rows to an officer, and no
// PII leaks — which is exactly what BUILD_PLAN S2-T42 and S7-T29 check by renaming it
// away and crawling the app. What it buys is that nobody is shown a screen they cannot
// use, and that a member never learns an admin route exists.
//
// ORDER MATTERS, and it is the order in BUILD_PLAN S2-T30 / S2-T37:
//
//   1. updateSession()      — refresh the token FIRST, so refreshed cookies ride on
//                             the response no matter which branch below returns.
//   2. getUser() is null    — redirect to /login?next=<where they were going>.
//   3. role                 — ONE live `user_roles` read. The same lookup the database
//                             makes; never a JWT claim, never `user_metadata`.
//   4. MFA gate             — no verified factor -> enrol; aal1 with aal2 available ->
//                             verify. (PRD item 2 / US-A3, US-A4.)
//   5. canAccess()          — else redirect HOME, never a 403. A 403 would tell a
//                             member that /members exists.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextRequest, NextResponse } from "next/server";

import {
  canAccess,
  homeForRole,
  LOGIN_PATH,
  mfaGateEnabled,
  requiresMfa,
  UNAUTHORIZED_PATH,
  type OrgRole,
} from "@/lib/auth/route-access";
import { redirectPreservingSession, updateSession } from "@/lib/supabase/middleware";

/** Build a same-origin redirect, carrying any cookies the session refresh produced. */
function redirectTo(
  request: NextRequest,
  pathname: string,
  sessionResponse: NextResponse,
  nextParam?: string,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (nextParam !== undefined) url.searchParams.set("next", nextParam);
  return redirectPreservingSession(url, sessionResponse);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // 1. Refresh the session. `response` carries the new cookies; every branch below
  //    must either return it or hand it to `redirectTo`, or the user is silently
  //    logged out at the moment they are being sent somewhere.
  const { response, user, supabase } = await updateSession(request);

  const { pathname, search } = request.nextUrl;

  // 2. No valid session. US-A1: no page other than the public application form is
  //    reachable without logging in, and after login the user lands on the page they
  //    originally requested — hence `next`.
  if (!user) {
    return redirectTo(request, LOGIN_PATH, response, `${pathname}${search}`);
  }

  // 3. The live role, read per request from `user_roles`. This is what makes
  //    revocation instant: a member who graduates or an officer who is impeached
  //    loses access on their NEXT request, not when a JWT expires (US-A2, US-E3).
  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const role: OrgRole | null = roleRow?.role ?? null;

  // A signed-in account with no `user_roles` row holds no capability at all — an
  // invite whose role assignment failed, or a role that was revoked mid-session. Send
  // them to the explicit refusal page, and pass through once they are on it so this
  // does not become a redirect loop.
  if (role === null) {
    if (pathname === UNAUTHORIZED_PATH) return response;
    return redirectTo(request, UNAUTHORIZED_PATH, response);
  }

  // 4. The MFA gate. PRD MVP item 2 / US-A3: TOTP enrolment is mandatory for every
  //    account above Member tier, and an unenrolled officer sees an enrolment screen
  //    and no organizational data.
  //
  //    This is the UX half only. The database backstop is the
  //    `(auth.jwt() ->> 'aal') = 'aal2'` predicate on the privileged write policies
  //    (S2-T16, asserted by pgTAP 031): delete this block and a non-verified
  //    tech_admin still cannot write `user_roles`.
  //
  //    `/auth/*` is excluded from the matcher, so neither redirect can loop.
  //
  //    `mfaGateEnabled()` is the DEV_DISABLE_MFA escape hatch — demo ergonomics only,
  //    default on, and it reaches exactly this block. The database's `has_aal2()`
  //    predicates are untouched by it, so switching it on does not grant an aal1
  //    session a single privileged write.
  if (mfaGateEnabled() && requiresMfa(role)) {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const hasVerifiedFactor = (factors?.all ?? []).some((factor) => factor.status === "verified");

    if (!hasVerifiedFactor) {
      return redirectTo(request, "/auth/mfa/enroll", response);
    }

    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    // Enrolled but this session has only satisfied the password factor. Step up.
    // FAIL CLOSED: an errored or absent AAL read is treated as unverified — an open
    // gate on a read failure would wave an aal1 admin straight through (US-A3).
    if (aalError !== null || aal === null || aal.currentLevel !== "aal2") {
      return redirectTo(request, "/auth/mfa/verify", response, `${pathname}${search}`);
    }
  }

  // 5. Tier check. A denial goes HOME, not to a 403 and not to a message naming the
  //    required role — `homeForRole` is asserted to be reachable by its own role in
  //    `route-access.test.ts`, so this cannot loop.
  if (!canAccess(role, pathname)) {
    return redirectTo(request, homeForRole(role), response);
  }

  return response;
}

export const config = {
  // Everything EXCEPT:
  //   /apply, /privacy   — the public surface (PRD §4: nothing else is publicly
  //                        reachable; the closed-application-window refusal is a
  //                        database fact, not a hidden link).
  //   /login, /auth/*    — the sign-in, recovery and MFA screens. Excluded so the
  //                        redirects above cannot loop.
  //   /api/*             — Route Handlers self-authorize: the proof proxy re-uses the
  //                        caller's JWT for an ordinary RLS-checked SELECT, and the
  //                        job endpoints check JOB_SHARED_SECRET (CONVENTIONS §4.4).
  //   _next, favicon, any path whose last segment has a dot — static assets.
  //
  // `/` IS matched: an anonymous visitor is sent to /login, and a signed-in one is
  // sent home by the `canAccess` deny-by-default on an ungrouped path.
  matcher: [
    "/((?!apply|privacy|login|auth|api|_next/static|_next/image|favicon\\.ico|.*\\.[^/]*$).*)",
  ],
};
