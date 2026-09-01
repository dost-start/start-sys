// Skeleton for the admin dashboard (BUILD_PLAN S6-T9).
//
// Shaped like the real page — one pending tile, one tile per membership status, two bar
// panels — so the layout does not jump when the four concurrent reads land. The tile
// count comes from the GENERATED enum rather than a literal, for the same reason the
// dashboard itself zero-fills from it: a status added by amendment must not leave the
// skeleton a row short of the page it is standing in for.
import { Constants } from "@/database.types";

const STATUS_TILES = Constants.public.Enums.membership_status.length;

export default function AdminDashboardLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: STATUS_TILES }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, panel) => (
          <div key={panel} className="space-y-3">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            {Array.from({ length: 6 }).map((_, row) => (
              <div key={row} className="space-y-1">
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-1.5 w-full rounded-full bg-muted" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
