// ─────────────────────────────────────────────────────────────────────────────
// THE MEMBERSHIP STATE MACHINE, IN TYPESCRIPT (BUILD_PLAN S5-T15).
//
// The status editor must offer only legal next statuses, which means the edge set now
// exists TWICE: here, and in the inline VALUES list inside
// `enforce_membership_transition()` (0028_membership_status_transitions.sql).
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ TWO COPIES WILL DRIFT WITHIN A FORTNIGHT UNLESS SOMETHING CHECKS
// ═══════════════════════════════════════════════════════════════════════════════
// So something does. `transitions.test.ts` READS 0028 FROM DISK, extracts the pairs
// between its `-- ── BEGIN LEGAL EDGE LIST ──` / `-- ── END LEGAL EDGE LIST ──`
// sentinels, and asserts SET EQUALITY with `LEGAL_EDGES` below. Adding an edge to the
// SQL without adding it here (or the reverse) turns that test red.
//
// ⚠ THE SQL IS THE AUTHORITY. If the two disagree, the trigger is what actually
// happens and this file is the bug — the same asymmetry `withRole` has against RLS
// (lib/auth/with-role.ts). This module is a UI convenience: a status the editor
// wrongly offers is refused by the trigger with 23514 or 42501, and a status it wrongly
// hides is a missing button, not a missing guard.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS IS A MODULE AND NOT A REFERENCE TABLE
// ═══════════════════════════════════════════════════════════════════════════════
// A `membership_status_transitions` table would be the "obvious" fix for the duplication
// — and it would be a 30th table in a schema another agent is editing this week, plus a
// query on every render of a dropdown, plus a second thing the trigger would have to be
// kept in step with anyway (the trigger cannot read a table it is guarding without
// inviting a recursion argument). Noted so a future maintainer can see the choice was
// made rather than missed. <!-- decision: boring option — a parsed-parity test over a
// TypeScript constant, not a reference table. -->
//
// CITATION: BUILD_PLAN S5-T15, S5-T28; DATA_MODEL.md §3.1, §13 rule 10;
//           PRD §3 v1.0 item 11, US-D3, US-D5, US-D6, US-H5;
//           CBL Art. VII §1, §3.1, §3.2.3, §3.2.5-3.2.6.
// ─────────────────────────────────────────────────────────────────────────────

import type { Enums } from "@/database.types";

export type MembershipStatus = Enums<"membership_status">;
export type OrgRole = Enums<"org_role">;

/** One directed edge of the machine. `from` may equal no `to` at all — see below. */
export type MembershipEdge = {
  from: MembershipStatus;
  to: MembershipStatus;
};

/**
 * The legal edges, mirroring the VALUES list in 0028 EXACTLY.
 *
 * Every terminal state — `graduated`, `resigned`, `left` — is terminal BY ABSENCE: it
 * appears on no left-hand side. A member who returns gets a NEW ROW IN A NEW TERM and
 * keeps their original member ID (PRD US-H5); there is no edge that walks a membership
 * backwards out of an ending, because a membership is a term-scoped record and last
 * term's ending is not this term's business.
 *
 * `terminated` is the one exception and the reason is constitutional: CBL Art. VII
 * §3.2.5-3.2.6 gives the member five working days to appeal to the Special Advisor, who
 * may recommend reconsideration. Without `terminated -> active` a successful appeal
 * would be unrepresentable, and CRRD would work around it by creating a second `people`
 * row — which is exactly how a member acquires a second member ID.
 */
export const LEGAL_EDGES: readonly MembershipEdge[] = [
  { from: "renewal_pending", to: "active" }, // CRRD approves the renewal
  { from: "renewal_pending", to: "left" }, // declined, or swept by roll_over_term()
  { from: "active", to: "graduated" }, // PRD US-D3
  { from: "active", to: "resigned" }, // PRD US-D3
  { from: "active", to: "left" }, // PRD US-D3 — the quiet, non-adjudicated exit
  { from: "active", to: "terminated" }, // CBL Art. VII §3.2.3 — exec_admin only
  { from: "terminated", to: "active" }, // CBL Art. VII §3.2.5-3.2.6 — the ONLY reversal
] as const;

/**
 * The tiers that hold an UPDATE policy on `memberships` at all (0014's
 * `memberships_update`).
 *
 * `officer` and `regional_rep` are absent because NO UPDATE POLICY NAMES THEM — PRD
 * US-D2 and US-F2 are missing policies, not hidden buttons, and 026's negative-space
 * meta-test asserts that no policy anywhere names either role for a write. `tech_admin`
 * is absent because the CTO configures the system and does not edit member records
 * (PRD OQ-5); `member` because a member's write surface is forms only.
 */
export const STATUS_WRITER_ROLES: readonly OrgRole[] = [
  "exec_admin",
  "crrd_admin",
  "moderator",
] as const;

/**
 * The tier that may cross either `terminated` edge, and it is one tier.
 *
 * CBL Art. VII §3.2.3: removal from the organization requires "a simple majority vote
 * (50% + 1) of the Executive Board". §3.2.5-3.2.6 gives the reversal to the same body
 * on the Special Advisor's recommendation. `crrd_admin` and `moderator` own every OTHER
 * membership transition and are narrowed out of these two — collapsing them into `left`
 * would make an Executive Board ruling indistinguishable from an unreturned renewal
 * form in the audit log (PRD US-D5, US-D6).
 */
export const TERMINATION_ROLE: OrgRole = "exec_admin";

/** Statuses that carry a written ground under PRD US-D5, in either direction. */
export function requiresWrittenGround(from: MembershipStatus, to: MembershipStatus): boolean {
  return to === "terminated" || from === "terminated";
}

/**
 * Is `from -> to` an edge of the machine at all, ignoring who is asking?
 *
 * This is the 23514 question — whether the transition EXISTS. Distinct from the 42501
 * question of who may cross it, because they are different refusals with different
 * meanings: `graduated -> active` is not a permission anyone could be granted.
 */
export function isLegalEdge(from: MembershipStatus, to: MembershipStatus): boolean {
  return LEGAL_EDGES.some((edge) => edge.from === from && edge.to === to);
}

/**
 * The statuses `role` may actually move a membership in `from` to.
 *
 * Returns `[]` — meaning "render no status control" — for:
 *   · a terminal status (`graduated`, `resigned`, `left`): no outgoing edge exists;
 *   · a role with no UPDATE policy on `memberships`: officer, regional_rep, tech_admin,
 *     member. Their attempt would affect zero rows, and a control that silently does
 *     nothing is worse than no control (PRD US-D2, US-F2);
 *   · `terminated`, for anyone but an Executive Admin: the row is not even VISIBLE for
 *     update to them, because `memberships_update`'s USING half hides it.
 *
 * The result is sorted so the dropdown's order is stable across renders and the tests
 * can compare arrays without sorting at the call site.
 */
export function legalNextStatuses(
  from: MembershipStatus,
  role: OrgRole,
): readonly MembershipStatus[] {
  if (!STATUS_WRITER_ROLES.includes(role)) return [];

  return LEGAL_EDGES.filter((edge) => edge.from === from)
    .filter((edge) => !requiresWrittenGround(edge.from, edge.to) || role === TERMINATION_ROLE)
    .map((edge) => edge.to)
    .sort();
}

/**
 * Would this exact transition be permitted?
 *
 * The editor's guard AND the shape the status action's schema refines against, so the
 * dropdown and the submitted value cannot disagree about what was on offer.
 */
export function canTransition(
  from: MembershipStatus,
  to: MembershipStatus,
  role: OrgRole,
): boolean {
  return legalNextStatuses(from, role).includes(to);
}

/** True when a status ends a membership for the term — drives the sign-out copy. */
export function isTerminalStatus(status: MembershipStatus): boolean {
  return LEGAL_EDGES.every((edge) => edge.from !== status);
}

/** Human labels. Keyed by the union, so a new enum member is a compile error here. */
export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  renewal_pending: "Renewal pending",
  active: "Active",
  graduated: "Graduated",
  resigned: "Resigned",
  left: "Left",
  terminated: "Terminated",
};
