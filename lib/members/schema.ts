// ─────────────────────────────────────────────────────────────────────────────
// THE MEMBER-RECORD SCHEMAS (BUILD_PLAN S5-T16).
//
// ONE module, imported by the client form AND re-run inside the Server Action. The PRD's
// Data Integrity NFR ("validate required fields and formats before modifying membership
// records") implemented once instead of twice and drifting (CONVENTIONS.md §6). The
// client check is UX; the server re-parse is the guard; the database CHECKs and
// `update_member_record()`'s own whitelist are the boundary.
//
// FIELD NAME == ZOD PATH == `error.fields` KEY == FORM INPUT `name` == DB COLUMN. The
// shape is flat for exactly that reason: a nested `{ patch: {...} }` would put a dot in
// every issue path and break the straight line from a server field error to `setError`
// on the input that caused it.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ TWO CONTRACTS WITH SQL THAT NOTHING ELSE CHECKS
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. `MEMBER_PATCHABLE_KEYS` must equal `update_member_record()`'s inline whitelist
//    (0030). A key here that the function refuses is a form field that always errors
//    with 22023; a key the function allows but this schema strips is a field a CCDO
//    edits and silently loses. schema.test.ts parses 0030 and asserts set equality.
//
//    Absent from that list ON PURPOSE, and none of them is an oversight:
//      · `member_id`   PRD US-C4 — 2024-001 never becomes 2025-001. Defended three
//                      times over (a CHECK, enforce_member_id_immutable(), the whitelist).
//      · `join_year`   the year they first joined, forever.
//      · `id`          identity is not editable.
//      · `redacted_at` the five-year purge's own stamp.
//      · `status`      a TERM-SCOPED fact on `memberships`, not a person-scoped one. It
//                      moves through a plain table UPDATE so that memberships_update
//                      (0014) AND enforce_membership_transition() (0028) are both in the
//                      path. Routing it through a SECURITY DEFINER function would take
//                      RLS out of that path entirely.
//
// 2. `ENDED_REASON_MIN_LENGTH` must equal the floor in
//    `memberships_terminated_has_ground` and in 0028's trigger. Set it lower here and a
//    reviewer types eight characters, hits Save, and gets a 23514 the form has no field
//    to attach; set it higher and the form refuses a ground the Constitution accepts.
//
// CITATION: BUILD_PLAN S5-T16, S5-T27, S5-T28; CONVENTIONS.md §6, §5;
//           PRD §IV Data Integrity NFR; PRD US-C4, US-D1, US-D3, US-D5, US-D6;
//           DATA_MODEL.md §6/0006, §8.1; CBL Art. VII §3.1, §3.2.3.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

import { MEMBERSHIP_STATUSES } from "@/lib/members/filters";
import type { MembershipStatus } from "@/lib/members/transitions";

// ── Formats ──────────────────────────────────────────────────────────────────
// Transcribed from lib/applications/schema.ts rather than imported, and the duplication
// is deliberate: these two forms collect the same facts about a person at two different
// moments, but they are separate surfaces with separate lifecycles, and an import would
// couple an admin edit screen to the public intake form so that loosening one loosens
// the other silently. Both files are validated against the same database constraints.

/**
 * Philippine mobile number, after separators are stripped. Accepts both forms a scholar
 * actually types: `+639171234567` and `09171234567`.
 *
 * Permissive rather than exhaustive — this rejects a typo, it does not verify that a
 * number is reachable. The system cannot verify truth (PRD §4 Assumptions).
 */
const PH_MOBILE_RE = /^(?:\+63|0)9\d{9}$/;

/** Everything a human puts between the digits of a phone number. */
const PHONE_SEPARATORS_RE = /[\s()\-.]/g;

/** Philippine ZIP code: exactly four digits. */
const POSTAL_CODE_RE = /^\d{4}$/;

/** Nobody in this organization was born before this. Catches a mistyped century. */
const EARLIEST_PLAUSIBLE_BIRTH_YEAR = 1900;

/**
 * The floor on a written ground, matching `memberships_terminated_has_ground` (0028) and
 * `rejected_has_reason` (0024). Refuses "ok", "n/a" and "-" without pretending to judge
 * prose. PRD US-D5.
 */
export const ENDED_REASON_MIN_LENGTH = 10;
export const ENDED_REASON_MAX_LENGTH = 500;

// ── Patch-field builders ─────────────────────────────────────────────────────
//
// Every field is OPTIONAL, because this is a patch: a key that is absent means "leave it
// alone", and `update_member_record()` distinguishes absent from present-and-null with
// `p_patch ? 'key'`. The action builds the jsonb from the keys the parse actually
// produced, so an untouched field is never sent and never overwritten.
//
// An EMPTY STRING means CLEAR, not "absent". A CCDO who deletes the contents of the
// address box means to remove the address; mapping "" to `undefined` would silently
// discard that intent and leave the old value in the database, which is the worst
// outcome available — the screen says one thing and the record says another.

/** Optional, clearable, free text. `""` -> `null`. */
const clearableText = (label: string, max = 120) =>
  z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z
        .string()
        .trim()
        .min(1, `${label} cannot be blank`)
        .max(max, `${label} is too long`)
        .nullable(),
    )
    .optional();

/** Optional but NOT clearable — `people` has NOT NULL + a non-blank CHECK on both names. */
const requiredWhenPresent = (label: string, max = 120) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`).optional();

/** Wrap a formatted scalar so that `""` clears it and `undefined` leaves it alone. */
const clearable = <T extends z.ZodType>(inner: T) =>
  z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.union([inner, z.null()]),
    )
    .optional();

// ── The patchable columns ────────────────────────────────────────────────────

/**
 * The thirteen columns `update_member_record()` will accept, in the SAME ORDER as the
 * function's whitelist so a side-by-side read is possible.
 *
 * ⚠ Adding a column to `people` does NOT add it here. It has to be argued onto both this
 * list and 0030's, and if it is sensitive it also has to be registered in
 * `sensitive_column_registry` in the same migration (DATA_MODEL.md §13 rule 4) or the
 * audit log stops masking it and the five-year purge stops clearing it.
 */
export const MEMBER_PATCHABLE_KEYS = [
  "given_name",
  "middle_name",
  "family_name",
  "suffix",
  "birthdate",
  "contact_number",
  "personal_email",
  "address_line",
  "city_municipality",
  "province",
  "postal_code",
  "school",
  "school_id_no",
] as const;

export type MemberPatchableKey = (typeof MEMBER_PATCHABLE_KEYS)[number];

/**
 * Columns a caller might reasonably expect to patch and cannot. Spelled out so the
 * refusal is a documented decision rather than an omission, and asserted in the test.
 */
export const MEMBER_NON_PATCHABLE_KEYS = [
  "id",
  "member_id",
  "join_year",
  "redacted_at",
  "status",
  "created_at",
  "updated_at",
] as const;

const patchShape = {
  given_name: requiredWhenPresent("First name"),
  middle_name: clearableText("Middle name"),
  family_name: requiredWhenPresent("Last name"),
  suffix: clearableText("Suffix", 16),

  // ISO `YYYY-MM-DD` and never `new Date(userInput)` (CONVENTIONS.md §6). The value goes
  // to the database as text and is cast there by `(p_patch->>'birthdate')::date`, so a
  // malformed date raises 22007 and the whole statement rolls back rather than being
  // defensively coerced into a silently NULLed birthdate — data loss disguised as a save.
  birthdate: clearable(
    z.iso
      .date("Enter the date of birth as YYYY-MM-DD")
      .refine((value) => new Date(`${value}T00:00:00Z`).getTime() <= Date.now(), {
        message: "Date of birth cannot be in the future",
      })
      .refine((value) => Number(value.slice(0, 4)) >= EARLIEST_PLAUSIBLE_BIRTH_YEAR, {
        message: "Enter a valid date of birth",
      }),
  ),

  contact_number: clearable(
    z
      .string()
      .trim()
      .refine((value) => PH_MOBILE_RE.test(value.replace(PHONE_SEPARATORS_RE, "")), {
        message: "Enter a Philippine mobile number, e.g. 09171234567 or +639171234567",
      }),
  ),

  // `.trim()` BEFORE the format check: a trailing space pasted out of a messaging app
  // must not read as "invalid email address".
  personal_email: clearable(
    z
      .string()
      .trim()
      .max(254, "Email address is too long")
      .pipe(z.email("Enter a valid email address")),
  ),

  address_line: clearableText("Street address", 200),
  city_municipality: clearableText("City or municipality"),
  province: clearableText("Province"),
  postal_code: clearable(
    z.string().trim().regex(POSTAL_CODE_RE, "Enter a four-digit postal code, e.g. 1101"),
  ),

  school: clearableText("School", 200),
  school_id_no: clearableText("School ID number", 64),
};

// ── memberUpdateSchema ───────────────────────────────────────────────────────

/**
 * The edit form (PRD US-D1), flat so every issue path is a column name.
 *
 * `.strict()` is load-bearing: an unknown key is REFUSED here rather than forwarded to
 * `update_member_record()`, which would raise 22023 and surface as an opaque validation
 * failure with no field attached. It is also the client-side half of the whitelist — a
 * stale bundle or a hand-crafted POST carrying `member_id` fails at this line, and again
 * inside the function, and again at the immutability trigger.
 *
 * ⚠ `expected_updated_at` IS NOT OPTIONAL. PRD US-D1: "concurrent edits do not silently
 * overwrite one another." The form carries the `updated_at` it loaded, the function
 * compares it under `FOR UPDATE`, and a stale value loses with 40001 which the action
 * maps to `conflict`. Making this optional would turn the optimistic-concurrency check
 * into a check a caller can opt out of, which is the same as not having one.
 */
export const memberUpdateSchema = z
  .object({
    person_id: z.uuid(),
    expected_updated_at: z.iso.datetime({ offset: true }),
    ...patchShape,
  })
  .strict()
  .refine((value) => MEMBER_PATCHABLE_KEYS.some((key) => Object.hasOwn(value, key)), {
    message: "Nothing was changed.",
  });

export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

/** The patch payload as `update_member_record()` wants it: only the keys actually sent. */
export type MemberPatch = Partial<Record<MemberPatchableKey, string | null>>;

/**
 * Pick the patchable keys out of a parsed update, preserving the absent/null distinction.
 *
 * `Object.hasOwn` rather than a truthiness test, because `null` is a MEANINGFUL value
 * here (clear the column) and a `!== undefined` filter would drop it — turning "remove
 * this scholar's address" into "leave the address exactly as it was".
 */
export function buildMemberPatch(input: MemberUpdateInput): MemberPatch {
  const patch: MemberPatch = {};
  for (const key of MEMBER_PATCHABLE_KEYS) {
    if (Object.hasOwn(input, key)) {
      patch[key] = input[key] ?? null;
    }
  }
  return patch;
}

// ── membershipStatusUpdateSchema ─────────────────────────────────────────────

/**
 * The statuses that END a membership for the term, and therefore require a written
 * ground before the change is accepted (PRD US-D3, US-D5; BUILD_PLAN S5-T28: "a reason
 * is required for every terminal status on both sides").
 *
 * `terminated` is the constitutional one — CBL Art. VII §3.1 names the grounds and the
 * database refuses the write without one. The other three carry no database CHECK; the
 * requirement here is a deliberate product decision, so that "why is this scholar no
 * longer on the roll" is answerable from the record rather than from someone's memory.
 * Being stricter than the database is safe; being looser is not.
 */
export const ENDING_STATUSES = ["graduated", "resigned", "left", "terminated"] as const;

export type EndingStatus = (typeof ENDING_STATUSES)[number];

export function isEndingStatus(status: MembershipStatus): status is EndingStatus {
  return (ENDING_STATUSES as readonly string[]).includes(status);
}

/**
 * The status editor (PRD US-D3, US-D5, US-D6).
 *
 * ⚠ THIS SCHEMA IS NOT THE AUTHORIZATION AND NOT THE STATE MACHINE. Which edges exist is
 * `enforce_membership_transition()`'s answer (0028) and who may cross the two
 * `terminated` edges is that trigger's plus `memberships_update`'s. This schema's job is
 * narrower and entirely about the FORM: that a status was chosen, and that a ground was
 * typed when one is required.
 *
 * `from_status` is optional and exists for ONE case the target alone cannot detect: the
 * `terminated -> active` reinstatement (PRD US-D6), where the target is `active` — not an
 * ending status — but 0028 still demands a FRESH ground, because a reinstatement that
 * silently inherits the termination's own reason reads as if the Executive Board
 * terminated someone in order to reinstate them. When the editor supplies it, the message
 * lands under the textarea; when it does not, the database raises 23514 and the action
 * re-attaches the error to `ended_reason` (the same shape `rejectApplication` uses).
 */
export const membershipStatusUpdateSchema = z
  .object({
    membership_id: z.uuid(),
    status: z.enum(MEMBERSHIP_STATUSES),
    from_status: z.enum(MEMBERSHIP_STATUSES).optional(),
    ended_reason: z
      .preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? null : value),
        z.union([
          z.string().trim().max(ENDED_REASON_MAX_LENGTH, "That reason is too long"),
          z.null(),
        ]),
      )
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const needsGround = isEndingStatus(value.status) || value.from_status === "terminated";

    if (!needsGround) return;

    const reason = value.ended_reason ?? "";

    if (reason.trim().length < ENDED_REASON_MIN_LENGTH) {
      ctx.addIssue({
        code: "custom",
        // Path is the column name, so react-hook-form's setError puts this under the
        // textarea rather than in a generic toast (CONVENTIONS.md §6).
        path: ["ended_reason"],
        message:
          value.status === "terminated" || value.from_status === "terminated"
            ? `A termination decision must record a written ground of at least ${ENDED_REASON_MIN_LENGTH} characters (CBL Art. VII §3.1).`
            : `Record why this membership is ending — at least ${ENDED_REASON_MIN_LENGTH} characters.`,
      });
    }
  });

export type MembershipStatusUpdateInput = z.infer<typeof membershipStatusUpdateSchema>;
