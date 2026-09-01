"use server";

// ─────────────────────────────────────────────────────────────────────────────
// OPEN AND CLOSE THE APPLICATION PERIOD (BUILD_PLAN S4-T24; PRD US-B4, MVP item 5).
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS AT ALL — THE GAP IT CLOSES
// ═══════════════════════════════════════════════════════════════════════════════
// Every other piece of US-B4 shipped before this one: S2-T17 wrote the
// `application_windows` write policies, S2-T9 attached `trg_application_windows_audit`,
// S3's anon INSERT policy reads the window from inside its own policy expression, and
// S3-T25 wrote the runbook. Nothing let the CCDO actually open a window — so the
// public portal could only ever be opened by hand-run SQL against production, which is
// exactly the undocumented drift CLAUDE.md forbids ("Migrations apply to production
// only via CI ... never by hand in the Supabase dashboard").
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHO MAY WRITE — ADR 0003, AND WHY exec_admin IS REFUSED
// ═══════════════════════════════════════════════════════════════════════════════
// `crrd_admin` AND `tech_admin`, and nobody else. PRD US-B4 says "As a CRRD Admin, I
// can open and close the application period"; ARCHITECTURE.md §5 lists
// `application_windows` among the tables only `tech_admin` writes. ADR 0003 resolves
// that conflict by shipping both, in the direction that survives an empty CTO seat
// (OQ-13): a tech_admin-only gate would mean the CCDO cannot open the application
// period while the one seat most likely to be vacant at a term boundary is vacant.
//
// `exec_admin` is DELIBERATELY absent, and it is the counter-intuitive row. The CEO and
// COO oversee records; opening a submission window is an operational act belonging to
// the department that runs recruitment (CBL Art. IV §6.2.2 puts "membership
// recruitment, application, retention" with the CRRD). `application_windows_insert` in
// 0014 names the same two roles, so an exec_admin calling this is refused twice —
// once here with a clean `unauthorized`, and once by the policy if this wrapper were
// deleted. `moderator` is refused for the same reason it cannot create a committee:
// structure and scheduling are chief-level (OQ-14's documented reading).
//
// ⚠ `withRole` IS NOT THE BOUNDARY. `application_windows_insert` / `_update` also
// require `has_aal2()`, which this file cannot and must not re-implement — a
// non-MFA-verified tech_admin is refused by the database even if middleware and this
// wrapper both vanish (ARCHITECTURE.md §5).
//
// ═══════════════════════════════════════════════════════════════════════════════
// TWO STRUCTURAL RULES
// ═══════════════════════════════════════════════════════════════════════════════
// 1. NEVER A DELETE. Closing sets `closes_at = now()`. There is no DELETE policy
//    anywhere in this schema and none may be added (CLAUDE.md "Banned patterns"), and
//    a deleted row would erase the record of a period that people actually applied in.
//
// 2. NEVER A SECOND ROW. `application_windows` is `unique (term_id, form_kind)`, so
//    "open a window" for a term that already has one is an UPDATE of that row, not an
//    insert. That is not merely convenient: `application_windows_read_anon` is a
//    single-row read from inside the anon INSERT policy, and a second row for the same
//    (term, kind) would make "is the period open?" ambiguous at the data layer.
//
// NOTHING IS LOGGED. `no-console` is an eslint error under `lib/**`. Window rows carry
// no PII, but a raw PostgREST error from this path can carry a constraint name and a
// term id, and there is no reason for either to reach a log line.
//
// ⚠ NO HAND-WRITTEN AUDIT WRITE. `trg_application_windows_audit` (0012) fires inside
// each statement's own transaction and attributes the row to `auth.uid()`, which is
// what makes US-B4's "written to the audit log with the responsible user" true rather
// than aspirational (CLAUDE.md definition-of-done item 4).
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";

import { err, mapDbError, ok, validationFailure } from "@/lib/action-result";
import {
  closeApplicationWindowSchema,
  openApplicationWindowSchema,
  type CloseApplicationWindowInput,
  type OpenApplicationWindowInput,
} from "@/lib/applications/window-schema";
import { withRole } from "@/lib/auth/with-role";

/** ADR 0003. Spelled once so the two actions cannot drift apart. */
const WINDOW_WRITER_ROLES = ["crrd_admin", "tech_admin"] as const;

/**
 * The paths a window change invalidates.
 *
 * `/apply` is in the list because the public page renders an open or a closed state
 * from `getPublicWindowState()`. It is `force-dynamic` already, so this is belt as
 * well as braces — but a cached open-window page served after closing time would
 * contradict the database, and that is the one contradiction this feature cannot have.
 *
 * Route groups are URL-invisible: `app/(admin)/applications/window/` is served at
 * `/applications/window`, and that is what `revalidatePath` takes.
 */
const WINDOW_PATH = "/applications/window";
const QUEUE_PATH = "/applications";
const PUBLIC_APPLY_PATH = "/apply";

function revalidateWindowSurfaces(): void {
  revalidatePath(WINDOW_PATH);
  revalidatePath(QUEUE_PATH);
  revalidatePath(PUBLIC_APPLY_PATH);
}

export type ApplicationWindowResult = {
  /** The term the window belongs to. Resolved server-side; never supplied by a client. */
  termId: string;
  opensAt: string;
  closesAt: string;
};

type WindowRow = {
  id: string;
  opens_at: string;
  closes_at: string;
};

/**
 * The existing window row for (current term, form_kind), or `null`.
 *
 * Read through the CALLER'S client, so `application_windows_read` decides it. A caller
 * who cannot read the table gets `null` and is then refused by the write policy
 * anyway — the read is never the gate.
 */
async function findWindow(
  supabase: ApplicationWindowClient,
  termId: string,
  formKind: string,
): Promise<{ row: WindowRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("application_windows")
    .select("id, opens_at, closes_at")
    .eq("term_id", termId)
    .eq("form_kind", formKind)
    .maybeSingle();

  return { row: (data as WindowRow | null) ?? null, error };
}

/**
 * The narrow slice of the Supabase client these two actions use.
 *
 * Structural rather than the full `SupabaseClient<Database>`: PostgREST's builder types
 * do not narrow cleanly across a `.select().eq().eq().maybeSingle()` chain that is
 * factored into a helper, and the alternative is an `as` cast on DB data — which
 * CONVENTIONS §5 treats as a signal that the generated types are stale. The runtime
 * calls are unchanged and the RLS policy is what actually decides the outcome.
 */
type ApplicationWindowClient = {
  rpc: (fn: "current_term_id") => PromiseLike<{ data: string | null; error: unknown }>;
  from: (table: "application_windows") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => {
          maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
    upsert: (
      row: Record<string, string>,
      options: { onConflict: string },
    ) => PromiseLike<{ error: unknown }>;
    update: (
      values: Record<string, string>,
      options: { count: "exact" },
    ) => {
      eq: (column: string, value: string) => PromiseLike<{ error: unknown; count: number | null }>;
    };
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// openApplicationWindow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open — or re-schedule, or re-open after a closure — the membership application
 * period for the CURRENT term (PRD US-B4).
 *
 * ⚠ THE CONFLICT CHECK IS A GUARD RAIL, NOT A LOCK. An already-open period is refused
 * with `conflict` so that "open applications" cannot silently move the closing time of
 * a period people are mid-submission in — the officer must close it deliberately
 * first, and that closure is its own audited act. It is checked-then-written without a
 * transaction, so two officers racing could both pass the check; the loser's upsert
 * simply overwrites, both writes are audited, and the outcome is one row either way.
 * Nothing is lost, which is why this does not need to be an RPC.
 *
 * The term is `current_term_id()`, resolved server-side and never accepted from the
 * client — the same rule the anon INSERT policy applies independently. A window on an
 * archived term is refused a third time, by `trg_application_windows_freeze_archived`.
 */
export const openApplicationWindow = withRole<unknown, ApplicationWindowResult>(
  WINDOW_WRITER_ROLES,
  async (ctx, input) => {
    const parsed = openApplicationWindowSchema.safeParse(input);
    if (!parsed.success) return validationFailure<ApplicationWindowResult>(parsed.error);

    const { form_kind, opens_at, closes_at }: OpenApplicationWindowInput = parsed.data;
    const supabase = ctx.supabase as unknown as ApplicationWindowClient;

    const { data: termId, error: termError } = await supabase.rpc("current_term_id");
    // No active term means the system has not been bootstrapped or a rollover is
    // mid-flight. `not_found` rather than a bespoke code: there is nothing the officer
    // can do about it on this screen.
    if (termError || !termId) return err<ApplicationWindowResult>("not_found");

    const { row: existing, error: readError } = await findWindow(supabase, termId, form_kind);
    if (readError) return { ok: false, error: mapDbError(readError) };

    if (existing !== null && Date.parse(existing.closes_at) > Date.now()) {
      // A live row occupies the term's (term_id, form_kind) slot whether the period is
      // already OPEN or merely SCHEDULED (opens_at still in the future). Both are
      // escapable the same way — Close cancels the row (closes_at = now()), then Open
      // upserts the new dates — but the message must say which state it found, or an
      // officer staring at a scheduled window is told it is "already open".
      const scheduled = Date.parse(existing.opens_at) > Date.now();
      return err<ApplicationWindowResult>(
        "conflict",
        scheduled
          ? "An application period is already scheduled for this term. Close it first to replace its dates."
          : "The application period is already open. Close it first if you need to change its dates.",
      );
    }

    // ONE statement whether this is the term's first window or a re-open of a closed
    // one. Two branches (insert vs. update) would be two policies to keep in step and
    // a race between them; the unique constraint makes the upsert exact.
    const { error } = await supabase
      .from("application_windows")
      .upsert(
        { term_id: termId, form_kind, opens_at, closes_at },
        { onConflict: "term_id,form_kind" },
      );

    if (error) return { ok: false, error: mapDbError(error) };

    revalidateWindowSurfaces();
    return ok({ termId, opensAt: opens_at, closesAt: closes_at });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// closeApplicationWindow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Close the current term's application period, effective immediately (PRD US-B4).
 *
 * ⚠ EFFECTIVE ON THE NEXT SUBMISSION, WITH NO CACHE TO WAIT FOR. The check that
 * refuses a submission lives inside `applications_insert_anon`, which EXISTS-checks
 * `now() between opens_at and closes_at` at INSERT time. So the moment this UPDATE
 * commits, a forwarded or bookmarked `/apply` link is inert — including for a browser
 * that already has the form rendered. That is the property the screen states in words,
 * because "did the close take effect yet?" is otherwise a question nobody can answer
 * from the UI.
 *
 * An UPDATE, never a DELETE, and `closes_at = now()` rather than any client value —
 * see the two structural rules in the header.
 */
export const closeApplicationWindow = withRole<unknown, ApplicationWindowResult>(
  WINDOW_WRITER_ROLES,
  async (ctx, input) => {
    const parsed = closeApplicationWindowSchema.safeParse(input);
    if (!parsed.success) return validationFailure<ApplicationWindowResult>(parsed.error);

    const { form_kind }: CloseApplicationWindowInput = parsed.data;
    const supabase = ctx.supabase as unknown as ApplicationWindowClient;

    const { data: termId, error: termError } = await supabase.rpc("current_term_id");
    if (termError || !termId) return err<ApplicationWindowResult>("not_found");

    const { row: existing, error: readError } = await findWindow(supabase, termId, form_kind);
    if (readError) return { ok: false, error: mapDbError(readError) };

    // Nothing to close: no window was ever opened for this term, or it has already
    // closed. `not_found` rather than a success, because reporting "closed" for a
    // period that was never open would let the screen claim an act that did not happen
    // and produced no audit row.
    if (existing === null || Date.parse(existing.closes_at) <= Date.now()) {
      return err<ApplicationWindowResult>(
        "not_found",
        "There is no open application period to close.",
      );
    }

    const closesAt = new Date().toISOString();

    const { error, count } = await supabase
      .from("application_windows")
      .update({ closes_at: closesAt }, { count: "exact" })
      .eq("id", existing.id);

    if (error) return { ok: false, error: mapDbError(error) };
    // Zero rows affected means the UPDATE policy refused the write (an aal1 session, or
    // a role this wrapper let through that the policy does not). CONVENTIONS §4.3: map
    // to `not_found`, never `unauthorized` — and treat the disagreement as this
    // wrapper's bug, not the policy's.
    if (count === 0) return err<ApplicationWindowResult>("not_found");

    revalidateWindowSurfaces();
    return ok({ termId, opensAt: existing.opens_at, closesAt });
  },
);
