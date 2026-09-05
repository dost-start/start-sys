// ─────────────────────────────────────────────────────────────────────────────
// Who composes and sends campaigns: the CRRD (SRS "CRRD can use the platform to directly
// send emails") and the CEO/COO. One constant, three consumers — the Server Actions'
// withRole([...]) guard, and the two page-level redirects that are UX for everyone else.
//
// The gate that matters is 0043: `email_campaigns_*` policies and the four definers name
// exactly these two roles. Widening this list without widening those is a no-op; widening
// those without a pgTAP change fails CI. Regional-rep sending (PRD US-F3, rr_send_grants)
// is a separate, not-yet-built path and is NOT added here.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgRole } from "@/lib/auth/route-access";

export const CAMPAIGN_ROLES = ["crrd_admin", "exec_admin"] as const satisfies readonly OrgRole[];

export function canSendCampaigns(role: OrgRole): boolean {
  return (CAMPAIGN_ROLES as readonly OrgRole[]).includes(role);
}
