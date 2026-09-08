// Committee rosters, read-only (BUILD_PLAN S6-T11; PRD §3 v1.0 item 15, US-D2, US-E1).
//
// The other half of the officer surface: who sits on which committee this term.
//
// ═══════════════════════════════════════════════════════════════════════════════
// FOUR THINGS THIS PAGE DOES DELIBERATELY
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. A COMMITTEE WITH ZERO MEMBERS RENDERS, WITH A 0 AND AN EMPTY ROSTER. The committee
//    list is read from the `committees` TABLE rather than derived from the roster rows,
//    so a committee a CRRD Admin created this morning is visible this afternoon — which
//    is the whole point of CBL Art. III §5 making committees a row rather than a
//    migration (ARCHITECTURE.md §4.4). Deriving the list from `committee_memberships`
//    would make an empty committee indistinguishable from one that does not exist.
//
// 2. THE UNASSIGNED BUCKET IS ITS OWN GROUP. Members with no committee seat are the
//    largest group in most terms; omitting them would show a page accounting for a
//    handful of people while silently dropping everyone else.
//
// 3. NO MANAGEMENT CONTROLS. No create, rename, assign or remove. Committee management
//    is v1.1 item 18 and belongs to `crrd_admin` — `committees_insert` names that role
//    alone (0014 §5) and the officer tier holds no UPDATE policy anywhere, so a rendered
//    control could only produce a confusing failure. No Server Action is imported here.
//
// 4. SCOPED BY COMMITTEE ID, NOT BY A LIST OF MEMBERSHIPS. The roster read filters on
//    `committee_id in (this term's committees)` — committees are term-scoped
//    (`unique (term_id, code)`, DATA_MODEL.md §6/0007), so that predicate scopes the
//    term exactly, with a dozen-odd uuids rather than six hundred in the URL.
//
// ⚠ ROW SCOPING IS RLS's. `committee_memberships_read` and `memberships_read` (0014)
// resolve through the parent membership, so a regional rep reaching this page would see
// their own region's seats and nothing else — without a line here about regions.
//
// ⚠ NO SENSITIVE COLUMN. Only the six `people` columns 0015 grants to `authenticated`
// are selected. A `contact_number` here would fail with 42501, not render.
//
// Brand edition (2026-09-08): the page title is the shell's top bar ("Committees"), so
// the `<h1>` here is screen-reader-only; each roster is a full-bleed card with a header
// row, per docs/design/canvas/boards_other.py.
import { redirect } from "next/navigation";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { MemberStatusBadge } from "@/components/members/member-status-badge";
import { Card } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";
import { getCurrentTermId, getTermLabel } from "@/lib/dashboard/queries";
import { UNASSIGNED_COMMITTEE_LABEL } from "@/lib/dashboard/status-buckets";
import type { MembershipStatus } from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";

/** One person on a roster. Exactly the granted columns, and nothing beyond them. */
type RosterMember = {
  membership_id: string;
  member_id: string | null;
  given_name: string;
  family_name: string;
  status: MembershipStatus;
};

type RosterGroup = {
  key: string;
  name: string;
  /** The stable cross-term code (`OUTREACH`), or null for the unassigned bucket. */
  code: string | null;
  members: RosterMember[];
};

const byName = (a: RosterMember, b: RosterMember): number =>
  a.family_name.localeCompare(b.family_name) || a.given_name.localeCompare(b.given_name);

export default async function OfficerCommitteesPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.role === "member" || ctx.role === "regional_rep") redirect(homeForRole(ctx.role));

  const termId = await getCurrentTermId(ctx);

  if (termId === null) {
    return (
      <div className="space-y-4">
        <h1 className="sr-only">Committees</h1>
        <DashboardEmptyState
          message="No active term."
          detail="Committees are created per term (CBL Art. III §5), so there are none to show."
        />
      </div>
    );
  }

  const [committeesResult, membershipsResult, termLabel] = await Promise.all([
    ctx.supabase
      .from("committees")
      .select("id, code, name")
      .eq("term_id", termId)
      .order("name", { ascending: true }),
    ctx.supabase
      .from("memberships")
      .select("id, status, people ( member_id, given_name, family_name )")
      .eq("term_id", termId),
    getTermLabel(ctx, termId),
  ]);

  const committees = committeesResult.data ?? [];
  const memberships = membershipsResult.data ?? [];

  // The roster read. Scoped by this term's committee ids — see note 4 in the header.
  // Skipped entirely when the term has no committees, which is the normal state of a
  // term on the morning after rollover (committees are NOT carried forward).
  const rosterRows =
    committees.length === 0
      ? []
      : ((
          await ctx.supabase
            .from("committee_memberships")
            .select("committee_id, membership_id")
            .in(
              "committee_id",
              committees.map((c) => c.id),
            )
        ).data ?? []);

  // Index the term's members once. `people` is a to-one embed; a membership always has a
  // person (`person_id` is NOT NULL with an FK), so a null here can only mean the row was
  // filtered by RLS between the two reads — it is dropped rather than rendered blank.
  const membersById = new Map<string, RosterMember>();
  for (const row of memberships) {
    const person = row.people;
    if (person === null) continue;
    membersById.set(row.id, {
      membership_id: row.id,
      member_id: person.member_id,
      given_name: person.given_name,
      family_name: person.family_name,
      status: row.status,
    });
  }

  const seated = new Set<string>();
  const groups: RosterGroup[] = committees.map((committee) => {
    const members: RosterMember[] = [];
    for (const seat of rosterRows) {
      if (seat.committee_id !== committee.id) continue;
      const member = membersById.get(seat.membership_id);
      if (member === undefined) continue;
      seated.add(seat.membership_id);
      members.push(member);
    }
    return {
      key: committee.id,
      name: committee.name,
      code: committee.code,
      members: members.sort(byName),
    };
  });

  const unassigned = [...membersById.values()].filter((m) => !seated.has(m.membership_id));

  // ⚠ The named rosters plus the unassigned bucket total to MORE than the term headcount
  // whenever anyone holds two seats (CBL Art. III §5 sets no limit). Captioned below,
  // never reconciled by picking one committee per member (ADR 0007 §4).
  const allGroups: RosterGroup[] = [
    ...groups,
    {
      key: "__unassigned__",
      name: UNASSIGNED_COMMITTEE_LABEL,
      code: null,
      members: unassigned.sort(byName),
    },
  ];

  return (
    <div className="space-y-7">
      <h1 className="sr-only">Committees</h1>
      <p className="text-brand-body text-sm">
        {termLabel !== null ? `Term ${termLabel}` : "Current term"} · read-only
      </p>

      {committees.length === 0 ? (
        <DashboardEmptyState
          message="No committees have been created for this term."
          detail="Committees are discretionary and per-term (CBL Art. III §5); they are not carried forward at rollover. A CRRD Admin creates them."
        />
      ) : null}

      <div className="space-y-5">
        {allGroups.map((group) => (
          <Card key={group.key} className="overflow-hidden p-0">
            <div className="flex flex-wrap items-baseline gap-3 px-5 pt-5 pb-3">
              <h2 className="text-brand-ink text-lg font-semibold">{group.name}</h2>
              {group.code !== null ? (
                <span className="text-brand-label font-mono text-xs">{group.code}</span>
              ) : null}
              <span className="text-brand-label ml-auto text-sm tabular-nums">
                {group.members.length.toLocaleString()}
              </span>
            </div>

            {group.members.length === 0 ? (
              <p className="text-brand-label border-t border-[#eff0f2] px-5 py-3 text-sm">
                No members on this committee.
              </p>
            ) : (
              <ul>
                {group.members.map((member) => (
                  <li
                    key={member.membership_id}
                    className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-[#eff0f2] px-5 py-3 text-[13.5px]"
                  >
                    <span className="text-brand-label font-mono text-[13px]">
                      {member.member_id ?? "—"}
                    </span>
                    <span className="text-brand-ink">
                      {member.family_name}, {member.given_name}
                    </span>
                    <span className="ml-auto">
                      <MemberStatusBadge status={member.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <p className="text-brand-label text-xs">
        A member may serve on more than one committee (CBL Art. III §5), so these rosters do not add
        up to the term&rsquo;s headcount.
      </p>
    </div>
  );
}
