// A presentational mapping from `membership_status` to a badge variant + label
// (BUILD_PLAN S5-T20). Keyed by the generated enum via `MEMBERSHIP_STATUS_LABELS`
// (lib/members/transitions.ts), so a new status added to `0002_enums.sql` fails
// typecheck here rather than rendering as a blank badge.
//
// `terminated` gets its own `destructive` treatment, distinct from the other three
// terminal statuses — it is the CBL Art. VII §3 outcome, not a quiet non-renewal, and
// the badge should read differently at a glance (PRD US-D5).
import { Badge } from "@/components/ui/badge";
import { MEMBERSHIP_STATUS_LABELS, type MembershipStatus } from "@/lib/members/transitions";

const STATUS_VARIANT: Record<
  MembershipStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  renewal_pending: "outline",
  active: "default",
  graduated: "secondary",
  resigned: "secondary",
  left: "secondary",
  terminated: "destructive",
};

export function MemberStatusBadge({ status }: { status: MembershipStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{MEMBERSHIP_STATUS_LABELS[status]}</Badge>;
}
