// Reads for the audit log surface (BUILD_PLAN S6-T19; PRD §3 v1.0 item 16, US-I1).
//
// "As an Executive or Technical Admin, I can see who changed what and when, so that
// record changes are attributable." The log has been written to since Day 1 by the
// `audit_row()` triggers and until now nothing read it.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE AUTHORIZATION IS ONE POLICY, AND THIS FILE ADDS NOTHING TO IT
// ═══════════════════════════════════════════════════════════════════════════════
// `audit_log_read` (0014 §1) names `exec_admin` and `tech_admin` and nobody else. Every
// read here goes through the caller's own client, so a crrd_admin, moderator, officer,
// regional rep or member gets an EMPTY ARRAY — not an error, not a partial view. The
// page renders that emptiness as not-found. 068_audit_read_matrix.sql pins the exact row
// counts for all nine fixtures against a POPULATED log, because S2-T15 asserted the same
// policy against an empty table where a broken policy and a correct one look identical.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ `old_data` / `new_data` ARRIVE ALREADY MASKED, AND THERE IS NO UN-MASKING PATH
// ═══════════════════════════════════════════════════════════════════════════════
// `mask_sensitive()` replaced every column registered in `sensitive_column_registry`
// with a redaction marker BEFORE the row was written (DATA_MODEL.md §8.3). The log
// therefore holds no PII — which is precisely what lets it be append-only AND survive
// the five-year purge, because the purge has nothing to reach into it for.
//
// So: this module NEVER joins back to `people`, never resolves a `row_id` to a name, and
// never re-reads a masked value from its source table. A "helpful" join that put the
// contact number back next to the entry recording its change would undo the whole
// design and put PII in a surface with no retention story.
//
// ⚠ NO EXPORT AND NO DELETE. `REVOKE UPDATE, DELETE` at the GRANT level plus the absence
// of any such policy means not even the CEO can rewrite history from the app. An export
// button would be a second PII-adjacent surface with its own audit question; it is
// deliberately absent (S6-T19).
//
// ⚠ CURSOR PAGINATION, NOT OFFSET. The table reaches ~20,000 rows in the S7-T18 load
// fixture and grows monotonically. `offset` on a table receiving inserts while you page
// SKIPS AND REPEATS rows; a keyset cursor on `(created_at, id)` — both of which the
// composite index covers — does not.
//
// CITATION: BUILD_PLAN S6-T19, S6-T20; PRD §3 v1.0 item 16, US-I1;
//           DATA_MODEL.md §8.3, §10; ARCHITECTURE.md §8 (History NFR); CONVENTIONS.md §4.3.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import type { Tables } from "@/database.types";
import type { ActionContext } from "@/lib/auth/with-role";

/** One entry, exactly the columns the table renders. Never `select('*')`. */
export type AuditEntry = Pick<
  Tables<"audit_log">,
  | "id"
  | "created_at"
  | "actor_user_id"
  | "actor_role"
  | "table_name"
  | "row_id"
  | "operation"
  | "old_data"
  | "new_data"
  | "note"
>;

const AUDIT_COLUMNS =
  "id, created_at, actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note";

/** Page size. Enough to scan a morning's activity without a 20,000-row payload. */
export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = {
  /** `INSERT` | `UPDATE` | `VIEW_DOCUMENT` | `ROLLOVER` | … Free text: `operation` is text. */
  operation: string | null;
  /** The audited table, e.g. `memberships`. */
  table_name: string | null;
  /** `auth.users.id` of the acting account. */
  actor_user_id: string | null;
  /**
   * Keyset cursor: the `id` of the last row on the previous page.
   *
   * `id` alone is sufficient and is used instead of a `(created_at, id)` pair because
   * `audit_log.id` is a monotonically increasing `bigserial` — so "older than this row"
   * is exactly `id < cursor`, and the newest-first ordering the page wants is the same
   * ordering. The composite index still serves it.
   */
  cursor: number | null;
};

export const DEFAULT_AUDIT_FILTERS: AuditFilters = Object.freeze({
  operation: null,
  table_name: null,
  actor_user_id: null,
  cursor: null,
});

export type AuditPage = {
  entries: AuditEntry[];
  /** The cursor for the next page, or `null` when this is the last one. */
  nextCursor: number | null;
  /**
   * Whether the caller can read the log AT ALL.
   *
   * ⚠ DISTINGUISHED FROM "no entries matched" ON PURPOSE, and the distinction is safe
   * to make because it is a fact about the CALLER, not about a record. A tier that
   * cannot read the log gets the not-found page; an exec_admin whose filter matched
   * nothing gets an empty table with their filters still visible, so they can widen
   * them instead of concluding the log is broken.
   */
  readable: boolean;
};

const EMPTY_PAGE: AuditPage = { entries: [], nextCursor: null, readable: false };

/**
 * Can this caller read the log?
 *
 * The tier list mirrors `audit_log_read` (0014). It is UX: the policy refuses the SELECT
 * independently, and if the two ever disagree the POLICY is the answer and this constant
 * is the bug (lib/auth/with-role.ts).
 */
export function canReadAuditLog(role: ActionContext["role"]): boolean {
  return role === "exec_admin" || role === "tech_admin";
}

/**
 * One page of the audit log, newest first (PRD US-I1).
 *
 * Fetches `AUDIT_PAGE_SIZE + 1` rows and returns at most `AUDIT_PAGE_SIZE`: the extra
 * row is how "is there a next page?" is answered without a second count query against a
 * table whose whole purpose is to grow.
 */
export async function listAuditEntries(
  ctx: ActionContext,
  filters: AuditFilters,
): Promise<AuditPage> {
  if (!canReadAuditLog(ctx.role)) return EMPTY_PAGE;

  let query = ctx.supabase
    .from("audit_log")
    .select(AUDIT_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AUDIT_PAGE_SIZE + 1);

  if (filters.operation !== null) query = query.eq("operation", filters.operation);
  if (filters.table_name !== null) query = query.eq("table_name", filters.table_name);
  if (filters.actor_user_id !== null) query = query.eq("actor_user_id", filters.actor_user_id);
  if (filters.cursor !== null) query = query.lt("id", filters.cursor);

  const { data, error } = await query;

  // An error here is a transport or shape failure, not a denial — a denial is an empty
  // array (ARCHITECTURE.md §9). Nothing is logged: `no-console` is an error under
  // `lib/**`, and a raw PostgREST error can carry a value in `details`.
  if (error || !data) return { entries: [], nextCursor: null, readable: true };

  const rows = data as AuditEntry[];
  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const entries = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;
  const last = entries.at(-1);

  return {
    entries,
    nextCursor: hasMore && last !== undefined ? last.id : null,
    readable: true,
  };
}

/**
 * The distinct values the filter controls offer.
 *
 * ⚠ DERIVED FROM THE LOG ITSELF, not from a hand-kept list of table names and
 * operations. `operation` gains synthetic values over time (`VIEW_DOCUMENT`,
 * `VIEW_RECORD`, `ROLLOVER`, `PURGE`) and the audited-table list grows with the schema;
 * a literal here would silently stop offering whichever one was added last.
 *
 * Scanned from a recent window rather than the whole table, because `select distinct` is
 * not expressible in PostgREST and a full scan of 20,000 rows to populate a dropdown is
 * a third of the page's latency budget. A value that has not occurred recently is not
 * offered — which is a real limitation, stated rather than hidden, and the URL still
 * accepts it if typed.
 */
export async function listAuditFacets(
  ctx: ActionContext,
): Promise<{ operations: string[]; tables: string[] }> {
  if (!canReadAuditLog(ctx.role)) return { operations: [], tables: [] };

  const { data, error } = await ctx.supabase
    .from("audit_log")
    .select("operation, table_name")
    .order("id", { ascending: false })
    .limit(1000);

  if (error || !data) return { operations: [], tables: [] };

  const operations = new Set<string>();
  const tables = new Set<string>();
  for (const row of data) {
    operations.add(row.operation);
    tables.add(row.table_name);
  }

  return {
    operations: [...operations].sort(),
    tables: [...tables].sort(),
  };
}
