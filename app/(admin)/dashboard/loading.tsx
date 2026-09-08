// Skeleton for the admin dashboard (BUILD_PLAN S6-T9).
//
// Shaped like the real page — the intro row, one pending tile, one tile per membership
// status, two bar panels — so the layout does not jump when the four concurrent reads
// land. The tile count comes from the GENERATED enum rather than a literal, for the same
// reason the dashboard itself zero-fills from it: a status added by amendment must not
// leave the skeleton a row short of the page it is standing in for.
import { Constants } from "@/database.types";

const STATUS_TILES = Constants.public.Enums.membership_status.length;

const block = "bg-brand-field animate-pulse rounded-form";

export default function AdminDashboardLoading() {
  return (
    <div className="space-y-7" aria-busy="true" aria-live="polite">
      <div className="flex items-start justify-between gap-4">
        <div className={`${block} h-5 w-36`} />
        <div className={`${block} h-5 w-32`} />
      </div>

      <div className="space-y-3">
        <div className={`${block} h-3 w-24`} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className={`${block} h-[108px]`} />
        </div>
      </div>

      <div className="space-y-3">
        <div className={`${block} h-3 w-32`} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: STATUS_TILES }).map((_, index) => (
            <div key={index} className={`${block} h-[108px]`} />
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, panel) => (
          <div key={panel} className="bg-card rounded-form shadow-soft space-y-4 p-5 sm:p-6">
            <div className={`${block} h-3 w-32`} />
            {Array.from({ length: 6 }).map((_, row) => (
              <div key={row} className="space-y-1.5">
                <div className={`${block} h-4 w-full`} />
                <div className="bg-brand-field h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
