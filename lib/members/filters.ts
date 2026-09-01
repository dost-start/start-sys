// ─────────────────────────────────────────────────────────────────────────────
// THE URL CONTRACT FOR /members (BUILD_PLAN S5-T14).
//
// PRD US-I3: "a filtered view is shareable as a link and survives the browser back
// button." That sentence is this module. Filter, sort and pagination state lives in
// the URL and NOWHERE ELSE — no `useState` mirror, no client state library
// (CONVENTIONS.md §2, §11: "URL search params only"). One source of truth means the
// grid cannot disagree with the address bar, Back works for free, and a link pasted
// into a group chat reproduces exactly what the sender was looking at.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THREE PROPERTIES THAT ARE REQUIREMENTS, NOT POLISH
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. **THIS MODULE NEVER THROWS.** Every field carries `.catch(...)`, so a stale,
//    hand-edited or truncated link degrades to the default view rather than a 500.
//    `?status=nonsense` shows everything. That is the right trade for a link people
//    are meant to share: a URL that errors when one param has gone stale is a URL
//    nobody shares twice. The same rule governs the application queue's filters
//    (lib/applications/schema.ts), so both surfaces behave identically.
//
// 2. **UNKNOWN PARAMS ARE DROPPED.** `parse` reads only the nine keys below and
//    `serialize` emits only those nine, so a tracking param, a stray `?debug=1` or a
//    param from a previous version of this file never survives a round trip and never
//    reaches a database predicate.
//
// 3. **SERIALIZATION IS CANONICAL.** Keys in a fixed order, multi-valued facets sorted
//    and deduped, and every value equal to its default OMITTED. The same filter set
//    always produces the same string, so `Clear all` lands on the bare path, two people
//    building the same view produce the same link, and `parse(serialize(f)) === f` for
//    any parsed `f` — asserted over a table of combinations in filters.test.ts.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ `MEMBERS_PATH` IS THE ONLY PLACE THE ROUTE PREFIX IS SPELLED
// ═══════════════════════════════════════════════════════════════════════════════
// Next's parenthesised route groups are URL-INVISIBLE: `app/(admin)/members/` is served
// at `/members`, not `/admin/members`. Everything that links into this surface —
// S6's dashboard tiles, the audit trail, `revalidatePath` in lib/members/actions.ts —
// imports this constant instead of hardcoding a string. If the team ever wants a literal
// `/admin` prefix, it is this one line plus a folder move.
//
// ⚠ WHAT THIS MODULE DELIBERATELY DOES NOT DO: it does not decide who may filter by
// `term_id`. A schema cannot know who is asking. PRD US-H3 (officers and reps do not
// gain access to prior terms they could not see at the time) is enforced SERVER-SIDE
// inside `search_member_directory()` (0030), which honours a client term only for the
// admin tiers and forces `current_term_id()` for everyone else — and RLS refuses the
// rows regardless. The term selector rendering for admins only is UX on top of that.
//
// CITATION: BUILD_PLAN S5-T14; PRD §3 v1.0 item 12, US-I2, US-I3, US-H3;
//           CONVENTIONS.md §2, §11; ARCHITECTURE.md §5.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

import { Constants, type Enums } from "@/database.types";

// ── The route this contract addresses ────────────────────────────────────────

/**
 * The served path of the member directory. Route groups are URL-invisible, so
 * `app/(admin)/members/page.tsx` is reachable at `/members`.
 *
 * Import this; never write the string. It is also what `revalidatePath` takes.
 */
export const MEMBERS_PATH = "/members";

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type MembershipStatus = Enums<"membership_status">;

/**
 * The six membership statuses, taken from the GENERATED enum rather than hand-typed.
 *
 * A hand-typed literal array silently drops a status from every filter the moment the
 * enum grows — the facet would simply stop offering it, with no error anywhere. Reading
 * `Constants` means a new member of `membership_status` becomes available here the
 * instant `pnpm db:types` is run (CONVENTIONS.md §5: DB types always come from the
 * generated root module).
 */
export const MEMBERSHIP_STATUSES = Constants.public.Enums.membership_status;

/**
 * The orderings the grid offers, as PostgREST `column.direction` pairs.
 *
 * Every column named here is one the RPC actually returns (0030's `RETURNS TABLE`), so
 * `.order(column)` cannot fail at runtime on a column that does not exist. Sensitive
 * columns are absent by construction: `search_member_directory()` returns none, and
 * sorting by a column nobody can read would be a 42501 dressed up as a sort.
 */
export const MEMBER_SORTS = [
  "family_name.asc",
  "family_name.desc",
  "given_name.asc",
  "given_name.desc",
  "member_id.asc",
  "member_id.desc",
  "join_year.asc",
  "join_year.desc",
  "status.asc",
  "status.desc",
  "region_name.asc",
  "region_name.desc",
] as const;

export type MemberSort = (typeof MEMBER_SORTS)[number];

export const DEFAULT_MEMBER_SORT: MemberSort = "family_name.asc";
export const DEFAULT_MEMBERS_PER_PAGE = 25;
export const MAX_MEMBERS_PER_PAGE = 100;

/** Longer than any real name or member ID; refuses a pathological URL, not a search. */
export const MAX_MEMBER_QUERY_LENGTH = 120;

/**
 * Split a sort token into what `.order()` needs.
 *
 * Kept here beside `MEMBER_SORTS` rather than in queries.ts so the token vocabulary and
 * its interpretation cannot drift into two different opinions about what `.desc` means.
 */
export function parseMemberSort(sort: MemberSort): { column: string; ascending: boolean } {
  const [column, direction] = sort.split(".");
  return { column: column ?? "family_name", ascending: direction !== "desc" };
}

// ── Normalising whatever a page hands us ─────────────────────────────────────

/**
 * What `parseMemberFilters` accepts.
 *
 * Next's `searchParams` is a `Record<string, string | string[] | undefined>`; a client
 * component holds a `URLSearchParams`. Both are taken so neither side has to convert,
 * because a conversion written twice is a conversion that disagrees once.
 */
export type MemberSearchParamsInput =
  URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

/** Collapse any accepted input into `key -> all values`, dropping empty strings. */
function toMultiMap(input: MemberSearchParamsInput): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (input === null || input === undefined) return out;

  const push = (key: string, value: unknown): void => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    // `?status=` is "no filter", not "an invalid enum member".
    if (trimmed === "") return;
    const bucket = out[key];
    if (bucket === undefined) out[key] = [trimmed];
    else bucket.push(trimmed);
  };

  if (input instanceof URLSearchParams) {
    for (const [key, value] of input.entries()) push(key, value);
    return out;
  }

  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) for (const item of value) push(key, item);
    else push(key, value);
  }
  return out;
}

/** First value for a key, or `undefined`. Single-valued fields ignore repeats. */
const one = (map: Record<string, string[]>, key: string): string | undefined => map[key]?.[0];

/** Every value for a key. Multi-valued facets use repeated params: `?a=1&a=2`. */
const many = (map: Record<string, string[]>, key: string): string[] => map[key] ?? [];

/**
 * A multi-valued facet: keep only the entries that validate, then dedupe and sort.
 *
 * ⚠ INVALID ENTRIES ARE DROPPED INDIVIDUALLY, not by discarding the whole facet.
 * `?status=active&status=nonsense` filters to `active` — throwing away the valid half
 * because the invalid half was there would silently widen the result set, which on a
 * screen full of member records is the wrong direction to fail.
 *
 * Sorting is what makes serialization canonical: two people who ticked the same two
 * regions in a different order produce the same link.
 */
function facet<T extends string>(values: readonly string[], allowed: readonly T[]): T[] {
  const kept = values.filter((value): value is T => (allowed as readonly string[]).includes(value));
  return [...new Set(kept)].sort();
}

/** The same, for opaque uuid facets where the allowed set is not enumerable. */
function uuidFacet(values: readonly string[]): string[] {
  const kept = values.filter((value) => z.uuid().safeParse(value).success);
  return [...new Set(kept)].sort();
}

// ── The schema ───────────────────────────────────────────────────────────────

/**
 * The parsed filter state. TOTAL: absence is `null`, never a missing key, so a caller
 * never has to distinguish "not set" from "set to undefined" and `toEqual` in the
 * round-trip test compares two fully-specified objects.
 *
 * ⚠ ALL SIX PRD FILTER DIMENSIONS ARE HERE, plus search. PRD §3 v1.0 item 12 and
 * US-I3 name status, region, term, committee and department; US-I2 names name and
 * member-ID search. filters.test.ts asserts each ONE INDIVIDUALLY rather than as a
 * group, so a dimension quietly dropped in a refactor fails here — on Day 5 — instead
 * of at the Day-7 demo rehearsal when someone asks to filter by department.
 */
export const memberFiltersSchema = z.object({
  q: z.string().trim().min(1).max(MAX_MEMBER_QUERY_LENGTH).nullable().catch(null),
  status: z.array(z.enum(MEMBERSHIP_STATUSES)).catch([]),
  region_id: z.array(z.uuid()).catch([]),
  term_id: z.uuid().nullable().catch(null),
  committee_id: z.array(z.uuid()).catch([]),
  department_id: z.array(z.uuid()).catch([]),
  page: z.coerce.number().int().min(1).catch(1),
  per_page: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_MEMBERS_PER_PAGE)
    .catch(DEFAULT_MEMBERS_PER_PAGE),
  sort: z.enum(MEMBER_SORTS).catch(DEFAULT_MEMBER_SORT),
});

export type MemberFilters = z.infer<typeof memberFiltersSchema>;

/** The canonical empty view: what `Clear all` produces and what a bare `/members` is. */
export const DEFAULT_MEMBER_FILTERS: MemberFilters = Object.freeze({
  q: null,
  status: [],
  region_id: [],
  term_id: null,
  committee_id: [],
  department_id: [],
  page: 1,
  per_page: DEFAULT_MEMBERS_PER_PAGE,
  sort: DEFAULT_MEMBER_SORT,
});

/**
 * Parse `searchParams` into the grid's filter state.
 *
 * Total by construction — the facets are pre-filtered above and every scalar carries
 * `.catch(...)`, so `safeParse` cannot fail and the `parse` below cannot throw. The
 * fallback branch exists only so that a future edit which removes a `.catch()` degrades
 * to the default view rather than 500-ing a page a scholar's officer is trying to open.
 */
export function parseMemberFilters(input: MemberSearchParamsInput): MemberFilters {
  const map = toMultiMap(input);

  const result = memberFiltersSchema.safeParse({
    q: one(map, "q") ?? null,
    status: facet(many(map, "status"), MEMBERSHIP_STATUSES),
    region_id: uuidFacet(many(map, "region_id")),
    term_id: one(map, "term_id") ?? null,
    committee_id: uuidFacet(many(map, "committee_id")),
    department_id: uuidFacet(many(map, "department_id")),
    page: one(map, "page") ?? 1,
    per_page: one(map, "per_page") ?? DEFAULT_MEMBERS_PER_PAGE,
    sort: one(map, "sort") ?? DEFAULT_MEMBER_SORT,
  });

  return result.success ? result.data : { ...DEFAULT_MEMBER_FILTERS };
}

// ── Serialization ────────────────────────────────────────────────────────────

/**
 * Emission order. Fixed and alphabetical so the same filter set is always the same
 * string — which is what makes a shared link comparable, a cache key stable and the
 * round-trip test meaningful.
 */
const SERIALIZED_KEY_ORDER = [
  "committee_id",
  "department_id",
  "page",
  "per_page",
  "q",
  "region_id",
  "sort",
  "status",
  "term_id",
] as const;

/**
 * Render filters as a canonical query string, WITHOUT a leading `?`.
 *
 * Values equal to their default are omitted, so the empty filter set serializes to `""`
 * and `Clear all` lands on a bare `/members` rather than on a URL carrying nine
 * redundant params. Facets are already deduped and sorted by `parseMemberFilters`; they
 * are sorted again here so a hand-built object serializes canonically too.
 */
export function serializeMemberFilters(filters: MemberFilters): string {
  const params = new URLSearchParams();

  for (const key of SERIALIZED_KEY_ORDER) {
    switch (key) {
      case "q": {
        const value = filters.q?.trim();
        if (value !== undefined && value !== "") params.set("q", value);
        break;
      }
      case "term_id": {
        if (filters.term_id !== null) params.set("term_id", filters.term_id);
        break;
      }
      case "page": {
        if (filters.page !== 1) params.set("page", String(filters.page));
        break;
      }
      case "per_page": {
        if (filters.per_page !== DEFAULT_MEMBERS_PER_PAGE) {
          params.set("per_page", String(filters.per_page));
        }
        break;
      }
      case "sort": {
        if (filters.sort !== DEFAULT_MEMBER_SORT) params.set("sort", filters.sort);
        break;
      }
      default: {
        // The four multi-valued facets, emitted as repeated params.
        for (const value of [...filters[key]].sort()) params.append(key, value);
      }
    }
  }

  return params.toString();
}

/** `/members`, or `/members?…`. What every link into this surface is built from. */
export function membersHref(filters: MemberFilters, basePath: string = MEMBERS_PATH): string {
  const query = serializeMemberFilters(filters);
  return query === "" ? basePath : `${basePath}?${query}`;
}

// ── Changing a filter ────────────────────────────────────────────────────────

/** The keys that describe WHAT is being looked at, as opposed to WHERE in the results. */
const FILTER_KEYS = [
  "q",
  "status",
  "region_id",
  "term_id",
  "committee_id",
  "department_id",
] as const;

/**
 * Apply a change to the current filters, resetting pagination when the result set moves.
 *
 * ⚠ THE PAGE RESET IS THE WHOLE POINT OF THIS FUNCTION. Narrowing a 12-page list to two
 * pages while sitting on page 7 renders an empty grid over a filter that matches 40
 * people — which reads as "the filter is broken", and the natural next move is to widen
 * the filter until rows come back. Any change to a genuine filter dimension, or to
 * `per_page` (which redefines what page 7 even means), sends the caller back to page 1.
 * A `sort` change does not: the same rows are there, in a different order.
 *
 * A patch that only moves `page` is passed through untouched — otherwise pagination
 * would reset itself on every click and the grid could never leave page 1.
 */
export function changeMemberFilters(
  current: MemberFilters,
  patch: Partial<MemberFilters>,
): MemberFilters {
  const next: MemberFilters = { ...current, ...patch };

  const touchedFilter = FILTER_KEYS.some((key) => Object.hasOwn(patch, key));
  const touchedPerPage = Object.hasOwn(patch, "per_page");

  if ((touchedFilter || touchedPerPage) && !Object.hasOwn(patch, "page")) {
    next.page = 1;
  }

  return next;
}

/** True when nothing is filtering the list — drives the "no members yet" empty state. */
export function hasActiveMemberFilters(filters: MemberFilters): boolean {
  return (
    filters.q !== null ||
    filters.term_id !== null ||
    filters.status.length > 0 ||
    filters.region_id.length > 0 ||
    filters.committee_id.length > 0 ||
    filters.department_id.length > 0
  );
}
