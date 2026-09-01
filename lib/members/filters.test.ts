// ─────────────────────────────────────────────────────────────────────────────
// BUILD_PLAN S5-T14's acceptance, asserted.
//
// The load-bearing assertions here are the FIRST two:
//
//   · every one of the six PRD filter dimensions is asserted INDIVIDUALLY, so a
//     dimension quietly dropped in a refactor fails on Day 5 instead of at the Day-7
//     rehearsal when someone asks to filter by department (PRD §3 v1.0 item 12, US-I3);
//
//   · `parse(serialize(f)) === f` over a table of combinations covering every dimension
//     at least once and at least two multi-valued — which is what "a filtered view is
//     shareable as a link" actually means (PRD US-I3). If a round trip loses a facet,
//     the link a CCDO pastes into a group chat shows a different set of scholars than
//     the one they were looking at.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import { Constants } from "@/database.types";
import {
  changeMemberFilters,
  DEFAULT_MEMBER_FILTERS,
  DEFAULT_MEMBER_SORT,
  DEFAULT_MEMBERS_PER_PAGE,
  hasActiveMemberFilters,
  MAX_MEMBERS_PER_PAGE,
  MEMBER_SORTS,
  MEMBERS_PATH,
  MEMBERSHIP_STATUSES,
  membersHref,
  memberFiltersSchema,
  parseMemberFilters,
  parseMemberSort,
  serializeMemberFilters,
  type MemberFilters,
} from "@/lib/members/filters";

// Fixed uuids so a failure names a value rather than a random one.
const REGION_A = "11111111-1111-4111-8111-111111111111";
const REGION_B = "22222222-2222-4222-8222-222222222222";
const COMMITTEE_A = "33333333-3333-4333-8333-333333333333";
const COMMITTEE_B = "44444444-4444-4444-8444-444444444444";
const DEPARTMENT_A = "55555555-5555-4555-8555-555555555555";
const DEPARTMENT_B = "66666666-6666-4666-8666-666666666666";
const TERM = "77777777-7777-4777-8777-777777777777";

const qs = (search: string): URLSearchParams => new URLSearchParams(search);

// ═════════════════════════════════════════════════════════════════════════════
// 1 — the route prefix
// ═════════════════════════════════════════════════════════════════════════════

describe("MEMBERS_PATH", () => {
  it("is /members — route groups are URL-invisible, so app/(admin)/members serves /members", () => {
    expect(MEMBERS_PATH).toBe("/members");
  });

  it("is what membersHref builds on, so nothing else has to spell the prefix", () => {
    expect(membersHref(DEFAULT_MEMBER_FILTERS)).toBe("/members");
    expect(membersHref({ ...DEFAULT_MEMBER_FILTERS, status: ["active"] })).toBe(
      "/members?status=active",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — all six PRD filter dimensions, ASSERTED ONE AT A TIME
//
// A single combined assertion would still pass if a dimension were dropped and its
// neighbour happened to absorb the value. These are separate `it` blocks so the
// failure message names the missing dimension.
// ═════════════════════════════════════════════════════════════════════════════

describe("the six PRD filter dimensions plus search (item 12 / US-I2 / US-I3)", () => {
  it("q — name and member-ID search (US-I2)", () => {
    expect(parseMemberFilters(qs("q=santos")).q).toBe("santos");
    expect(parseMemberFilters(qs("q=2024-001")).q).toBe("2024-001");
  });

  it("status — multi-valued", () => {
    expect(parseMemberFilters(qs("status=active&status=graduated")).status).toEqual([
      "active",
      "graduated",
    ]);
  });

  it("region_id — multi-valued", () => {
    expect(parseMemberFilters(qs(`region_id=${REGION_A}&region_id=${REGION_B}`)).region_id).toEqual(
      [REGION_A, REGION_B],
    );
  });

  it("term_id — single-valued", () => {
    expect(parseMemberFilters(qs(`term_id=${TERM}`)).term_id).toBe(TERM);
  });

  it("committee_id — multi-valued", () => {
    expect(
      parseMemberFilters(qs(`committee_id=${COMMITTEE_A}&committee_id=${COMMITTEE_B}`))
        .committee_id,
    ).toEqual([COMMITTEE_A, COMMITTEE_B]);
  });

  it("department_id — multi-valued", () => {
    expect(
      parseMemberFilters(qs(`department_id=${DEPARTMENT_A}&department_id=${DEPARTMENT_B}`))
        .department_id,
    ).toEqual([DEPARTMENT_A, DEPARTMENT_B]);
  });

  it("page, per_page and sort round out the shape", () => {
    const parsed = parseMemberFilters(qs("page=3&per_page=50&sort=join_year.desc"));
    expect(parsed.page).toBe(3);
    expect(parsed.per_page).toBe(50);
    expect(parsed.sort).toBe("join_year.desc");
  });

  it("the schema's key set is exactly the nine contracted keys, so a tenth is deliberate", () => {
    expect(Object.keys(memberFiltersSchema.shape).sort()).toEqual([
      "committee_id",
      "department_id",
      "page",
      "per_page",
      "q",
      "region_id",
      "sort",
      "status",
      "term_id",
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — parse(serialize(f)) === f, over >= 10 combinations
// ═════════════════════════════════════════════════════════════════════════════

describe("parse(serialize(f)) === f", () => {
  const base = DEFAULT_MEMBER_FILTERS;

  const cases: Array<{ name: string; filters: MemberFilters }> = [
    { name: "the empty default set", filters: { ...base } },
    { name: "search only", filters: { ...base, q: "dela cruz" } },
    { name: "one status", filters: { ...base, status: ["active"] } },
    {
      name: "two statuses (multi-valued #1)",
      filters: { ...base, status: ["active", "graduated"] },
    },
    {
      name: "two regions (multi-valued #2)",
      filters: { ...base, region_id: [REGION_A, REGION_B] },
    },
    { name: "a term", filters: { ...base, term_id: TERM } },
    { name: "two committees", filters: { ...base, committee_id: [COMMITTEE_A, COMMITTEE_B] } },
    { name: "one department", filters: { ...base, department_id: [DEPARTMENT_A] } },
    { name: "a non-default sort", filters: { ...base, sort: "member_id.desc" } },
    { name: "page and per_page", filters: { ...base, page: 4, per_page: 50 } },
    {
      name: "every dimension at once",
      filters: {
        q: "santos",
        status: ["active", "renewal_pending"],
        region_id: [REGION_A, REGION_B],
        term_id: TERM,
        committee_id: [COMMITTEE_A],
        department_id: [DEPARTMENT_A, DEPARTMENT_B],
        page: 2,
        per_page: 10,
        sort: "join_year.asc",
      },
    },
    {
      name: "the maximum page size",
      filters: { ...base, per_page: MAX_MEMBERS_PER_PAGE, status: ["terminated"] },
    },
  ];

  for (const { name, filters } of cases) {
    it(`round-trips: ${name}`, () => {
      const parsed = parseMemberFilters(qs(serializeMemberFilters(filters)));
      // `status` etc. are sorted by parse; the fixtures above are written in sorted
      // order so the comparison is exact rather than order-insensitive.
      expect(parsed).toEqual({
        ...filters,
        status: [...filters.status].sort(),
        region_id: [...filters.region_id].sort(),
        committee_id: [...filters.committee_id].sort(),
        department_id: [...filters.department_id].sort(),
      });
    });
  }

  it("covers at least ten combinations, including two multi-valued", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(
      cases.filter((c) => c.filters.status.length > 1 || c.filters.region_id.length > 1).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — unknown params dropped
// ═════════════════════════════════════════════════════════════════════════════

describe("unknown params", () => {
  it("are dropped from the parsed shape", () => {
    const parsed = parseMemberFilters(
      qs("status=active&utm_source=discord&debug=1&region=Luzon&order=name"),
    );
    expect(parsed).toEqual({ ...DEFAULT_MEMBER_FILTERS, status: ["active"] });
  });

  it("do not survive a round trip", () => {
    const serialized = serializeMemberFilters(parseMemberFilters(qs("q=x&utm_campaign=y")));
    expect(serialized).toBe("q=x");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — malformed values fall back to defaults, and NOTHING throws
// ═════════════════════════════════════════════════════════════════════════════

describe("malformed input degrades instead of throwing", () => {
  it("?status=nonsense falls back to no status filter rather than a 500", () => {
    expect(() => parseMemberFilters(qs("status=nonsense"))).not.toThrow();
    expect(parseMemberFilters(qs("status=nonsense")).status).toEqual([]);
  });

  it("drops only the invalid half of a facet, keeping the valid entries", () => {
    // Discarding `active` because `nonsense` was alongside it would silently WIDEN the
    // result set — the wrong direction to fail on a screen full of member records.
    expect(parseMemberFilters(qs("status=active&status=nonsense")).status).toEqual(["active"]);
    expect(parseMemberFilters(qs(`region_id=${REGION_A}&region_id=not-a-uuid`)).region_id).toEqual([
      REGION_A,
    ]);
  });

  it("falls back for every malformed scalar", () => {
    const parsed = parseMemberFilters(
      qs("page=abc&per_page=9999&sort=birthdate.desc&term_id=not-a-uuid&q="),
    );
    expect(parsed.page).toBe(1);
    expect(parsed.per_page).toBe(DEFAULT_MEMBERS_PER_PAGE);
    expect(parsed.sort).toBe(DEFAULT_MEMBER_SORT);
    expect(parsed.term_id).toBeNull();
    expect(parsed.q).toBeNull();
  });

  it("never throws on anything a URL can carry", () => {
    const hostile = [
      "",
      "page=-1",
      "page=0",
      "page=1e99",
      "per_page=0",
      "per_page=-5",
      "q=" + "x".repeat(5000),
      "status=&region_id=&committee_id=",
      "sort=",
      "term_id=%00",
    ];
    for (const search of hostile) {
      expect(() => parseMemberFilters(qs(search))).not.toThrow();
    }
    expect(() => parseMemberFilters(null)).not.toThrow();
    expect(() => parseMemberFilters(undefined)).not.toThrow();
    expect(parseMemberFilters(undefined)).toEqual(DEFAULT_MEMBER_FILTERS);
  });

  it("accepts Next's Record shape as well as URLSearchParams", () => {
    const parsed = parseMemberFilters({
      status: ["active", "left"],
      q: "cruz",
      page: "2",
      stray: "ignored",
    });
    expect(parsed.status).toEqual(["active", "left"]);
    expect(parsed.q).toBe("cruz");
    expect(parsed.page).toBe(2);
  });

  it("an over-long search string falls back rather than reaching a database predicate", () => {
    expect(parseMemberFilters(qs(`q=${"a".repeat(500)}`)).q).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 — canonical serialization
// ═════════════════════════════════════════════════════════════════════════════

describe("serialization is canonical", () => {
  it("omits every default, so Clear all lands on the bare path", () => {
    expect(serializeMemberFilters(DEFAULT_MEMBER_FILTERS)).toBe("");
    expect(membersHref(DEFAULT_MEMBER_FILTERS)).toBe(MEMBERS_PATH);
  });

  it("emits keys in one fixed order regardless of object key order", () => {
    const a: MemberFilters = {
      ...DEFAULT_MEMBER_FILTERS,
      sort: "member_id.desc",
      q: "z",
      status: ["active"],
      page: 3,
    };
    expect(serializeMemberFilters(a)).toBe("page=3&q=z&sort=member_id.desc&status=active");
  });

  it("sorts and dedupes facets, so tick order does not change the link", () => {
    const one = serializeMemberFilters({
      ...DEFAULT_MEMBER_FILTERS,
      region_id: [REGION_B, REGION_A],
    });
    const other = serializeMemberFilters({
      ...DEFAULT_MEMBER_FILTERS,
      region_id: [REGION_A, REGION_B],
    });
    expect(one).toBe(other);

    expect(parseMemberFilters(qs(`region_id=${REGION_A}&region_id=${REGION_A}`)).region_id).toEqual(
      [REGION_A],
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 — page resets on a filter change
// ═════════════════════════════════════════════════════════════════════════════

describe("changeMemberFilters", () => {
  const onPageSeven: MemberFilters = { ...DEFAULT_MEMBER_FILTERS, page: 7, status: ["active"] };

  it("resets to page 1 when a filter dimension changes", () => {
    // Narrowing a 12-page list to two pages while on page 7 renders an empty grid over
    // a filter that matches 40 people, which reads as "the filter is broken".
    expect(changeMemberFilters(onPageSeven, { status: ["graduated"] }).page).toBe(1);
    expect(changeMemberFilters(onPageSeven, { q: "cruz" }).page).toBe(1);
    expect(changeMemberFilters(onPageSeven, { region_id: [REGION_A] }).page).toBe(1);
    expect(changeMemberFilters(onPageSeven, { term_id: TERM }).page).toBe(1);
    expect(changeMemberFilters(onPageSeven, { committee_id: [COMMITTEE_A] }).page).toBe(1);
    expect(changeMemberFilters(onPageSeven, { department_id: [DEPARTMENT_A] }).page).toBe(1);
  });

  it("resets on per_page, which redefines what page 7 means", () => {
    expect(changeMemberFilters(onPageSeven, { per_page: 50 }).page).toBe(1);
  });

  it("does NOT reset on a sort change — the same rows, in a different order", () => {
    expect(changeMemberFilters(onPageSeven, { sort: "member_id.desc" }).page).toBe(7);
  });

  it("passes an explicit page change through, or pagination could never leave page 1", () => {
    expect(changeMemberFilters(onPageSeven, { page: 8 }).page).toBe(8);
    expect(changeMemberFilters(onPageSeven, { status: ["left"], page: 3 }).page).toBe(3);
  });

  it("leaves everything it was not asked to change alone", () => {
    const next = changeMemberFilters(onPageSeven, { q: "santos" });
    expect(next.status).toEqual(["active"]);
    expect(next.sort).toBe(onPageSeven.sort);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8 — vocabulary is generated, not hand-typed
// ═════════════════════════════════════════════════════════════════════════════

describe("vocabulary", () => {
  it("MEMBERSHIP_STATUSES comes from the generated enum, so a new status is offered free", () => {
    expect(MEMBERSHIP_STATUSES).toEqual(Constants.public.Enums.membership_status);
    expect(MEMBERSHIP_STATUSES).toContain("terminated");
  });

  it("every sort token names a column search_member_directory actually returns", () => {
    const returned = [
      "membership_id",
      "person_id",
      "member_id",
      "given_name",
      "family_name",
      "join_year",
      "term_id",
      "status",
      "year_level",
      "region_name",
      "island_group",
    ];
    for (const sort of MEMBER_SORTS) {
      expect(returned).toContain(parseMemberSort(sort).column);
    }
  });

  it("parseMemberSort reads the direction", () => {
    expect(parseMemberSort("family_name.asc")).toEqual({ column: "family_name", ascending: true });
    expect(parseMemberSort("join_year.desc")).toEqual({ column: "join_year", ascending: false });
  });

  it("no sort token names a sensitive column", () => {
    const sensitive = [
      "birthdate",
      "contact_number",
      "address_line",
      "school_id_no",
      "personal_email",
    ];
    for (const sort of MEMBER_SORTS) {
      expect(sensitive).not.toContain(parseMemberSort(sort).column);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9 — the empty-state discriminator
// ═════════════════════════════════════════════════════════════════════════════

describe("hasActiveMemberFilters", () => {
  it("is false for the default set, so the page can say 'no members yet'", () => {
    expect(hasActiveMemberFilters(DEFAULT_MEMBER_FILTERS)).toBe(false);
  });

  it("ignores page, per_page and sort — those do not narrow anything", () => {
    expect(
      hasActiveMemberFilters({
        ...DEFAULT_MEMBER_FILTERS,
        page: 4,
        per_page: 50,
        sort: "member_id.desc",
      }),
    ).toBe(false);
  });

  it("is true for any real filter dimension", () => {
    expect(hasActiveMemberFilters({ ...DEFAULT_MEMBER_FILTERS, q: "x" })).toBe(true);
    expect(hasActiveMemberFilters({ ...DEFAULT_MEMBER_FILTERS, status: ["left"] })).toBe(true);
    expect(hasActiveMemberFilters({ ...DEFAULT_MEMBER_FILTERS, term_id: TERM })).toBe(true);
    expect(hasActiveMemberFilters({ ...DEFAULT_MEMBER_FILTERS, region_id: [REGION_A] })).toBe(true);
    expect(hasActiveMemberFilters({ ...DEFAULT_MEMBER_FILTERS, committee_id: [COMMITTEE_A] })).toBe(
      true,
    );
    expect(
      hasActiveMemberFilters({ ...DEFAULT_MEMBER_FILTERS, department_id: [DEPARTMENT_A] }),
    ).toBe(true);
  });
});
