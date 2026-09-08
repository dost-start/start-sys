import { Badge } from "@/components/ui/badge";
import type { Enums } from "@/database.types";

type CampaignStatus = Enums<"campaign_status">;

/**
 * Labels keyed by the generated enum, so a new value is a compile error here rather than a
 * blank badge. Tones follow the design canvas's STATUS_TONE (docs/design/canvas/
 * boards_admin.py): draft and the queue states are neutral/info, only the outcome is
 * success or danger.
 */
const LABELS: Record<
  CampaignStatus,
  { label: string; variant: "neutral" | "info" | "success" | "danger" }
> = {
  draft: { label: "Draft", variant: "neutral" },
  queued: { label: "Queued", variant: "info" },
  sending: { label: "Sending", variant: "info" },
  sent: { label: "Sent", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const entry = LABELS[status];
  return (
    <Badge variant={entry.variant} data-testid={`campaign-status-${status}`}>
      {entry.label}
    </Badge>
  );
}
