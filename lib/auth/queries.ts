// ─────────────────────────────────────────────────────────────────────────────
// "Who is calling, and what may they do right now?"
//
// The role is read from `public.user_roles` on every request. It is NEVER stamped
// into the JWT and NEVER read from `user_metadata` (ARCHITECTURE.md §5,
// CONVENTIONS §11):
//
//   - `raw_user_meta_data` is writable by the user themselves. A role there is a
//     one-line privilege escalation and the most common Supabase security bug.
//   - A custom access token hook would be marginally faster, but claims go stale for
//     the token lifetime — a member who graduates or an officer who is impeached would
//     keep their privileges for up to an hour. The PRD requires access revoked on
//     graduation, resignation and leaving (US-A2, US-H4). Stale claims are exactly the
//     wrong failure mode.
//
// This is the same live lookup the database itself makes: `auth_role()` reads the same
// row. If this function and a policy ever disagree, the policy is the answer.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { cache } from "react";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/database.types";
import type { OrgRole } from "@/lib/auth/route-access";
import { createServerSupabase } from "@/lib/supabase/server";

export type SessionContext = {
  /** The revalidated user — from `getUser()`, never `getSession()`. */
  user: User;
  /** The live role from `user_roles`. */
  role: OrgRole;
  /** `people.id` for an account that belongs to a person. Null for a system account. */
  personId: string | null;
  /** Primary region scope. Non-null for `regional_rep` (the `rr_needs_region` CHECK). */
  regionId: string | null;
  /** The caller's own client — reuse it so downstream reads stay under the same JWT. */
  supabase: SupabaseClient<Database>;
};

/**
 * Resolve the caller's session context, or `null`.
 *
 * ⚠ MEMOISED PER REQUEST with React's `cache()` (PR E, 2026-09-09), and the saving is not
 * marginal. Every admin screen calls this from its route-group layout AND from the page,
 * and `/system/*` calls it from a nested layout as well — three calls, each making TWO
 * network round trips (`auth.getUser()` revalidates against the auth server, then a
 * `user_roles` read). At the measured ~25ms per round trip that was ~150ms of pure waiting
 * before a byte of the screen existed. `cache()` collapses them to one.
 *
 * It does NOT weaken revocation, which is the reason the role is read live at all
 * (ARCHITECTURE §5): the memo lives for ONE render of ONE request. The next request reads
 * the table again. If anything it is more correct — a role revoked mid-render can no
 * longer make a layout and its page disagree about who the caller is.
 *
 * It is also NOT the security boundary and does not pretend to be: RLS re-evaluates
 * `auth_role()` per statement no matter what this function returns.
 *
 * `null` means one of three things, and they are deliberately indistinguishable to the
 * caller: no session, a session whose user no longer exists, or a signed-in account
 * with no `user_roles` row (an invited account whose role assignment failed, or one
 * whose role was revoked). All three mean "no capability", and every one of them must
 * end in the same place — a redirect or an `unauthorized` result — rather than in a
 * message that distinguishes them.
 */
export const getSessionContext = cache(
  async function getSessionContext(): Promise<SessionContext | null> {
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // `maybeSingle()` rather than `single()`: no row is an ordinary outcome here, not an
    // error to be mapped. The row is visible because of the self-read policy on
    // `user_roles` (`user_id = auth.uid()`), which deliberately does not call
    // `auth_role()` — that would recurse into the policy that calls it.
    const { data, error } = await supabase
      .from("user_roles")
      .select("role, person_id, region_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) return null;

    return {
      user,
      role: data.role,
      personId: data.person_id,
      regionId: data.region_id,
      supabase,
    };
  },
);
