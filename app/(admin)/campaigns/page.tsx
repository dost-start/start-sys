// ─────────────────────────────────────────────────────────────────────────────
// `/campaigns` — every compose + send, newest first (PRD items 20-26; SRS "Email
// Sending"). Server Component reading through the caller's client, so
// `email_campaigns_read` (0043: crrd_admin, exec_admin) is the only authorization; the
// redirect below is UX for the tiers that would otherwise see an empty table.
//
// NO ADDRESSES on this page. The list carries subject, template, status and counts.
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `campaigns`): the page
// title lives in the shell's top bar, so the <h1> here is screen-reader-only.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { redirect } from "next/navigation";

import { CampaignStatusBadge } from "@/components/campaigns/campaign-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 sm:gap-6">
        <h1 className="sr-only">Campaigns</h1>
        <p className="text-brand-body max-w-3xl text-sm">
          Emails and form sends to scholars, filtered by year of membership, role, region, island
          group and affiliation. Every send is recorded here with its per-recipient delivery report.
        </p>
        <Button asChild className="ml-auto">
          <Link href="/campaigns/new">New campaign</Link>
        </Button>
      </header>

      {campaigns.length === 0 ? (
        <Card className="border-border border border-dashed p-6 shadow-none">
          <p className="text-brand-label text-sm" data-testid="campaigns-empty">
            No campaigns yet. Start one with &ldquo;New campaign&rdquo;.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table className="min-w-[48rem]" data-testid="campaigns-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Subject</TableHead>
                <TableHead scope="col">Template</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className="text-right">
                  Recipients
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Sent
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Failed
                </TableHead>
                <TableHead scope="col">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="max-w-md truncate">
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="text-brand-ink font-medium underline-offset-2 hover:underline"
                    >
                      {campaign.subject}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {isTemplateKey(campaign.template_key)
                      ? TEMPLATES[campaign.template_key].label
                      : campaign.template_key}
                  </TableCell>
                  <TableCell>
                    <CampaignStatusBadge status={campaign.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {campaign.recipient_count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{campaign.sent_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{campaign.failed_count}</TableCell>
                  <TableCell>{formatInstant(campaign.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <p className="text-brand-label text-xs">All times shown in Asia/Manila.</p>
    </div>
  );
}
