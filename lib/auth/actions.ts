"use server";

// ─────────────────────────────────────────────────────────────────────────────
// The sign-in Server Action. Deliberately NOT wrapped in `withRole` — there is no
// role yet at this point, since signing in is how one is established. It is public
// by nature, exactly like the intake actions in `lib/applications/`.
//
// Two absolute rules (BUILD_PLAN S2-T33):
//   1. No signup path exists anywhere in `(auth)`. Accounts exist only by invitation
//      (S2-T39). Do not add a "create account" link or copy to this file or its form.
//   2. A failed login returns the SAME generic message whether the email exists or
//      not — Supabase Auth itself already collapses "no such user" and "wrong
//      password" into one `AuthApiError`, and this action does not re-introduce a
//      distinction on top of it.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { type ActionResult, err, validationFailure } from "@/lib/action-result";
import { homeForRole } from "@/lib/auth/route-access";
import { safeNextPath } from "@/lib/auth/safe-next";
import { signInSchema } from "@/lib/auth/schema";
import { createServerSupabase } from "@/lib/supabase/server";

const GENERIC_LOGIN_ERROR = "Invalid email or password";

/**
 * Resolve where a successful login should land: the page the caller was originally
 * headed to (US-A1), or the role's home route when `next` is absent or unsafe.
 * The allowlist is `safeNextPath` — the ONE shared redirect-target check.
 */
async function resolveDestination(next: string | undefined): Promise<string> {
  const safe = safeNextPath(next);
  if (safe !== null) return safe;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/login";

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  return homeForRole(roleRow?.role ?? null);
}

/**
 * Sign in and redirect. Returns an `ActionResult` only on FAILURE — success ends in
 * `redirect()`, which throws internally and never reaches the caller as a return
 * value (the Next.js convention this codebase follows for auth flows).
 */
export async function signIn(
  next: string | undefined,
  input: unknown,
): Promise<ActionResult<never>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return validationFailure<never>(parsed.error);

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately one generic message regardless of the underlying cause (wrong
    // password, no such account, unconfirmed email) — see the file header.
    return err("validation", GENERIC_LOGIN_ERROR, { _form: [GENERIC_LOGIN_ERROR] });
  }

  redirect(await resolveDestination(next));
}

/**
 * End the caller's own session and return them to `/login`.
 *
 * Not wrapped in `withRole` for the same reason `signIn` is not: every tier may end
 * its own session, and a role check here would only be able to refuse someone the
 * right to log out. This scope is the caller's own session ONLY — ending someone
 * else's is `auth.admin.signOut(user, 'global')` on the service-role client, which
 * lives behind `lib/server/admin-client.ts` and is a different action entirely.
 *
 * Takes no argument on purpose. It is used directly as a `<form action>`, and a
 * zero-parameter function is assignable to Next's `(formData: FormData) => void`
 * action type — so declaring the FormData would only add an unused binding: there
 * is nothing to validate here, the session cookie is the whole input.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  // `scope: 'local'` clears this browser's session. A failure here is not worth
  // surfacing: the redirect below leaves the user at `/login` either way, and
  // middleware re-checks the session on the next request regardless.
  await supabase.auth.signOut({ scope: "local" });

  redirect("/login");
}
