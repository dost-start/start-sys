// ─────────────────────────────────────────────────────────────────────────────
// `/campaigns/[id]` — one campaign: what it says, who it reaches, the send controls and
// the per-recipient delivery report (PRD items 20-26, US-G4, item 25).
//
// Server Component through the caller's client: `email_campaigns_read` and
// `email_recipients_read` (0043) are the authorization; a row RLS hides is `notFound()`,
// never "forbidden" (CONVENTIONS §4.3). The report shows each recipient's address to the
// SENDING tier and to nobody else — that is what the recipients policy says, and the
// address is already theirs: they sent to it.
//
// The rendered body is shown in a sandboxed iframe from `body_html`, which our own
// renderer produced from escaped input (lib/campaigns/markdown.ts).
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `campaign_detail`): a
// detail page keeps a VISIBLE <h1> — the subject — under a "Campaigns /" breadcrumb.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CampaignSendPanel } from "@/components/campaigns/campaign-send-panel";
import { CampaignStatusBadge } from "@/components/campaigns/campaign-status-badge";
import { Card, CardTitle } from "@/components/ui/card";
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
import { getCampaign, listAudienceOptions, listRecipients } from "@/lib/campaigns/queries";
import { audienceFilterSchema } from "@/lib/campaigns/schema";
import { TEMPLATES, isTemplateKey } from "@/lib/campaigns/templates";
import { mailTransportName } from "@/lib/mail";
import { canSendCampaigns } from "@/lib/campaigns/roles";

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

const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
  suppressed: "Suppressed",
};

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);
  if (!canSendCampaigns(ctx.role)) redirect(homeForRole(ctx.role));

  const campaign = await getCampaign(ctx, id);
  if (campaign === null) notFound();

  const [recipients, options] = await Promise.all([
    listRecipients(ctx, campaign.id),
    listAudienceOptions(ctx),
  ]);

  // The frozen filter, rendered as words. A stored filter always parses — it was written
  // by the same schema — but a hand-edited row must not crash the page.
  const parsedFilter = audienceFilterSchema.safeParse(campaign.audience_filter);
  const filter = parsedFilter.success ? parsedFilter.data : null;
  const regionName = new Map(options.regions.map((r) => [r.id, r.name]));
  const affiliationName = new Map(options.affiliations.map((a) => [a.id, a.name]));
  const positionTitle = new Map(options.positions.map((p) => [p.code, p.title]));

  const audienceLines: Array<{ label: string; value: string }> = filter
    ? [
        { label: "Status", value: filter.statuses.join(", ") },
        {
          label: "Year of membership",
          value: filter.join_years.length > 0 ? filter.join_years.join(", ") : "any",
        },
        {
          label: "Island group",
          value: filter.island_groups.length > 0 ? filter.island_groups.join(", ") : "any",
        },
        {
          label: "Region",
          value:
            filter.region_ids.length > 0
              ? filter.region_ids.map((rid) => regionName.get(rid) ?? rid).join(", ")
              : "any",
        },
        {
          label: "Role",
          value:
            filter.role_codes.length > 0
              ? filter.role_codes.map((code) => positionTitle.get(code) ?? code).join(", ")
              : "any",
        },
        {
          label: "Affiliation",
          value:
            filter.affiliation_ids.length > 0
              ? filter.affiliation_ids.map((aid) => affiliationName.get(aid) ?? aid).join(", ")
              : "any",
        },
      ]
    : [{ label: "Filter", value: "unreadable — the stored filter does not match the schema" }];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-brand-label text-sm">
          <Link href="/campaigns" className="text-brand-link hover:underline">
            Campaigns
          </Link>{" "}
          /
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1
            className="text-brand-ink text-[26px] leading-tight font-semibold"
            data-testid="campaign-subject"
          >
            {campaign.subject}
          </h1>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        <p className="text-brand-label text-sm">
          {isTemplateKey(campaign.template_key)
            ? TEMPLATES[campaign.template_key].label
            : campaign.template_key}{" "}
          · created {formatInstant(campaign.created_at)}
          {campaign.queued_at ? ` · queued ${formatInstant(campaign.queued_at)}` : ""}
          {campaign.sent_at ? ` · finished ${formatInstant(campaign.sent_at)}` : ""}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <section className="space-y-3">
          <h2 className="text-brand-ink text-lg leading-tight font-semibold">Message</h2>
          <Card className="overflow-hidden p-0">
            <iframe
              title="Rendered message"
              srcDoc={campaign.body_html}
              sandbox=""
              className="h-[28rem] w-full bg-white"
              data-testid="campaign-body-frame"
            />
          </Card>
          <p className="text-brand-label text-xs">
            Merge fields appear as written here and are filled in per recipient at send.
          </p>
        </section>

        <div className="space-y-6">
          <Card className="gap-4 p-5 sm:p-6">
            <CardTitle>Recipients</CardTitle>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
              {audienceLines.map((line) => (
                <div key={line.label} className="contents">
                  <dt className="text-brand-label pt-0.5 text-xs font-semibold tracking-[0.06em] uppercase">
                    {line.label}
                  </dt>
                  <dd className="text-brand-ink">{line.value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-brand-ink text-sm" data-testid="campaign-recipient-count">
              {campaign.status === "draft"
                ? "The list is resolved when it is frozen."
                : `${campaign.recipient_count} recipient${campaign.recipient_count === 1 ? "" : "s"} frozen.`}
            </p>
          </Card>

          <Card className="gap-4 p-5 sm:p-6">
            <CardTitle>Send</CardTitle>
            <CampaignSendPanel
              campaignId={campaign.id}
              status={campaign.status}
              recipientCount={campaign.recipient_count}
              sentCount={campaign.sent_count}
              failedCount={campaign.failed_count}
              transportName={mailTransportName()}
            />
          </Card>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-brand-ink text-lg leading-tight font-semibold">Delivery report</h2>
        {recipients.length === 0 ? (
          <Card className="border-border border border-dashed p-6 shadow-none">
            <p className="text-brand-label text-sm" data-testid="recipients-empty">
              No recipient rows yet — the list has not been frozen.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <Table className="min-w-[40rem]" data-testid="recipients-table">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Email</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Sent</TableHead>
                  <TableHead scope="col">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((row) => (
                  <TableRow key={row.id} data-testid={`recipient-${row.status}`}>
                    <TableCell className="text-brand-ink font-medium">{row.name}</TableCell>
                    <TableCell>{row.to_email}</TableCell>
                    <TableCell>{RECIPIENT_STATUS_LABEL[row.status] ?? row.status}</TableCell>
                    <TableCell>{formatInstant(row.sent_at)}</TableCell>
                    <TableCell className="text-brand-label whitespace-normal">
                      {row.error ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
        <p className="text-brand-label text-xs">
          &ldquo;Sent&rdquo; means the mail server accepted the message. The interim Gmail transport
          has no bounce reporting (ADR 0010); a bounced address shows up in the sending inbox, not
          here. All times in Asia/Manila.
        </p>
      </section>
    </div>
  );
}
