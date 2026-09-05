// ─────────────────────────────────────────────────────────────────────────────
// `/campaigns` — every compose + send, newest first (PRD items 20-26; SRS "Email
// Sending"). Server Component reading through the caller's client, so
// `email_campaigns_read` (0043: crrd_admin, exec_admin) is the only authorization; the
// redirect below is UX for the tiers that would otherwise see an empty table.
//
// NO ADDRESSES on this page. The list carries subject, template, status and counts.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { redirect } from "next/navigation";

import { CampaignStatusBadge } from "@/components/campaigns/campaign-status-badge";
import { Button } from "@/components/ui/button";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/route-access";
import { listCampaigns } from "@/lib/campaigns/queries";
import { canSendCampaigns } from "@/lib/campaigns/roles";
import { TEMPLATES, isTemplateKey } from "@/lib/campaigns/templates";

export const dynamic = "force-dynamic";

const MANILA = "Asia/Manila";

function formatInstant(value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: MANILA,
  }).format(new Date(value));
}

export default async function CampaignsPage() {
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);
  if (!canSendCampaigns(ctx.role)) redirect(homeForRole(ctx.role));

  const campaigns = await listCampaigns(ctx);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Emails and form sends to scholars, filtered by year of membership, role, region, island
            group and affiliation. Every send is recorded here with its per-recipient delivery
            report.
          </p>
        </div>
        <Button asChild>
          <Link href="/campaigns/new">New campaign</Link>
        </Button>
      </header>

      {campaigns.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="campaigns-empty">
          No campaigns yet. Start one with &ldquo;New campaign&rdquo;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[48rem] text-left text-sm" data-testid="campaigns-table">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Subject
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Template
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Recipients
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Sent
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Failed
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="border-t">
                  <td className="px-4 py-2">
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {campaign.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {isTemplateKey(campaign.template_key)
                      ? TEMPLATES[campaign.template_key].label
                      : campaign.template_key}
                  </td>
                  <td className="px-4 py-2">
                    <CampaignStatusBadge status={campaign.status} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{campaign.recipient_count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{campaign.sent_count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{campaign.failed_count}</td>
                  <td className="px-4 py-2">{formatInstant(campaign.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground text-xs">All times shown in Asia/Manila.</p>
    </div>
  );
}
