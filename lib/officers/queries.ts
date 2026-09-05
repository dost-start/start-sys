// ─────────────────────────────────────────────────────────────────────────────
// Reads for the /officers roster (ADR 0012). Runs through the CALLER'S OWN client:
// `officer_assignments_read` (0014) is `using (true)` for every authenticated tier — the
// org chart is org-public (PRD US-E4) — so no RPC is needed to LIST it. Column exposure
// on `people` is cut by 0015's six-column GRANT, which already covers everything this
// roster renders (id, member_id, given_name, family_name).
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import type { ActionContext } from "@/lib/auth/with-role";
import type { OfficerAssignmentStatus } from "@/lib/officers/schema";

export type OfficerHolderPerson = {
  id: string;
  member_id: string | null;
  given_name: string;
  family_name: string;
};

export type OfficerHolder = {
  assignment_id: string;
  status: OfficerAssignmentStatus;
  is_acting: boolean;
  status_note: string | null;
  person: OfficerHolderPerson;
};

export type OfficerPositionRow = {
  code: string;
  title: string;
  sort_order: number;
  is_administrator: boolean;
  /** Empty means vacant (CBL Art. VI §4: a vacancy is the ABSENCE of a sitting row, never a stored status). */
  holders: OfficerHolder[];
};

export type OfficerRoster = {
  term_id: string | null;
  positions: OfficerPositionRow[];
};

/**
 * The current term's officer roster, every seeded position with its holder(s).
 *
 * REGIONAL_REP and COMMITTEE_MEMBER are multi-seat positions (CBL Art. III §4.6, §5) —
 * every holder is listed, never just one, and `holders.length === 0` is what "vacant"
 * means for them too. `on_leave` and `suspended` holders are included alongside `active`
 * ones: a leave or a suspension does not remove someone from the roster, it changes their
 * standing on it (DATA_MODEL.md §3.4) — only the terminal statuses (`resigned`,
 * `dismissed`, `impeached`, `ended`) drop a row out of view here.
 *
 * Returns an empty roster rather than throwing when there is no active term or the
 * `officer_positions` read fails — the page renders its own empty state.
 */
export async function listOfficerRoster(ctx: ActionContext): Promise<OfficerRoster> {
  const { data: termId } = await ctx.supabase.rpc("current_term_id");
  if (!termId) return { term_id: null, positions: [] };

  const { data: positions, error: positionsError } = await ctx.supabase
    .from("officer_positions")
    .select("code, title, sort_order, is_administrator")
    .order("sort_order", { ascending: true });

  if (positionsError || !positions) return { term_id: termId, positions: [] };

  const { data: assignments } = await ctx.supabase
    .from("officer_assignments")
    .select(
      "id, role, status, is_acting, status_note, person:people!officer_assignments_person_id_fkey(id, member_id, given_name, family_name)",
    )
    .eq("term_id", termId)
    .in("status", ["active", "on_leave", "suspended"] satisfies OfficerAssignmentStatus[]);

  const holdersByRole = new Map<string, OfficerHolder[]>();
  for (const row of assignments ?? []) {
    if (!row.person) continue; // RLS-hidden or orphaned; do not render a headless holder
    const list = holdersByRole.get(row.role) ?? [];
    list.push({
      assignment_id: row.id,
      status: row.status,
      is_acting: row.is_acting,
      status_note: row.status_note,
      person: row.person,
    });
    holdersByRole.set(row.role, list);
  }

  return {
    term_id: termId,
    positions: positions.map((position) => ({
      code: position.code,
      title: position.title,
      sort_order: position.sort_order,
      is_administrator: position.is_administrator,
      holders: holdersByRole.get(position.code) ?? [],
    })),
  };
}
