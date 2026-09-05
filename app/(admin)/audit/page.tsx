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

/** Canonical link, defaults omitted — the same discipline as the member contract. */
function auditHref(filters: Partial<AuditFilters>): string {
  const params = new URLSearchParams();
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
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Append-only. Sensitive values were masked before each entry was written, and there is no
          path to reveal them.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Action</span>
          <a
            href={withOperation(null)}
            className={filters.operation === null ? "text-xs underline" : "text-xs opacity-70"}
          >
            All
          </a>
          {facets.operations.map((operation) => (
            <a
              key={operation}
              href={withOperation(operation)}
              className={
                filters.operation === operation ? "text-xs underline" : "text-xs opacity-70"
              }
            >
              {operation}
            </a>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Table</span>
          <a
            href={withTable(null)}
            className={filters.table_name === null ? "text-xs underline" : "text-xs opacity-70"}
          >
            All
          </a>
          {facets.tables.map((table) => (
            <a
              key={table}
              href={withTable(table)}
              className={filters.table_name === table ? "text-xs underline" : "text-xs opacity-70"}
            >
              {table}
            </a>
          ))}
        </div>

        {filters.actor_user_id !== null ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Actor</span>
            <span className="font-mono break-all">{filters.actor_user_id}</span>
            <a
              href={auditHref({ ...filters, actor_user_id: null, cursor: null })}
              className="underline"
            >
              clear
            </a>
          </div>
        ) : null}

        {hasFilters ? (
          <a href={AUDIT_PATH} className="inline-block text-xs underline">
            Clear all filters
          </a>
        ) : null}
      </div>

      <AuditLogTable entries={page.entries} />

      {/* Cursor pagination: forward only. An `offset` on a table receiving inserts while
          you page skips and repeats rows (lib/audit/queries.ts). */}
      {page.nextCursor !== null ? (
        <a
          href={auditHref({ ...filters, cursor: page.nextCursor })}
          className="inline-block text-sm underline"
        >
          Older entries →
        </a>
      ) : null}
    </div>
  );
}
