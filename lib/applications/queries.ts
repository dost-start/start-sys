// ─────────────────────────────────────────────────────────────────────────────
// Reads for the application feature.
//
// ⚠ SCOPE: this module holds the ONE read the PUBLIC portal needs. The reviewer reads —
// `listApplications`, `getApplicationDetail`, `countPendingApplications`, `getProofRef` —
// belong to S4-T14 and land in this same file then. They are deliberately absent now
// rather than stubbed: a stub reads as coverage that does not exist, and `applications`
// currently has no reviewer-facing column GRANT anyway (0008's header hands that to
// S4-T4's 0027_applications_review_grants.sql).
//
// Every read here goes through the caller's own client. On `/apply` that caller holds no
// session, so the statement runs as the `anon` database role and the anon policies are
// what decide the answer.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import type { ActionResult } from "@/lib/action-result";
import { err, mapDbError, ok } from "@/lib/action-result";
import type { ApplicationListFilters, ApplicationQueueStatus } from "@/lib/applications/schema";
import type { ActionContext } from "@/lib/auth/with-role";
import { createServerSupabase } from "@/lib/supabase/server";

export type PublicWindowState = {
  /** Whether the membership-application form may be submitted right now. */
  open: boolean;
  /** `opens_at` of the open window, or `null`. See the note below about closed windows. */
  opensAt: string | null;
  /** `closes_at` of the open window, or `null`. */
  closesAt: string | null;
};

const CLOSED: PublicWindowState = { open: false, opensAt: null, closesAt: null };

/**
 * Is the public application period open, and until when? (PRD US-B4, item 5.)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * A DELIBERATE LIMITATION, STATED SO IT IS NOT DEBUGGED AS A BUG
 * ═══════════════════════════════════════════════════════════════════════════════
 * `application_windows_read_anon` (0014) is `using (now() between opens_at and
 * closes_at)`. An anonymous visitor can therefore see a window ONLY WHILE IT IS OPEN.
 * When the period is closed this function returns `{ open: false, null, null }` and
 * genuinely cannot say when applications next open — the row exists but anon cannot
 * read it.
 *
 * That is the correct trade and it must not be "fixed" by widening the anon policy:
 * that same policy is EXISTS-checked from inside the anon INSERT policy on
 * `applications`, so widening it would make a bookmarked `/apply` link submittable
 * outside the period. If the closed-state screen must announce a future opening date,
 * the answer is a separate, deliberately-published value — not a wider read.
 *
 * The open/closed decision is a DATABASE FACT either way. This function drives what the
 * page renders; the policy is what refuses the write (ARCHITECTURE.md §5 — the hidden
 * link is never the enforcement).
 */
export async function getPublicWindowState(
  formKind: "membership_application" | "membership_renewal" = "membership_application",
): Promise<PublicWindowState> {
  const supabase = await createServerSupabase();

  const { data: termId, error: termError } = await supabase.rpc("current_term_id");
  if (termError || !termId) return CLOSED;

  const { data, error } = await supabase
    .from("application_windows")
    .select("opens_at, closes_at")
    .eq("term_id", termId)
    .eq("form_kind", formKind)
    .maybeSingle();

  // An RLS-filtered empty result is an ordinary outcome here, not an error: it is
  // exactly what "the period is closed" looks like to an anonymous caller.
  if (error || !data) return CLOSED;

  // Compare the timestamps HERE too, not only in the policy: a SIGNED-IN visitor to
  // /apply reads through `application_windows_read` (authenticated, `using (true)`),
  // so row presence alone would render an open form for a closed or scheduled window
  // and the eventual INSERT would fail confusingly. The anon policy stays the
  // enforcement; this is the page telling the truth.
  const now = Date.now();
  const isOpen = Date.parse(data.opens_at) <= now && now < Date.parse(data.closes_at);
  if (!isOpen) return CLOSED;

  return { open: true, opensAt: data.opens_at, closesAt: data.closes_at };
}

// ═════════════════════════════════════════════════════════════════════════════
// S4 — THE REVIEWER READS (BUILD_PLAN S4-T14)
// ═════════════════════════════════════════════════════════════════════════════
// Four functions, all through the CALLER'S OWN client (`ctx.supabase`), never a new
// one and never the service-role client. That is the whole authorization story:
// `applications_read` (0008) decides which rows come back and `0027`'s column GRANT
// decides which columns, and this module adds nothing on top of either.
//
// ⚠ TWO COLUMNS ARE UNREACHABLE FROM HERE, ON PURPOSE.
//   `applicant_email` and `payload` are withheld from every session role by 0027 and
//   readable only through `get_application_detail()` (0026), which writes an audit row
//   and asserts a current-term confidentiality acknowledgement first (CBL Art. VIII
//   §7.1). If a screen needs a field out of the payload, it calls the RPC and accepts
//   the audit row. It does NOT get added to the SELECT list below, and the GRANT is
//   never widened to make that work (CLAUDE.md "Banned patterns").
//
//   `proof_web_view_link` is not granted at all: a provider URL must never reach a
//   browser (PRD US-J2). Documents are served by the proxy route.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The columns the queue renders — a subset of the fifteen 0027 grants.
 *
 * Written as one frozen string because PostgREST takes it verbatim, and because
 * `select("*")` on this table would silently start returning whatever a future
 * migration adds. An explicit list makes a new column a deliberate decision.
 */
const QUEUE_COLUMNS =
  "id, term_id, status, applicant_given_name, applicant_family_name, " +
  "proof_mime_type, proof_size_bytes, proof_verified_at, " +
  "person_id, reviewed_by, reviewed_at, review_note, submitted_at, created_at";

export type ApplicationListRow = {
  id: string;
  term_id: string;
  status: "draft" | "pending" | "approved" | "rejected";
  applicant_given_name: string;
  applicant_family_name: string;
  proof_mime_type: string | null;
  proof_size_bytes: number | null;
  proof_verified_at: string | null;
  person_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  submitted_at: string | null;
  created_at: string;
};

export type ApplicationListPage = {
  rows: ApplicationListRow[];
  /** PostgREST's exact count for the filtered set — an honest total, not an estimate. */
  total: number;
  page: number;
  perPage: number;
  /** The term actually queried, after the server-side default. Rendered in the header. */
  termId: string;
  /** Whether `status` was applied, so the UI can show the right empty state. */
  status: ApplicationQueueStatus | null;
};

/**
 * List applications for the review queue (PRD US-C1, v1.0 item 8).
 *
 * ⚠ THE TERM IS RESOLVED SERVER-SIDE. `filters.term_id` is honoured only because every
 * role that can read this table at all is a reviewer role — `applications_read` names
 * exec_admin, crrd_admin and moderator and nobody else, so there is no tier here whose
 * history access needs narrowing (unlike the member grid, where S5-T5 must gate the
 * parameter by role). An absent or unreadable term falls back to `current_term_id()`,
 * so a stale link shows this term rather than nothing.
 *
 * Ordering is `submitted_at` with `id` as a deterministic tiebreak. Without the
 * tiebreak two rows submitted in the same millisecond can swap between page 1 and
 * page 2, which shows one application twice and hides another entirely — a paging bug
 * that looks like a data bug.
 *
 * `nullsFirst: false` keeps drafts (no `submitted_at`) at the end rather than at the
 * top of the queue on a descending sort.
 */
export async function listApplications(
  ctx: ActionContext,
  filters: ApplicationListFilters,
): Promise<ActionResult<ApplicationListPage>> {
  let termId = filters.term_id ?? null;

  if (termId === null) {
    const { data, error } = await ctx.supabase.rpc("current_term_id");
    if (error || !data) return err<ApplicationListPage>("not_found");
    termId = data;
  }

  const ascending = filters.sort === "submitted_at.asc";
  const from = (filters.page - 1) * filters.per_page;
  const to = from + filters.per_page - 1;

  let query = ctx.supabase
    .from("applications")
    .select(QUEUE_COLUMNS, { count: "exact" })
    .eq("term_id", termId);

  if (filters.status !== undefined) query = query.eq("status", filters.status);

  const { data, error, count } = await query
    .order("submitted_at", { ascending, nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, to);

  // An RLS-filtered read returns an empty array, not an error — a non-reviewer role
  // gets `{ rows: [], total: 0 }`, which is the correct answer and not a failure.
  if (error) return { ok: false, error: mapDbError(error) };

  return ok({
    rows: (data ?? []) as unknown as ApplicationListRow[],
    total: count ?? 0,
    page: filters.page,
    perPage: filters.per_page,
    termId,
    status: filters.status ?? null,
  });
}

/**
 * The full application, including `applicant_email` and `payload` (PRD US-C1: "the
 * detail view shows every submitted field").
 *
 * ⚠ CALLING THIS WRITES AN AUDIT ROW. `get_application_detail()` inserts one `VIEW`
 * entry before it returns, so merely opening the detail page is recorded — under
 * RA 10173 "who read this scholar's submission, and when" must be answerable
 * (CBL Art. VIII §6). Do not call it to test whether a row exists, and do not call it
 * twice per render.
 *
 * ⚠ THE ERROR MAPPING IS LOSSY, DELIBERATELY. Both the role guard and
 * `assert_confidentiality_ack()` raise 42501, so this layer cannot distinguish "wrong
 * tier" from "your CBL Art. VIII §7.1 acknowledgement is not on file for this term".
 * Both become `not_found`, which is the CONVENTIONS §4.3 rule: an empty result caused
 * by a policy is `not_found`, never `unauthorized`, because "forbidden" confirms the
 * row exists and therefore that a named person applied.
 *
 * The practical consequence, stated so it is not debugged as a bug: a newly appointed
 * CCDO in June sees the queue but every detail page 404s until an Executive Admin
 * records their acknowledgement. That is what "upon assuming their roles" means
 * (ARCHITECTURE.md §9 item 5). If the screen must say so out loud, the answer is a
 * separate `has_confidentiality_ack()` call on the page — not a wider error code here.
 */
export async function getApplicationDetail(
  ctx: ActionContext,
  applicationId: string,
): Promise<ActionResult<Record<string, unknown>>> {
  const { data, error } = await ctx.supabase.rpc("get_application_detail", {
    p_app_id: applicationId,
  });

  if (error) {
    const mapped = mapDbError(error);
    if (mapped.code === "unauthorized") return err<Record<string, unknown>>("not_found");
    return { ok: false, error: mapped };
  }

  // The RPC returns SQL NULL for an application that does not exist, and writes no
  // audit row for it — an absent row must not be distinguishable from an unreadable one.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return err<Record<string, unknown>>("not_found");
  }

  return ok(data as Record<string, unknown>);
}

/**
 * How many applications are awaiting a decision this term (PRD US-D4, v1.0 item 13).
 *
 * ⚠ S6's admin dashboard REUSES THIS. Do not write a second pending count there: two
 * counts computed two ways will disagree the first time one of them forgets the term
 * filter, and the tile links through to a list whose length contradicts it.
 *
 * `head: true` so PostgREST returns the count and no rows — this is a number on a
 * dashboard, and there is no reason for an applicant's name to travel for it.
 *
 * Returns 0 for a caller who cannot read the table. That is correct rather than an
 * error: the officer and RR dashboards never render this tile, and a zero is a safer
 * failure than an exception on a dashboard.
 */
export async function countPendingApplications(ctx: ActionContext): Promise<number> {
  const { data: termId, error: termError } = await ctx.supabase.rpc("current_term_id");
  if (termError || !termId) return 0;

  const { count, error } = await ctx.supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("term_id", termId)
    .eq("status", "pending");

  if (error) return 0;
  return count ?? 0;
}

export type ProofRef = {
  id: string;
  /** Provider-opaque. Only `lib/documents/` may interpret it; never rendered, ever. */
  proof_drive_file_id: string | null;
  /** The STORED type, re-verified from provider metadata. Never the client's claim. */
  proof_mime_type: string | null;
  /** The Notice of Award — the second document (0040). Same contract as the two above. */
  noa_drive_file_id: string | null;
  noa_mime_type: string | null;
};

/**
 * The proof pointer for one application — the first step of the document proxy
 * (ARCHITECTURE.md §4.1 step 7, BUILD_PLAN S4-T17).
 *
 * ⚠ THIS ORDINARY SELECT *IS* THE AUTHORIZATION, and that is the neatest thing in the
 * design. It runs under the caller's own JWT, so `applications_read` decides it: a row
 * comes back means authorized, `null` means the caller may not see this application —
 * or it does not exist, and the route must answer 404 to both, never 403. A 403 would
 * confirm that an application with that id exists.
 *
 * There is no second permission model here to drift from the policies that guard
 * everything else. The route's job after this is to call `log_document_view()` and
 * fail closed if it raises, then stream.
 */
export async function getProofRef(
  ctx: ActionContext,
  applicationId: string,
): Promise<ProofRef | null> {
  const { data, error } = await ctx.supabase
    .from("applications")
    .select("id, proof_drive_file_id, proof_mime_type, noa_drive_file_id, noa_mime_type")
    .eq("id", applicationId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}
