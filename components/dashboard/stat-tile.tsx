// A single dashboard figure (BUILD_PLAN S6-T8).
//
// ⚠ IT RENDERS AS AN ANCHOR WHENEVER IT HAS AN href, AND THAT IS A REQUIREMENT.
// PRD US-D4: "every number links through to the filtered list that produced it." A
// figure a reader cannot click is a dead end — they go to the member list and rebuild
// the filter by hand, get a different number, and now distrust the dashboard.
//
// ⚠ NO SERVER COMPONENT, NO FETCH, NO CLIENT DIRECTIVE. It takes an already-aggregated
// number as a prop. Both halves matter: a component that fetched would need a Supabase
// client, and a `'use client'` component that fetched would be one refactor away from
// selecting a column it must not (CONVENTIONS.md §1.3, CLAUDE.md "Privacy" — PII is read
// in Server Components and passed only as far as the rendered screen requires).
//
// Plain `<a>` rather than `next/link`: these are cross-route-group navigations that
// should re-run the layout gate on the server, and there is no prefetch worth the
// complexity on a page with twenty of them.
import { cn } from "@/lib/utils";

export type StatTileProps = {
  /** What is being counted, e.g. "Active". */
  label: string;
  /** The already-aggregated figure. Rendered verbatim — 0 is a real answer, not empty. */
  value: number;
  /** Where the number came from. `null` renders a non-interactive tile — see links.ts. */
  href?: string | null;
  /** One short line under the figure, e.g. a term label or a caveat. Optional. */
  hint?: string;
  /** Draws the eye to the tile that needs action (the pending-application count). */
  emphasis?: boolean;
};

export function StatTile({ label, value, href = null, hint, emphasis = false }: StatTileProps) {
  const body = (
    <>
      <span className="text-sm text-muted-foreground">{label}</span>
      {/* `toLocaleString` so 1,204 is readable; `0` still renders as "0". */}
      <span className="text-3xl font-semibold tabular-nums tracking-tight">
        {value.toLocaleString()}
      </span>
      {hint !== undefined ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </>
  );

  const className = cn(
    "flex min-w-0 flex-col gap-1 rounded-lg border p-4",
    emphasis ? "border-primary/40 bg-primary/5" : "bg-card",
    href !== null
      ? "transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      : null,
  );

  if (href === null) {
    return <div className={className}>{body}</div>;
  }

  return (
    <a href={href} className={className}>
      {body}
    </a>
  );
}
