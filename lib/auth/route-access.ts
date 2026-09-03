// ─────────────────────────────────────────────────────────────────────────────
// The routing decision, pulled out of `middleware.ts` so it is unit-testable without
// a browser and readable without tracing a request.
//
// ⚠️ THIS FILE IS UX AND DEFENCE IN DEPTH. IT IS NOT THE SECURITY BOUNDARY.
//
// Changing this file does not change what data anyone can reach. Postgres RLS does
// that (ARCHITECTURE.md §5): if `middleware.ts` were deleted tomorrow, no PII would
// leak, because every query carries the caller's JWT and policies return empty sets.
// What this file buys is that a member is never shown an admin URL, and an officer is
// sent somewhere useful instead of to a page that would render nothing.
//
// If you ever find yourself relying on `canAccess` to keep a column secret, the policy
// is wrong — fix the policy, and write the pgTAP test first.
//
// ── Route groups are URL-INVISIBLE ──────────────────────────────────────────
// Next's parenthesised route groups do not appear in the URL. `app/(admin)/members/`
// serves `/members`, and `app/(admin)/system/user-roles/` serves `/system/user-roles`.
// The prefixes below are therefore the real, served paths — not the folder names.
// ─────────────────────────────────────────────────────────────────────────────

import type { Enums } from "@/database.types";

/** The seven access tiers. Generated from the `org_role` enum — never hand-typed. */
export type OrgRole = Enums<"org_role">;

/** The audience a path belongs to. One group per PRD tier, plus `public` and `auth`. */
export type RouteGroup = "public" | "auth" | "admin" | "officer" | "member" | "rr";

/**
 * The `/system` surface is `tech_admin` alone — terms, application windows and
 * `user_roles`. PRD §2 Technical Admin: "configure the system and control access".
 */
export const ADMIN_SYSTEM_PREFIX = "/system";

/**
 * The one authenticated path outside every group: the explicit "you cannot see this"
 * page a route-group layout falls back to (BUILD_PLAN S2-T34). Reachable by any
 * signed-in account so the fallback cannot become a redirect loop.
 */
export const UNAUTHORIZED_PATH = "/unauthorized";

/** Where an unauthenticated request is sent. */
export const LOGIN_PATH = "/login";

/**
 * Served path prefixes, by audience. A prefix matches a path exactly or as a whole
 * leading segment — `/system` matches `/system` and `/system/user-roles`, and does
 * NOT match `/systematic`.
 *
 * `/committees-admin` and `/officers` are deliberately absent: those admin surfaces
 * are v1.1 (BUILD_PLAN "Scope honesty") and adding a prefix for a page that does not
 * exist would let a URL through to a 404 instead of home.
 */
export const ROUTE_GROUPS = {
  public: ["/apply", "/privacy"],
  auth: [LOGIN_PATH, "/auth"],
  admin: ["/dashboard", "/members", "/applications", "/audit", ADMIN_SYSTEM_PREFIX],
  officer: ["/directory", "/committees"],
  member: ["/portal"],
  rr: ["/region"],
} as const satisfies Record<RouteGroup, readonly string[]>;

/** Deterministic iteration order for `groupForPath`. */
const GROUP_ORDER: readonly RouteGroup[] = ["public", "auth", "admin", "officer", "member", "rr"];

/**
 * The four roles that reach the admin surface. `moderator` is included because the
 * operating tier reviews applications and updates member records (PRD §2 Moderator);
 * it is excluded from `/system` by the check in `canAccess`, not by this list.
 */
const ADMIN_GROUP_ROLES: readonly OrgRole[] = [
  "exec_admin",
  "tech_admin",
  "crrd_admin",
  "moderator",
];

/** Landing route per role. A `Record` over the enum, so a new tier is a compile error. */
const HOME_BY_ROLE: Record<OrgRole, string> = {
  exec_admin: "/dashboard",
  crrd_admin: "/dashboard",
  moderator: "/dashboard",
  // NOT `/dashboard`: the `memberships` SELECT policy does not name `tech_admin`, so
  // the CTO would land on an all-zero headcount screen that reads as a broken system
  // (BUILD_PLAN S6-T13). Their surface is system configuration.
  tech_admin: ADMIN_SYSTEM_PREFIX,
  officer: "/directory",
  regional_rep: "/region",
  member: "/portal",
};

/** Strip a trailing slash so `/members/` and `/members` are the same path. */
function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

/** Exact match, or a whole-segment prefix match. Never a bare `startsWith`. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The group a served path belongs to, or `null` when it belongs to none.
 *
 * `null` is the deny-by-default answer: `/`, `/unauthorized`, a typo and a route that
 * does not exist all land here, and `canAccess` refuses all of them for an
 * authenticated user (who is then sent home) as well as for an anonymous one.
 */
export function groupForPath(pathname: string): RouteGroup | null {
  const path = normalize(pathname);

  let best: RouteGroup | null = null;
  let bestLength = -1;

  for (const group of GROUP_ORDER) {
    for (const prefix of ROUTE_GROUPS[group]) {
      if (matchesPrefix(path, prefix) && prefix.length > bestLength) {
        best = group;
        bestLength = prefix.length;
      }
    }
  }

  return best;
}

/** Whether this role reaches the admin surface at all (before the `/system` narrowing). */
function isAdminGroupRole(role: OrgRole): boolean {
  return ADMIN_GROUP_ROLES.includes(role);
}

/**
 * May this role reach this path?
 *
 * @param role the caller's live role from `user_roles`, or `null` when anonymous.
 * @param pathname the served path, e.g. `/system/user-roles`.
 */
export function canAccess(role: OrgRole | null, pathname: string): boolean {
  const path = normalize(pathname);
  const group = groupForPath(path);

  // The public application portal, the privacy notice, and the login/recovery/MFA
  // screens are reachable by everyone — an anonymous applicant included. They are the
  // only paths that are.
  if (group === "public" || group === "auth") return true;

  if (role === null) return false;

  // Any signed-in account may see the explicit refusal page.
  if (path === UNAUTHORIZED_PATH) return true;

  // Unknown path — including `/`. Deny, so the caller is sent home rather than shown
  // a 403 that would confirm an admin route exists (BUILD_PLAN S2-T30).
  if (group === null) return false;

  switch (group) {
    case "admin":
      // Terms, application windows and role assignment. Single-occupancy by design;
      // the OQ-13 vacancy risk is a known, recorded consequence.
      if (matchesPrefix(path, ADMIN_SYSTEM_PREFIX)) return role === "tech_admin";
      return isAdminGroupRole(role);

    case "officer":
      // The read-only directory and committee rosters. Admin roles see them too — the
      // COLUMNS an officer gets are cut by the column-level GRANT and
      // `v_member_directory`, never by this function (ARCHITECTURE §5).
      return role === "officer" || isAdminGroupRole(role);

    case "member":
      // Strictly the member's own portal. US-E4: a member sees their own assignment
      // and nothing else, so nobody else has a reason to be here.
      return role === "member";

    case "rr":
      // Scoped to `auth_region_id()` by RLS. Only the regional rep tier lands here.
      return role === "regional_rep";
  }

  // Every RouteGroup is handled above. Adding a group without a case is a compile
  // error here, not a silent allow.
  const exhaustive: never = group;
  return exhaustive;
}

/** Where this role lands after login, and where a denied navigation is redirected. */
export function homeForRole(role: OrgRole | null): string {
  if (role === null) return LOGIN_PATH;
  return HOME_BY_ROLE[role];
}

/**
 * Is TOTP enrolment mandatory for this role?
 *
 * PRD MVP item 2 / US-A3: every account above Member tier. Members hold no
 * organizational data — the risk-proportionate exception is documented in ADR 0004,
 * not left implicit.
 *
 * This is the UX half. The database backstop is the `(auth.jwt() ->> 'aal') = 'aal2'`
 * predicate on the privileged write policies (BUILD_PLAN S2-T16, S2-T25): delete this
 * function and an unverified `tech_admin` still cannot write a role.
 */
export function requiresMfa(role: OrgRole | null): boolean {
  return role !== null && role !== "member";
}

/**
 * Is the middleware's MFA gate switched on?
 *
 * ⚠️ THE ONLY REASON THIS EXISTS IS DEMO ERGONOMICS. Setting `DEV_DISABLE_MFA=1`
 * lets an above-Member account reach the app on a password alone, so that trying
 * seven role tiers back to back does not mean seven authenticator enrolments.
 *
 * What it does NOT do, and must never be extended to do:
 *
 *   · It does not touch the DATABASE backstop. `has_aal2()` still guards every
 *     privileged write policy, so with the gate off a `tech_admin` session is aal1
 *     and its writes to `user_roles`, `terms`, `application_windows`,
 *     `rr_region_grants` and `privacy_notice_versions` are still refused — silently,
 *     as zero rows affected, because that is what an RLS refusal looks like. Role
 *     assignment and opening an application window stop working. That is the
 *     security model holding, not a bug to route around, and it is the reason this
 *     flag can never be a substitute for enrolling on a real deployment.
 *   · It does not weaken US-A4. `/auth/reset` still demands the second factor before
 *     a privileged password change; the reset page reads `requiresMfa` directly.
 *   · It is not read anywhere except the middleware gate.
 *
 * Default is ON. Only the exact string "1" disables it — not "true", not "yes", not
 * any non-empty value — so a stray or half-written variable fails closed.
 *
 * PRD MVP item 2 / US-A3 is a hard requirement for the real deployment. This flag
 * must not be set on the org's production project; it is registered as launch debt.
 */
export function mfaGateEnabled(): boolean {
  return process.env.DEV_DISABLE_MFA !== "1";
}
