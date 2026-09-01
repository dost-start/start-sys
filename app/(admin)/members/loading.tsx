// Loading skeleton for `/members` (BUILD_PLAN S5-T25). Renders `per_page` placeholder
// rows so the grid does not jump in height once real rows arrive. Plain
// `animate-pulse` divs rather than a vendored shadcn `Skeleton` — one more component to
// vendor for a shape this simple is not worth the time on a seven-day clock
// (BUILD_PLAN S1's "boring beats clever").
import { DEFAULT_MEMBERS_PER_PAGE } from "@/lib/members/filters";

export default function MembersLoading() {
  const rows = Array.from({ length: DEFAULT_MEMBERS_PER_PAGE }, (_, index) => index);

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-10 w-full max-w-sm animate-pulse rounded-md bg-muted" />
      <div className="h-40 w-full animate-pulse rounded-lg border bg-muted/40" />
      <div className="overflow-hidden rounded-md border">
        {rows.map((row) => (
          <div key={row} className="h-10 border-b bg-muted/30 last:border-b-0" />
        ))}
      </div>
    </div>
  );
}
