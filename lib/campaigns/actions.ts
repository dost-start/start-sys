"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Campaign Server Actions (PRD items 20-26; SRS "Email Sending" / "Form Sending").
//
//   previewAudienceAction  the composer's live count — the SAME RPC the send freezes from
//   createCampaign         validate, render the markdown once, store the draft
//   sendCampaign           freeze the audience into recipient rows (idempotent)
//   drainCampaign          send one chunk through the mail transport, record outcomes
//
// Every action opens with withRole(['crrd_admin','exec_admin']) — defence in depth; the
// RLS policies and the definer guards in 0043 refuse the same calls independently.
//
// The drain is deliberately a Server Action called in a loop from the campaign page
// rather than a background worker: no queue product, no cron, the CRRD watches the
// progress bar (PRD US-G4). A chunk that dies mid-way leaves leased rows that the next
// call (or the next day's call) re-claims after ten minutes. Nothing here logs an
// address or a body.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";

import { err, mapDbError, ok, validationFailure, type ActionResult } from "@/lib/action-result";
import { withRole } from "@/lib/auth/with-role";
import { getMailTransport } from "@/lib/mail";

import { markdownToHtml, markdownToText, wrapEmailHtml } from "./markdown";
import { assertMergeTokensKnown, mergeHtml, mergeText, type MergePayload } from "./merge";
import { previewAudience } from "./queries";
import { CAMPAIGN_ROLES } from "./roles";
import {
  audienceFilterSchema,
  campaignComposeSchema,
  campaignIdSchema,
  DRAIN_BATCH_SIZE,
} from "./schema";
import { TEMPLATES } from "./templates";
import type { AudiencePreview } from "./types";

const CAMPAIGNS_PATH = "/campaigns";

export const previewAudienceAction = withRole<unknown, AudiencePreview>(
  CAMPAIGN_ROLES,
  async (ctx, input) => {
    const parsed = audienceFilterSchema.safeParse(input);
    if (!parsed.success) return validationFailure<AudiencePreview>(parsed.error);
    const preview = await previewAudience(ctx, parsed.data);
    if (preview === null) return err<AudiencePreview>("unknown");
    return ok(preview);
  },
);

export type CreateCampaignResult = { id: string };

export const createCampaign = withRole<unknown, CreateCampaignResult>(
  CAMPAIGN_ROLES,
  async (ctx, input) => {
    const parsed = campaignComposeSchema.safeParse(input);
    if (!parsed.success) return validationFailure<CreateCampaignResult>(parsed.error);
    const { template_key, subject, body_markdown, audience } = parsed.data;

    // The schema already refused unknown tokens; this is the belt to that brace.
    try {
      assertMergeTokensKnown(subject);
      assertMergeTokensKnown(body_markdown);
    } catch (caught) {
      return err<CreateCampaignResult>("validation", (caught as Error).message);
    }

    const { data: termId, error: termError } = await ctx.supabase.rpc("current_term_id");
    if (termError || !termId) return err<CreateCampaignResult>("not_found", "No active term.");

    // Rendered ONCE, stored, and merged per recipient at send. The stored html carries the
    // merge tokens verbatim; every value is escaped when merged (lib/campaigns/merge.ts).
    const bodyHtml = wrapEmailHtml(markdownToHtml(body_markdown), subject);

    const { data, error } = await ctx.supabase
      .from("email_campaigns")
      .insert({
        term_id: termId,
        form_kind: TEMPLATES[template_key].formKind,
        template_key,
        subject,
        body_markdown,
        body_html: bodyHtml,
        audience_filter: audience,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: mapDbError(error) };

    revalidatePath(CAMPAIGNS_PATH);
    return ok({ id: data.id });
  },
);

export type SendCampaignResult = { queued: number };

export const sendCampaign = withRole<unknown, SendCampaignResult>(
  CAMPAIGN_ROLES,
  async (ctx, input) => {
    const parsed = campaignIdSchema.safeParse(input);
    if (!parsed.success) return validationFailure<SendCampaignResult>(parsed.error);
    const { data, error } = await ctx.supabase.rpc("send_campaign", {
      p_campaign_id: parsed.data.id,
    });
    if (error) return { ok: false, error: mapDbError(error) };
    revalidatePath(`${CAMPAIGNS_PATH}/${parsed.data.id}`);
    return ok({ queued: data ?? 0 });
  },
);

export type DrainCampaignResult = {
  sent: number;
  failed: number;
  /** Rows still queued after this chunk. Zero means the campaign is finished. */
  remaining: number;
  /** A transport-level stop (throttled / misconfigured): the caller should not loop on. */
  halted: "throttled" | "misconfigured" | null;
};

export const drainCampaign = withRole<unknown, DrainCampaignResult>(
  CAMPAIGN_ROLES,
  async (ctx, input): Promise<ActionResult<DrainCampaignResult>> => {
    const parsed = campaignIdSchema.safeParse(input);
    if (!parsed.success) return validationFailure<DrainCampaignResult>(parsed.error);
    const campaignId = parsed.data.id;

    const { data: campaign, error: campaignError } = await ctx.supabase
      .from("email_campaigns")
      .select("subject, body_html, body_markdown, status")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError || !campaign) return err<DrainCampaignResult>("not_found");
    if (campaign.status === "draft") {
      return err<DrainCampaignResult>("conflict", "Queue the campaign before sending it.");
    }

    const { data: batch, error: claimError } = await ctx.supabase.rpc("claim_campaign_batch", {
      p_campaign_id: campaignId,
      p_limit: DRAIN_BATCH_SIZE,
    });
    if (claimError) return { ok: false, error: mapDbError(claimError) };

    const transport = getMailTransport();
    const textTemplate = markdownToText(campaign.body_markdown);
    let sent = 0;
    let failed = 0;
    let halted: DrainCampaignResult["halted"] = null;

    for (const row of batch ?? []) {
      if (halted) break;
      const merge = (row.merge ?? {}) as MergePayload;
      let outcome:
        | { ok: true; providerMessageId: string | null }
        | { ok: false; reason: string; message: string };
      try {
        outcome = await transport.send({
          to: row.to_email,
          subject: mergeText(campaign.subject, merge),
          html: mergeHtml(campaign.body_html, merge),
          text: mergeText(textTemplate, merge),
          tag: row.recipient_id,
        });
      } catch (caught) {
        // A merge failure is a programmer error on a template that passed validation;
        // record it on the row rather than crashing the chunk.
        outcome = {
          ok: false,
          reason: "rejected",
          message: (caught as Error).message.slice(0, 200),
        };
      }

      const { error: finishError } = await ctx.supabase.rpc("finish_recipient", {
        p_recipient_id: row.recipient_id,
        p_ok: outcome.ok,
        p_provider_id: outcome.ok ? (outcome.providerMessageId ?? undefined) : undefined,
        p_error: outcome.ok ? undefined : outcome.message,
      });
      if (finishError) return { ok: false, error: mapDbError(finishError) };

      if (outcome.ok) sent += 1;
      else {
        failed += 1;
        if (outcome.reason === "throttled" || outcome.reason === "misconfigured") {
          halted = outcome.reason;
        }
      }
    }

    const { count } = await ctx.supabase
      .from("email_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "queued");

    revalidatePath(`${CAMPAIGNS_PATH}/${campaignId}`);
    return ok({ sent, failed, remaining: count ?? 0, halted });
  },
);
