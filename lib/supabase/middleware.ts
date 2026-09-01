// ─────────────────────────────────────────────────────────────────────────────
// Session refresh for `middleware.ts`.
//
// Access tokens are short-lived. Without a middleware that refreshes them and writes
// the new cookies onto BOTH the request (for the downstream render) and the response
// (for the browser), a user is silently logged out mid-session — the single most
// confusing auth bug in the App Router.
//
// `getUser()`, NEVER `getSession()`. `getSession()` reads the cookie and trusts it;
// `getUser()` revalidates against the auth server. An authorization decision made on
// `getSession()` is a decision made on a value the client can edit.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/database.types";

/**
 * Read the two public Supabase variables.
 *
 * Read INSIDE the function so a build without an environment still succeeds.
 */
function readPublicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    const missing = [
      !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
      !anonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
    ].filter((name): name is string => name !== null);

    throw new Error(
      `Supabase middleware client: missing required environment variable(s): ${missing.join(", ")}.`,
    );
  }

  return { url, anonKey };
}

export type UpdateSessionResult = {
  /** Carries any refreshed auth cookies. Must be returned, or copied onto a redirect. */
  response: NextResponse;
  /** The revalidated user, or null when there is no valid session. */
  user: User | null;
  /** The same client, so the caller can read `user_roles` and MFA state without a second round trip. */
  supabase: SupabaseClient<Database>;
};

/**
 * Refresh the session and revalidate the user.
 *
 * The returned `response` may carry `Set-Cookie` headers. If the caller redirects
 * instead of returning it, those cookies MUST be copied onto the redirect or the
 * refreshed session is thrown away and the next request refreshes again.
 */
export async function updateSession(request: NextRequest): Promise<UpdateSessionResult> {
  const { url, anonKey } = readPublicEnv();

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // 1. Onto the request, so the downstream render sees the refreshed session.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // 2. Rebuild the response from the mutated request, then write the cookies
        //    onto it so the browser receives them.
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // 3. The no-store headers the library supplies. A response that sets auth
        //    cookies must never be cached by a CDN — Vercel's edge would otherwise be
        //    able to serve one scholar's session token to another.
        for (const [key, headerValue] of Object.entries(headers)) {
          response.headers.set(key, headerValue);
        }
      },
    },
  });

  // Awaited before any response is committed, so a refresh triggered here can still
  // be written back through `setAll` above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user, supabase };
}

/**
 * Redirect while preserving anything `updateSession` wrote.
 *
 * Every redirect in `middleware.ts` goes through this. A bare `NextResponse.redirect`
 * drops the refreshed cookies, which logs the user out at the exact moment they are
 * being sent to a page.
 */
export function redirectPreservingSession(url: URL, sessionResponse: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);

  for (const cookie of sessionResponse.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }

  // Only the caching headers are carried across. Copying every header would drag
  // `NextResponse.next()`'s internal `x-middleware-*` markers onto a redirect, which
  // is not a thing the router expects to see.
  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = sessionResponse.headers.get(key);
    if (value !== null) redirect.headers.set(key, value);
  }

  return redirect;
}
