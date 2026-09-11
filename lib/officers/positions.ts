// ─────────────────────────────────────────────────────────────────────────────
// Which tier may SEAT which CBL position.
//
// OFFICER FEEDBACK 2026-09-11 (ADR 0019, migration 0063): the Special Advisor position is
// RETIRED from START-SYS. Nobody — exec_admin included — can appoint to it or record a
// separation on it, and the /officers roster no longer lists it. The Special Advisor
// advises the whole organization and is a DOST-SEI employee rather than a scholar (CBL
// Art. X §3.1), so it is not a seat the officers record in a membership system.
//
// History: finding A9 (2026-09-09, migration 0054) first narrowed the seat to exec_admin,
// because a CRRD that could seat the Special Advisor could seat the independent reviewer of
// appeals against its own records (CBL Art. X §2.4–2.5). 0063 closes it for every tier.
//
// ⚠ THIS MODULE IS NOT THE PERMISSION. `officer_assignments_insert` / `_update` (0063)
// refuse a write to any position whose `officer_positions.is_active` is false, for every
// tier, and `075_officer_assignments_crrd.sql` proves it. What lives here is the same fact
// spelled once for the Server Action, so a stale screen gets the reason instead of a bare
// permission error — a hidden control is never the enforcement (CLAUDE.md).
//
// The position ROW is not deleted (nothing in this system is hard-deleted, and an older
// assignment may still reference it); it is marked inactive.
// ─────────────────────────────────────────────────────────────────────────────

import type { ActionContext } from "@/lib/auth/with-role";

/** CBL Art. III §2.9 — retired from START-SYS on 2026-09-11 (ADR 0019). */
export const SPECIAL_ADVISOR_CODE = "SPECIAL_ADVISOR";

/** Whether `role` may appoint to, or record a separation on, `positionCode`. */
export function canSeatPosition(role: ActionContext["role"], positionCode: string): boolean {
  if (positionCode === SPECIAL_ADVISOR_CODE) return false;
  return role === "exec_admin" || role === "crrd_admin";
}

/** The message returned when the seat above is refused because it is retired. */
export const SPECIAL_ADVISOR_REFUSAL =
  "The Special Advisor position is no longer recorded in START-SYS. The Special Advisor " +
  "advises the whole organization and is a DOST-SEI employee (CBL Art. X §3.1), not a seat " +
  "the officers assign.";
