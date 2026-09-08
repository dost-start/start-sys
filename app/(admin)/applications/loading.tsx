// Skeleton for the applications queue (BUILD_PLAN S4-T18). Renders roughly
// `DEFAULT_APPLICATIONS_PER_PAGE` placeholder rows so the layout does not jump once
// the real page streams in. Brand edition (2026-09-08): the shapes mirror the queue's
// own layout — intro row, chip row, the white panel, the pagination row.
import { Card } from "@/components/ui/card";
import { DEFAULT_APPLICATIONS_PER_PAGE } from "@/lib/applications/schema";

const SKELETON_ROWS = Math.min(DEFAULT_APPLICATIONS_PER_PAGE, 10);

function Bone({ className }: { className: string }) {
  return <div className={`bg-brand-field rounded-form animate-pulse ${className}`} />;
}

export default function ApplicationsLoading() {
  return (
    <div className="space-y-5">
      <div className="flex min-h-11 flex-wrap items-start justify-between gap-4">
        <Bone className="h-4 w-56" />
        <Bone className="h-11 w-48 rounded-lg" />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Bone key={index} className="h-9 w-20 rounded-full" />
            ))}
          </div>
          <Bone className="ml-auto h-9 w-40 rounded-lg" />
        </div>

        <Card className="overflow-hidden p-0">
          <div className="h-11 border-b border-[#e6e7e9]" />
          {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 border-b border-[#eff0f2] px-4 py-3.5 last:border-0"
            >
              <Bone className="h-4 w-32" />
              <Bone className="h-6 w-20 rounded-full" />
              <Bone className="h-4 w-24" />
              <Bone className="h-4 w-32" />
              <Bone className="h-4 w-20" />
            </div>
          ))}
        </Card>

        <div className="flex items-center justify-between">
          <Bone className="h-4 w-40" />
          <div className="flex gap-2">
            <Bone className="h-9 w-24 rounded-lg" />
            <Bone className="h-9 w-20 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
