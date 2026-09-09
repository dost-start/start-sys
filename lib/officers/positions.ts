// ─────────────────────────────────────────────────────────────────────────────
// Which tier may SEAT which CBL position.
//
// FINDING A9 (reviewer PDF 2026-09-09; Ethan: "CRRD cannot assign that"): the officers
// screen offered CRRD an Appoint control on the Special Advisor row.
//
// ADR 0012 made crrd_admin a second RECORDER of officer standing for the CBL's elected
// and appointed seats. That reasoning does not reach `SPECIAL_ADVISOR`:
//
//   · CBL Art. X §3.1 — the Special Advisor is an employee of DOST-SEI, not a scholar and
//     not a member. Seating them is an external appointment, not an org HR record.
//   · CBL Art. X §2.4-2.5 — they are the INDEPENDENT reviewer of appeals against the same
//     disciplinary outcomes crrd_admin records. A tier that can seat its own appeal
//     reviewer is not being reviewed independently.
//
// ⚠ THIS MODULE IS NOT THE PERMISSION. Migration 0054 narrows
// `officer_assignments_insert` / `_update` so the database refuses the identical write,
// and `075_officer_assignments_crrd.sql` (21-24) proves it per role. What lives here is
// the same fact spelled once for the UI and the Server Action, so the screen does not
// offer a button whose only outcome is an error — CLAUDE.md's banned patterns are explicit
// that a hidden control is never the enforcement, and it is not being used as one here.
//
// The position is NOT removed from the roster: CRRD still sees who holds the seat. Only
// the write controls go.
// ─────────────────────────────────────────────────────────────────────────────

import type { ActionContext } from "@/lib/auth/with-role";

/** CBL Art. III §2.9 — the non-voting Executive Board seat, held by a DOST-SEI employee. */
export const SPECIAL_ADVISOR_CODE = "SPECIAL_ADVISOR";

/** Whether `role` may appoint to, or record a separation on, `positionCode`. */
export function canSeatPosition(role: ActionContext["role"], positionCode: string): boolean {
  if (positionCode === SPECIAL_ADVISOR_CODE) return role === "exec_admin";
  return role === "exec_admin" || role === "crrd_admin";
}

/** The message shown when the answer above is no, for the one seat where it can be. */
export const SPECIAL_ADVISOR_REFUSAL =
  "Only an Executive Admin can seat or separate the Special Advisor. The Special Advisor " +
  "reviews appeals against CRRD's own records (CBL Art. X §2.4–2.5) and is a DOST-SEI " +
  "appointee rather than a member (Art. X §3.1).";
