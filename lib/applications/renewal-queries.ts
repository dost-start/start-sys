// ─────────────────────────────────────────────────────────────────────────────
// Reads for the renewal review surface. Every read runs through the caller's own client:
// `renewal_submissions_read` (0018) decides the rows, 0044's column GRANT decides the
// columns, and `get_renewal_detail()` is the ONLY path to the body — it audits and asserts
// the confidentiality acknowledgement first (CBL Art. VIII §7.1).
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { err, mapDbError, ok, type ActionResult } from "@/lib/action-result";
import type { ActionContext } from "@/lib/auth/with-role";
import type { Enums } from "@/database.types";

import type { RenewalQueueStatus } from "./renewal-schema";

export type RenewalQueueRow = {
  id: string;
  status: Enums<"application_status">;
  submitted_at: string | null;
  created_at: string;
  reviewed_at: string | null;
  person: { member_id: string | null; given_name: string; family_name: string } | null;
};

/**
 * The renewal queue for the current term, newest submission first. `people` is joined on
 * its six GRANTed columns (0015) — name and member id, nothing sensitive.
 */
export async function listRenewals(
  ctx: ActionContext,
  status: RenewalQueueStatus | "all",
): Promise<RenewalQueueRow[]> {
  const { data: termId } = await ctx.supabase.rpc("current_term_id");
  if (!termId) return [];

  let query = ctx.supabase
    .from("renewal_submissions")
    .select(
      "id, status, submitted_at, created_at, reviewed_at, person:people!renewal_submissions_person_id_fkey(member_id, given_name, family_name)",
    )
    .eq("term_id", termId)
    .neq("status", "draft")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    status: row.status,
    submitted_at: row.submitted_at,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    person: row.person,
  }));
}

/** The audited full read. `not_found` for a row RLS hides or an id that does not exist. */
export async function getRenewalDetail(
  ctx: ActionContext,
  renewalId: string,
): Promise<ActionResult<Record<string, unknown>>> {
  const { data, error } = await ctx.supabase.rpc("get_renewal_detail", { p_id: renewalId });
  if (error) {
    const mapped = mapDbError(error);
    if (mapped.code === "unauthorized") return err<Record<string, unknown>>("not_found");
    return { ok: false, error: mapped };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return err<Record<string, unknown>>("not_found");
  }
  return ok(data as Record<string, unknown>);
}

/** Pending renewals this term — the dashboard tile's number, read under RLS. */
export async function countPendingRenewals(ctx: ActionContext): Promise<number> {
  const { data: termId } = await ctx.supabase.rpc("current_term_id");
  if (!termId) return 0;
  const { count } = await ctx.supabase
    .from("renewal_submissions")
    .select("id", { count: "exact", head: true })
    .eq("term_id", termId)
    .eq("status", "pending");
  return count ?? 0;
}
