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
// ORDER MATTERS. It is the order in BUILD_PLAN S2-T30 / S2-T37, plus the idle check:
//
//   1. updateSession()      — refresh the token FIRST, so refreshed cookies ride on
//                             the response no matter which branch below returns.
//   2. getUser() is null    — redirect to /login?next=<where they were going>.
//   3. idle logout          — no activity for more than an hour -> sign this browser
//                             out (scope "local") and redirect to /login?reason=idle;
//                             otherwise stamp the activity cookie (not on prefetches).
//                             Checked here, not only in the browser, so a closed tab or
//                             a sleeping laptop cannot skip it. Officer feedback
//                             2026-09-11: auto logout.
//   4. role                 — ONE live `user_roles` read. The same lookup the database
//                             makes; never a JWT claim, never `user_metadata`.
//   5. MFA gate             — no verified factor -> enrol; aal1 with aal2 available ->
//                             verify. (PRD item 2 / US-A3, US-A4.)
//   6. canAccess()          — else redirect HOME, never a 403. A 403 would tell a
//                             member that /members exists.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextRequest, NextResponse } from "next/server";

import {
  IDLE_LOGOUT_REASON,
  idleDecision,
  isPrefetchRequest,
  lastAuthenticatedAtFromAccessToken,
  isSupabaseAuthCookieName,
  LAST_ACTIVITY_COOKIE,
  LAST_ACTIVITY_COOKIE_MAX_AGE_S,
} from "@/lib/auth/idle";
import {
  canAccess,
  homeForRole,
  LOGIN_PATH,
  mfaGateEnabled,
  requiresMfa,
  UNAUTHORIZED_PATH,
  type OrgRole,
} from "@/lib/auth/route-access";
import {
  redirectPreservingSession,
  updateSession,
  type UpdateSessionResult,
} from "@/lib/supabase/middleware";

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

/** The activity cookie's attributes. The browser writes the same ones (`lib/auth/idle.ts`). */
function lastActivityCookieOptions(request: NextRequest) {
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    // The idle warning reads it in the browser. It is not a credential.
    httpOnly: false,
    maxAge: LAST_ACTIVITY_COOKIE_MAX_AGE_S,
  };
}

/**
 * End an idle session: sign this browser out and send it to `/login?reason=idle`.
 *
 * `scope: "local"`, NEVER "global" — global would also end the user's sessions on every
 * other device they are signed in on.
 */
async function endIdleSession(
  request: NextRequest,
  sessionResponse: NextResponse,
  supabase: UpdateSessionResult["supabase"],
): Promise<NextResponse> {
  // Revokes this session's refresh token on the auth server.
  await supabase.auth.signOut({ scope: "local" });

  const url = request.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = "";
  url.searchParams.set("reason", IDLE_LOGOUT_REASON);
  const redirect = redirectPreservingSession(url, sessionResponse);

  // signOut() writes its cleared cookies through updateSession()'s `setAll`, which builds
  // a NEW response object — not `sessionResponse` — so they would never reach the browser
  // from here. Expire the auth cookies on the redirect directly. This also covers a
  // signOut() that failed on the network and cleared nothing: the browser loses the
  // session either way.
  const names = new Set(
    [...request.cookies.getAll(), ...redirect.cookies.getAll()].map((cookie) => cookie.name),
  );
  for (const name of names) {
    if (isSupabaseAuthCookieName(name)) redirect.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  redirect.cookies.set(LAST_ACTIVITY_COOKIE, "", {
    ...lastActivityCookieOptions(request),
    maxAge: 0,
  });

  // A response that clears auth cookies must never be cached.
  redirect.headers.set("cache-control", "private, no-cache, no-store, must-revalidate, max-age=0");
  return redirect;
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
  //
  //    The splash page at `/` is the one anonymous exception (brand restyle,
  //    2026-09-08, PRD §4 decision note): it shows the emblem, the wordmark and two
  //    links, reads nothing, and carries the noindex header like every non-form path.
  //    A signed-in visitor still falls through to step 6, where the deny-by-default on
  //    an ungrouped path sends them home.
  if (!user) {
    if (pathname === "/") return response;
    return redirectTo(request, LOGIN_PATH, response, `${pathname}${search}`);
  }

  // 3. Idle logout (Officer feedback 2026-09-11: auto logout). More than an hour since
  //    the last activity ends this browser's session here, whatever the page did.
  //    `idleDecision` folds in when this session last AUTHENTICATED (the access token's
  //    `amr` timestamps), so a stale cookie from yesterday cannot end a session that was
  //    just started with a password. Never `user.last_sign_in_at`: the auth server
  //    rewrites it on every token refresh, which would make every idle session look
  //    fresh (lib/auth/idle.ts).
  const now = Date.now();
  // `getSession()` here only reads the access token `getUser()` validated a moment ago.
  // It authorizes nothing: the value can only end a session, never extend access.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const idle = idleDecision({
    cookieValue: request.cookies.get(LAST_ACTIVITY_COOKIE)?.value,
    lastAuthenticatedAt: session ? lastAuthenticatedAtFromAccessToken(session.access_token) : null,
    now,
  });
  if (idle === "expired") {
    return endIdleSession(request, response, supabase);
  }

  //    Still active: this request is activity, unless it is a prefetch (a link scrolling
  //    into view is not the user). Set on `response` BEFORE every branch below — each
  //    redirect copies `response.cookies`, and the last branch returns `response` itself.
  if (!isPrefetchRequest(request.headers)) {
    response.cookies.set(LAST_ACTIVITY_COOKIE, String(now), lastActivityCookieOptions(request));
  }

  // 4. The live role, read per request from `user_roles`. This is what makes
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

  // 5. The MFA gate. PRD MVP item 2 / US-A3: TOTP enrolment is mandatory for every
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

  // 6. Tier check. A denial goes HOME, not to a 403 and not to a message naming the
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
  // `/` IS matched: an anonymous visitor is let through to the splash page (step 2's
  // one exception), and a signed-in one is sent home by the `canAccess`
  // deny-by-default on an ungrouped path.
  matcher: [
    "/((?!apply|renew(?:/|$)|privacy|login|auth|api|_next/static|_next/image|favicon\\.ico|.*\\.[^/]*$).*)",
  ],
};
