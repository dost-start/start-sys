// ─────────────────────────────────────────────────────────────────────────────
// The DOST "Year of Award" window offered by the public application form.
//
// FINDING A6 (reviewer PDF 2026-09-09 p1, refined by Ethan the same day): the form
// offered 2016–2026 because it counted ten years back from `new Date()`. What the org
// actually wants is a ROLLING FIVE-YEAR WINDOW that turns over on 1 JULY, not 1
// January — 1 July is when a new application period opens, so a window that turned
// over in January would offer a year nobody could yet hold an award for, and would
// drop the oldest eligible cohort halfway through their own application season.
//
//   on 2026-09-09  → 2022 … 2026   (2022 is the oldest, as Ethan specified)
//   on 2027-06-30  → 2022 … 2026   (still the old window; the period has not turned)
//   on 2027-07-01  → 2023 … 2027
//
// It turns over BY ITSELF. Nobody edits a constant next July, which is the whole
// point — the person who would have had to remember will have graduated.
//
// Computed in Asia/Manila, not UTC: the org is in Manila, and UTC would hold the old
// window for the first eight hours of 1 July local time (CONVENTIONS.md §3.3 — stored
// UTC, reasoned about local).
// ─────────────────────────────────────────────────────────────────────────────

const MANILA_TIME_ZONE = "Asia/Manila";

/** How many years the window offers, inclusive of both ends. */
export const AWARD_WINDOW_YEARS = 5;

/** The month the window rolls forward in. 7 = July. */
export const AWARD_WINDOW_TURNOVER_MONTH = 7;

/**
 * `now` as a calendar year and month in Asia/Manila.
 *
 * `en-CA` is used only because it formats as `YYYY-MM-DD`, which slices without any
 * locale ambiguity. It is not a claim about the reader's locale.
 */
function manilaYearMonth(now: Date): { year: number; month: number } {
  const iso = now.toLocaleDateString("en-CA", { timeZone: MANILA_TIME_ZONE });
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

/** The inclusive `[min, max]` award years accepted right now. */
export function awardYearWindow(now: Date = new Date()): { min: number; max: number } {
  const { year, month } = manilaYearMonth(now);
  const max = month >= AWARD_WINDOW_TURNOVER_MONTH ? year : year - 1;
  return { min: max - (AWARD_WINDOW_YEARS - 1), max };
}

/** The window as select options, newest first — a new scholar picks the top entry. */
export function awardYearOptions(now: Date = new Date()): number[] {
  const { min, max } = awardYearWindow(now);
  return Array.from({ length: max - min + 1 }, (_, index) => max - index);
}
