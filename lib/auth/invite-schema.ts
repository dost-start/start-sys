// ─────────────────────────────────────────────────────────────────────────────
// Shared zod schemas for the tech_admin role-management surface
// (BUILD_PLAN S2-T39 invite flow, S2-T40 user-roles screen). One module, imported
// by both the client dialogs/forms and the Server Actions that re-validate
// (CONVENTIONS.md §6): the client check is UX, the server check is enforcement.
//
// Field names match what the actions pass to `user_roles` verbatim (`role`,
// `region_id`, `person_id`) — CONVENTIONS §1: DB payload keys stay snake_case.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

import type { OrgRole } from "@/lib/auth/route-access";

/**
 * The seven access tiers, as a literal tuple zod can build an enum from.
 *
 * `satisfies readonly OrgRole[]` checks every element is a real `OrgRole` at
 * compile time; it does not (and cannot) prove the tuple is total over the
 * generated enum. If an eighth tier is ever added to `org_role`, this list needs
 * a matching edit — there is no automated total-over-the-enum check here, unlike
 * `route-access.ts`'s `Record<OrgRole, string>` maps.
 */
export const ORG_ROLES = [
  "exec_admin",
  "tech_admin",
  "crrd_admin",
  "moderator",
  "officer",
  "regional_rep",
  "member",
] as const satisfies readonly OrgRole[];

const uuid = z.string().uuid();

/**
 * An optional uuid field fed by a plain `<input>`/`<select>`, where "nothing
 * chosen" arrives as `""` rather than `undefined` (an uncontrolled DOM element
 * has no other way to represent "empty"). Without this, an untouched optional
 * field fails `.uuid()` validation on every submit.
 */
const optionalUuid = z
  .union([z.literal(""), uuid])
  .optional()
  .transform((value) => (value === "" ? undefined : value));

/**
 * Shared shape: a role assignment needs a region exactly when the role is
 * `regional_rep` — DATA_MODEL.md §6/0004's `rr_needs_region` CHECK, mirrored here
 * so the form can show a field-level error before the database would raise one.
 */
function requireRegionForRegionalRep(
  data: { role: (typeof ORG_ROLES)[number]; region_id?: string },
  ctx: z.RefinementCtx,
): void {
  if (data.role === "regional_rep" && !data.region_id) {
    ctx.addIssue({
      code: "custom",
      path: ["region_id"],
      message: "A region is required for the Regional Representative role.",
    });
  }
}

/**
 * `inviteUser` input. `person_id` is optional: a `tech_admin` account with no
 * `people` row (a system-only login) is a documented, legitimate shape
 * (DATA_MODEL.md §6/0004 — `user_roles.person_id` is nullable).
 */
export const inviteUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    role: z.enum(ORG_ROLES),
    region_id: optionalUuid,
    person_id: optionalUuid,
  })
  .superRefine(requireRegionForRegionalRep);

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** `assignRole` input — (re)point an existing account at a role. */
export const roleAssignmentSchema = z
  .object({
    user_id: uuid,
    role: z.enum(ORG_ROLES),
    region_id: optionalUuid,
    person_id: optionalUuid,
  })
  .superRefine(requireRegionForRegionalRep);

export type RoleAssignmentInput = z.infer<typeof roleAssignmentSchema>;

/**
 * `revokeRole` input. Revocation is a demotion to `member`, never a delete — no
 * hard deletes exist system-wide (CLAUDE.md "Banned patterns").
 */
export const revokeRoleSchema = z.object({
  user_id: uuid,
});

export type RevokeRoleInput = z.infer<typeof revokeRoleSchema>;
