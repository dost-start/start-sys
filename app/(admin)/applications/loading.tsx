// Skeleton for the applications queue (BUILD_PLAN S4-T18). Renders roughly
// `DEFAULT_APPLICATIONS_PER_PAGE` placeholder rows so the layout does not jump once
// the real page streams in.
import { DEFAULT_APPLICATIONS_PER_PAGE } from "@/lib/applications/schema";

const SKELETON_ROWS = Math.min(DEFAULT_APPLICATIONS_PER_PAGE, 10);

export default function ApplicationsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-56 animate-pulse rounded bg-muted" />
      </div>

      <div className="flex gap-1.5">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="h-10 border-b bg-muted/50" />
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 border-b p-3 last:border-0">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-5 w-16 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
