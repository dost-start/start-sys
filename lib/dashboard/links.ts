// ─────────────────────────────────────────────────────────────────────────────
// "Every number links through to the filtered list that produced it" (PRD US-D4),
// as pure functions over S5's URL contract (BUILD_PLAN S6-T7).
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS IS A MODULE AND NOT AN `href={...}` IN A COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
// A tile whose link uses a param name the list page does not read is a tile that
// SILENTLY SHOWS EVERYTHING: `parseMemberFilters` drops unknown params by design, so a
// `?committee=` where the contract says `?committee_id=` produces an unfiltered grid
// under a heading that claims a filter. No error, no crash, and the number above the
// list contradicts the list. links.test.ts feeds EVERY href this module can produce back
// through `parseMemberFilters` and asserts the round trip, so that class of mistake
// fails on Day 5 rather than at the demo.
//
// Every href is built by `membersHref(...)`, which serializes CANONICALLY: keys in a
// fixed order, defaults omitted. Two tiles describing the same view therefore produce
// byte-identical links.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THREE BASE PATHS, AND ONE OF THEM IS DELIBERATELY ABSENT
// ═══════════════════════════════════════════════════════════════════════════════
//   · admin   -> `/members`   (S5's grid). Term-selecting: the admin tiers may pass an
//                explicit `term_id`, so the historical dashboard's tiles carry the term
//                they are describing.
//   · officer -> `/directory` (the read-only directory, S6-T10). Same param names, so
//                one builder serves both; NOT term-selecting, because `/directory` is
//                pinned to the current term and ignores `term_id` entirely — prior-term
//                access for officers is US-H3, a v1.2 item, and must not be reachable by
//                editing a URL.
//   · rr      -> NONE. **Decision, recorded here rather than left as an omission:** the
//                Regional Representative dashboard has no member-list surface to link
//                into. `/region` is one page: header, tiles, roster. A rep's tiles are
//                therefore rendered as plain figures, not anchors, and `dashboardBase`
//                has no `rr` member so writing one is a compile error rather than a link
//                to a route that does not exist. If a scoped rep list ever ships, it
//                gets a base here and the tiles become anchors — one line, one test row.
//
// ⚠ AN OFFICER TILE MUST NOT LINK INTO `/members`. `canAccess` would bounce an officer
// off the admin surface, so a mis-based tile is a link that throws the user home — which
// looks like a broken session, not a broken link. That is why the base is a required
// argument on every builder here and never has a default.
//
// CITATION: BUILD_PLAN S6-T7, S6-T9, S6-T10, S6-T12; PRD US-D4, US-H3, US-I3;
//           CONVENTIONS.md §2 (URL search params only); ADR 0007.
// ─────────────────────────────────────────────────────────────────────────────

import {
  DEFAULT_MEMBER_FILTERS,
  MEMBERS_PATH,
  membersHref,
  type MemberFilters,
  type MembershipStatus,
} from "@/lib/members/filters";

/** The served path of the officer directory. Route groups are URL-invisible. */
export const OFFICER_DIRECTORY_PATH = "/directory";

/** The served path of the officer committee rosters. */
export const OFFICER_COMMITTEES_PATH = "/committees";

/** The served path of the application queue — the pending tile's destination. */
export const APPLICATIONS_PATH = "/applications";

/** The audience a set of tiles belongs to. No `rr` member — see the header. */
export type DashboardAudience = "admin" | "officer";

type BaseSpec = {
  /** Where the list lives for this audience. */
  path: string;
  /**
   * Whether a `term_id` may travel in the link.
   *
   * False for the officer directory: it is pinned to `current_term_id()` and ignores the
   * param, so emitting one would produce a URL that promises something the page does not
   * do — and `search_member_directory()` would force the current term regardless
   * (0030), with RLS refusing the rows beneath that (PRD US-H3).
   */
  carriesTerm: boolean;
};

const BASES: Record<DashboardAudience, BaseSpec> = {
  admin: { path: MEMBERS_PATH, carriesTerm: true },
  officer: { path: OFFICER_DIRECTORY_PATH, carriesTerm: false },
};

/** The base spec for an audience. Total over `DashboardAudience`. */
export function dashboardBase(audience: DashboardAudience): BaseSpec {
  return BASES[audience];
}

/**
 * Start from the canonical empty filter set and apply the term, if this audience may
 * carry one.
 *
 * Starting from `DEFAULT_MEMBER_FILTERS` rather than from a caller-supplied object is
 * what makes these links reproducible: a tile always describes ONE filter, never "the
 * current view plus one filter", so clicking Active from a page already filtered to
 * Region 4 lands on Active across all regions — which is the number the tile showed.
 */
function baseFilters(audience: DashboardAudience, termId: string | null): MemberFilters {
  const { carriesTerm } = BASES[audience];
  return {
    ...DEFAULT_MEMBER_FILTERS,
    term_id: carriesTerm ? termId : null,
  };
}

/** The whole term's member list — what a total headcount figure links to. */
export function allMembersHref(audience: DashboardAudience, termId: string | null): string {
  return membersHref(baseFilters(audience, termId), BASES[audience].path);
}

/** One status tile: `…?status=active` (plus `term_id` for the admin base). */
export function statusTileHref(
  audience: DashboardAudience,
  termId: string | null,
  status: MembershipStatus,
): string {
  return membersHref({ ...baseFilters(audience, termId), status: [status] }, BASES[audience].path);
}

/** One region bar: `…?region_id=<uuid>`. */
export function regionTileHref(
  audience: DashboardAudience,
  termId: string | null,
  regionId: string,
): string {
  return membersHref(
    { ...baseFilters(audience, termId), region_id: [regionId] },
    BASES[audience].path,
  );
}

/**
 * One committee bar: `…?committee_id=<uuid>`, or `null` for the UNASSIGNED bucket.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ⚠ THE UNASSIGNED BUCKET HAS NO LINK, AND THAT IS THE DECISION, NOT AN OVERSIGHT
 * ═══════════════════════════════════════════════════════════════════════════════
 * "Members with no committee" is a NEGATIVE predicate. S5's contract has no encoding for
 * it: `committee_id` is a uuid facet, and `parseMemberFilters` drops any value that is
 * not a uuid. So every sentinel one could invent — `none`, `null`, the nil uuid — is
 * either discarded (producing an UNFILTERED list under a heading claiming otherwise:
 * exactly the failure this module exists to prevent) or matches no committee and shows
 * nothing.
 *
 * Returning `null` makes the bar render as a plain figure rather than an anchor, so the
 * count is still shown and still true, and nothing pretends to be clickable. Giving it a
 * real link means giving `search_member_directory()` an `unassigned` predicate and
 * `memberFiltersSchema` a boolean dimension — a schema change in another agent's lane,
 * on a day that cannot afford one. Recorded so the next maintainer sees a choice rather
 * than a gap.
 */
export function committeeTileHref(
  audience: DashboardAudience,
  termId: string | null,
  committeeId: string | null,
): string | null {
  if (committeeId === null) return null;
  return membersHref(
    { ...baseFilters(audience, termId), committee_id: [committeeId] },
    BASES[audience].path,
  );
}

/**
 * The pending-application tile (PRD US-D4: "plus the pending-application count").
 *
 * ⚠ THIS ONE DOES NOT USE THE MEMBER CONTRACT. `/applications` is a different surface
 * with its own filter vocabulary (`lib/applications/schema.ts`), so it is built here as
 * a literal rather than through `membersHref` — and it is admin-only, because no other
 * tier renders a pending count or could read one.
 */
export function pendingApplicationsHref(): string {
  return `${APPLICATIONS_PATH}?status=pending`;
}
