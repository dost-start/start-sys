// Loading skeleton for `/members` (BUILD_PLAN S5-T25). Renders `per_page` placeholder
// rows so the grid does not jump in height once real rows arrive. Plain
// `animate-pulse` divs rather than a vendored shadcn `Skeleton` — one more component to
// vendor for a shape this simple is not worth the time on a seven-day clock
// (BUILD_PLAN S1's "boring beats clever").
import { DEFAULT_MEMBERS_PER_PAGE } from "@/lib/members/filters";

const block = "bg-brand-field animate-pulse rounded-form";

export default function MembersLoading() {
  const rows = Array.from({ length: DEFAULT_MEMBERS_PER_PAGE }, (_, index) => index);

  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className={`${block} h-5 w-64`} />
      <div className="space-y-4">
        <div className={`${block} h-11 w-full max-w-sm`} />
        <div className={`${block} h-40 w-full`} />
      </div>
      <div className="bg-card rounded-form shadow-soft overflow-hidden">
        <div className="bg-brand-field/60 h-11 border-b border-[#eff0f2]" />
        {rows.map((row) => (
          <div key={row} className="h-12 border-b border-[#eff0f2] last:border-b-0" />
        ))}
      </div>
    </div>
  );
}
