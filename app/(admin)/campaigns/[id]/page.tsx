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
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CampaignSendPanel } from "@/components/campaigns/campaign-send-panel";
import { CampaignStatusBadge } from "@/components/campaigns/campaign-status-badge";
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
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm">
          <Link href="/campaigns" className="hover:underline">
            Campaigns
          </Link>{" "}
          /
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="campaign-subject">
            {campaign.subject}
          </h1>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          {isTemplateKey(campaign.template_key)
            ? TEMPLATES[campaign.template_key].label
            : campaign.template_key}{" "}
          · created {formatInstant(campaign.created_at)}
          {campaign.queued_at ? ` · queued ${formatInstant(campaign.queued_at)}` : ""}
          {campaign.sent_at ? ` · finished ${formatInstant(campaign.sent_at)}` : ""}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Message</h2>
          <iframe
            title="Rendered message"
            srcDoc={campaign.body_html}
            sandbox=""
            className="h-[28rem] w-full rounded-lg border bg-white"
            data-testid="campaign-body-frame"
          />
          <p className="text-muted-foreground text-xs">
            Merge fields appear as written here and are filled in per recipient at send.
          </p>
        </section>

        <div className="space-y-8">
          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="text-base font-semibold">Recipients</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {audienceLines.map((line) => (
                <div key={line.label} className="contents">
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm" data-testid="campaign-recipient-count">
              {campaign.status === "draft"
                ? "The list is resolved when it is frozen."
                : `${campaign.recipient_count} recipient${campaign.recipient_count === 1 ? "" : "s"} frozen.`}
            </p>
          </section>

          <section className="space-y-3 rounded-lg border p-4">
            <h2 className="text-base font-semibold">Send</h2>
            <CampaignSendPanel
              campaignId={campaign.id}
              status={campaign.status}
              recipientCount={campaign.recipient_count}
              sentCount={campaign.sent_count}
              failedCount={campaign.failed_count}
              transportName={mailTransportName()}
            />
          </section>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Delivery report</h2>
        {recipients.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="recipients-empty">
            No recipient rows yet — the list has not been frozen.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table
              className="w-full min-w-[40rem] text-left text-sm"
              data-testid="recipients-table"
            >
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Sent
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((row) => (
                  <tr key={row.id} className="border-t" data-testid={`recipient-${row.status}`}>
                    <td className="px-4 py-2">{row.name}</td>
                    <td className="px-4 py-2">{row.to_email}</td>
                    <td className="px-4 py-2">
                      {RECIPIENT_STATUS_LABEL[row.status] ?? row.status}
                    </td>
                    <td className="px-4 py-2">{formatInstant(row.sent_at)}</td>
                    <td className="text-muted-foreground px-4 py-2">{row.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          &ldquo;Sent&rdquo; means the mail server accepted the message. The interim Gmail transport
          has no bounce reporting (ADR 0010); a bounced address shows up in the sending inbox, not
          here. All times in Asia/Manila.
        </p>
      </section>
    </div>
  );
}
