// The Regional Representative dashboard (BUILD_PLAN S6-T12; PRD §3 v1.0 item 14,
// US-F1, US-F2).
//
// "As a Regional Representative, I can view scholars from my own region, so that I can
// support them" — and "Regional Representatives cannot delete or alter any record."
//
// ═══════════════════════════════════════════════════════════════════════════════
// THERE IS NO REGION FILTER IN THIS FILE. THAT IS NOT AN OVERSIGHT — IT IS THE POINT.
// ═══════════════════════════════════════════════════════════════════════════════
// The tiles read `security_invoker` views (0032) and the roster reads
// `search_member_directory()` (SECURITY INVOKER, 0030). Both are evaluated as the
// caller, so `memberships_read`'s regional branch — `region_id = any(auth_region_ids())`
// — is what scopes every number and every row on this page. A rep's totals are correct
// because THE DATABASE REFUSES TO COMPUTE ANYTHING ELSE.
//
// Writing `.eq('region_id', ctx.regionId)` here would look like belt and braces and be
// the opposite: a second authorization model that drifts from the first, silently, in
// the direction nobody notices. It would also be WRONG for a rep holding
// `rr_region_grants` rows, who legitimately sees more than their primary region.
// ADR 0007; 065_dashboard_views_rls.sql pins rep_a and rep_b to disjoint sets.
//
// ═══════════════════════════════════════════════════════════════════════════════
// READ-ONLY BY CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════════
// No form, no Server Action import, no status control — `grep -rn "use server|/actions"
// app/(rr)/` must return nothing. US-F2 is a MISSING POLICY (the rep tier holds no
// UPDATE policy on any table), and the UI must not imply a capability the database does
// not grant.
//
// ⚠ `?term_id=` AND `?region_id=` ARE DROPPED BEFORE THE QUERY IS BUILT. A rep tampering
// with either gets a byte-identical page. That is the UX half; the enforcement is that
// `search_member_directory()` forces `current_term_id()` for non-admin tiers and RLS
// refuses another region's rows regardless. Delete the stripping below and nothing leaks
// — it exists so a tampered URL is not merely refused but INERT.
//
// ⚠ NO SENSITIVE COLUMN. A regional rep reads the same six granted `people` columns an
// officer does (0015; PRD US-J1). The roster renders what the RPC returns and cannot
// widen it.
import { redirect } from "next/navigation";

import { CountBarList, type CountBarRow } from "@/components/dashboard/count-bar-list";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DirectoryTable } from "@/components/dashboard/directory-table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";
import {
  getCallerRegions,
  getCurrentTermId,
  getTermLabel,
  listRegionCounts,
  listStatusCounts,
} from "@/lib/dashboard/queries";
import { zeroFillRegions, zeroFillStatuses } from "@/lib/dashboard/status-buckets";
import { DEFAULT_MEMBER_FILTERS } from "@/lib/members/filters";
import { listMemberDirectory } from "@/lib/members/queries";

export const dynamic = "force-dynamic";

/** How many scholars the roster shows. Reps support tens, not thousands. */
const ROSTER_PAGE_SIZE = 100;

export default async function RegionDashboardPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "regional_rep") redirect(homeForRole(ctx.role));

  const termId = await getCurrentTermId(ctx);

  // ⚠ THE FILTERS ARE BUILT FROM THE CANONICAL DEFAULTS, NOT FROM `searchParams`. This
  // page takes no search params at all — which is why the component signature has none.
  // A `term_id` or `region_id` a rep appended to the URL therefore never reaches the
  // query: it is not read, so it cannot be forwarded.
  const filters = { ...DEFAULT_MEMBER_FILTERS, per_page: ROSTER_PAGE_SIZE };

  const [regions, statusRows, regionRows, listResult, termLabel] = await Promise.all([
    getCallerRegions(ctx),
    termId === null ? Promise.resolve([]) : listStatusCounts(ctx, termId),
    termId === null ? Promise.resolve([]) : listRegionCounts(ctx, termId),
    listMemberDirectory(ctx, filters),
    termId === null ? Promise.resolve(null) : getTermLabel(ctx, termId),
  ]);

  const statusBuckets = zeroFillStatuses(statusRows);
  const total = statusBuckets.reduce((sum, bucket) => sum + bucket.count, 0);

  // Zero-filled against the rep's OWN regions only. Filling all 18 would imply an
  // org-wide panel that happens to be empty; the counts are scoped either way
  // (status-buckets.ts).
  const regionBuckets = zeroFillRegions(regions, regionRows);

  const regionBars: CountBarRow[] = regionBuckets.map((bucket) => ({
    key: bucket.region_id,
    label: bucket.region_name,
    meta: bucket.island_group,
    value: bucket.count,
    // ⚠ NO LINK. There is no scoped member-list surface for this tier — `/region` is one
    // page. A tile linking to `/members` or `/directory` would be bounced home by
    // `canAccess`, which reads as a broken session (links.ts: `dashboardBase` has no
    // `rr` member, so writing one is a compile error rather than a dead link).
    href: null,
  }));

  const page = listResult.ok
    ? listResult.data
    : { rows: [], total: 0, page: 1, perPage: ROSTER_PAGE_SIZE };

  // Multi-region reps exist: `rr_region_grants` adds regions beyond the primary (0009).
  const regionNames =
    regions.length === 0 ? "your region" : regions.map((region) => region.name).join(", ");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{regionNames}</h1>
        <p className="text-sm text-muted-foreground">
          {termLabel !== null ? `Term ${termLabel}` : "Current term"} · read-only
        </p>
      </div>

      {termId === null ? (
        <DashboardEmptyState
          message="No active term."
          detail="Membership records are scoped to a term, so there is nothing to show yet."
        />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Scholars by status</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {statusBuckets.map((bucket) => (
                <StatTile key={bucket.status} label={bucket.label} value={bucket.count} />
              ))}
            </div>
          </section>

          {regionBuckets.length > 1 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">By region</h2>
              <CountBarList rows={regionBars} />
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">Scholars</h2>
              <span className="text-xs text-muted-foreground">
                {total.toLocaleString()} in {regions.length > 1 ? "your regions" : "your region"}
              </span>
            </div>
            <DirectoryTable
              rows={page.rows}
              showRegion={regions.length > 1}
              emptyMessage="No scholars are recorded in your region for the current term."
            />
            {page.total > page.rows.length ? (
              <p className="text-xs text-muted-foreground">
                Showing the first {page.rows.length.toLocaleString()} of{" "}
                {page.total.toLocaleString()}.
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
