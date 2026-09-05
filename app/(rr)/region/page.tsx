// ─────────────────────────────────────────────────────────────────────────────
// The Regional Representative dashboard (PRD item 14, US-F1, US-F2) — now with the
// contact roster the team asked for on 2026-09-05 (ADR 0011).
//
// Two surfaces on one page, two different mechanisms:
//   • headcounts — security_invoker aggregate views, region-scoped by the memberships
//     policy without a line of scoping code here (ADR 0008);
//   • the roster — `list_region_member_contacts()`, a SECURITY DEFINER read that is
//     regional_rep-only, own-region, current-term, acknowledgement-gated and audited per
//     call. When the acknowledgement is missing the RPC raises and this page says so in
//     words, with the CBL article; it never shows a half-populated table.
//
// Read-only by construction: no form posts here, no Server Action is imported. The only
// interactive control is a GET filter (university), which is a URL param — a filtered
// roster is a shareable link (PRD US-I3). `region_id` and `term_id` params are ignored:
// the RPC scopes by the caller's live role, and RLS would refuse anything else anyway.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { CountBarList, type CountBarRow } from "@/components/dashboard/count-bar-list";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { RegionContactsTable } from "@/components/dashboard/region-contacts-table";
import { StatTile } from "@/components/dashboard/stat-tile";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";
import {
  getCallerRegions,
  getCurrentTermId,
  getTermLabel,
  listRegionContacts,
  listRegionCounts,
  listRegionUniversities,
  listStatusCounts,
} from "@/lib/dashboard/queries";
import { zeroFillRegions, zeroFillStatuses } from "@/lib/dashboard/status-buckets";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUniversityFilter(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && UUID_RE.test(value) ? value : null;
}

export default async function RegionDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "regional_rep") redirect(homeForRole(ctx.role));

  const params = await searchParams;
  const universityId = readUniversityFilter(params.university_id);

  const termId = await getCurrentTermId(ctx);

  const [regions, statusRows, regionRows, termLabel] = await Promise.all([
    getCallerRegions(ctx),
    termId === null ? Promise.resolve([]) : listStatusCounts(ctx, termId),
    termId === null ? Promise.resolve([]) : listRegionCounts(ctx, termId),
    termId === null ? Promise.resolve(null) : getTermLabel(ctx, termId),
  ]);

  const [contacts, universities] = await Promise.all([
    termId === null
      ? Promise.resolve({ ok: true as const, rows: [] })
      : listRegionContacts(ctx, universityId),
    listRegionUniversities(
      ctx,
      regions.map((region) => region.id),
    ),
  ]);

  const statusBuckets = zeroFillStatuses(statusRows);
  const total = statusBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const regionBuckets = zeroFillRegions(regions, regionRows);
  const regionBars: CountBarRow[] = regionBuckets.map((bucket) => ({
    key: bucket.region_id,
    label: bucket.region_name,
    meta: bucket.island_group,
    value: bucket.count,
    href: null,
  }));

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
              <h2 className="text-sm font-medium text-muted-foreground">
                Scholars and contact details
              </h2>
              <span className="text-xs text-muted-foreground">
                {total.toLocaleString()} in {regions.length > 1 ? "your regions" : "your region"}
                {" · "}every view of this list is logged (CBL Art. VIII §6)
              </span>
            </div>

            {/* A GET form: the filter is the URL, so it is shareable and Back works. */}
            <form method="get" className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-sm">
                <span className="block text-xs font-medium text-muted-foreground">University</span>
                <select
                  name="university_id"
                  defaultValue={universityId ?? ""}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">All universities</option>
                  {universities.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                Filter
              </button>
              {universityId ? (
                <a href="/region" className="text-sm underline underline-offset-4">
                  Clear
                </a>
              ) : null}
            </form>

            {contacts.ok ? (
              <RegionContactsTable
                rows={contacts.rows}
                emptyMessage={
                  universityId
                    ? "No scholars in your region are recorded at that university this term."
                    : "No scholars are recorded in your region for the current term."
                }
              />
            ) : contacts.denial === "missing_acknowledgement" ? (
              <div
                role="alert"
                className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950"
              >
                <p className="font-medium">
                  Contact details are locked until your confidentiality acknowledgement is on file.
                </p>
                <p className="text-muted-foreground">
                  CBL Art. VIII §7.1 requires every officer — Regional Representatives included — to
                  sign the Confidentiality Agreement on assuming their role each term. An Executive
                  Admin records the acknowledgement; once it is on file for the current term this
                  roster shows names, member IDs, universities, emails, contact numbers and Facebook
                  links for your region. Headcounts above are unaffected.
                </p>
              </div>
            ) : (
              <DashboardEmptyState
                message="Contact details are not available."
                detail="Your account is not bound to a member record, so the acknowledgement cannot be recorded yet. Ask the CTO to link your account."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
