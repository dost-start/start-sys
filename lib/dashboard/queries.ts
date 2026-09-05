// ─────────────────────────────────────────────────────────────────────────────
// The scoped reads behind every dashboard in v1.0 (BUILD_PLAN S6-T5).
//
// ═══════════════════════════════════════════════════════════════════════════════
// THERE IS NOT ONE LINE ABOUT REGIONS IN THIS FILE, AND THERE MUST NEVER BE ONE
// ═══════════════════════════════════════════════════════════════════════════════
// The three views are `security_invoker = true` (0032), so `memberships_read` (0014 §4)
// is evaluated for the CALLER on every row they touch. A regional rep's totals are
// correct because THE DATABASE REFUSES TO COMPUTE ANYTHING ELSE — not because a branch
// here remembered to filter. Adding a `.eq('region_id', …)` for a rep would be a second
// authorization model, which is the exact thing ADR 0007 exists to prevent: two models
// drift, and the one that drifts silently is the one in TypeScript.
//
// Consequences that follow for free and are therefore not coded:
//   · a rep resolves their own region(s) and nothing else;
//   · an officer resolves org-wide totals;
//   · `tech_admin` resolves NOTHING — `memberships_read` does not name that role, which
//     is why `homeForRole` sends the CTO to `/system` rather than to an all-zero
//     dashboard that reads as a broken system (BUILD_PLAN S6-T13).
//
// ⚠ EVERY READ USES `ctx.supabase` — THE CALLER'S OWN CLIENT. No admin client, no
// service-role key, ever: `grep -rn "admin-client|service_role" lib/dashboard/` must
// return nothing (S6-T5 acceptance).
//
// ⚠ NOTHING IS LOGGED. `no-console` is an eslint error under `lib/**`, and a raw
// PostgREST error can carry a value in `details`.
//
// A FAILED READ RETURNS AN EMPTY ARRAY, NOT AN ERROR. An RLS-filtered aggregate is
// legitimately empty for several tiers, so a dashboard panel must render `0` rather than
// a crash — the zero-fill in status-buckets.ts is what turns that into "0 across the
// board" instead of a blank panel (PRD US-H2: "dashboards wiped clean" is true of the
// view, never of the data).
//
// CITATION: BUILD_PLAN S6-T5, S6-T9, S6-T12, S6-T13; ADR 0007;
//           ARCHITECTURE.md §5, §9; PRD §3 v1.0 items 13-15; PRD US-D4, US-F1, US-H2.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import type { Database } from "@/database.types";
import type { ActionContext } from "@/lib/auth/with-role";
import type {
  CallerRegion,
  CommitteeCountRow,
  RegionCountRow,
  RegionRef,
  StatusCountRow,
} from "@/lib/dashboard/types";

// ─────────────────────────────────────────────────────────────────────────────
// The one cast, in one place
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The minimal structural shape of the PostgREST builder this module uses.
 *
 * ⚠ WHY A CAST AT ALL. `database.types.ts` does not yet know about the three views from
 * 0032 (see the header of lib/dashboard/types.ts), so `ctx.supabase.from('v_…')` does
 * not typecheck. Rather than sprinkling `as` through five call sites, the narrowing
 * happens exactly once, here, behind a function whose return type is the caller's row
 * type. When the migration owner regenerates types, this helper and the hand-written row
 * types are deleted together and the call sites are unchanged.
 *
 * Deliberately NOT `any` (banned, CONVENTIONS.md §5): the shape below is exactly the two
 * methods used, so a typo in `.select()` or `.eq()` is still a compile error.
 */
type AggregateReader = {
  from(relation: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};

/** `count(*)::bigint` arrives as a JSON number; coerce defensively and never NaN. */
function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `select … where term_id = $1` against one aggregate view, as the caller.
 *
 * Rows come back unordered — ordering is done in TypeScript by the callers below,
 * because these result sets are at most six statuses, eighteen regions and a handful of
 * committees. Sorting a twenty-row array in memory is free, and it keeps the builder
 * shape above down to the two methods it actually needs.
 */
async function readAggregate(
  ctx: ActionContext,
  relation: string,
  columns: string,
  termId: string,
): Promise<unknown[]> {
  const reader = ctx.supabase as unknown as AggregateReader;
  const { data, error } = await reader.from(relation).select(columns).eq("term_id", termId);
  if (error !== null && error !== undefined) return [];
  return Array.isArray(data) ? data : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// The four reads
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLUMNS = "term_id, status, member_count";

const REGION_COLUMNS =
  "term_id, region_id, region_code, region_name, island_group, sort_order, member_count";

const COMMITTEE_COLUMNS = "term_id, committee_id, committee_code, committee_name, member_count";

/**
 * Headcount by membership status for one term (PRD US-D4).
 *
 * ⚠ NOT ZERO-FILLED. A term where nobody is `graduated` yields no `graduated` row,
 * because a view cannot invent a row for a status nobody holds. `zeroFillStatuses`
 * (status-buckets.ts) fills from the GENERATED enum, so a brand-new term renders 0 for
 * every status rather than an empty panel.
 */
export async function listStatusCounts(
  ctx: ActionContext,
  termId: string,
): Promise<StatusCountRow[]> {
  const rows = (await readAggregate(
    ctx,
    "v_membership_status_counts",
    STATUS_COLUMNS,
    termId,
  )) as StatusCountRow[];

  return rows.map((row) => ({ ...row, member_count: toCount(row.member_count) }));
}

/**
 * Headcount by region for one term (PRD US-D4, US-F1).
 *
 * Sorted by the `regions.sort_order` the view carries, so Luzon → Visayas → Mindanao
 * reads the way the seed intends and the order does not depend on the planner.
 */
export async function listRegionCounts(
  ctx: ActionContext,
  termId: string,
): Promise<RegionCountRow[]> {
  const rows = (await readAggregate(
    ctx,
    "v_membership_region_counts",
    REGION_COLUMNS,
    termId,
  )) as RegionCountRow[];

  return rows
    .map((row) => ({ ...row, member_count: toCount(row.member_count) }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Headcount by committee for one term (PRD US-D4).
 *
 * ⚠ THIS DOES NOT SUM TO THE TERM HEADCOUNT, AND THAT IS CORRECT. CBL Art. III §5 places
 * no limit on how many committees a member may serve, so a scholar on two committees is
 * counted under each. The panel is LABELLED with a caption rather than reconciled — do
 * not "fix" it by picking one committee per member, which silently understates every
 * roster and, unlike a visible non-sum, produces a page where nothing looks wrong
 * (ADR 0007 §4).
 *
 * Sorted by count descending, then name, with the unassigned bucket LAST regardless —
 * it is usually the largest bar and would otherwise bury every real committee.
 */
export async function listCommitteeCounts(
  ctx: ActionContext,
  termId: string,
): Promise<CommitteeCountRow[]> {
  const rows = (await readAggregate(
    ctx,
    "v_membership_committee_counts",
    COMMITTEE_COLUMNS,
    termId,
  )) as CommitteeCountRow[];

  return rows
    .map((row) => ({ ...row, member_count: toCount(row.member_count) }))
    .sort((a, b) => {
      if (a.committee_id === null) return 1;
      if (b.committee_id === null) return -1;
      if (b.member_count !== a.member_count) return b.member_count - a.member_count;
      return (a.committee_name ?? "").localeCompare(b.committee_name ?? "");
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Supporting reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The active term, or `null`.
 *
 * `current_term_id()` is STABLE SECURITY DEFINER (0012) and every dashboard filters on
 * it. Never a hardcoded year: term rollover is a status flip, and a hardcoded year
 * breaks silently every June (CONVENTIONS.md §0 rule 7).
 */
export async function getCurrentTermId(ctx: ActionContext): Promise<string | null> {
  const { data, error } = await ctx.supabase.rpc("current_term_id");
  if (error || !data) return null;
  return data;
}

/** The term's label (`2026-2027`), so "current term" is never ambiguous on screen. */
export async function getTermLabel(ctx: ActionContext, termId: string): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("terms")
    .select("label")
    .eq("id", termId)
    .maybeSingle();
  if (error || !data) return null;
  return data.label;
}

/**
 * Every seeded region, for zero-filling the region panel.
 *
 * `regions_read` grants SELECT to every authenticated role and to anon (0014 §1), so
 * this is global reference data and adds no reachable surface — it labels counts, it
 * cannot widen them.
 */
export async function listRegions(ctx: ActionContext): Promise<RegionRef[]> {
  const { data, error } = await ctx.supabase
    .from("regions")
    .select("id, code, name, island_group, sort_order")
    .order("sort_order", { ascending: true });

  if (error || !data) return [];
  return data;
}

/**
 * The caller's own region(s) — the Regional Representative dashboard header (US-F1).
 *
 * `auth_region_ids()` returns the caller's `user_roles.region_id` UNION their
 * `rr_region_grants` rows and NOTHING ELSE, so it discloses to a caller a fact the
 * caller already supplied (0033). A rep with extra grants sees all of them named.
 *
 * Returns `[]` for every non-rep tier, which is correct rather than a failure: only the
 * `/region` surface renders this.
 */
export async function getCallerRegions(ctx: ActionContext): Promise<CallerRegion[]> {
  const { data: ids, error: idsError } = await ctx.supabase.rpc("auth_region_ids");
  if (idsError || !ids || ids.length === 0) return [];

  const { data, error } = await ctx.supabase
    .from("regions")
    .select("id, code, name, island_group, sort_order")
    .in("id", ids)
    .order("sort_order", { ascending: true });

  if (error || !data) return [];
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// The Regional Representative contact roster (ADR 0011, migration 0042).
// ─────────────────────────────────────────────────────────────────────────────

export type RegionContactRow =
  Database["public"]["Functions"]["list_region_member_contacts"]["Returns"][number];

export type RegionContactsResult =
  | { ok: true; rows: RegionContactRow[] }
  | { ok: false; denial: "missing_acknowledgement" | "unavailable" };

/**
 * Own region(s), current term, regional_rep only, one VIEW_CONTACTS audit row per call.
 * The RPC RAISES when the caller has no current-term confidentiality acknowledgement
 * (PRD US-J5); that specific refusal is surfaced as a distinct result so the page can
 * say what unblocks it, exactly as `/members/[id]` does for a CCDO. Any other failure is
 * "unavailable" — never a raw PostgREST message.
 */
export async function listRegionContacts(
  ctx: ActionContext,
  universityId: string | null,
): Promise<RegionContactsResult> {
  const { data, error } = await ctx.supabase.rpc(
    "list_region_member_contacts",
    universityId ? { p_university_id: universityId } : {},
  );
  if (error) {
    if (error.code === "42501" && /acknowledgement/i.test(error.message)) {
      return { ok: false, denial: "missing_acknowledgement" };
    }
    return { ok: false, denial: "unavailable" };
  }
  return { ok: true, rows: data ?? [] };
}

/** The universities in the caller's region(s), for the roster filter. Public reference rows. */
export async function listRegionUniversities(
  ctx: ActionContext,
  regionIds: readonly string[],
): Promise<Array<{ id: string; name: string }>> {
  if (regionIds.length === 0) return [];
  const { data, error } = await ctx.supabase
    .from("universities")
    .select("id, name")
    .in("region_id", [...regionIds])
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error || !data) return [];
  return data;
}
