"use server";

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO MEMBER-RECORD WRITES (BUILD_PLAN S5-T18).
//
//   updateMemberRecord     -> update_member_record()  (SECURITY DEFINER RPC)
//   updateMembershipStatus -> a PLAIN TABLE UPDATE on `memberships`
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ WHY ONE IS AN RPC AND THE OTHER DELIBERATELY IS NOT
// ═══════════════════════════════════════════════════════════════════════════════
// This asymmetry looks like an inconsistency and is the most important decision in the
// file. It follows from WHERE THE ENFORCEMENT LIVES for each write:
//
//   `people` — 0015_grants.sql runs `revoke all ... from authenticated` and grants back a
//   six-column SELECT. NO ROLE HOLDS TABLE UPDATE ON `people` AT ALL. `people_update`
//   (0014) exists but a policy cannot grant a privilege that was revoked. So an ordinary
//   `.from('people').update(...)` raises 42501 for every caller and the only correct path
//   is the definer RPC, which re-applies the role guard, the CBL Art. VIII §7.1
//   acknowledgement, an explicit patch whitelist and optimistic concurrency. Widening the
//   0015 GRANT to "make the edit form work" is the exact banned move (CLAUDE.md).
//
//   `memberships` — has a real UPDATE policy AND a transition trigger. Routing status
//   through a SECURITY DEFINER function would take `memberships_update` OUT OF THE PATH
//   entirely: a definer whose owner holds BYPASSRLS is not subject to RLS, so the policy
//   half of CBL Art. VII §3.2.3's exec-only rule would stop applying and only the trigger
//   would remain. A plain UPDATE keeps BOTH guards in the path, which is the whole reason
//   0028 duplicates the policy's terminated check in the first place.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ `withRole` IS NOT THE BOUNDARY HERE EITHER
// ═══════════════════════════════════════════════════════════════════════════════
// Both underlying writes refuse the same callers independently — the RPC by its own role
// guard, the table update by `memberships_update` — and pgTAP asserts each for all nine
// fixtures (062, 064, 060) without reference to this file. Delete these wrappers and
// nothing leaks; the caller just gets an opaque failure instead of a clean `unauthorized`.
// If the two ever disagree, THE POLICY IS THE ANSWER.
//
// ⚠ NO HAND-WRITTEN AUDIT WRITE. `trg_people_audit` and `trg_memberships_audit` fire
// inside these statements and mask every registered sensitive key before writing. An
// application-side audit write would double-count and would be the one audit path a
// refactor could skip (CLAUDE.md definition-of-done item 4).
//
// ⚠ NOTHING IS LOGGED. `no-console` is an eslint ERROR under `lib/**`; a raw PostgREST
// error on this path can carry a scholar's contact number in `details`.
//
// CITATION: BUILD_PLAN S5-T18, S5-T27, S5-T28; CONVENTIONS.md §4.2, §4.3, §6;
//           PRD US-D1, US-D3, US-D5, US-D6; DATA_MODEL.md §3.1, §8.3;
//           CBL Art. VII §3.1, §3.2.3, §3.2.5-3.2.6; ARCHITECTURE.md §5.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";

import { err, mapDbError, ok, validationFailure } from "@/lib/action-result";
import { withRole } from "@/lib/auth/with-role";
import { MEMBERS_PATH } from "@/lib/members/filters";
import {
  buildMemberPatch,
  memberUpdateSchema,
  membershipStatusUpdateSchema,
  type MemberUpdateInput,
  type MembershipStatusUpdateInput,
} from "@/lib/members/schema";

/**
 * The three tiers 0014's `memberships_update` and 0030's RPC guards both name.
 *
 * Spelled once so the two actions cannot drift apart. `officer` and `regional_rep` are
 * absent because NO UPDATE POLICY NAMES THEM anywhere — PRD US-D2 and US-F2 are missing
 * policies, not hidden buttons (026's negative-space meta-test asserts exactly that).
 * `tech_admin` is absent per PRD OQ-5.
 */
const RECORD_WRITER_ROLES = ["exec_admin", "crrd_admin", "moderator"] as const;

/** Everything this surface serves. Route groups are URL-invisible: `/members`, not `/admin/members`. */
function revalidateMember(personId?: string): void {
  revalidatePath(MEMBERS_PATH);
  if (personId !== undefined) revalidatePath(`${MEMBERS_PATH}/${personId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// updateMemberRecord
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Correct a member's record (PRD §3 v1.0 item 10, US-D1).
 *
 * ⚠ THE 40001 MAPPING IS THE POINT OF THIS FUNCTION'S ERROR BRANCH.
 * `update_member_record()` locks the row `FOR UPDATE` and compares the caller's
 * `expected_updated_at`; a stale form loses with `serialization_failure`, which
 * `mapDbError` already turns into `conflict`. The form renders that as "this record was
 * changed by someone else — reload" AND DOES NOT SILENTLY RETRY OR MERGE. A merge of two
 * half-informed edits is a third edit nobody made, and PRD US-D1 is explicit that
 * concurrent edits must not silently overwrite one another.
 *
 * The whitelist rejection (22023) is mapped to `validation` with no field, because the
 * offending key is by definition not a field the form renders — the shared schema's
 * `.strict()` catches it first, and this branch exists only for a stale bundle or a
 * hand-crafted POST.
 */
export const updateMemberRecord = withRole<MemberUpdateInput, null>(
  RECORD_WRITER_ROLES,
  async (ctx, input) => {
    const parsed = memberUpdateSchema.safeParse(input);
    if (!parsed.success) return validationFailure<null>(parsed.error);

    const patch = buildMemberPatch(parsed.data);

    const { error } = await ctx.supabase.rpc("update_member_record", {
      p_person_id: parsed.data.person_id,
      p_patch: patch,
      p_expected_updated_at: parsed.data.expected_updated_at,
    });

    if (error) {
      const code = typeof error.code === "string" ? error.code : "";

      // 22023 invalid_parameter_value — an unpatchable or unknown key reached the
      // function. Authorized caller, malformed request: `validation`, not `unauthorized`.
      if (code === "22023") return err<null>("validation");

      // P0002 no_data_found — the person does not exist, or (equivalently, from the
      // caller's side) they cannot see them. `not_found`, never "forbidden".
      if (code === "P0002") return err<null>("not_found");

      const mapped = mapDbError(error);
      // A 42501 here is either the wrong tier or a missing CBL Art. VIII §7.1
      // acknowledgement. Both mean the write did not happen; neither is worth
      // distinguishing at the point of a save, and `unauthorized` is honest for both
      // because it is a statement about the CALLER, not about the record's existence.
      return { ok: false, error: mapped };
    }

    revalidateMember(parsed.data.person_id);
    return ok(null);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// updateMembershipStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move a membership through the CBL Art. VII state machine (PRD US-D3, US-D5, US-D6).
 *
 * ⚠ A PLAIN TABLE UPDATE, ON PURPOSE. See the file header: this keeps BOTH
 * `memberships_update` (0014) and `enforce_membership_transition()` (0028) in the path.
 * Do not "tidy" this into an RPC.
 *
 * ⚠ ZERO ROWS AFFECTED IS `conflict`, NEVER `unauthorized`.
 * A zero-row UPDATE means one of three things and they are indistinguishable from here:
 *   · the row moved first (another admin decided seconds ago);
 *   · `memberships_update`'s USING half hid it — which, for a currently-`terminated` row,
 *     is exactly how CBL Art. VII §3.2.5-3.2.6 is enforced against a non-exec caller;
 *   · the membership does not exist.
 * Reporting the second case as "forbidden" would confirm that a named scholar has a
 * terminated membership — a disclosure with no data in it (CONVENTIONS.md §4.3). So all
 * three become `conflict`, whose message ("reload and try again") is the correct advice
 * in every one of them.
 *
 * ⚠ `ended_reason` IS WRITTEN IN THE SAME STATEMENT AS `status`, and it has to be. 0028
 * demands a FRESH ground for both `terminated` edges, comparing NEW to OLD — writing the
 * reason in a second UPDATE would leave the first one refused, and writing it first would
 * record a ground for a decision that had not happened yet.
 *
 * ⚠ NO SIGN-OUT. PRD US-H4 ("membership end revokes access") is v1.2 item 30 and is
 * deliberately not done here — it needs the service-role client, whose documented purpose
 * CLAUDE.md scopes to the invite flow and the backup job. Deferred and recorded, not
 * forgotten (BUILD_PLAN "Scope honesty"; S5-T19 dropped).
 */
export const updateMembershipStatus = withRole<MembershipStatusUpdateInput, null>(
  RECORD_WRITER_ROLES,
  async (ctx, input) => {
    const parsed = membershipStatusUpdateSchema.safeParse(input);
    if (!parsed.success) return validationFailure<null>(parsed.error);

    const { membership_id, status, ended_reason } = parsed.data;

    const { data, error } = await ctx.supabase
      .from("memberships")
      .update({ status, ended_reason: ended_reason ?? null })
      .eq("id", membership_id)
      // `person_id` comes back so the detail page can be revalidated without a second
      // read; it is not sensitive and is not rendered.
      .select("id, person_id");

    if (error) {
      const mapped = mapDbError(error);

      // 23514 check_violation is raised by three different guards in 0028 — an illegal
      // edge, a missing written ground, a too-short one — and `mapDbError` collapses all
      // of them to `validation` with no field. A form-level error on a two-field dialog
      // is useless, so the message is re-attached to `ended_reason`, which is where the
      // only fixable one of the three lives. (Same shape as `rejectApplication`.)
      if (mapped.code === "validation" && mapped.fields === undefined) {
        return {
          ok: false,
          error: { ...mapped, fields: { ended_reason: [mapped.message] } },
        };
      }

      // 42501 from the trigger's exec-only check on either terminated edge. The tier IS
      // the reason here and the caller can act on it (ask an Executive Admin), so
      // `unauthorized` is left as mapped rather than folded into `conflict`.
      return { ok: false, error: mapped };
    }

    const rows = data ?? [];
    if (rows.length === 0) return err<null>("conflict");

    revalidateMember(rows[0]?.person_id);
    return ok(null);
  },
);
