// Horizontal count bars for the region and committee panels (BUILD_PLAN S6-T8).
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ NO CHARTING LIBRARY, AND THAT IS A SCOPE DECISION RATHER THAN A SHORTCUT
// ═══════════════════════════════════════════════════════════════════════════════
// PRD §4 excludes advanced analytics — "dashboards show counts and lists. No trend
// analysis, cohort modelling, forecasting or BI." A bar here is a `<div>` with a
// percentage width. Adding recharts or d3 would be a new runtime dependency for a 2029
// officer to upgrade, a new client bundle, and an ADR (ARCHITECTURE.md §1) — to draw a
// rectangle. ADR 0007 §3 records the decision.
//
// The width is DECORATION; the number is the content. The figure is rendered as text on
// every row, so the panel is fully readable with CSS disabled, by a screen reader, and
// at 375px — where the bars themselves are nearly meaningless.
//
// A row with `href === null` renders as a plain figure rather than an anchor. That is
// how the unassigned-committee bucket is drawn: it has a true count and no encodable
// filter, so it must show the number without pretending to be clickable (links.ts).
import { cn } from "@/lib/utils";

export type CountBarRow = {
  /** Stable React key — a uuid, or a sentinel for the unassigned bucket. */
  key: string;
  label: string;
  value: number;
  /** Where this row's members are listed, or `null` for a non-interactive row. */
  href: string | null;
  /** Optional secondary label, e.g. an island group or a region code. */
  meta?: string;
};

export type CountBarListProps = {
  rows: readonly CountBarRow[];
  /** Rendered when `rows` is empty. */
  emptyLabel?: string;
};

export function CountBarList({ rows, emptyLabel = "No data for this term." }: CountBarListProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  // Scale against the largest row so the panel uses its full width whatever the volume.
  // `Math.max(..., 1)` keeps an all-zero panel from dividing by zero — a brand-new term
  // renders every bar at 0 width with a visible "0", which is the correct screen the
  // morning after rollover (PRD US-H2).
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const percent = Math.round((row.value / max) * 100);

        const content = (
          <>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-sm">{row.label}</span>
              {row.meta !== undefined ? (
                <span className="shrink-0 text-xs text-muted-foreground">{row.meta}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {row.value.toLocaleString()}
            </span>
          </>
        );

        return (
          <li key={row.key} className="space-y-1">
            {row.href === null ? (
              <div className="flex items-baseline justify-between gap-3">{content}</div>
            ) : (
              <a
                href={row.href}
                className="flex items-baseline justify-between gap-3 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {content}
              </a>
            )}
            {/* Decoration only — the number above is the content, so this is aria-hidden. */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className={cn(
                  "h-full rounded-full",
                  row.value > 0 ? "bg-primary" : "bg-transparent",
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
