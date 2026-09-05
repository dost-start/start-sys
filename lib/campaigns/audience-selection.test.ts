import { describe, expect, it } from "vitest";

import {
  clearSelection,
  isCandidateSelected,
  selectionSummary,
  setSelectAll,
  toggleCandidate,
} from "./audience-selection";
import { audienceFilterSchema, type AudienceFilter } from "./schema";

const PERSON_A = "00000000-0000-4000-a000-000000000001";
const PERSON_B = "00000000-0000-4000-a000-000000000002";
const PERSON_C = "00000000-0000-4000-a000-000000000003";

/** The bare default: select_all=true, no picks, no exclusions. */
function baseAudience(overrides: Partial<AudienceFilter> = {}): AudienceFilter {
  return audienceFilterSchema.parse(overrides);
}

describe("isCandidateSelected", () => {
  it("everyone is selected under select_all with no exclusion", () => {
    const audience = baseAudience();
    expect(isCandidateSelected(audience, PERSON_A)).toBe(true);
  });

  it("an excluded person is not selected even under select_all", () => {
    const audience = baseAudience({ excluded_person_ids: [PERSON_A] });
    expect(isCandidateSelected(audience, PERSON_A)).toBe(false);
  });

  it("a hand-picked person is selected even when select_all is false", () => {
    const audience = baseAudience({ select_all: false, person_ids: [PERSON_A] });
    expect(isCandidateSelected(audience, PERSON_A)).toBe(true);
  });

  it("nobody is selected under select_all=false with no picks", () => {
    const audience = baseAudience({ select_all: false });
    expect(isCandidateSelected(audience, PERSON_A)).toBe(false);
  });

  it("exclusion wins over a hand-pick of the same person (should not happen, but is not ambiguous)", () => {
    const audience = baseAudience({
      select_all: false,
      person_ids: [PERSON_A],
      excluded_person_ids: [PERSON_A],
    });
    expect(isCandidateSelected(audience, PERSON_A)).toBe(false);
  });
});

describe("toggleCandidate — select_all mode", () => {
  it("ticking a matching person removes any exclusion and adds no pick", () => {
    const audience = baseAudience({ excluded_person_ids: [PERSON_A, PERSON_B] });
    const next = toggleCandidate(audience, PERSON_A, true);
    expect(next.excluded_person_ids).toEqual([PERSON_B]);
    expect(next.person_ids).toEqual([]);
    expect(next.select_all).toBe(true);
    expect(isCandidateSelected(next, PERSON_A)).toBe(true);
  });

  it("unticking a matching person adds an exclusion and touches no pick", () => {
    const audience = baseAudience();
    const next = toggleCandidate(audience, PERSON_A, false);
    expect(next.excluded_person_ids).toEqual([PERSON_A]);
    expect(next.person_ids).toEqual([]);
    expect(isCandidateSelected(next, PERSON_A)).toBe(false);
  });

  it("unticking twice does not duplicate the exclusion", () => {
    const audience = baseAudience();
    const once = toggleCandidate(audience, PERSON_A, false);
    const twice = toggleCandidate(once, PERSON_A, false);
    expect(twice.excluded_person_ids).toEqual([PERSON_A]);
  });
});

describe("toggleCandidate — picked mode (select_all=false)", () => {
  it("ticking a person adds a pick and touches no exclusion", () => {
    const audience = baseAudience({ select_all: false });
    const next = toggleCandidate(audience, PERSON_A, true);
    expect(next.person_ids).toEqual([PERSON_A]);
    expect(next.excluded_person_ids).toEqual([]);
    expect(isCandidateSelected(next, PERSON_A)).toBe(true);
  });

  it("ticking twice does not duplicate the pick", () => {
    const audience = baseAudience({ select_all: false });
    const once = toggleCandidate(audience, PERSON_A, true);
    const twice = toggleCandidate(once, PERSON_A, true);
    expect(twice.person_ids).toEqual([PERSON_A]);
  });

  it("unticking a picked person drops the pick and adds no exclusion", () => {
    const audience = baseAudience({ select_all: false, person_ids: [PERSON_A, PERSON_B] });
    const next = toggleCandidate(audience, PERSON_A, false);
    expect(next.person_ids).toEqual([PERSON_B]);
    expect(next.excluded_person_ids).toEqual([]);
    expect(isCandidateSelected(next, PERSON_A)).toBe(false);
  });
});

describe("toggleCandidate — never mutates its input", () => {
  it("the original audience object is unchanged after any toggle", () => {
    const audience = baseAudience({ excluded_person_ids: [PERSON_A] });
    const frozenLists = {
      person_ids: [...audience.person_ids],
      excluded_person_ids: [...audience.excluded_person_ids],
    };
    toggleCandidate(audience, PERSON_A, true);
    toggleCandidate(audience, PERSON_B, false);
    expect(audience.person_ids).toEqual(frozenLists.person_ids);
    expect(audience.excluded_person_ids).toEqual(frozenLists.excluded_person_ids);
  });
});

describe("setSelectAll", () => {
  it("turning it on forgets every exclusion", () => {
    const audience = baseAudience({
      select_all: false,
      excluded_person_ids: [PERSON_A, PERSON_B],
    });
    const next = setSelectAll(audience, true);
    expect(next.select_all).toBe(true);
    expect(next.excluded_person_ids).toEqual([]);
  });

  it("turning it on leaves hand-picks alone (they are already implied, but harmless)", () => {
    const audience = baseAudience({ select_all: false, person_ids: [PERSON_A] });
    const next = setSelectAll(audience, true);
    expect(next.person_ids).toEqual([PERSON_A]);
  });

  it("turning it off keeps existing picks and exclusions untouched", () => {
    const audience = baseAudience({ person_ids: [PERSON_A], excluded_person_ids: [PERSON_B] });
    const next = setSelectAll(audience, false);
    expect(next.select_all).toBe(false);
    expect(next.person_ids).toEqual([PERSON_A]);
    expect(next.excluded_person_ids).toEqual([PERSON_B]);
  });

  it("does not mutate its input", () => {
    const audience = baseAudience({ select_all: false, excluded_person_ids: [PERSON_A] });
    setSelectAll(audience, true);
    expect(audience.select_all).toBe(false);
    expect(audience.excluded_person_ids).toEqual([PERSON_A]);
  });
});

describe("clearSelection", () => {
  it("empties select_all, picks and exclusions", () => {
    const audience = baseAudience({
      person_ids: [PERSON_A],
      excluded_person_ids: [PERSON_B, PERSON_C],
    });
    const next = clearSelection(audience);
    expect(next.select_all).toBe(false);
    expect(next.person_ids).toEqual([]);
    expect(next.excluded_person_ids).toEqual([]);
    expect(isCandidateSelected(next, PERSON_A)).toBe(false);
  });

  it("leaves the filter axes untouched", () => {
    const audience = baseAudience({
      region_ids: [PERSON_A],
      statuses: ["active", "graduated"],
    });
    const next = clearSelection(audience);
    expect(next.region_ids).toEqual([PERSON_A]);
    expect(next.statuses).toEqual(["active", "graduated"]);
  });

  it("does not mutate its input", () => {
    const audience = baseAudience({ person_ids: [PERSON_A] });
    clearSelection(audience);
    expect(audience.person_ids).toEqual([PERSON_A]);
  });
});

describe("selectionSummary", () => {
  it("counts picks and exclusions independently of select_all", () => {
    const audience = baseAudience({
      person_ids: [PERSON_A, PERSON_B],
      excluded_person_ids: [PERSON_C],
    });
    expect(selectionSummary(audience)).toEqual({ picked: 2, excluded: 1 });
  });

  it("is zero and zero for the bare default", () => {
    expect(selectionSummary(baseAudience())).toEqual({ picked: 0, excluded: 0 });
  });
});
