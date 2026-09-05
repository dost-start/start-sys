// The admin dashboard (BUILD_PLAN S6-T9; PRD §3 v1.0 item 13, US-D4).
//
// "As an Administrator, I see an overview of the organization on login, so that I can
// assess the org at a glance" — headcount by status, by region and by committee, plus
// the pending-application count, with EVERY NUMBER LINKING THROUGH to the filtered list
// that produced it.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THERE IS NO ROLE CHECK ON THE NUMBERS, AND THAT IS THE DESIGN
// ═══════════════════════════════════════════════════════════════════════════════
// The three aggregates are `security_invoker` views (0032), so `memberships_read` runs
// for the CALLER. This page therefore contains not one line about who may see what: an
// exec_admin gets org-wide totals, a `tech_admin` who reached here would get zeros
// (their role is not named in `memberships_read` — which is why `homeForRole` sends the
// CTO to `/system` instead), and a regional rep never arrives at all because
// `canAccess` and `middleware.ts` both refuse the admin group. Adding a filter here
// would be a second authorization model, which is exactly what ADR 0007 forbids.
//
// ⚠ `?term_id=` IS PASSED STRAIGHT THROUGH, DELIBERATELY UNVALIDATED BEYOND ITS SHAPE.
// This is the ONE route that accepts an explicit term (PRD US-H3, historical retrieval).
// It is not checked against the caller's tier here because RLS is what refuses a term
// they may not read — the aggregates would simply return nothing, and the page would
// render honest zeros. A role check here would duplicate the boundary and could only
// ever drift from it.
//
// All four reads run concurrently: four sequential round trips to Singapore is a third
// of the 3-second budget spent on a dashboard (PRD Performance NFR, Success Metric 4).
import { redirect } from "next/navigation";

import { CountBarList, type CountBarRow } from "@/components/dashboard/count-bar-list";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { StatTile } from "@/components/dashboard/stat-tile";
import { countPendingApplications } from "@/lib/applications/queries";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";
import {
  allMembersHref,
  committeeTileHref,
  pendingApplicationsHref,
  regionTileHref,
  statusTileHref,
} from "@/lib/dashboard/links";
import {
  getCurrentTermId,
  getTermLabel,
  listCommitteeCounts,
  listRegionCounts,
  listRegions,
  listStatusCounts,
} from "@/lib/dashboard/queries";
import {
  toCommitteeBuckets,
  totalFromStatuses,
  zeroFillRegions,
  zeroFillStatuses,
} from "@/lib/dashboard/status-buckets";

// Headcounts must never be served from a cache: a status change made thirty seconds ago
// has to be on this screen, and a stale dashboard is how an officer double-approves.
export const dynamic = "force-dynamic";

/** A uuid, or null. The only shape validation `?term_id=` gets — RLS does the rest. */
function readTermParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // UX and defence in depth. `middleware.ts` and `(admin)/layout.tsx` already refused a
  // non-admin caller; the boundary is RLS beneath all three.
  if (!["exec_admin", "crrd_admin"].includes(ctx.role)) {
    redirect(homeForRole(ctx.role));
  }

  const params = await searchParams;
  const requestedTerm = readTermParam(params.term_id);
  const termId = requestedTerm ?? (await getCurrentTermId(ctx));

  // No active term at all is an operational state (before the first rollover, or between
  // one and the next), not a permission denial. It renders as an explained empty page.
  if (termId === null) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <DashboardEmptyState
          message="No active term."
          detail="A Technical Admin opens a term before any membership record can exist."
        />
      </div>
    );
  }

  const [statusRows, regionRows, committeeRows, regions, pendingCount, termLabel] =
    await Promise.all([
      listStatusCounts(ctx, termId),
      listRegionCounts(ctx, termId),
      listCommitteeCounts(ctx, termId),
      listRegions(ctx),
      countPendingApplications(ctx),
      getTermLabel(ctx, termId),
    ]);

  const statusBuckets = zeroFillStatuses(statusRows);
  const total = totalFromStatuses(statusBuckets);
  const regionBuckets = zeroFillRegions(regions, regionRows);
  const committeeBuckets = toCommitteeBuckets(committeeRows);

  const regionBars: CountBarRow[] = regionBuckets.map((bucket) => ({
    key: bucket.region_id,
    label: bucket.region_name,
    meta: bucket.island_group,
    value: bucket.count,
    href: regionTileHref("admin", termId, bucket.region_id),
  }));

  const committeeBars: CountBarRow[] = committeeBuckets.map((bucket) => ({
    // The unassigned bucket has no uuid; a fixed sentinel keeps the React key stable.
    key: bucket.committee_id ?? "__unassigned__",
    label: bucket.committee_name,
    value: bucket.count,
    href: committeeTileHref("admin", termId, bucket.committee_id),
  }));

  const isHistorical = requestedTerm !== null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          {/* The term is always named. "Current term" is ambiguous the week either side
              of a rollover, which is precisely when someone is looking. */}
          <p className="text-sm text-muted-foreground">
            {termLabel !== null ? `Term ${termLabel}` : "Selected term"}
            {isHistorical ? " · viewing a term you selected" : null}
          </p>
        </div>
        <a href={allMembersHref("admin", termId)} className="text-sm underline">
          All members ({total.toLocaleString()})
        </a>
      </div>

      {/* ── Pending applications ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Applications</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Pending review"
            value={pendingCount}
            href={pendingApplicationsHref()}
            emphasis
            hint="Awaiting a decision"
          />
        </div>
      </section>

      {/* ── Headcount by status ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Members by status</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {statusBuckets.map((bucket) => (
            <StatTile
              key={bucket.status}
              label={bucket.label}
              value={bucket.count}
              href={statusTileHref("admin", termId, bucket.status)}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ── Headcount by region ────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Members by region</h2>
          <CountBarList rows={regionBars} emptyLabel="No regions are configured for this term." />
        </section>

        {/* ── Headcount by committee ─────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Members by committee</h2>
          <CountBarList
            rows={committeeBars}
            emptyLabel="No committees have been created for this term."
          />
          {/* ⚠ THE CAPTION IS PART OF THE ACCEPTANCE CRITERIA, NOT DECORATION.
              CBL Art. III §5 places no limit on committee seats, so a scholar on two
              committees is counted under each and this panel totals to MORE than the
              headcount. A visible non-sum documents itself; the alternative — picking one
              committee per member — silently understates every roster and produces a page
              where nothing looks wrong (ADR 0007 §4). */}
          <p className="text-xs text-muted-foreground">
            A member may serve on more than one committee (CBL Art. III §5), so these figures do not
            add up to the term&rsquo;s headcount. &ldquo;No committee&rdquo; counts members with no
            committee seat and is not filterable.
          </p>
        </section>
      </div>
    </div>
  );
}
