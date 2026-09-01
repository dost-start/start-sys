// The member portal (BUILD_PLAN S6-T18; PRD US-E4, §2 Member tier).
//
// ═══════════════════════════════════════════════════════════════════════════════
// THIS STORY HAD NO SLICE OWNER AND WOULD HAVE BEEN FOUND MISSING AT THE REHEARSAL
// ═══════════════════════════════════════════════════════════════════════════════
// US-E4 — "a member can view their own current committee, department or organizational
// role" — sits under item 10's record surface and item 15's read-only theme and belongs
// to neither. It lands here (BUILD_PLAN's coverage matrix, "Plus one story with no slice
// owner, caught and assigned").
//
// ═══════════════════════════════════════════════════════════════════════════════
// EVERY READ IS SCOPED TWICE, AND THE SECOND SCOPE IS THE ONE THAT COUNTS
// ═══════════════════════════════════════════════════════════════════════════════
// Each query below filters on the caller's own `person_id` (or on their own membership
// id). That is UX and defence in depth. The ENFORCEMENT is `memberships_read`,
// `committee_memberships_read` and `department_assignments_read` (0014 §4, §5), whose
// member branches are `person_id = auth_person_id()` and, for the assignment tables, a
// resolution through the parent membership. Delete every `.eq(...)` below and this page
// still shows one person: their own.
//
// ⚠ NO ORGANIZATIONAL ROSTER IS REACHABLE FROM HERE. No list, no search, no link into
// `/directory` or `/members` — `canAccess` refuses the member tier both, and this page
// offers no route to them. The component it renders takes ONE record and has no shape
// for a list (components/members/member-own-assignment.tsx).
//
// ⚠ NO WRITE PATH. Member self-service profile editing is deferred (PRD §4: "v1 members
// see their own role/committee/department but do not edit their own record; CRRD owns
// the record"), so there is no form and no Server Action import here.
//
// ⚠ NO SENSITIVE COLUMN. Only the six `people` columns granted to `authenticated` are
// selected — a member's own birthdate and address are not on this page. Reading them
// would mean `get_member_record()`, which is exec/crrd/moderator only and writes an
// audit row (ADR 0006).
import { redirect } from "next/navigation";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import {
  MemberOwnAssignment,
  type MemberOwnAssignment as OwnAssignment,
} from "@/components/members/member-own-assignment";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";
import { getCurrentTermId } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";

// ⚠ ONE STRING LITERAL, NOT A CONCATENATION. supabase-js parses the select string as a
// TEMPLATE LITERAL TYPE to derive the row shape; `"a" + "b"` widens to `string` and the
// result collapses to an untyped error shape. Keep it on one line.
const MEMBERSHIP_SELECT =
  "id, status, year_level, term_id, people ( member_id, given_name, family_name ), regions ( name ), terms ( label )";

export default async function MemberPortalPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "member") redirect(homeForRole(ctx.role));

  // A `member` role with no `person_id` is an account that was invited but never bound
  // to a person. It is not an error and must not read as one — there is simply nothing
  // to show, and a CRRD Admin resolves it.
  if (ctx.personId === null) {
    return (
      <DashboardEmptyState
        message="Your account is not linked to a member record yet."
        detail="Contact the Community & Regional Relations Department to have it linked."
      />
    );
  }

  const termId = await getCurrentTermId(ctx);
  if (termId === null) {
    return (
      <DashboardEmptyState
        message="No active term."
        detail="Membership is recorded per term, so there is nothing to show yet."
      />
    );
  }

  const { data: membership } = await ctx.supabase
    .from("memberships")
    .select(MEMBERSHIP_SELECT)
    .eq("person_id", ctx.personId)
    .eq("term_id", termId)
    .maybeSingle();

  // No membership in the current term is an ordinary state — a member who has not
  // renewed yet, or whose renewal is still pending review. It is not a permission
  // failure and must not be reported as one (CONVENTIONS.md §4.3).
  if (!membership || membership.people === null) {
    return (
      <DashboardEmptyState
        message="You have no membership record for the current term."
        detail="If you have submitted a renewal, it is with the Community & Regional Relations Department for review."
      />
    );
  }

  const [committees, departments, positions] = await Promise.all([
    ctx.supabase
      .from("committee_memberships")
      .select("committees ( name )")
      .eq("membership_id", membership.id),
    ctx.supabase
      .from("department_assignments")
      .select("departments ( name )")
      .eq("membership_id", membership.id),
    // CBL positions held this term. `is_acting` is carried in the label because an acting
    // designation is distinguishable from a substantive appointment in every list
    // (PRD US-E7, CBL Art. VI §4.1-4.3).
    ctx.supabase
      .from("officer_assignments")
      .select("is_acting, status, officer_positions ( title )")
      .eq("person_id", ctx.personId)
      .eq("term_id", termId),
  ]);

  const record: OwnAssignment = {
    member_id: membership.people.member_id,
    given_name: membership.people.given_name,
    family_name: membership.people.family_name,
    status: membership.status,
    region_name: membership.regions?.name ?? "Not recorded",
    year_level: membership.year_level,
    term_label: membership.terms?.label ?? "Current term",
    committee_names: (committees.data ?? [])
      .map((row) => row.committees?.name)
      .filter((name): name is string => typeof name === "string"),
    department_names: (departments.data ?? [])
      .map((row) => row.departments?.name)
      .filter((name): name is string => typeof name === "string"),
    position_titles: (positions.data ?? [])
      // Only a sitting assignment is a position the member currently holds. A separation
      // under CBL Art. VI (resigned, dismissed, impeached, ended) is history, and showing
      // it here would tell a member they still hold an office they do not.
      .filter((row) => row.status === "active" || row.status === "on_leave")
      .map((row) => {
        const title = row.officer_positions?.title;
        if (typeof title !== "string") return null;
        return row.is_acting ? `${title} (acting)` : title;
      })
      .filter((title): title is string => title !== null),
  };

  return <MemberOwnAssignment record={record} />;
}
