"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Assign and revoke `user_roles`, `tech_admin` only (BUILD_PLAN S2-T40; PRD
// US-E3: "assign and revoke system roles"). Both actions write through the
// CALLER's client (never `lib/server/admin-client.ts`) so the `user_roles_write`
// RLS policy — tech_admin AND `(auth.jwt() ->> 'aal') = 'aal2'` — and the
// `audit_row()` trigger both apply independently of this wrapper
// (ARCHITECTURE.md §5: "withRole is defence in depth, not the boundary").
//
// Effect is instant, not eventual: `auth_role()` reads `user_roles` live on every
// statement (ARCHITECTURE.md §5), so the affected account's very next request
// sees the new — or revoked — capability. Nothing here signs the account out or
// invalidates a cached claim, because there is no cached claim to invalidate.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";

import { err, mapDbError, ok, validationFailure } from "@/lib/action-result";
import {
  revokeRoleSchema,
  roleAssignmentSchema,
  type RevokeRoleInput,
  type RoleAssignmentInput,
} from "@/lib/auth/invite-schema";
import { withRole } from "@/lib/auth/with-role";

/**
 * (Re)point an existing account at a role — including changing a `regional_rep`'s
 * region, or handing a role to an account that previously had none.
 *
 * `upsert` on the `user_roles` primary key (`user_id`) so this is one statement
 * whether the account is gaining its first role or moving between roles — never
 * two branches (insert vs. update) that could disagree under a race.
 */
export const assignRole = withRole<unknown, { userId: string }>(
  ["tech_admin"],
  async (ctx, input) => {
    const parsed = roleAssignmentSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);

    const { user_id, role, region_id, person_id }: RoleAssignmentInput = parsed.data;

    const { error } = await ctx.supabase.from("user_roles").upsert(
      {
        user_id,
        role,
        region_id: region_id ?? null,
        person_id: person_id ?? null,
      },
      { onConflict: "user_id" },
    );

    if (error) return err(mapDbError(error).code);

    revalidatePath("/system/user-roles");
    return ok({ userId: user_id });
  },
);

/**
 * Revoke a role by demoting the account to `member` — the lowest-privilege tier,
 * which still leaves a functioning (forms-only) account rather than an orphaned
 * one. This is an UPDATE, never a DELETE: no hard deletes exist system-wide
 * (CLAUDE.md "Banned patterns" — "Never hard-delete anything"), and a deleted
 * `user_roles` row would just as effectively strip the account's `person_id` and
 * `region_id` history, which a status change deliberately preserves for audit.
 *
 * Clears `region_id` in the same statement: only `regional_rep` needs one
 * (`rr_needs_region`), and leaving a stale region on a demoted account is a
 * landmine for the next `assignRole` back to `regional_rep`. `person_id` is left
 * untouched — the person did not stop being who they are.
 */
export const revokeRole = withRole<unknown, { userId: string }>(
  ["tech_admin"],
  async (ctx, input) => {
    const parsed = revokeRoleSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);

    const { user_id }: RevokeRoleInput = parsed.data;

    const { error, count } = await ctx.supabase
      .from("user_roles")
      .update({ role: "member", region_id: null }, { count: "exact" })
      .eq("user_id", user_id);

    if (error) return err(mapDbError(error).code);
    // Zero rows affected means either RLS refused the write or the account does
    // not exist — CONVENTIONS §4.3: map to `not_found`, never `unauthorized`, so
    // the response never confirms which case it was.
    if (count === 0) return err("not_found");

    revalidatePath("/system/user-roles");
    return ok({ userId: user_id });
  },
);
