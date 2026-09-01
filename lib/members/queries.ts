// ─────────────────────────────────────────────────────────────────────────────
// Reads for the member-records surface (BUILD_PLAN S5-T17).
//
// EVERY read here goes through `ctx.supabase` — THE CALLER'S OWN CLIENT, carrying the
// caller's JWT. Never a fresh client, never `lib/server/admin-client.ts`. That is the
// whole authorization story for this module: `memberships_read`, `people_read` and the
// six-column GRANT on `people` decide what comes back, and nothing here adds a second
// opinion on top of them (ARCHITECTURE.md §5).
//
// ═══════════════════════════════════════════════════════════════════════════════
// AN EMPTY RESULT IS NOT AN ERROR, AND IS NEVER `unauthorized`
// ═══════════════════════════════════════════════════════════════════════════════
// RLS's failure mode is a silent empty set (ARCHITECTURE.md §9). An officer listing
// members gets rows; a regional rep gets one region; a member gets themselves; and a
// caller with no policy gets `[]`. All four are correct answers, not failures.
//
// Where a read genuinely cannot proceed, the code is `not_found` — never `unauthorized`.
// Saying "forbidden" confirms the row exists, and therefore that a named scholar has a
// record (CONVENTIONS.md §4.3). There is exactly ONE documented exception, below.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ NOTHING IS LOGGED
// ═══════════════════════════════════════════════════════════════════════════════
// `no-console` is an eslint ERROR under `lib/**`. A `people` row is the densest PII
// object in the schema, and a raw PostgREST error from this path can carry a column
// value in `details`. Raw errors are mapped and dropped; Sentry — whose `beforeSend`
// strips request bodies — is where one is allowed to go.
//
// CITATION: BUILD_PLAN S5-T17, S5-T25, S5-T26; PRD §3 v1.0 items 10, 12;
//           PRD US-D1, US-D2, US-I1, US-I2, US-I3, US-J1, US-J5;
//           ARCHITECTURE.md §5, §9; CONVENTIONS.md §4.1, §4.3.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import type { ActionResult } from "@/lib/action-result";
import { err, mapDbError, ok } from "@/lib/action-result";
import type { ActionContext } from "@/lib/auth/with-role";
import type { OrgRole } from "@/lib/auth/route-access";
import { parseMemberSort, type MemberFilters, type MembershipStatus } from "@/lib/members/filters";
import type {
  FacetOption,
  MemberAuditEntry,
  MemberDirectoryPage,
  MemberDirectoryRow,
  MemberFacetOptions,
  MemberRecord,
  MemberTermHistoryRow,
} from "@/lib/members/types";

// ─────────────────────────────────────────────────────────────────────────────
// listMemberDirectory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The tiers whose `term_id` filter is honoured, mirroring the list inside
 * `search_member_directory()` (0030).
 *
 * ⚠ THIS IS UX, NOT THE GATE. The function forces `current_term_id()` for every other
 * tier no matter what is passed, and RLS refuses the rows regardless (PRD US-H3:
 * officers and reps do not gain access to prior terms they could not see at the time).
 * Not sending the parameter simply keeps a stale link from looking like it worked.
 */
const TERM_SELECTING_ROLES: readonly OrgRole[] = [
  "exec_admin",
  "crrd_admin",
  "moderator",
  "tech_admin",
];

/** `undefined` for an empty facet, so JSON.stringify drops it and the SQL default (NULL) wins. */
const facetArg = <T>(values: readonly T[]): T[] | undefined =>
  values.length === 0 ? undefined : [...values];

/**
 * One page of the member grid (PRD §3 v1.0 items 10 and 12, US-I2, US-I3).
 *
 * ⚠ THE SECOND `.order()` IS NOT DECORATION. `membership_id` is a deterministic
 * tiebreak. Without it, two scholars whose `family_name` sorts equal can swap between
 * page 1 and page 2 on separate requests — which shows one person twice and hides
 * another entirely. It reads as a data bug and is a paging bug, and it is the kind that
 * only appears once there is enough data for the demo to matter.
 *
 * ⚠ SORTING AND PAGING ARE POSTGREST'S, NOT ARGUMENTS. `search_member_directory()`
 * takes no `p_sort` and no `p_limit`; `?order=` and the Range header apply to a
 * SETOF-returning function directly. A sort argument would be a string concatenated
 * into an ORDER BY — an injection surface added for no capability (0030's header).
 *
 * ⚠ THE COUNT IS EXACT. `count: 'exact'` costs a second planner pass and buys an honest
 * total: the pagination control shows the real number of pages, and an out-of-range page
 * renders the last one rather than dead-ending a link somebody shared.
 */
export async function listMemberDirectory(
  ctx: ActionContext,
  filters: MemberFilters,
): Promise<ActionResult<MemberDirectoryPage>> {
  const { column, ascending } = parseMemberSort(filters.sort);
  const from = (filters.page - 1) * filters.per_page;
  const to = from + filters.per_page - 1;

  const args = {
    p_term_id:
      filters.term_id !== null && TERM_SELECTING_ROLES.includes(ctx.role)
        ? filters.term_id
        : undefined,
    p_q: filters.q ?? undefined,
    p_statuses: facetArg<MembershipStatus>(filters.status),
    p_region_ids: facetArg(filters.region_id),
    p_committee_ids: facetArg(filters.committee_id),
    p_department_ids: facetArg(filters.department_id),
  };

  const { data, error, count } = await ctx.supabase
    .rpc("search_member_directory", args, { count: "exact" })
    .order(column, { ascending })
    .order("membership_id", { ascending: true })
    .range(from, to);

  if (error) return { ok: false, error: mapDbError(error) };

  return ok({
    rows: (data ?? []) as MemberDirectoryRow[],
    total: count ?? 0,
    page: filters.page,
    perPage: filters.per_page,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getMemberRecord
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The message the detail page renders when the caller's CBL Art. VIII §7.1
 * acknowledgement is not on file for the current term.
 *
 * Written once here so the page, the test and any future surface all say the same
 * sentence, and so it names the ACTION that unblocks it rather than stopping at "no".
 */
export const MISSING_ACKNOWLEDGEMENT_MESSAGE =
  "Your confidentiality acknowledgement for the current term is not on file, so member " +
  "records cannot be opened. An Executive Admin records it (CBL Art. VIII §7.1).";

/**
 * Substring of `assert_confidentiality_ack()`'s exception message (0012).
 *
 * ⚠ MATCHING ON MESSAGE TEXT IS A COMPROMISE, AND IT IS THE RIGHT ONE HERE. Both the
 * role guard and the acknowledgement guard raise 42501, so SQLSTATE cannot separate
 * them, and `ErrorCode` is a fixed seven-member union that must not grow a code for one
 * feature. If this string ever stops matching, the failure is SAFE IN THE RIGHT
 * DIRECTION: the read still fails, the page renders not-found instead of the actionable
 * panel, and nothing leaks. `020_confidentiality_gate.sql` asserts the message names the
 * agreement, so a reworded exception turns pgTAP red before it reaches a screen.
 */
const ACK_MESSAGE_MARKER = "confidentiality acknowledgement";

/** Did this failure come from the CBL Art. VIII §7.1 gate rather than from the tier? */
export function isMissingAcknowledgement(error: { message: string }): boolean {
  return error.message === MISSING_ACKNOWLEDGEMENT_MESSAGE;
}

/**
 * One scholar's full record, sensitive columns included (PRD §3 v1.0 item 10, US-D1).
 *
 * ⚠ CALLING THIS WRITES AN AUDIT ROW. `get_member_record()` inserts one `VIEW_RECORD`
 * entry before it returns, so merely opening the detail page is recorded — under
 * RA 10173, and under CBL Art. VIII §6 which makes it a constitutional obligation too,
 * "who read this scholar's address, and when" must be answerable. Do not call this to
 * test whether a person exists, and do not call it twice in one render.
 *
 * ⚠ THE ONE PLACE `unauthorized` IS THE RIGHT CODE. Everywhere else in this codebase a
 * denial is `not_found`, because "forbidden" confirms the row exists. The missing
 * acknowledgement is different: it says nothing about the scholar and everything about
 * the CALLER, it is a documented day-one failure mode (nobody has signed on the morning
 * a term opens — PRD US-J5, ARCHITECTURE.md §9 item 5), and it has a one-INSERT fix that
 * the reader needs to be told about. Rendering it as a 404 would send a newly appointed
 * CCDO to debug a page that is working exactly as designed.
 *
 * Every other denial — wrong tier, no such person, RLS — collapses to `not_found`.
 */
export async function getMemberRecord(
  ctx: ActionContext,
  personId: string,
): Promise<ActionResult<MemberRecord>> {
  const { data, error } = await ctx.supabase.rpc("get_member_record", {
    p_person_id: personId,
  });

  if (error) {
    const raw = typeof error.message === "string" ? error.message : "";
    if (raw.includes(ACK_MESSAGE_MARKER)) {
      return err<MemberRecord>("unauthorized", MISSING_ACKNOWLEDGEMENT_MESSAGE);
    }
    const mapped = mapDbError(error);
    // A wrong-tier 42501 must not read differently from "no such person".
    if (mapped.code === "unauthorized") return err<MemberRecord>("not_found");
    return { ok: false, error: mapped };
  }

  // The RPC returns SQL NULL for a person who does not exist, and writes no audit row
  // for one — an absent record must not be distinguishable from an unreadable one.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return err<MemberRecord>("not_found");
  }

  return ok(data as unknown as MemberRecord);
}

// ─────────────────────────────────────────────────────────────────────────────
// listMemberTermHistory
// ─────────────────────────────────────────────────────────────────────────────

/** The embed the history read asks for. Explicit — never `select('*')` on a joined shape. */
const TERM_HISTORY_SELECT =
  "id, status, year_level, expected_grad_year, ended_reason, term_id, region_id, " +
  "terms ( label, starts_on, ends_on, status ), regions ( name, island_group )";

type TermHistoryEmbeddedRow = {
  id: string;
  status: MembershipStatus;
  year_level: number | null;
  expected_grad_year: number | null;
  ended_reason: string | null;
  term_id: string;
  region_id: string;
  terms: {
    label: string;
    starts_on: string;
    ends_on: string;
    status: MemberTermHistoryRow["term_status"];
  } | null;
  regions: { name: string; island_group: MemberTermHistoryRow["island_group"] } | null;
};

/**
 * A person's membership across every term they have one in (PRD US-H1, US-H5, US-H3).
 *
 * This is the screen that DEMONSTRATES the PRD's hardest rule rather than asserting it:
 * three term rows, three statuses, one unchanged member ID. `2024-001` does not become
 * `2025-001` because the number is on `people` and renewal only ever inserts into
 * `memberships` (DATA_MODEL.md §4).
 *
 * ⚠ SORTED IN TYPESCRIPT, NOT IN POSTGREST, AND DELIBERATELY. PostgREST's `order` on an
 * embedded resource sorts rows WITHIN the embed, not the top-level rows — asking it to
 * order memberships by `terms.starts_on` looks like it works and silently does nothing.
 * A person has at most a handful of memberships (one per term, `unique (person_id,
 * term_id)`), so sorting in memory is free and, more to the point, correct.
 *
 * Prior terms a caller may not read are simply absent — RLS decides, not this function.
 */
export async function listMemberTermHistory(
  ctx: ActionContext,
  personId: string,
): Promise<MemberTermHistoryRow[]> {
  const { data, error } = await ctx.supabase
    .from("memberships")
    .select(TERM_HISTORY_SELECT)
    .eq("person_id", personId);

  if (error || !data) return [];

  const rows = data as unknown as TermHistoryEmbeddedRow[];

  return rows
    .filter(
      (
        row,
      ): row is TermHistoryEmbeddedRow & { terms: NonNullable<TermHistoryEmbeddedRow["terms"]> } =>
        row.terms !== null,
    )
    .map((row) => ({
      membership_id: row.id,
      term_id: row.term_id,
      term_label: row.terms.label,
      term_starts_on: row.terms.starts_on,
      term_ends_on: row.terms.ends_on,
      term_status: row.terms.status,
      status: row.status,
      region_id: row.region_id,
      region_name: row.regions?.name ?? "",
      island_group: row.regions?.island_group ?? "Luzon",
      year_level: row.year_level,
      expected_grad_year: row.expected_grad_year,
      ended_reason: row.ended_reason,
    }))
    .sort((a, b) => b.term_starts_on.localeCompare(a.term_starts_on));
}

// ─────────────────────────────────────────────────────────────────────────────
// listMemberAuditTrail
// ─────────────────────────────────────────────────────────────────────────────

/** How many entries the detail page shows. History beyond this belongs on `/audit`. */
const AUDIT_TRAIL_LIMIT = 50;

/**
 * The audit entries about this person (PRD US-I1).
 *
 * ⚠ AN EMPTY ARRAY IS THE NORMAL, CORRECT ANSWER FOR MOST CALLERS, NOT A FAILURE.
 * `audit_log_read` (0014) names `exec_admin` and `tech_admin` and nobody else, so a
 * CRRD Admin or a moderator opening a member record legitimately sees no trail. The page
 * renders this section CONDITIONALLY on the array being non-empty — it must not show an
 * error, and it must not show "no changes have been made", which would be false.
 *
 * ⚠ EVERY VALUE IN `old_data` / `new_data` IS ALREADY MASKED. `mask_sensitive()` replaced
 * each registered column before the row was written (DATA_MODEL.md §8.3), which is what
 * lets the log be append-only and still survive the five-year purge — it holds no PII for
 * the purge to reach. There is no un-masking path and none may be added.
 *
 * `rowIds` lets the caller include the person's membership rows, whose `row_id` is the
 * membership uuid rather than the person's. Status changes live there.
 */
export async function listMemberAuditTrail(
  ctx: ActionContext,
  personId: string,
  rowIds: readonly string[] = [],
): Promise<MemberAuditEntry[]> {
  const ids = [...new Set([personId, ...rowIds])];

  const { data, error } = await ctx.supabase
    .from("audit_log")
    .select(
      "id, created_at, actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note",
    )
    .in("row_id", ids)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AUDIT_TRAIL_LIMIT);

  // An RLS-filtered read is an empty array, not an error. Returning `[]` for a genuine
  // transport failure too is deliberate: this is a supplementary panel on a page whose
  // primary content already loaded, and failing it closed is better than 500-ing a
  // member record over a side panel.
  if (error || !data) return [];

  return data as MemberAuditEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// listFacetOptions
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_FACETS: MemberFacetOptions = {
  regions: [],
  committees: [],
  departments: [],
  terms: [],
};

/**
 * The options the filter bar renders (PRD US-I3, item 12).
 *
 * Resolved in the Server Component and passed DOWN as props. The filter bar never
 * fetches: a client component with a Supabase client is a client component one refactor
 * away from selecting a column it should not (CONVENTIONS.md §1.3).
 *
 * ⚠ COMMITTEES AND DEPARTMENTS ARE TERM-SCOPED. Offering last term's committees as
 * filters on this term's grid produces facets that match nothing — the ids differ per
 * term even where the `code` is stable (DATA_MODEL.md §6/0007).
 *
 * ⚠ `terms` IS EMPTY FOR NON-ADMIN TIERS, and that is UX only. The gate that matters is
 * inside `search_member_directory()`, which forces `current_term_id()` regardless of what
 * is passed, and RLS beneath it (PRD US-H3).
 *
 * All four reads run concurrently — four sequential round trips to Singapore is a third
 * of the 3-second budget spent on dropdown contents (PRD Performance NFR).
 */
export async function listFacetOptions(ctx: ActionContext): Promise<MemberFacetOptions> {
  const { data: termId } = await ctx.supabase.rpc("current_term_id");
  if (!termId) return EMPTY_FACETS;

  const canSelectTerm = TERM_SELECTING_ROLES.includes(ctx.role);

  const [regions, committees, departments, terms] = await Promise.all([
    ctx.supabase.from("regions").select("id, name").order("sort_order", { ascending: true }),
    ctx.supabase
      .from("committees")
      .select("id, name")
      .eq("term_id", termId)
      .order("name", { ascending: true }),
    ctx.supabase
      .from("departments")
      .select("id, name")
      .eq("term_id", termId)
      .order("name", { ascending: true }),
    canSelectTerm
      ? ctx.supabase.from("terms").select("id, label").order("starts_on", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; label: string }[], error: null }),
  ]);

  const toOptions = (rows: { id: string; name?: string; label?: string }[] | null): FacetOption[] =>
    (rows ?? []).map((row) => ({ id: row.id, label: row.name ?? row.label ?? "" }));

  return {
    regions: toOptions(regions.data),
    committees: toOptions(committees.data),
    departments: toOptions(departments.data),
    terms: toOptions(terms.data),
  };
}
