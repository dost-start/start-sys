// The "there is nothing here yet, and that is correct" panel (BUILD_PLAN S6-T8).
//
// ⚠ IT RENDERS AN EXPLICIT `0`, NEVER A BLANK PANEL. On the morning after term rollover
// the active term genuinely has zero memberships — nothing was deleted and no data moved
// (PRD US-H2, ARCHITECTURE.md §4.3: "wiped clean" is true of the VIEW, never of the
// data). A blank panel on that morning reads as a broken dashboard, and the officer's
// next move is to go looking for the missing rows.
//
// ⚠ IT MUST NEVER SAY "you do not have permission". An RLS-filtered aggregate is legally
// empty for several tiers, and "forbidden" would confirm rows exist that this caller
// cannot see (CONVENTIONS.md §4.3). The copy says what the number is, not who may see it.
export type DashboardEmptyStateProps = {
  /** What is empty, e.g. "No members in this term yet." One sentence. */
  message: string;
  /** One further line of context — why this is expected, or what happens next. */
  detail?: string;
};

export function DashboardEmptyState({ message, detail }: DashboardEmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed p-4">
      <span className="text-3xl font-semibold tabular-nums tracking-tight">0</span>
      <span className="text-sm">{message}</span>
      {detail !== undefined ? (
        <span className="text-xs text-muted-foreground">{detail}</span>
      ) : null}
    </div>
  );
}
