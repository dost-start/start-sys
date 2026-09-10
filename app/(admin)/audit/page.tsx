// The audit log (BUILD_PLAN S6-T19; PRD §3 v1.0 item 16, US-I1).
//
// The log has been written to by the `audit_row()` triggers since Day 1 and read by
// nothing. This is its surface — and both S2-T42's middleware-off crawl and S7-T28's QA
// sweep already assert against this route, so it was verified before it existed.
//
// ═══════════════════════════════════════════════════════════════════════════════
// AN UNREADABLE LOG RENDERS AS NOT-FOUND, NOT AS "FORBIDDEN"
// ═══════════════════════════════════════════════════════════════════════════════
// `audit_log_read` (0014 §1) names `exec_admin` and `tech_admin`. A crrd_admin or
// moderator reaching this route — both are in the admin group, so `canAccess` lets them
// through — gets an empty result from the policy, and this page turns that into
// `notFound()`. Never "you do not have permission": a 403 on a specific record confirms
// the record exists (CONVENTIONS.md §4.3), and consistency is what makes that habit
// hold.
//
// ⚠ EVERY FILTER LIVES IN THE URL, so a link to "every VIEW_DOCUMENT this week" is
// shareable and Back works (CONVENTIONS.md §2 — no `useState`, no client state library).
//
// ⚠ NO EXPORT AND NO DELETE CONTROL anywhere on this page. See the component headers.
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `audit_log`): the filter
// values are chips, still plain <a> links to the same hrefs; the page title lives in the
// shell's top bar, so the <h1> here is screen-reader-only.
import { notFound, redirect } from "next/navigation";

import { AuditLogTable } from "@/components/audit/audit-log-table";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";
import {
  canReadAuditLog,
  listAuditEntries,
  listAuditFacets,
  type AuditFilters,
} from "@/lib/audit/queries";

export const dynamic = "force-dynamic";

const AUDIT_PATH = "/audit";

/** First value for a key, trimmed; empty means "not set", never "invalid". */
function one(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parse the URL into filters.
 *
 * ⚠ TOTAL AND NON-THROWING, for the same reason `parseMemberFilters` is: a stale or
 * hand-edited link must degrade to the unfiltered log rather than 500 a page somebody is
 * opening during an incident. A malformed cursor is dropped, not rejected.
 */
function parseAuditFilters(params: Record<string, string | string[] | undefined>): AuditFilters {
  const rawCursor = one(params.cursor);
  const cursor = rawCursor !== null && /^\d+$/.test(rawCursor) ? Number(rawCursor) : null;

  return {
    operation: one(params.operation),
    table_name: one(params.table_name),
    actor_user_id: one(params.actor_user_id),
    cursor: cursor !== null && Number.isSafeInteger(cursor) ? cursor : null,
  };
}

/** The design canvas's `.chip` / `.chip.on`, as a link: the active value is the gradient pill. */
function chipClass(active: boolean): string {
  return active
    ? "bg-brand-gradient text-brand-ink inline-flex h-8 items-center rounded-full border border-transparent px-3 text-[13px] font-semibold no-underline"
    : "border-border bg-card text-brand-body hover:bg-brand-field inline-flex h-8 items-center rounded-full border px-3 text-[13px] no-underline transition-colors";
}

/** The design canvas's `.label`, for the word that names a filter row. */
const FILTER_LABEL_CLASS =
  "text-brand-label w-14 shrink-0 text-xs font-semibold tracking-[0.08em] uppercase";

/** Canonical link, defaults omitted — the same discipline as the member contract. */
function auditHref(filters: Partial<AuditFilters>, raw = false): string {
  const params = new URLSearchParams();
  // Deliberately NOT part of `AuditFilters`: it changes how rows are displayed, never
  // which rows are fetched, so it must not be able to reach the query builder.
  if (raw) params.set("raw", "1");
  if (filters.operation) params.set("operation", filters.operation);
  if (filters.table_name) params.set("table_name", filters.table_name);
  if (filters.actor_user_id) params.set("actor_user_id", filters.actor_user_id);
  if (filters.cursor !== null && filters.cursor !== undefined) {
    params.set("cursor", String(filters.cursor));
  }
  const query = params.toString();
  return query === "" ? AUDIT_PATH : `${AUDIT_PATH}?${query}`;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  // UX only. The policy refuses the SELECT independently — remove this line and the page
  // renders an empty log, which the `readable` flag below turns into the same 404.
  if (!canReadAuditLog(ctx.role)) {
    if (ctx.role === "crrd_admin") notFound();
    redirect(homeForRole(ctx.role));
  }

  const params = await searchParams;
  const filters = parseAuditFilters(params);
  const rawRows = one(params.raw) === "1";

  const [page, facets] = await Promise.all([listAuditEntries(ctx, filters), listAuditFacets(ctx)]);

  // The policy is the answer, not the tier list above: if it ever disagrees with
  // `canReadAuditLog`, this is the branch that holds.
  if (!page.readable) notFound();

  const hasFilters =
    filters.operation !== null || filters.table_name !== null || filters.actor_user_id !== null;

  // Filter links carry the OTHER filters but never the cursor: narrowing the set while
  // holding a cursor from the previous set would silently start you mid-way through a
  // list you have not seen the top of.
  const withOperation = (operation: string | null): string =>
    auditHref({ ...filters, operation, cursor: null });
  const withTable = (table_name: string | null): string =>
    auditHref({ ...filters, table_name, cursor: null });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="sr-only">Audit log</h1>
        <p className="text-brand-body max-w-3xl text-sm">
          Append-only. Sensitive values were masked before each entry was written, and there is no
          path to reveal them.
        </p>
      </header>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={FILTER_LABEL_CLASS}>Action</span>
          <a href={withOperation(null)} className={chipClass(filters.operation === null)}>
            All
          </a>
          {facets.operations.map((operation) => (
            <a
              key={operation}
              href={withOperation(operation)}
              className={chipClass(filters.operation === operation)}
            >
              {operation}
            </a>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={FILTER_LABEL_CLASS}>Table</span>
          <a href={withTable(null)} className={chipClass(filters.table_name === null)}>
            All
          </a>
          {facets.tables.map((table) => (
            <a
              key={table}
              href={withTable(table)}
              className={chipClass(filters.table_name === table)}
            >
              {table}
            </a>
          ))}
        </div>

        {filters.actor_user_id !== null ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={FILTER_LABEL_CLASS}>Actor</span>
            <span className="text-brand-body font-mono break-all">{filters.actor_user_id}</span>
            <a
              href={auditHref({ ...filters, actor_user_id: null, cursor: null })}
              className="text-brand-link underline underline-offset-2"
            >
              clear
            </a>
          </div>
        ) : null}

        {hasFilters ? (
          <a
            href={AUDIT_PATH}
            className="text-brand-link inline-block text-xs underline underline-offset-2"
          >
            Clear all filters
          </a>
        ) : null}
      </div>

      {/* Repeated reads by one actor are folded for READING only — nothing is written
          differently and nothing is dropped. One toggle away from the raw rows, because
          "the log is complete" has to stay verifiable by looking (QA ISSUE-008). */}
      <div className="flex items-center justify-end">
        <a
          href={auditHref({ ...filters, cursor: null }, !rawRows)}
          className="text-brand-link text-xs underline underline-offset-2"
        >
          {rawRows ? "Fold repeated views" : "Show every entry, unfolded"}
        </a>
      </div>

      <AuditLogTable entries={page.entries} collapseRepeats={!rawRows} />

      {/* Cursor pagination: forward only. An `offset` on a table receiving inserts while
          you page skips and repeats rows (lib/audit/queries.ts). */}
      {page.nextCursor !== null ? (
        <a
          href={auditHref({ ...filters, cursor: page.nextCursor }, rawRows)}
          className="text-brand-link inline-block text-sm font-medium underline-offset-2 hover:underline"
        >
          Older entries →
        </a>
      ) : null}
    </div>
  );
}
