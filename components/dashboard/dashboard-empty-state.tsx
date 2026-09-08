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
//
// Brand edition (2026-09-08): a dashed-border card rather than a shadowed panel, so an
// empty state reads as a placeholder and not as a tile with a figure of zero.
import { Card } from "@/components/ui/card";

export type DashboardEmptyStateProps = {
  /** What is empty, e.g. "No members in this term yet." One sentence. */
  message: string;
  /** One further line of context — why this is expected, or what happens next. */
  detail?: string;
};

export function DashboardEmptyState({ message, detail }: DashboardEmptyStateProps) {
  return (
    <Card className="border-border items-start gap-1.5 border border-dashed p-5 shadow-none">
      <span className="text-brand-ink text-[32px] leading-none font-bold tabular-nums">0</span>
      <span className="text-brand-body text-sm">{message}</span>
      {detail !== undefined ? <span className="text-brand-label text-xs">{detail}</span> : null}
    </Card>
  );
}
