// ─────────────────────────────────────────────────────────────────────────────
// THE CRRD RECORDS DESK — schemas and the CBL Art. VI state machine, in TypeScript
// (ADR 0012, migration 0046).
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ UNLIKE lib/members/transitions.ts, THERE IS NO DATABASE TRIGGER BEHIND THIS TABLE
// ═══════════════════════════════════════════════════════════════════════════════
// `enforce_membership_transition()` (0028) enforces the membership state machine at the
// database layer regardless of what the UI offers. `officer_assignments` has NO
// equivalent — 0007/0014/0046 enforce only WHO may write the row (exec_admin and, since
// ADR 0012, crrd_admin), never WHICH status legally follows which. BUILD_PLAN's own
// coverage matrix says so plainly: "the officer machine ships as enum + constraints +
// exec-only RLS + pgTAP — the boundary is enforced from day one; only the screen is
// missing." This module IS that screen's state machine — not a UI mirror of a database
// one. A status this file wrongly offers is NOT caught anywhere else in the system, so
// getting `OFFICER_LEGAL_EDGES` right matters more here than the equivalent table does
// for memberships.
//
// FIELD NAME == ZOD PATH == `error.fields` KEY == FORM INPUT `name`. Flat shapes, same
// reasoning as lib/members/schema.ts: a nested object would put a dot in every issue
// path and break the line from a server field error to `setError`.
//
// CITATION: ADR 0012; DATA_MODEL.md §3.4, §13 rule 10; ARCHITECTURE.md §5;
//           PRD US-E5, US-E6, US-E7, OQ-16; CBL Art. VI (all sections), Art. V §1.3.3,
//           §2, §4.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

import type { Enums } from "@/database.types";

export type OfficerAssignmentStatus = Enums<"officer_assignment_status">;

/** Every label of the enum, generated — never hand-typed, so a new value is a compile error below. */
export const OFFICER_ASSIGNMENT_STATUSES = [
  "active",
  "on_leave",
  "suspended",
  "resigned",
  "dismissed",
  "impeached",
  "ended",
] as const satisfies readonly OfficerAssignmentStatus[];

/** Human labels. Keyed by the union, so a new enum member fails typecheck here first. */
export const OFFICER_ASSIGNMENT_STATUS_LABELS: Record<OfficerAssignmentStatus, string> = {
  active: "Active",
  on_leave: "On leave",
  suspended: "Suspended",
  resigned: "Resigned",
  dismissed: "Dismissed",
  impeached: "Impeached",
  ended: "Ended",
};

// ── The CBL Art. VI state machine ────────────────────────────────────────────

export type OfficerAssignmentEdge = {
  from: OfficerAssignmentStatus;
  to: OfficerAssignmentStatus;
};

/**
 * The legal edges of CBL Art. VI ("Separation from Office"), transcribed from
 * DATA_MODEL.md §3.4's transition table.
 *
 * Terminal states — `resigned`, `dismissed`, `impeached`, `ended` — appear on no
 * left-hand side: `impeached` because Art. VI §3.2.8 makes the Executive Board's ruling
 * "final and irrevocable" (the one state the Constitution itself declares terminal), the
 * other three because a re-appointment is a NEW ROW for a new term, never a reopened one
 * (DATA_MODEL.md §3.4).
 *
 * `on_leave -> active` (return from leave, Art. VI §1.3-1.4) and `suspended -> active`
 * (acquittal / complaint dropped) are offered by the record-separation dialog too — a
 * return to active is recorded through the same control.
 */
export const OFFICER_LEGAL_EDGES: readonly OfficerAssignmentEdge[] = [
  { from: "active", to: "on_leave" }, // Art. VI §1.2 — CEO approves LOA
  { from: "on_leave", to: "active" }, // Art. VI §1.3-1.4 — return from leave
  { from: "on_leave", to: "dismissed" }, // Art. VI §1.5.4, §1.7 — unanswered AWOL notice
  { from: "active", to: "suspended" }, // Art. VI §3.2.3 — automatic on an impeachment complaint
  { from: "on_leave", to: "suspended" }, // Art. VI §3.2.3
  { from: "suspended", to: "impeached" }, // Art. VI §3.2.7 — Executive Board majority vote
  { from: "suspended", to: "active" }, // acquitted, or the complaint was dropped
  { from: "active", to: "resigned" }, // Art. VI §2.2 — approval rests with the CEO
  { from: "on_leave", to: "resigned" }, // Art. VI §2.2
  { from: "active", to: "dismissed" }, // Art. VI §1.7
  { from: "active", to: "ended" }, // Art. V §1.3.3 (death), Art. VI §4 (permanent incapacity)
  { from: "on_leave", to: "ended" },
  { from: "suspended", to: "ended" },
] as const;

/** Is `from -> to` an edge of the machine at all, ignoring who is asking? */
export function isLegalOfficerEdge(
  from: OfficerAssignmentStatus,
  to: OfficerAssignmentStatus,
): boolean {
  return OFFICER_LEGAL_EDGES.some((edge) => edge.from === from && edge.to === to);
}

/**
 * The statuses the RECORD-SEPARATION dialog offers as a target, given a holder's
 * current status. Every right-hand side of `OFFICER_LEGAL_EDGES` — including `active`,
 * which is only ever reachable from `on_leave` (return from leave, Art. VI §1.3–1.4) or
 * `suspended` (acquittal / complaint dropped) and is filtered per holder by
 * `legalSeparationTargets`. A return to active is a change of standing the records desk
 * records like any other (ADR 0012).
 */
export const SEPARATION_TARGET_STATUSES = [
  "active",
  "on_leave",
  "suspended",
  "resigned",
  "dismissed",
  "impeached",
  "ended",
] as const satisfies readonly OfficerAssignmentStatus[];

export type SeparationTargetStatus = (typeof SEPARATION_TARGET_STATUSES)[number];

/** The separation targets legally reachable from a holder's current status, for the dropdown. */
export function legalSeparationTargets(
  from: OfficerAssignmentStatus,
): readonly SeparationTargetStatus[] {
  return OFFICER_LEGAL_EDGES.filter((edge) => edge.from === from)
    .map((edge) => edge.to)
    .filter((to): to is SeparationTargetStatus =>
      (SEPARATION_TARGET_STATUSES as readonly string[]).includes(to),
    )
    .sort();
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Matches `memberships_terminated_has_ground`-style grounds elsewhere in this codebase
 * (`ENDED_REASON_MIN_LENGTH`, lib/members/schema.ts) and `rejected_has_reason` (0024) —
 * NOT a database CHECK here (`officer_assignments.status_note` carries none), so this
 * floor is enforced by this schema alone. Being stricter than the database is safe.
 */
export const OFFICER_STATUS_NOTE_MIN_LENGTH = 10;
export const OFFICER_STATUS_NOTE_MAX_LENGTH = 500;

const statusNoteSchema = z
  .string()
  .trim()
  .min(
    OFFICER_STATUS_NOTE_MIN_LENGTH,
    `Name the CBL Art. VI basis and, if you are not the decider, who decided — at least ${OFFICER_STATUS_NOTE_MIN_LENGTH} characters.`,
  )
  .max(OFFICER_STATUS_NOTE_MAX_LENGTH, "That note is too long.");

/** Matches `member_id_format` (0004): `^\d{4}-\d{3,}$`, admitting both 3- and 4-digit widths. */
const MEMBER_ID_RE = /^\d{4}-\d{3,}$/;

export const officerLookupSchema = z
  .object({
    member_id: z.string().trim().regex(MEMBER_ID_RE, "Enter a member ID like 2026-0001"),
  })
  .strict();
export type OfficerLookupInput = z.infer<typeof officerLookupSchema>;

/**
 * Appoint a person to a vacant (or acting) seat. `position_code` and `person_id` are
 * both resolved server-rendered values, never free text the caller invents: the position
 * comes from a roster row the page already fetched, and `person_id` is what
 * `lookupOfficerCandidate` resolved from the typed member ID. The database's own FK
 * (`officer_assignments.role -> officer_positions.code`, `.person_id -> people.id`) and
 * the `one_sitting_officer` / `one_acting_officer` partial unique indexes (0007) are the
 * real boundary; this schema only rejects an obviously malformed request before it
 * reaches them.
 */
export const officerAppointSchema = z
  .object({
    position_code: z.string().trim().min(1, "Choose a position").max(32),
    person_id: z.uuid(),
    is_acting: z.boolean(),
    status_note: statusNoteSchema,
  })
  .strict();
export type OfficerAppointInput = z.infer<typeof officerAppointSchema>;

/**
 * Record a separation from office (CBL Art. VI) on an existing holder row.
 *
 * `from_status` is the holder's CURRENT status, read from the roster row the dialog
 * opened on — not user-editable — and exists so this schema can reject an illegal edge
 * BEFORE the request reaches the database, since (unlike memberships) nothing there
 * will. `status` is restricted to `SEPARATION_TARGET_STATUSES`, so `active` cannot be
 * submitted through this form at all — see that constant's own comment.
 */
export const officerSeparationSchema = z
  .object({
    assignment_id: z.uuid(),
    from_status: z.enum(OFFICER_ASSIGNMENT_STATUSES),
    status: z.enum(SEPARATION_TARGET_STATUSES),
    status_note: statusNoteSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isLegalOfficerEdge(value.from_status, value.status)) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: `${OFFICER_ASSIGNMENT_STATUS_LABELS[value.from_status]} cannot move to ${OFFICER_ASSIGNMENT_STATUS_LABELS[value.status]} — not a legal CBL Art. VI edge.`,
      });
    }
  });
export type OfficerSeparationInput = z.infer<typeof officerSeparationSchema>;
