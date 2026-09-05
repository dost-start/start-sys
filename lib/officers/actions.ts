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
// one of: the row moved or was reassigned first; `officer_assignments_update`'s USING half
// hid it (which, for any caller outside the two recorder tiers, is exactly how the refusal
// is enforced); or the id no longer exists. Reporting the second case as "forbidden" would
// confirm a specific officer's assignment id resolves to a row — a disclosure with no data
// in it. `conflict`'s "reload and try again" is the correct advice in all three cases, and
// `withRole` already refuses the wrong tier before any of this runs anyway.
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
  officerAppointSchema,
  officerLookupSchema,
  officerSeparationSchema,
  type OfficerAppointInput,
  type OfficerLookupInput,
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
};

/**
 * Resolve a member ID to the person it names, for the appoint dialog's "look up" step.
 *
 * A read, not a write — still `withRole`-guarded, because this is a records-desk action
 * reachable from a client component, not a Server Component render: an unguarded-looking
 * action here would be indistinguishable from a forgotten guard (CONVENTIONS §0 rule 6).
 * `people`'s six-column GRANT (0015) is what actually decides which columns come back;
 * this reads only columns already in that set.
 */
export const lookupOfficerCandidate = withRole<OfficerLookupInput, OfficerCandidate>(
  OFFICER_DESK_ROLES,
  async (ctx, input) => {
    const parsed = officerLookupSchema.safeParse(input);
    if (!parsed.success) return validationFailure<OfficerCandidate>(parsed.error);

    const { data, error } = await ctx.supabase
      .from("people")
      .select("id, member_id, given_name, family_name")
      .eq("member_id", parsed.data.member_id)
      .maybeSingle();

    if (error) return { ok: false, error: mapDbError(error) };
    if (!data) {
      return err<OfficerCandidate>("not_found", "No member with that ID was found.");
    }

    return ok(data);
  },
);

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
 */
export const recordOfficerSeparation = withRole<OfficerSeparationInput, null>(
  OFFICER_DESK_ROLES,
  async (ctx, input) => {
    const parsed = officerSeparationSchema.safeParse(input);
    if (!parsed.success) return validationFailure<null>(parsed.error);

    const { data, error } = await ctx.supabase
      .from("officer_assignments")
      .update({ status: parsed.data.status, status_note: parsed.data.status_note })
      .eq("id", parsed.data.assignment_id)
      .select("id");

    if (error) return { ok: false, error: mapDbError(error) };

    const rows = data ?? [];
    if (rows.length === 0) return err<null>("conflict");

    revalidatePath(OFFICERS_PATH);
    return ok(null);
  },
);
