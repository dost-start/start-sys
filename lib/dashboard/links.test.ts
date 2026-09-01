// Dashboard tile links (BUILD_PLAN S6-T7).
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE LOAD-BEARING TEST IS THE ROUND TRIP
// ═══════════════════════════════════════════════════════════════════════════════
// Every href this module can produce is fed back through `parseMemberFilters` — S5's own
// parser, not a re-implementation — and the resulting filters are asserted. That is what
// catches a param name the list page does not read: `parseMemberFilters` DROPS unknown
// params, so a `?committee=` where the contract says `?committee_id=` would produce an
// unfiltered grid under a heading claiming a filter. It fails here instead.
//
// The round trip is asserted for BOTH audiences and for every builder, because the
// officer base differs from the admin base in one respect (`term_id` is not carried) and
// that difference is exactly the kind of thing a refactor flattens.
import { describe, expect, it } from "vitest";

import {
  allMembersHref,
  APPLICATIONS_PATH,
  committeeTileHref,
  dashboardBase,
  OFFICER_DIRECTORY_PATH,
  pendingApplicationsHref,
  regionTileHref,
  statusTileHref,
  type DashboardAudience,
} from "@/lib/dashboard/links";
import {
  DEFAULT_MEMBER_FILTERS,
  MEMBERS_PATH,
  MEMBERSHIP_STATUSES,
  parseMemberFilters,
  type MemberFilters,
} from "@/lib/members/filters";

const TERM = "11111111-1111-4111-8111-111111111111";
const REGION = "22222222-2222-4222-8222-222222222222";
const COMMITTEE = "44444444-4444-4444-8444-444444444444";

const AUDIENCES: DashboardAudience[] = ["admin", "officer"];

/** Split an href into its path and the filters S5's parser reads back out of it. */
function roundTrip(href: string): { path: string; filters: MemberFilters } {
  const [path, query = ""] = href.split("?");
  return {
    path: path ?? "",
    filters: parseMemberFilters(new URLSearchParams(query)),
  };
}

describe("dashboardBase", () => {
  it("points admin tiles at /members and officer tiles at /directory", () => {
    // An officer tile linking into /members would be bounced home by `canAccess`, which
    // reads as a broken session rather than a broken link.
    expect(dashboardBase("admin").path).toBe(MEMBERS_PATH);
    expect(dashboardBase("officer").path).toBe(OFFICER_DIRECTORY_PATH);
  });

  it("carries a term for admin only", () => {
    // PRD US-H3: officers do not gain access to prior terms by editing a URL. The
    // officer directory ignores `term_id`, so emitting one would promise what the page
    // does not do — and 0030 would force the current term regardless.
    expect(dashboardBase("admin").carriesTerm).toBe(true);
    expect(dashboardBase("officer").carriesTerm).toBe(false);
  });
});

describe("allMembersHref", () => {
  it.each(AUDIENCES)("round-trips to the unfiltered view (%s)", (audience) => {
    const { path, filters } = roundTrip(allMembersHref(audience, TERM));
    expect(path).toBe(dashboardBase(audience).path);
    expect(filters.status).toEqual([]);
    expect(filters.region_id).toEqual([]);
    expect(filters.committee_id).toEqual([]);
  });

  it("carries the term on the admin base and omits it on the officer base", () => {
    expect(roundTrip(allMembersHref("admin", TERM)).filters.term_id).toBe(TERM);
    expect(roundTrip(allMembersHref("officer", TERM)).filters.term_id).toBeNull();
  });

  it("serializes to a bare path when there is no term at all", () => {
    // The canonical empty view: `Clear all` and a no-active-term dashboard agree.
    expect(allMembersHref("officer", null)).toBe(OFFICER_DIRECTORY_PATH);
  });
});

describe("statusTileHref", () => {
  it.each(AUDIENCES)("round-trips every generated status (%s)", (audience) => {
    // Driven off the GENERATED enum, so a status added by amendment is covered the
    // moment types are regenerated — no test edit required.
    for (const status of MEMBERSHIP_STATUSES) {
      const { path, filters } = roundTrip(statusTileHref(audience, TERM, status));
      expect(path).toBe(dashboardBase(audience).path);
      expect(filters.status).toEqual([status]);
      expect(filters.region_id).toEqual([]);
      expect(filters.committee_id).toEqual([]);
    }
  });

  it("uses the `status` param name the list page actually reads", () => {
    expect(statusTileHref("admin", null, "active")).toContain("status=active");
  });

  it("describes ONE filter, never the current view plus one", () => {
    // Clicking Active from a page already filtered to a region must land on Active across
    // all regions — which is the number the tile showed.
    const { filters } = roundTrip(statusTileHref("admin", TERM, "active"));
    expect(filters.region_id).toEqual([]);
    expect(filters.q).toBeNull();
    expect(filters.page).toBe(DEFAULT_MEMBER_FILTERS.page);
  });
});

describe("regionTileHref", () => {
  it.each(AUDIENCES)("round-trips a region uuid (%s)", (audience) => {
    const { path, filters } = roundTrip(regionTileHref(audience, TERM, REGION));
    expect(path).toBe(dashboardBase(audience).path);
    expect(filters.region_id).toEqual([REGION]);
    expect(filters.status).toEqual([]);
  });

  it("uses `region_id`, not `region` — a name the parser would drop", () => {
    expect(regionTileHref("admin", null, REGION)).toContain(`region_id=${REGION}`);
  });
});

describe("committeeTileHref", () => {
  it.each(AUDIENCES)("round-trips a committee uuid (%s)", (audience) => {
    const href = committeeTileHref(audience, TERM, COMMITTEE);
    expect(href).not.toBeNull();
    const { path, filters } = roundTrip(href as string);
    expect(path).toBe(dashboardBase(audience).path);
    expect(filters.committee_id).toEqual([COMMITTEE]);
  });

  it("returns null for the unassigned bucket rather than a link that lies", () => {
    // "No committee" is a NEGATIVE predicate and S5's contract has no encoding for it.
    // Every sentinel is either dropped by the parser (producing an UNFILTERED list under
    // a heading claiming otherwise) or matches nothing. The bar renders as a plain
    // figure — see the decision note in links.ts.
    expect(committeeTileHref("admin", TERM, null)).toBeNull();
    expect(committeeTileHref("officer", TERM, null)).toBeNull();
  });
});

describe("pendingApplicationsHref", () => {
  it("targets the application queue, not the member contract", () => {
    const href = pendingApplicationsHref();
    expect(href.startsWith(`${APPLICATIONS_PATH}?`)).toBe(true);
    expect(new URLSearchParams(href.split("?")[1]).get("status")).toBe("pending");
  });
});

describe("no href smuggles a param the member contract does not read", () => {
  it("emits only contract keys across every builder", () => {
    const CONTRACT_KEYS = new Set([
      "q",
      "status",
      "region_id",
      "term_id",
      "committee_id",
      "department_id",
      "page",
      "per_page",
      "sort",
    ]);

    const hrefs: string[] = [];
    for (const audience of AUDIENCES) {
      hrefs.push(allMembersHref(audience, TERM));
      hrefs.push(regionTileHref(audience, TERM, REGION));
      hrefs.push(committeeTileHref(audience, TERM, COMMITTEE) as string);
      for (const status of MEMBERSHIP_STATUSES) {
        hrefs.push(statusTileHref(audience, TERM, status));
      }
    }

    for (const href of hrefs) {
      const query = href.split("?")[1] ?? "";
      for (const key of new URLSearchParams(query).keys()) {
        expect(CONTRACT_KEYS.has(key)).toBe(true);
      }
    }
  });
});
