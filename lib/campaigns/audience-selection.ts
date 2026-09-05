// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers for the composer's people picker. The selection model lives in
// `audienceFilterSchema` (schema.ts): recipients = (select_all ? matches : ∅) ∪ person_ids
// − excluded_person_ids. These functions only rewrite that object; `resolve_recipients()`
// is what actually applies it, so nothing here is an enforcement.
// ─────────────────────────────────────────────────────────────────────────────

import type { AudienceFilter } from "./schema";

/** Is this candidate (a person the filter axes match) currently in the audience? */
export function isCandidateSelected(audience: AudienceFilter, personId: string): boolean {
  if (audience.excluded_person_ids.includes(personId)) return false;
  if (audience.person_ids.includes(personId)) return true;
  return audience.select_all;
}

/** Tick or untick one candidate. Returns a new audience; never mutates. */
export function toggleCandidate(
  audience: AudienceFilter,
  personId: string,
  on: boolean,
): AudienceFilter {
  const without = (list: readonly string[]) => list.filter((id) => id !== personId);
  if (on) {
    return {
      ...audience,
      excluded_person_ids: without(audience.excluded_person_ids),
      // In select-all mode a matching person is already in; only a hand-pick needs the id.
      person_ids: audience.select_all
        ? without(audience.person_ids)
        : [...without(audience.person_ids), personId],
    };
  }
  return {
    ...audience,
    person_ids: without(audience.person_ids),
    // In select-all mode an untick is an exclusion; otherwise dropping the pick is enough.
    excluded_person_ids: audience.select_all
      ? [...without(audience.excluded_person_ids), personId]
      : without(audience.excluded_person_ids),
  };
}

/** "Everyone matching the filters" on or off. Turning it on forgets the exclusions. */
export function setSelectAll(audience: AudienceFilter, on: boolean): AudienceFilter {
  return on
    ? { ...audience, select_all: true, excluded_person_ids: [] }
    : { ...audience, select_all: false };
}

/** Nobody selected: no select-all, no picks, no exclusions. Filter axes untouched. */
export function clearSelection(audience: AudienceFilter): AudienceFilter {
  return { ...audience, select_all: false, person_ids: [], excluded_person_ids: [] };
}

/** How many people are hand-picked or excluded — for the picker's summary line. */
export function selectionSummary(audience: AudienceFilter): {
  picked: number;
  excluded: number;
} {
  return { picked: audience.person_ids.length, excluded: audience.excluded_person_ids.length };
}
