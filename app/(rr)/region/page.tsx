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
//
// Brand edition (2026-09-08): the shell's top bar says "Region", so this page keeps a
// VISIBLE `<h1>` naming the rep's region(s); the tiles are plain (unlinked) cards and
// the roster sits in a full-bleed card, per docs/design/canvas/boards_other.py.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { CountBarList, type CountBarRow } from "@/components/dashboard/count-bar-list";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DirectoryTable } from "@/components/dashboard/directory-table";
import { RegionContactsTable } from "@/components/dashboard/region-contacts-table";
import { SectionEyebrow } from "@/components/dashboard/section-eyebrow";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
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
import { DEFAULT_MEMBER_FILTERS } from "@/lib/members/filters";
import { listMemberDirectory } from "@/lib/members/queries";

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

  // The name-only roster (v_member_directory, RLS-scoped, no contact columns) is what a
  // rep sees while the contact read is refused — the region list itself is never locked,
  // only the contact details are (ADR 0011).
  const fallbackRoster =
    contacts.ok || termId === null
      ? null
      : await listMemberDirectory(ctx, { ...DEFAULT_MEMBER_FILTERS, per_page: 100 });
  const fallbackRows = fallbackRoster?.ok ? fallbackRoster.data.rows : [];

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
    <div className="space-y-7">
      <div className="space-y-1">
        <h1 className="text-brand-ink text-[26px] leading-tight font-semibold">{regionNames}</h1>
        <p className="text-brand-body text-sm">
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
            <SectionEyebrow>Scholars by status</SectionEyebrow>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {statusBuckets.map((bucket) => (
                <StatTile key={bucket.status} label={bucket.label} value={bucket.count} />
              ))}
            </div>
          </section>

          {regionBuckets.length > 1 ? (
            <Card className="gap-4 p-5 sm:p-6">
              <SectionEyebrow>By region</SectionEyebrow>
              <CountBarList rows={regionBars} />
            </Card>
          ) : null}

          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionEyebrow>Scholars and contact details</SectionEyebrow>
              <span className="text-brand-label text-xs">
                {total.toLocaleString()} in {regions.length > 1 ? "your regions" : "your region"}
                {" · "}every view of this list is logged (CBL Art. VIII §6)
              </span>
            </div>

            {/* A GET form: the filter is the URL, so it is shareable and Back works. */}
            <form method="get" className="flex flex-wrap items-end gap-3">
              <Field className="w-full sm:w-80">
                <FieldLabel htmlFor="university_id">University</FieldLabel>
                <NativeSelect
                  id="university_id"
                  name="university_id"
                  defaultValue={universityId ?? ""}
                  className="h-9 px-3 text-[13px]"
                >
                  <option value="">All universities</option>
                  {universities.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Button variant="outline" size="sm" type="submit">
                Filter
              </Button>
              {universityId ? (
                <a
                  href="/region"
                  className="text-brand-link h-9 text-sm leading-9 underline underline-offset-4"
                >
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
              <>
                <Alert variant="warning" role="alert">
                  <div className="space-y-1">
                    <p className="font-semibold">
                      Contact details are locked until your confidentiality acknowledgement is on
                      file.
                    </p>
                    <p>
                      CBL Art. VIII §7.1 requires every officer — Regional Representatives included
                      — to sign the Confidentiality Agreement on assuming their role each term. An
                      Executive Admin records the acknowledgement; once it is on file for the
                      current term this roster shows names, member IDs, universities, emails,
                      contact numbers and Facebook links for your region. Headcounts above are
                      unaffected.
                    </p>
                  </div>
                </Alert>
                <DirectoryTable
                  rows={fallbackRows}
                  showRegion={regions.length > 1}
                  emptyMessage="No scholars are recorded in your region for the current term."
                />
              </>
            ) : (
              <>
                <DashboardEmptyState
                  message="Contact details are not available."
                  detail="Your account is not bound to a member record, so the acknowledgement cannot be recorded yet. Ask the CTO to link your account."
                />
                <DirectoryTable
                  rows={fallbackRows}
                  showRegion={regions.length > 1}
                  emptyMessage="No scholars are recorded in your region for the current term."
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
