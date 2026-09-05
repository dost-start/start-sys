// The application review queue (BUILD_PLAN S4-T18; PRD US-C1, v1.0 item 8).
//
// Server Component. `searchParams` is parsed through `applicationListFiltersSchema`
// (CONVENTIONS.md §2 — filter/sort/pagination state lives in the URL, never in
// `useState`), so `listApplications` sees the SAME filters a shared link would
// reproduce. Only the columns the queue renders are ever selected — see the
// `QUEUE_COLUMNS` note in `lib/applications/queries.ts`; `applicant_email` and
// `payload` never reach this page, so they cannot reach the client bundle either.
//
// Access is enforced twice, independently: `applications_read` (0008/0014) refuses
// the SELECT for anyone outside exec_admin/crrd_admin/moderator, and this page's own
// `getSessionContext()` redirects a signed-out visitor. `(admin)/layout.tsx` is a third,
// UX-only layer. Delete any two of the three and the third still holds.
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApplicationsTable } from "@/components/applications/applications-table";
import { ApproveAllDialog } from "@/components/applications/approve-all-dialog";
import type { Database } from "@/database.types";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";
import {
  countPendingApplications,
  listApplications,
  listPendingStandards,
} from "@/lib/applications/queries";
import { parseApplicationListFilters } from "@/lib/applications/schema";

export const dynamic = "force-dynamic";

/** The three reviewer tiers. Everyone else — including tech_admin, per OQ-5 — is bounced. */
const REVIEWER_ROLES = new Set(["exec_admin", "crrd_admin"]);

/**
 * The term selector's option list.
 *
 * A plain `terms` read: `terms_read` (0014) grants SELECT to every authenticated role,
 * so this needs no RPC and no extra guard. Newest first, so "this term" is always the
 * top option — the same convention the admin dashboard will use.
 */
async function listTermOptions(supabase: SupabaseClient<Database>) {
  const { data } = await supabase
    .from("terms")
    .select("id, label")
    .order("starts_on", { ascending: false });
  return data ?? [];
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!REVIEWER_ROLES.has(ctx.role)) redirect(homeForRole(ctx.role));

  const rawParams = await searchParams;
  const filters = parseApplicationListFilters(rawParams);

  const [listResult, pendingCount, terms, standardsFailures] = await Promise.all([
    listApplications(ctx, filters),
    countPendingApplications(ctx),
    listTermOptions(ctx.supabase),
    // ADR 0013 §2 — the queue's "meets standards" flag, exec_admin/crrd_admin only,
    // same two tiers `REVIEWER_ROLES` above already gates this whole page to.
    listPendingStandards(ctx),
  ]);

  // `listApplications` only fails when `current_term_id()` cannot resolve a fallback
  // term (no active term at all) — an operational state, not a permission denial, so
  // it renders as an empty queue with an explanation rather than a crash.
  const page = listResult.ok
    ? listResult.data
    : {
        rows: [],
        total: 0,
        page: 1,
        perPage: filters.per_page,
        termId: filters.term_id ?? "",
        status: filters.status ?? null,
      };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Applications</h1>
          <p className="text-sm text-muted-foreground">
            {pendingCount} pending decision{pendingCount === 1 ? "" : "s"} this term.
          </p>
        </div>
        {/* Both roles able to reach this render are already exec_admin/crrd_admin —
            REVIEWER_ROLES above already redirected everyone else — so no second role
            check is needed here (ADR 0013 §2's guard is the SQL function's own). */}
        {pendingCount > 0 ? <ApproveAllDialog /> : null}
      </div>

      {!listResult.ok ? (
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          No active term is open, so there is nothing to review yet.
        </p>
      ) : (
        <ApplicationsTable
          page={page}
          filters={filters}
          terms={terms}
          standardsFailures={standardsFailures}
        />
      )}
    </div>
  );
}
