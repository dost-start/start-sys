// ─────────────────────────────────────────────────────────────────────────────
// The application-window inputs (BUILD_PLAN S4-T24; PRD US-B4, MVP item 5).
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS IS A SEPARATE MODULE FROM `lib/applications/schema.ts`
// ═══════════════════════════════════════════════════════════════════════════════
// `schema.ts` is imported by `app/(public)/apply/application-form.tsx`, which is a
// `'use client'` file — so everything in it ships to an anonymous visitor's browser.
// The window inputs belong to an admin screen. They are trivially non-secret, but
// keeping the two apart means the public bundle never grows a shape that only an
// administrator has any use for, and a reader of `schema.ts` can keep assuming that
// everything in it is something an applicant sees.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ INSTANTS ARE ABSOLUTE, AND THAT IS ENFORCED HERE RATHER THAN HOPED FOR
// ═══════════════════════════════════════════════════════════════════════════════
// An `<input type="datetime-local">` produces `2026-09-01T09:00` — a wall-clock
// reading with NO timezone. `new Date()` on that string resolves it against the
// *server's* zone, which on Vercel is UTC while every officer using this screen is in
// Asia/Manila. A CCDO who closed the window at 5pm would find it closing at 1am.
//
// So the schema refuses a value without an offset. The client is responsible for
// converting its local input to an absolute instant (`new Date(local).toISOString()`)
// before it calls the action, and a client that forgets gets a field error instead of
// an eight-hour silent skew.
//
// The values stay STRINGS all the way to Postgres: `opens_at`/`closes_at` are
// `timestamptz`, PostgREST hands an ISO-8601 string straight through, and round-
// tripping through a JS `Date` would only add a place to lose precision.
//
// CONVENTIONS §3.3: `_at` is an instant (`timestamptz`), `_on` is a calendar day.
// Both fields here are instants — a window opens and closes at a moment, not on a day.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

/**
 * The only `form_kind` v1.0 opens a window for.
 *
 * `application_windows` is keyed `unique (term_id, form_kind)` and the enum also
 * carries `committee_application`, `membership_renewal` and `freeform` — but those are
 * v1.1 (items 24, 27) and neither exists as a form yet. Offering them would be a
 * control that opens a period for a form nobody can submit.
 *
 * A literal, not the full enum, so widening it is a deliberate edit here rather than a
 * dropdown that silently grew when 0002's enum did.
 */
export const MEMBERSHIP_APPLICATION_FORM_KIND = "membership_application" as const;
/** The accountless renewal form (0044) — SRS "Membership Renewal Form"; PRD US-G7. */
export const MEMBERSHIP_RENEWAL_FORM_KIND = "membership_renewal" as const;

export const WINDOW_FORM_KINDS = [
  MEMBERSHIP_APPLICATION_FORM_KIND,
  MEMBERSHIP_RENEWAL_FORM_KIND,
] as const;

export type WindowFormKind = (typeof WINDOW_FORM_KINDS)[number];

/**
 * ISO-8601 with a mandatory timezone designator — `Z` or `±HH:MM`.
 *
 * The regex is the guard; `Date.parse` then rejects a shape that matches but is not a
 * real instant (`2026-02-30T00:00:00Z`).
 */
const ABSOLUTE_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const instant = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .regex(
      ABSOLUTE_INSTANT_RE,
      `${label} must include a timezone, e.g. 2026-06-01T09:00:00+08:00 — a local time without one would be read in the server's zone, not yours`,
    )
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: `${label} is not a real date and time`,
    });

/**
 * Open (or re-open, or re-schedule) the membership application period.
 *
 * ⚠ `closes_at > opens_at` DUPLICATES the `window_ordered` CHECK in 0005 on purpose.
 * The CHECK is the enforcement — a direct PostgREST call never passes through this
 * schema — and this copy exists so the officer sees the message under the field they
 * got wrong instead of a generic 23514 mapped to a form-level validation error
 * (CONVENTIONS §6). If the CHECK is ever relaxed, relax this too; if this is ever
 * relaxed alone, the database will still refuse and the officer will be confused.
 */
export const openApplicationWindowSchema = z
  .object({
    form_kind: z.enum(WINDOW_FORM_KINDS),
    opens_at: instant("Opening date and time"),
    closes_at: instant("Closing date and time"),
  })
  .strict()
  .refine((value) => Date.parse(value.closes_at) > Date.parse(value.opens_at), {
    message: "The closing time must be after the opening time",
    path: ["closes_at"],
  });

export type OpenApplicationWindowInput = z.infer<typeof openApplicationWindowSchema>;

/**
 * Close the currently-open period.
 *
 * Takes no timestamp. The closing instant is `now()` on the SERVER'S clock, so a
 * client cannot backdate a closure to retroactively invalidate a submission that was
 * accepted while the window was genuinely open — the audit row would then disagree
 * with the application row it is supposed to explain.
 */
export const closeApplicationWindowSchema = z
  .object({
    form_kind: z.enum(WINDOW_FORM_KINDS),
  })
  .strict();

export type CloseApplicationWindowInput = z.infer<typeof closeApplicationWindowSchema>;

/** What the screen renders per window row. Derived, never stored — see `windowState`. */
export type WindowState = "open" | "scheduled" | "closed";

/**
 * Classify a window row against a moment.
 *
 * Three states, not two, because "scheduled" and "closed" are operationally different
 * and both look like "not open" to an anonymous visitor: `application_windows_read_anon`
 * (0014) is `using (now() between opens_at and closes_at)`, so a window outside its
 * period is invisible to anon either way. The distinction exists for the officer who
 * has to decide whether to wait or to act.
 */
export function windowState(
  row: { opens_at: string; closes_at: string },
  at: number = Date.now(),
): WindowState {
  const opens = Date.parse(row.opens_at);
  const closes = Date.parse(row.closes_at);
  if (at < opens) return "scheduled";
  if (at > closes) return "closed";
  return "open";
}
