"use server";

// ─────────────────────────────────────────────────────────────────────────────
// THE CRRD RECORDS DESK (ADR 0012, migration 0046).
//
// Three actions, all `withRole(['exec_admin', 'crrd_admin'])` — defence in depth over
// `officer_assignments_insert` / `officer_assignments_update` (0014, as amended by 0046),
// which refuse the identical call independently for every other tier
// (075_officer_assignments_crrd.sql). If the two ever disagree, THE POLICY IS THE ANSWER.
//
// ⚠ NO NEW RPC. Both writes go straight through `ctx.supabase` against the plain table, the
// same reasoning `lib/members/actions.ts` gives for `updateMembershipStatus`: a definer
// function whose owner holds BYPASSRLS would take `officer_assignments_insert` /
// `_update` OUT of the path entirely, and the whole point of ADR 0012 is that those TWO
// named tiers — nobody else — may write this table. A plain table write keeps the policy
// in the path.
//
// ⚠ AN EMPTY-ROW UPDATE IS `conflict`, NEVER `unauthorized` — the same reasoning
// `updateMembershipStatus` documents. Zero rows affected on `recordOfficerSeparation` means
// one of: the row is no longer in the `from_status` the caller claimed (a stale tab, a
// forged hidden field, or another recorder who decided seconds ago); the row moved or was
// reassigned first; `officer_assignments_update`'s USING half hid it (which, for any caller
// outside the two recorder tiers, is exactly how the refusal is enforced); or the id no
// longer exists. Reporting the third case as "forbidden" would confirm a specific officer's
// assignment id resolves to a row — a disclosure with no data in it. `conflict`'s "reload
// and try again" is the correct advice in all four cases, and `withRole` already refuses
// the wrong tier before any of this runs anyway.
//
// ⚠ NO HAND-WRITTEN AUDIT WRITE. `trg_officer_assignments_audit` (0012_functions.sql)
// fires on every INSERT and UPDATE here; an application-side audit write would double the
// entry and would be the one audit path a refactor could skip (CLAUDE.md definition-of-done
// item 4).
//
// NOTHING IS LOGGED. `no-console` is an eslint ERROR under `lib/**`.
//
// CITATION: ADR 0012; DATA_MODEL.md §3.4; ARCHITECTURE.md §5; CONVENTIONS.md §4.2, §4.3;
//           PRD US-E5, US-E6, US-E7; CBL Art. VI.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";

import { err, mapDbError, ok, validationFailure } from "@/lib/action-result";
import { withRole } from "@/lib/auth/with-role";
import {
  candidateNameFilter,
  matchesCandidateQuery,
  queryWords,
} from "@/lib/officers/candidate-match";
import { canSeatPosition, SPECIAL_ADVISOR_REFUSAL } from "@/lib/officers/positions";
import {
  OFFICER_CANDIDATE_GROUP_STATUSES,
  officerAppointSchema,
  officerCandidateSearchSchema,
  officerSeparationSchema,
  type MembershipStatus,
  type OfficerAppointInput,
  type OfficerCandidateSearchInput,
  type OfficerSeparationInput,
} from "@/lib/officers/schema";

/** The two tiers ADR 0012 names, spelled once so the three actions cannot drift apart. */
const OFFICER_DESK_ROLES = ["exec_admin", "crrd_admin"] as const;

const OFFICERS_PATH = "/officers";

export type OfficerCandidate = {
  id: string;
  member_id: string | null;
  given_name: string;
  family_name: string;
  /** The current-term membership's region; null only if that region row is unreadable. */
  region_name: string | null;
  status: MembershipStatus;
};

export type OfficerCandidateSearchResult = {
  candidates: OfficerCandidate[];
  /** More people matched than are returned — the dialog asks for more letters. */
  truncated: boolean;
};

/** How many candidates the dialog lists. */
const CANDIDATE_RESULT_LIMIT = 20;

/** How many rows the first-word filter may return before the every-word pass runs. */
const CANDIDATE_FETCH_LIMIT = 200;

/**
 * Find people to appoint by name or member ID, narrowing as the caller types (Officer
 * feedback 2026-09-11: appoint by name — nobody memorises a member ID).
 *
 * A read, not a write — still `withRole`-guarded, because it is reachable from a client
 * component, not a Server Component render: an unguarded-looking action here would be
 * indistinguishable from a forgotten guard (CONVENTIONS §0 rule 6). It runs through the
 * CALLER'S client, so `people_read` / `memberships_read` (0014) decide the rows and
 * `people`'s column GRANT (0015) decides the columns — the four named here are inside it;
 * naming any other `people` column raises 42501.
 *
 * `memberships!inner` plus the two embedded filters keeps only people with a CURRENT-term
 * membership in the chosen group, so `terminated` and `renewal_pending` are never offered.
 * The database filters on the first typed word; `matchesCandidateQuery` applies every word
 * to what comes back (lib/officers/candidate-match.ts). If the fetch cap is hit,
 * `truncated` is set even when fewer than 20 survive: rows past the cap were never seen.
 */
export const searchOfficerCandidates = withRole<
  OfficerCandidateSearchInput,
  OfficerCandidateSearchResult
>(OFFICER_DESK_ROLES, async (ctx, input) => {
  const parsed = officerCandidateSearchSchema.safeParse(input);
  if (!parsed.success) return validationFailure<OfficerCandidateSearchResult>(parsed.error);
  const { q, group } = parsed.data;

  const { data: termId, error: termError } = await ctx.supabase.rpc("current_term_id");
  if (termError) return { ok: false, error: mapDbError(termError) };
  if (!termId) {
    return err<OfficerCandidateSearchResult>("conflict", "No term is currently open.");
  }

  let query = ctx.supabase
    .from("people")
    .select(
      "id, member_id, given_name, family_name, memberships!inner(status, term_id, regions(name))",
    )
    .eq("memberships.term_id", termId)
    .in("memberships.status", OFFICER_CANDIDATE_GROUP_STATUSES[group]);

  const [firstWord] = queryWords(q);
  if (firstWord !== undefined) query = query.or(candidateNameFilter(firstWord));

  const { data, error } = await query
    .order("family_name")
    .order("given_name")
    .order("id")
    .limit(CANDIDATE_FETCH_LIMIT);

  if (error) return { ok: false, error: mapDbError(error) };

  const rows = data ?? [];
  const matched = rows.filter((row) => matchesCandidateQuery(row, q));

  const candidates: OfficerCandidate[] = [];
  for (const row of matched.slice(0, CANDIDATE_RESULT_LIMIT)) {
    const membership = row.memberships[0];
    if (!membership) continue; // `!inner` guarantees one; never offer a person without it
    candidates.push({
      id: row.id,
      member_id: row.member_id,
      given_name: row.given_name,
      family_name: row.family_name,
      region_name: membership.regions?.name ?? null,
      status: membership.status,
    });
  }

  return ok({
    candidates,
    truncated: matched.length > CANDIDATE_RESULT_LIMIT || rows.length === CANDIDATE_FETCH_LIMIT,
  });
});

export type AppointOfficerResult = { assignment_id: string };

/**
 * Appoint a person to a CBL position for the current term (CBL Art. V §2, Art. VI §4.1-4.3
 * mid-term vacancy filling) — ADR 0012's records-desk write. `department_id` and
 * `committee_id` are left null: the CBL positions this screen seats are not staffed onto
 * a specific committee or department through this action (DATA_MODEL.md §6/0007's
 * columns exist for a different assignment shape and are not required here).
 */
export const appointOfficer = withRole<OfficerAppointInput, AppointOfficerResult>(
  OFFICER_DESK_ROLES,
  async (ctx, input) => {
    const parsed = officerAppointSchema.safeParse(input);
    if (!parsed.success) return validationFailure<AppointOfficerResult>(parsed.error);

    // A9 / 0054: SPECIAL_ADVISOR is exec_admin's alone. `officer_assignments_insert`
    // refuses this identical INSERT for crrd_admin regardless — this check exists only so
    // the caller gets the constitutional reason instead of a bare permission error.
    if (!canSeatPosition(ctx.role, parsed.data.position_code)) {
      return err<AppointOfficerResult>("unauthorized", SPECIAL_ADVISOR_REFUSAL);
    }

    const { data: termId, error: termError } = await ctx.supabase.rpc("current_term_id");
    if (termError) return { ok: false, error: mapDbError(termError) };
    if (!termId) return err<AppointOfficerResult>("conflict", "No term is currently open.");

    const { data, error } = await ctx.supabase
      .from("officer_assignments")
      .insert({
        person_id: parsed.data.person_id,
        term_id: termId,
        role: parsed.data.position_code,
        status: "active",
        is_acting: parsed.data.is_acting,
        status_note: parsed.data.status_note,
      })
      .select("id")
      .single();

    if (error || !data) return { ok: false, error: mapDbError(error) };

    revalidatePath(OFFICERS_PATH);
    return ok({ assignment_id: data.id });
  },
);

/**
 * Record a separation from office (CBL Art. VI) on an existing assignment.
 *
 * A PLAIN TABLE UPDATE, on purpose — see the file header. `status` and `status_note` are
 * written in the SAME statement so a partial write (a status with no recorded ground)
 * cannot happen.
 *
 * ⚠ THE UPDATE IS CONDITIONAL ON `from_status`, AND HAS TO BE. See the filter below.
 */
export const recordOfficerSeparation = withRole<OfficerSeparationInput, null>(
  OFFICER_DESK_ROLES,
  async (ctx, input) => {
    const parsed = officerSeparationSchema.safeParse(input);
    if (!parsed.success) return validationFailure<null>(parsed.error);

    // ⚠ `from_status` IS A PRECONDITION, NOT A TRUSTED FACT, and this filter is what makes
    // that true. It arrives from the client (a hidden field), so `officerSeparationSchema`'s
    // edge check proves only that the CLAIMED edge is legal — never that the row is still
    // where the claim says it is. Filtering the UPDATE on it turns the claim into a
    // compare-and-swap token, the same shape as `update_member_record`'s
    // `expected_updated_at` (S5-T7): a stale tab, a second change in one tab, or a value
    // edited in devtools matches 0 rows and returns `conflict` below instead of writing an
    // edge nobody authorised.
    //
    // This is not belt-and-braces. `officer_assignments` has NO state-machine trigger behind
    // it — 0007/0014/0046 enforce only WHO may write the row, never WHICH status legally
    // follows which (lib/officers/schema.ts header). Without this filter, a claimed
    // `suspended -> active` lands on a row that is actually `impeached`, reversing the one
    // state CBL Art. VI §3.2.8 declares "final and irrevocable".
    //
    // It stays a plain table UPDATE: the filter NARROWS the scan and widens no policy —
    // `officer_assignments_update` is still in the path, which is the whole point of the
    // file header's "NO NEW RPC".
    const { data, error } = await ctx.supabase
      .from("officer_assignments")
      .update({ status: parsed.data.status, status_note: parsed.data.status_note })
      .eq("id", parsed.data.assignment_id)
      .eq("status", parsed.data.from_status)
      .select("id");

    if (error) return { ok: false, error: mapDbError(error) };

    const rows = data ?? [];
    if (rows.length === 0) return err<null>("conflict");

    revalidatePath(OFFICERS_PATH);
    return ok(null);
  },
);
