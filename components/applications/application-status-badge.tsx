// A tiny presentational mapping from `application_status` to a badge variant + label
// (BUILD_PLAN S4-T18). Exhaustive over the four DB enum members so a new status added
// to `0002_enums.sql` fails typecheck here rather than rendering as a blank badge.
//
// `draft` is rendered defensively even though the review queue never requests it
// (`APPLICATION_QUEUE_STATUSES` in `lib/applications/schema.ts` omits it) — a stray
// direct link to a draft row must not crash this component.
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/database.types";

export type ApplicationStatusValue = Database["public"]["Enums"]["application_status"];

const STATUS_LABEL: Record<ApplicationStatusValue, string> = {
  draft: "Draft",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_VARIANT: Record<
  ApplicationStatusValue,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatusValue }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
