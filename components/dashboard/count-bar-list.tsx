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
//
// Brand edition (2026-09-08): the `.bar` rule from the design canvas — a soft grey track
// with a light-blue → brand-blue gradient fill, the count in mono beside the label.
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
    return <p className="text-brand-label text-sm">{emptyLabel}</p>;
  }

  // Scale against the largest row so the panel uses its full width whatever the volume.
  // `Math.max(..., 1)` keeps an all-zero panel from dividing by zero — a brand-new term
  // renders every bar at 0 width with a visible "0", which is the correct screen the
  // morning after rollover (PRD US-H2).
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className="space-y-3.5">
      {rows.map((row) => {
        const percent = Math.round((row.value / max) * 100);

        const content = (
          <>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-brand-body truncate text-[13.5px]">{row.label}</span>
              {row.meta !== undefined ? (
                <span className="text-brand-label shrink-0 text-xs">{row.meta}</span>
              ) : null}
            </span>
            <span className="text-brand-label shrink-0 font-mono text-[13px] tabular-nums">
              {row.value.toLocaleString()}
            </span>
          </>
        );

        return (
          <li key={row.key} className="space-y-1.5">
            {row.href === null ? (
              <div className="flex items-baseline justify-between gap-3">{content}</div>
            ) : (
              <a
                href={row.href}
                className="focus-visible:ring-ring/50 flex items-baseline justify-between gap-3 rounded-sm no-underline hover:underline focus-visible:ring-[3px] focus-visible:outline-none"
              >
                {content}
              </a>
            )}
            {/* Decoration only — the number above is the content, so this is aria-hidden. */}
            <div
              className="bg-brand-field h-2 w-full overflow-hidden rounded-full"
              aria-hidden="true"
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  row.value > 0
                    ? "from-brand-blue-soft to-brand-blue bg-linear-to-r"
                    : "bg-transparent",
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
