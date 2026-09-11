// The officer dashboard and member directory (BUILD_PLAN S6-T10; PRD §3 v1.0 item 15,
// US-D2, US-J1).
//
// "As an Officer, I can view member records, so that I can do my job without being able
// to damage the data."
//
// ═══════════════════════════════════════════════════════════════════════════════
// THREE PROPERTIES THIS PAGE MUST HAVE, AND WHERE EACH IS ACTUALLY ENFORCED
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. NO SENSITIVE COLUMN. No contact number, no address, no birthdate, no school ID, no
//    proof link. Enforced by the column-level GRANT on `people` (0015) and by what
//    `search_member_directory()` returns — NOT by this file omitting a column. If this
//    page rendered a `birthdate`, the query would already have failed with 42501.
//    061_officer_column_sets.sql asserts the set, and its red is verified by granting
//    `select (birthdate)`.
//
// 2. NO WRITE PATH. There is no Server Action imported here and no edit, status or
//    assign control anywhere on the page — `grep -rn "use server" app/(officer)/` must
//    return nothing. That is UX honesty rather than security: the officer tier holds NO
//    UPDATE policy on any table (US-D2), so a rendered button could only produce a
//    confusing failure.
//
// 3. PINNED TO THE CURRENT TERM. `term_id` is stripped from the parsed filters before
//    the query is built, so `?term_id=<archived>` changes nothing. Prior-term visibility
//    for officers is US-H3 — a v1.2 item — and must not be reachable by editing a URL.
//    Stripping it here is the UX half; `search_member_directory()` forces
//    `current_term_id()` for non-admin tiers regardless (0030), and RLS refuses the rows
//    beneath that. Delete this line and nothing leaks.
//
// 4. SEARCH, FILTERS AND PAGINATION ARE S5's, REUSED (RECORDS-01, 2026-09-11). The list
//    is ~600 people; rendering the first 25 with no controls left rows 26+ reachable only
//    by hand-editing `?page=`, and a dashboard tile's filter arrived with no visible chip
//    and no way to clear it. The admin grid's controls are role-agnostic and prop-driven,
//    so they are imported here with `basePath` pointed at `/directory` rather than
//    reimplemented — a second search box would be a second opinion about what `?q=`
//    means, and the one that drifted would be this one. They write a URL, never a row,
//    so property 2 above is untouched.
//
// The admin roles reach this page too (`canAccess`'s officer case). They see the same
// columns, because the column set is the RPC's, not the page's.
//
// Brand edition (2026-09-08): the page title is the shell's top bar ("Directory"), so
// the `<h1>` here is screen-reader-only; sections follow docs/design/canvas/boards_other.py.
import { redirect } from "next/navigation";

import { CountBarList, type CountBarRow } from "@/components/dashboard/count-bar-list";
import { DirectoryTable } from "@/components/dashboard/directory-table";
import { SectionEyebrow } from "@/components/dashboard/section-eyebrow";
import { StatTile } from "@/components/dashboard/stat-tile";
import { MemberActiveFilters } from "@/components/members/member-active-filters";
import { MemberFilterBar } from "@/components/members/member-filters";
import { MemberPagination } from "@/components/members/member-pagination";
import { MemberSearch } from "@/components/members/member-search";
import { Card } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";
import { OFFICER_DIRECTORY_PATH, regionTileHref, statusTileHref } from "@/lib/dashboard/links";
import {
  aggregateRowsOrEmpty,
  getCurrentTermId,
  getTermLabel,
  listRegionCounts,
  listRegions,
  listStatusCounts,
} from "@/lib/dashboard/queries";
import { zeroFillRegions, zeroFillStatuses } from "@/lib/dashboard/status-buckets";
import { parseMemberFilters } from "@/lib/members/filters";
import { listFacetOptions, listMemberDirectory } from "@/lib/members/queries";

export const dynamic = "force-dynamic";

export default async function OfficerDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role === "member" || ctx.role === "regional_rep") redirect(homeForRole(ctx.role));

  const params = await searchParams;

  // Parsed through S5's contract so the officer tiles' links (which use the same param
  // names) work here — then `term_id` is forced to null. See property 3 above.
  const parsed = parseMemberFilters(params);
  const filters = { ...parsed, term_id: null };

  // Every reused control links back into `/directory`, never `/members`: `canAccess`
  // bounces an officer off the admin grid, so a mis-based control would throw the user
  // home — which reads as a broken session rather than a broken link (links.ts).
  const basePath = OFFICER_DIRECTORY_PATH;

  const termId = await getCurrentTermId(ctx);

  // ⚠ `aggregateRowsOrEmpty` BELOW IS THE OLD SWALLOW, NOW VISIBLE (QA UX-03,
  // 2026-09-11). A failed aggregate still renders zeros on this surface — the same bug
  // `/dashboard` just fixed. Naming it at the call site is what keeps it from being
  // invisible again; this page wants the same DashboardUnavailable banner as a follow-up.
  const [listResult, statusResult, regionResult, regions, termLabel, facets] = await Promise.all([
    listMemberDirectory(ctx, filters),
    termId === null
      ? Promise.resolve({ ok: true as const, rows: [] })
      : listStatusCounts(ctx, termId),
    termId === null
      ? Promise.resolve({ ok: true as const, rows: [] })
      : listRegionCounts(ctx, termId),
    listRegions(ctx),
    termId === null ? Promise.resolve(null) : getTermLabel(ctx, termId),
    // The labels the chips and the facet bar need. Regions, committees and departments
    // are readable by `authenticated` (0014 §1, §5); `terms` comes back EMPTY for this
    // tier, which is exactly why `canSelectTerm` is false below rather than a UI guess.
    listFacetOptions(ctx),
  ]);

  const page = listResult.ok
    ? listResult.data
    : { rows: [], total: 0, page: filters.page, perPage: filters.per_page };

  const statusBuckets = zeroFillStatuses(aggregateRowsOrEmpty(statusResult));
  const regionBuckets = zeroFillRegions(regions, aggregateRowsOrEmpty(regionResult));

  const regionBars: CountBarRow[] = regionBuckets.map((bucket) => ({
    key: bucket.region_id,
    label: bucket.region_name,
    meta: bucket.island_group,
    value: bucket.count,
    // The officer base: links stay inside `/directory` with the same param names. An
    // officer tile pointing at `/members` would be bounced home by `canAccess`, which
    // reads as a broken session rather than a broken link (links.ts).
    href: regionTileHref("officer", null, bucket.region_id),
  }));

  return (
    <div className="space-y-7">
      <h1 className="sr-only">Directory</h1>
      <p className="text-brand-body text-sm">
        {termLabel !== null ? `Term ${termLabel}` : "Current term"} · read-only
      </p>

      <section className="space-y-3">
        <SectionEyebrow>Members by status</SectionEyebrow>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {statusBuckets.map((bucket) => (
            <StatTile
              key={bucket.status}
              label={bucket.label}
              value={bucket.count}
              href={statusTileHref("officer", null, bucket.status)}
            />
          ))}
        </div>
      </section>

      <Card className="gap-4 p-5 sm:p-6">
        <SectionEyebrow>Members by region</SectionEyebrow>
        <CountBarList rows={regionBars} emptyLabel="No regions are configured." />
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionEyebrow>Members</SectionEyebrow>
          <span className="text-brand-label text-xs">
            {page.total.toLocaleString()} matching · page {page.page}
          </span>
        </div>

        {/* S5's controls on the officer base. `canSelectTerm` is false because
            `/directory` is pinned to the current term (property 3), and the chips are
            what make a tile's filter visible and clearable (RECORDS-01). */}
        <div className="space-y-4">
          <MemberSearch filters={filters} basePath={basePath} />
          <MemberFilterBar
            filters={filters}
            facets={facets}
            canSelectTerm={false}
            basePath={basePath}
          />
          <MemberActiveFilters filters={filters} facets={facets} basePath={basePath} />
        </div>

        <DirectoryTable
          rows={page.rows}
          emptyMessage="No members match this view for the current term."
        />
        <MemberPagination filters={filters} total={page.total} basePath={basePath} />
      </section>
    </div>
  );
}
