"use server";

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO DECISIONS, PLUS THE BATCH THAT RUNS THEM AFTER THE PERIOD CLOSES
// (BUILD_PLAN S4-T15; PRD §3 v1.0 item 8, US-C2, US-C3; ADR 0013 §2).
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS IS A SEPARATE FILE FROM `actions.ts`
// ═══════════════════════════════════════════════════════════════════════════════
// `lib/applications/actions.ts` holds the two genuinely ANONYMOUS intake actions and
// nothing else. Keeping the reviewer decisions out of it means a reader can open that
// file and know that everything in it is meant to be reachable without an account —
// there is no "which of these is public?" question to get wrong, and no risk of a
// future `withPublic` being pasted next to a `withRole` by pattern-matching.
//
// The guard test globs `**/*actions.ts`, so `review-actions.ts` is scanned exactly
// like the others — verified by an assertion in `actions-are-guarded.test.ts` that
// names this file. A filename-exact glob would have silently exempted it, which is the
// failure this comment exists to prevent someone re-introducing.
//
// ═══════════════════════════════════════════════════════════════════════════════
// `withRole` IS NOT THE BOUNDARY HERE
// ═══════════════════════════════════════════════════════════════════════════════
// All three RPCs carry their OWN role guard in SQL: `approve_application()` (0023) and
// `reject_application()` (0024) each raise 42501 for anything outside
// exec_admin / crrd_admin / moderator, and `047_application_decision_authz.sql`
// asserts that for all nine fixtures independently of this file. Delete this wrapper
// and nothing leaks; the caller just gets an opaque error instead of a clean
// `unauthorized`. If the two ever disagree, THE SQL GUARD IS THE ANSWER.
//
// `approve_all_pending()` is narrower still — `exec_admin`/`crrd_admin` only, no
// `moderator` (ADR 0013 §2) — and carries its own window-open guard besides, which
// this wrapper does not and must not try to duplicate.
//
// tech_admin is refused everywhere (PRD OQ-5): "configure the system and control
// access" is not "read every applicant's birthdate and mint them a member ID".
//
// ═══════════════════════════════════════════════════════════════════════════════
// NOTHING IS LOGGED
// ═══════════════════════════════════════════════════════════════════════════════
// `no-console` is an eslint ERROR under `lib/**`. An application row is the densest
// PII object in the schema; a raw PostgREST error from this path can carry a
// constraint name, a column value or an applicant's email in its `details`. The raw
// error is mapped and dropped — Sentry (S7-T8), whose `beforeSend` strips request
// bodies, is where a raw error is allowed to go.
//
// ⚠ NO HAND-WRITTEN AUDIT WRITE. `trg_applications_audit` fires inside each RPC's
// transaction and attributes the row to `auth.uid()`. An application-side audit write
// would double-count and would be a second path a refactor could skip
// (CLAUDE.md definition-of-done item 4).
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";

import {
  type ActionError,
  type ErrorCode,
  err,
  mapDbError,
  ok,
  validationFailure,
} from "@/lib/action-result";
import {
  applicationApproveSchema,
  applicationRejectSchema,
  type ApplicationApproveInput,
  type ApplicationRejectInput,
} from "@/lib/applications/schema";
import { withRole } from "@/lib/auth/with-role";

/** The three tiers the SQL guards name. Spelled once so the two actions cannot drift. */
const REVIEWER_ROLES = ["crrd_admin", "exec_admin"] as const;

/**
 * The renewal queue's own path, revalidated alongside the applications queue below
 * (ADR 0013 §2 — one batch decides both applications and renewals).
 */
const RENEWALS_PATH = "/renewals";

/**
 * The routes a decision invalidates.
 *
 * `/applications` is the queue; the detail page is revalidated by path so the
 * now-terminal row stops offering decision controls. Route groups are URL-invisible,
 * so `app/(admin)/applications/` is served at `/applications` — that is what
 * `revalidatePath` takes.
 */
const QUEUE_PATH = "/applications";

export type ApproveApplicationResult = {
  /**
   * The minted (or, for a returning scholar, the PRE-EXISTING) member ID.
   *
   * Returned so the dialog can show it immediately — that string is the PRD's own
   * proof the feature works (US-C3, "e.g. 2024-001"). It is NOT sensitive: `member_id`
   * is deliberately outside `sensitive_column_registry` so five-year-old headcounts
   * still work (DATA_MODEL.md §8.1).
   */
  memberId: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Error mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SQLSTATEs the two decision functions raise that `mapDbError` does not know about.
 *
 * `mapDbError` is the shared, feature-agnostic mapper; these two codes are specific to
 * the application state machine, so they are translated here rather than by widening
 * the shared table with meanings that only hold for one feature.
 *
 *   P0002  no_data_found — the row does not exist, or (equivalently, from the caller's
 *          side) they could not see it. `not_found`, never `unauthorized`: saying
 *          "forbidden" would confirm that an application with this id exists, and
 *          therefore that a named person applied (CONVENTIONS §4.3).
 *
 *   55000  object_not_in_prerequisite_state — the application is not `pending`. Almost
 *          always means another reviewer decided it seconds ago, so the UI's job is to
 *          refresh and explain rather than retry. `conflict`.
 *
 * Note what is NOT here: an already-approved application returns its existing member
 * ID and an already-rejected one returns success, because both RPCs are idempotent
 * (US-C3). A double-clicked Approve is a success, not a red banner.
 */
const DECISION_CODES: Record<string, ErrorCode> = {
  P0002: "not_found",
  "55000": "conflict",
};

/**
 * The standard, user-safe message for a code, taken from `lib/action-result.ts` rather
 * than written a second time here — two copies of "That record could not be found."
 * is exactly the drift this module has no reason to introduce.
 */
function messageFor(code: ErrorCode): string {
  const result = err(code);
  // `err()` never takes the ok branch; the check is only for the type narrowing.
  return result.ok ? "" : result.error.message;
}

function decisionError(raw: unknown): ActionError {
  if (raw !== null && typeof raw === "object") {
    const code = (raw as { code?: unknown }).code;
    if (typeof code === "string") {
      const mapped = DECISION_CODES[code];
      if (mapped !== undefined) return { code: mapped, message: messageFor(mapped) };
    }
  }
  return mapDbError(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// approveApplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approve an application, minting or reusing the member ID (PRD US-C2, US-C3, US-C4).
 *
 * Everything that matters happens inside ONE database transaction: person resolution,
 * ID allocation, the membership insert and the application stamp. This function
 * chooses nothing — it does not compute a member ID, does not insert a `people` row and
 * could not: no human role holds INSERT on `people`, and `allocate_member_id()` has
 * EXECUTE revoked from every session role (0022). CLAUDE.md is explicit that a member
 * ID is never generated, formatted or assigned in TypeScript.
 *
 * The in-flight disabled button in the dialog is UX. The real double-click guard is
 * the RPC's idempotent early-return, proved by `approve-application.test.ts` firing ten
 * concurrent approvals of the same row and asserting one membership.
 */
export const approveApplication = withRole<ApplicationApproveInput, ApproveApplicationResult>(
  REVIEWER_ROLES,
  async (ctx, input) => {
    const parsed = applicationApproveSchema.safeParse(input);
    if (!parsed.success) return validationFailure<ApproveApplicationResult>(parsed.error);

    const { data, error } = await ctx.supabase.rpc("approve_application", {
      p_app_id: parsed.data.id,
    });

    if (error) return { ok: false, error: decisionError(error) };

    // Defensive: the function's only success path returns a member ID, and
    // `approved_has_person` plus the allocator make a null return unrepresentable.
    // If it ever happens, it is a programmer error, not something to render as a
    // half-success next to the word "Approved".
    if (typeof data !== "string" || data.length === 0) {
      return err<ApproveApplicationResult>("unknown");
    }

    revalidatePath(QUEUE_PATH);
    revalidatePath(`${QUEUE_PATH}/${parsed.data.id}`);

    return ok({ memberId: data });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// rejectApplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reject an application with a written ground (PRD US-C2).
 *
 * Creates no person and no membership — asserted in pgTAP (047), not merely intended.
 *
 * ⚠ THE 23514 MAPPING IS THE POINT OF THIS FUNCTION'S ERROR BRANCH. Both
 * `reject_application()`'s own length check and the `rejected_has_reason` CHECK raise
 * `check_violation`, which `mapDbError` collapses to `validation` with no field. A
 * reviewer would then see a form-level error on a form with one field they filled in.
 * So the message is re-attached to `review_note`, which is what feeds react-hook-form's
 * `setError` and puts the message under the textarea (CONVENTIONS §6 — server field
 * errors are never dropped into a generic toast).
 *
 * In practice the shared schema catches this first; this branch exists because a
 * direct call, a stale client bundle or a drifted constant would not go through it.
 */
export const rejectApplication = withRole<ApplicationRejectInput, null>(
  REVIEWER_ROLES,
  async (ctx, input) => {
    const parsed = applicationRejectSchema.safeParse(input);
    if (!parsed.success) return validationFailure<null>(parsed.error);

    const { error } = await ctx.supabase.rpc("reject_application", {
      p_app_id: parsed.data.id,
      p_reason: parsed.data.review_note,
    });

    if (error) {
      const mapped = decisionError(error);
      if (mapped.code === "validation" && mapped.fields === undefined) {
        return {
          ok: false,
          error: { ...mapped, fields: { review_note: [mapped.message] } },
        };
      }
      return { ok: false, error: mapped };
    }

    revalidatePath(QUEUE_PATH);
    revalidatePath(`${QUEUE_PATH}/${parsed.data.id}`);

    return ok(null);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// approveAllPending — the post-period batch (ADR 0013 §2; PRD US-C1, US-C2, US-C3,
// US-G7, US-H5)
// ─────────────────────────────────────────────────────────────────────────────
//
// Same "withRole is not the boundary" note as the two decisions above:
// `approve_all_pending()` (0044-family) carries its own `exec_admin`/`crrd_admin` guard
// and its own window-open guard, both independent of this wrapper. This function takes
// NO INPUT — there is nothing to validate, nothing per-row to name — it is a trigger
// for a server-side batch scoped entirely to `current_term_id()`.
//
// One database transaction per underlying `approve_application()` / `approve_renewal()`
// call, not one for the whole batch: a single bad row (a stale reference, a race with a
// manual reject) is caught, reported in `failed`, and does not roll back every other
// row's approval. That per-row isolation is why the batch can be re-run safely — see
// the idempotency note on `parseApproveAllPendingResult` below.

export type ApproveAllPendingResult = {
  applicationsApproved: number;
  renewalsApproved: number;
  /** Still-pending rows that failed a submission standard (application or renewal id). */
  skipped: { id: string; failures: string[] }[];
  /** Rows `approve_application()`/`approve_renewal()` itself raised on, mid-batch. */
  failed: { id: string; error: string }[];
};

/**
 * Refuses while the application period is still open (55000 from the RPC). Distinct
 * from `DECISION_CODES`'s `55000` above, which means "this ONE application is no longer
 * pending" — the same SQLSTATE, two different meanings depending on which function
 * raised it, so it is mapped here rather than folded into `decisionError`.
 */
const WINDOW_STILL_OPEN_MESSAGE =
  "The application period is still open. Close it on the application-period page first.";

function approveAllError(raw: unknown): ActionError {
  if (raw !== null && typeof raw === "object" && (raw as { code?: unknown }).code === "55000") {
    return { code: "conflict", message: WINDOW_STILL_OPEN_MESSAGE };
  }
  return mapDbError(raw);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toFiniteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** `[{id, failures: string[]}]`, dropping any entry that does not have at least an id. */
function toSkippedList(value: unknown): { id: string; failures: string[] }[] {
  if (!Array.isArray(value)) return [];
  const out: { id: string; failures: string[] }[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry) || typeof entry.id !== "string") continue;
    const failures = Array.isArray(entry.failures)
      ? entry.failures.filter((f): f is string => typeof f === "string")
      : [];
    out.push({ id: entry.id, failures });
  }
  return out;
}

/** `[{id, error: string}]`, same defensive shape as `toSkippedList`. */
function toFailedList(value: unknown): { id: string; error: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { id: string; error: string }[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry) || typeof entry.id !== "string") continue;
    out.push({ id: entry.id, error: typeof entry.error === "string" ? entry.error : "" });
  }
  return out;
}

/**
 * Parse `approve_all_pending()`'s jsonb return DEFENSIVELY.
 *
 * The RPC's success is already established by the caller (no `error` from the client)
 * before this runs — an unexpected jsonb shape here (a schema drift mid-deploy, a
 * `NULL`) degrades to all-zero counts and empty lists rather than throwing. The batch
 * really did run; a shape this layer cannot parse is not evidence that it failed.
 *
 * Idempotency (US-C2, US-C3) lives entirely in the SQL: a second click finds nothing
 * still `pending` in the current term and returns zero counts and empty lists — this
 * function has no idempotency logic of its own to get wrong.
 */
function parseApproveAllPendingResult(data: unknown): ApproveAllPendingResult {
  if (!isJsonRecord(data)) {
    return { applicationsApproved: 0, renewalsApproved: 0, skipped: [], failed: [] };
  }
  return {
    applicationsApproved: toFiniteCount(data.applications_approved),
    renewalsApproved: toFiniteCount(data.renewals_approved),
    skipped: toSkippedList(data.skipped),
    failed: toFailedList(data.failed),
  };
}

/**
 * Approve every still-`pending` application and renewal in the current term that
 * meets the submission standards, in one batch (ADR 0013 §2).
 *
 * Refuses (`conflict`) while a `membership_application` window for the current term is
 * still open — decisions happen once, after the period closes, never mid-window. A row
 * that fails `check_submission_standards()` is skipped, not approved: it cannot
 * normally reach `pending` in the first place (the same checks gate submission), so a
 * skip here means reference data (a program, a university) or the applicant's
 * membership standing changed after they submitted. A row `approve_application()` /
 * `approve_renewal()` itself raises on is reported in `failed` for individual review —
 * it is not retried automatically, and it is not silently dropped.
 */
export const approveAllPending = withRole<void, ApproveAllPendingResult>(
  REVIEWER_ROLES,
  async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("approve_all_pending");

    if (error) return { ok: false, error: approveAllError(error) };

    revalidatePath(QUEUE_PATH);
    revalidatePath(RENEWALS_PATH);

    return ok(parseApproveAllPendingResult(data));
  },
);
