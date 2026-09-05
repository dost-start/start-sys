import { describe, expect, it } from "vitest";

import {
  audienceCandidatesQuerySchema,
  audienceFilterSchema,
  AUDIENCE_PAGE_SIZE,
  campaignIdSchema,
  YEAR_LEVELS,
} from "./schema";

/** N distinct, well-formed UUIDs — enough to exceed the 1000-entry person_ids cap. */
function uuids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const suffix = (i + 1).toString().padStart(12, "0");
    return `00000000-0000-4000-8000-${suffix}`;
  });
}

describe("audienceFilterSchema — the empty/default shape", () => {
  it("parse({}) defaults select_all to true and every list to empty, except statuses", () => {
    const parsed = audienceFilterSchema.parse({});
    expect(parsed.select_all).toBe(true);
    expect(parsed.statuses).toEqual(["active"]);
    expect(parsed.join_years).toEqual([]);
    expect(parsed.region_ids).toEqual([]);
    expect(parsed.island_groups).toEqual([]);
    expect(parsed.affiliation_ids).toEqual([]);
    expect(parsed.role_codes).toEqual([]);
    expect(parsed.department_ids).toEqual([]);
    expect(parsed.committee_ids).toEqual([]);
    expect(parsed.university_ids).toEqual([]);
    expect(parsed.year_levels).toEqual([]);
    expect(parsed.person_ids).toEqual([]);
    expect(parsed.excluded_person_ids).toEqual([]);
  });

  it("an absent key means select_all=true and empty lists — the pre-0047 campaign case", () => {
    // A campaign written before the audience picker shipped stored a filter with none of
    // the new keys at all. Re-parsing that stored jsonb must not throw and must yield
    // exactly the "everyone the old axes matched" reading (schema.ts contract note).
    const legacy = { region_ids: ["00000000-0000-4000-8000-000000000001"] };
    const parsed = audienceFilterSchema.parse(legacy);
    expect(parsed.select_all).toBe(true);
    expect(parsed.person_ids).toEqual([]);
    expect(parsed.excluded_person_ids).toEqual([]);
    expect(parsed.department_ids).toEqual([]);
  });
});

describe("audienceFilterSchema — person_ids cap", () => {
  it("accepts exactly 1000 person_ids", () => {
    const parsed = audienceFilterSchema.parse({ person_ids: uuids(1000) });
    expect(parsed.person_ids).toHaveLength(1000);
  });

  it("refuses 1001 person_ids", () => {
    const result = audienceFilterSchema.safeParse({ person_ids: uuids(1001) });
    expect(result.success).toBe(false);
  });

  it("refuses 1001 excluded_person_ids the same way", () => {
    const result = audienceFilterSchema.safeParse({ excluded_person_ids: uuids(1001) });
    expect(result.success).toBe(false);
  });
});

describe("audienceFilterSchema — year_levels bounds", () => {
  it("accepts every level 1 through 5", () => {
    const parsed = audienceFilterSchema.parse({ year_levels: [...YEAR_LEVELS] });
    expect(parsed.year_levels).toEqual([1, 2, 3, 4, 5]);
  });

  it("refuses 0", () => {
    const result = audienceFilterSchema.safeParse({ year_levels: [0] });
    expect(result.success).toBe(false);
  });

  it("refuses 6", () => {
    const result = audienceFilterSchema.safeParse({ year_levels: [6] });
    expect(result.success).toBe(false);
  });
});

describe("audienceFilterSchema — strictness and the new axes", () => {
  it("refuses an unknown top-level key", () => {
    const result = audienceFilterSchema.safeParse({ not_a_real_axis: true });
    expect(result.success).toBe(false);
  });

  it("accepts the four new axes together", () => {
    const [department, committee, university] = uuids(3);
    const parsed = audienceFilterSchema.parse({
      department_ids: [department],
      committee_ids: [committee],
      university_ids: [university],
      year_levels: [2, 3],
    });
    expect(parsed.department_ids).toEqual([department]);
    expect(parsed.committee_ids).toEqual([committee]);
    expect(parsed.university_ids).toEqual([university]);
    expect(parsed.year_levels).toEqual([2, 3]);
  });
});

describe("audienceCandidatesQuerySchema", () => {
  it("defaults q to '' and page to 1", () => {
    const parsed = audienceCandidatesQuerySchema.parse({ audience: {} });
    expect(parsed.q).toBe("");
    expect(parsed.page).toBe(1);
    expect(parsed.audience.select_all).toBe(true);
  });

  it("trims q", () => {
    const parsed = audienceCandidatesQuerySchema.parse({ audience: {}, q: "  Peña  " });
    expect(parsed.q).toBe("Peña");
  });

  it("refuses page 0", () => {
    const result = audienceCandidatesQuerySchema.safeParse({ audience: {}, page: 0 });
    expect(result.success).toBe(false);
  });

  it("refuses a negative page", () => {
    const result = audienceCandidatesQuerySchema.safeParse({ audience: {}, page: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts an 80-character q", () => {
    const result = audienceCandidatesQuerySchema.safeParse({ audience: {}, q: "a".repeat(80) });
    expect(result.success).toBe(true);
  });

  it("refuses an 81-character q", () => {
    const result = audienceCandidatesQuerySchema.safeParse({ audience: {}, q: "a".repeat(81) });
    expect(result.success).toBe(false);
  });

  it("refuses an unknown top-level key", () => {
    const result = audienceCandidatesQuerySchema.safeParse({ audience: {}, extra: true });
    expect(result.success).toBe(false);
  });
});

describe("constants the composer and the database contract both depend on", () => {
  it("AUDIENCE_PAGE_SIZE is 50", () => {
    expect(AUDIENCE_PAGE_SIZE).toBe(50);
  });

  it("YEAR_LEVELS is exactly 1 through 5", () => {
    expect(YEAR_LEVELS).toEqual([1, 2, 3, 4, 5]);
  });
});

// Not new behaviour, but campaignIdSchema is a one-line neighbour in the same file and
// otherwise has no coverage anywhere in the repo.
describe("campaignIdSchema", () => {
  it("accepts a well-formed uuid", () => {
    const result = campaignIdSchema.safeParse({ id: uuids(1)[0] });
    expect(result.success).toBe(true);
  });

  it("refuses a non-uuid id", () => {
    const result = campaignIdSchema.safeParse({ id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});
