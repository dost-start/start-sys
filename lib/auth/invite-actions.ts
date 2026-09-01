"use server";

// ─────────────────────────────────────────────────────────────────────────────
// The invite-only account flow (BUILD_PLAN S2-T39). PRD MVP item 1: "email-based
// account invitation (no public signup)". Public signup is disabled at the vendor
// (`supabase/config.toml`, `enable_signup = false`), so the ONLY way an account is
// created is a `tech_admin` sending an invite through this action.
//
// `createAdminClient()` is required here because `auth.admin.inviteUserByEmail`
// is an Admin API call with no caller-JWT equivalent — this is the ARCHITECTURE.md
// §5 exception, not a workaround. The accompanying `user_roles` row is written
// with the CALLER's client (`ctx.supabase`), never the admin client, so the
// `user_roles_write` RLS policy (tech_admin + aal2) and the `audit_row()` trigger
// both apply to that write (DATA_MODEL.md §6/0012, ARCHITECTURE.md §5).
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";

import { err, mapDbError, ok, validationFailure, type ActionResult } from "@/lib/action-result";
import { inviteUserSchema } from "@/lib/auth/invite-schema";
import { withRole } from "@/lib/auth/with-role";
// admin-client consumer named in lib/server/admin-client.ts's own header (ARCHITECTURE §5).
// `auth.admin.inviteUserByEmail` has no caller-JWT equivalent; the resulting `user_roles`
// row below is still written through `ctx.supabase`, not this client.
// eslint-disable-next-line no-restricted-imports -- invite flow: the one sanctioned
import { createAdminClient } from "@/lib/server/admin-client";

export type InviteUserResult = {
  /** `auth.users.id` of the newly invited account. */
  userId: string;
};

/**
 * Invite a new account and assign it a role, `tech_admin` only.
 *
 * On success, exactly one `auth.users` row and one `user_roles` row exist for the
 * invited email; the `user_roles` insert is what triggers `audit_row()` (US-E3:
 * "every officer role change is written to the audit log").
 *
 * If the `auth.users` insert succeeds but the `user_roles` insert fails (a race
 * against a role already assigned to a re-invited email, a dropped connection,
 * an RLS surprise), the auth account exists with no role — every policy in the
 * system denies-by-default on a missing `user_roles` row, so this is inert, not
 * dangerous. The error names the orphaned invite's `auth.users.id` so a
 * `tech_admin` can finish the job with `assignRole` rather than re-inviting the
 * same email and hitting a duplicate-account error from the vendor.
 */
export const inviteUser = withRole<unknown, InviteUserResult>(
  ["tech_admin"],
  async (ctx, input) => {
    const parsed = inviteUserSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);

    const { email, role, region_id, person_id } = parsed.data;

    let invitedUserId: string;
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email);

      if (error || !data.user) {
        return err(
          "upstream",
          "Could not send the invitation. No account or role was created. " +
            "The email may already have an account, or the invite service is unavailable.",
        );
      }

      invitedUserId = data.user.id;
    } catch {
      // A thrown network/config error from the Admin API — never a partial state,
      // since nothing was written yet.
      return err<InviteUserResult>("upstream");
    }

    const { error: roleError } = await ctx.supabase.from("user_roles").insert({
      user_id: invitedUserId,
      role,
      region_id: region_id ?? null,
      person_id: person_id ?? null,
    });

    if (roleError) {
      const mapped = mapDbError(roleError);
      return err<InviteUserResult>(
        mapped.code,
        `The invitation email was sent (account ${invitedUserId}), but the role could not ` +
          `be recorded — ${mapped.message} Use "Assign role" with that account id to finish, ` +
          `or contact the Technical Admin.`,
      );
    }

    revalidatePath("/system/user-roles");
    return ok({ userId: invitedUserId });
  },
);

/** Re-export for callers that only need the guarded-action type shape. */
export type InviteUserAction = (input: unknown) => Promise<ActionResult<InviteUserResult>>;
