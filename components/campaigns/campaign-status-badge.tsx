import { Badge } from "@/components/ui/badge";
import type { Enums } from "@/database.types";

type CampaignStatus = Enums<"campaign_status">;

/** Labels keyed by the generated enum, so a new value is a compile error here rather than a blank badge. */
const LABELS: Record<
  CampaignStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "outline" },
  queued: { label: "Queued", variant: "secondary" },
  sending: { label: "Sending", variant: "secondary" },
  sent: { label: "Sent", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const entry = LABELS[status];
  return (
    <Badge variant={entry.variant} data-testid={`campaign-status-${status}`}>
      {entry.label}
    </Badge>
  );
}
