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
// The admin roles reach this page too (`canAccess`'s officer case). They see the same
// columns, because the column set is the RPC's, not the page's.
import { redirect } from "next/navigation";

import { CountBarList, type CountBarRow } from "@/components/dashboard/count-bar-list";
import { DirectoryTable } from "@/components/dashboard/directory-table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";
import { regionTileHref, statusTileHref } from "@/lib/dashboard/links";
import {
  getCurrentTermId,
  getTermLabel,
  listRegionCounts,
  listRegions,
  listStatusCounts,
} from "@/lib/dashboard/queries";
import { zeroFillRegions, zeroFillStatuses } from "@/lib/dashboard/status-buckets";
import { parseMemberFilters } from "@/lib/members/filters";
import { listMemberDirectory } from "@/lib/members/queries";

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

  const termId = await getCurrentTermId(ctx);

  const [listResult, statusRows, regionRows, regions, termLabel] = await Promise.all([
    listMemberDirectory(ctx, filters),
    termId === null ? Promise.resolve([]) : listStatusCounts(ctx, termId),
    termId === null ? Promise.resolve([]) : listRegionCounts(ctx, termId),
    listRegions(ctx),
    termId === null ? Promise.resolve(null) : getTermLabel(ctx, termId),
  ]);

  const page = listResult.ok
    ? listResult.data
    : { rows: [], total: 0, page: filters.page, perPage: filters.per_page };

  const statusBuckets = zeroFillStatuses(statusRows);
  const regionBuckets = zeroFillRegions(regions, regionRows);

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
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Directory</h1>
        <p className="text-sm text-muted-foreground">
          {termLabel !== null ? `Term ${termLabel}` : "Current term"} · read-only
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Members by status</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Members by region</h2>
        <CountBarList rows={regionBars} emptyLabel="No regions are configured." />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Members</h2>
          <span className="text-xs text-muted-foreground">
            {page.total.toLocaleString()} matching · page {page.page}
          </span>
        </div>
        <DirectoryTable
          rows={page.rows}
          emptyMessage="No members match this view for the current term."
        />
      </section>
    </div>
  );
}
