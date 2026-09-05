// ─────────────────────────────────────────────────────────────────────────────
// Reads for the campaign surface. Every query runs through the caller's own client, so
// email_campaigns_read / email_recipients_read (crrd_admin, exec_admin) are the only
// authorization; an empty result for anyone else is RLS, never an error.
//
// The audience preview goes through resolve_recipients() — the SAME function
// send_campaign() freezes from — so the count the composer shows is the count the send
// uses (PRD US-G2). The preview returns names and counts, never addresses: an address
// leaves the database only as a frozen recipient row, at send time.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import type { Database, Tables } from "@/database.types";
import type { ActionContext } from "@/lib/auth/with-role";

import type { AudienceFilter } from "./schema";

export type CampaignRow = Tables<"email_campaigns">;
export type RecipientRow = Tables<"email_recipients">;
export type CampaignListRow = Pick<
  CampaignRow,
  | "id"
  | "template_key"
  | "form_kind"
  | "subject"
  | "status"
  | "recipient_count"
  | "sent_count"
  | "failed_count"
  | "created_at"
  | "sent_at"
>;

const LIST_COLUMNS =
  "id, template_key, form_kind, subject, status, recipient_count, sent_count, failed_count, created_at, sent_at";

export async function listCampaigns(ctx: ActionContext): Promise<CampaignListRow[]> {
  const { data, error } = await ctx.supabase
    .from("email_campaigns")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return data;
}

export async function getCampaign(ctx: ActionContext, id: string): Promise<CampaignRow | null> {
  const { data, error } = await ctx.supabase
    .from("email_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/** The delivery report (PRD item 25): per-recipient status. Addresses are shown to the sender. */
export type RecipientReportRow = Pick<
  RecipientRow,
  "id" | "to_email" | "status" | "provider_message_id" | "error" | "sent_at"
> & { name: string };

export async function listRecipients(ctx: ActionContext, campaignId: string): Promise<RecipientReportRow[]> {
  const { data, error } = await ctx.supabase
    .from("email_recipients")
    .select("id, to_email, merge, status, provider_message_id, error, sent_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error || !data) return [];
  return data.map((row) => {
    const merge = (row.merge ?? {}) as Record<string, unknown>;
    const given = typeof merge.given_name === "string" ? merge.given_name : "";
    const family = typeof merge.family_name === "string" ? merge.family_name : "";
    return {
      id: row.id,
      to_email: row.to_email,
      status: row.status,
      provider_message_id: row.provider_message_id,
      error: row.error,
      sent_at: row.sent_at,
      name: `${family}, ${given}`.replace(/^, |, $/g, "").trim() || "—",
    };
  });
}

export type AudiencePreview = {
  count: number;
  /** Up to five "Family, Given · Region" lines. Names only — never an address. */
  sample: string[];
};

/** Resolve the audience exactly as the send will. crrd_admin / exec_admin only (the RPC refuses others). */
export async function previewAudience(
  ctx: ActionContext,
  filter: AudienceFilter,
): Promise<AudiencePreview | null> {
  const { data, error } = await ctx.supabase.rpc("resolve_recipients", {
    p_filter: filter as unknown as Database["public"]["Functions"]["resolve_recipients"]["Args"]["p_filter"],
  });
  if (error || !data) return null;
  const sample = data.slice(0, 5).map((row) => {
    const merge = (row.merge ?? {}) as Record<string, unknown>;
    const given = typeof merge.given_name === "string" ? merge.given_name : "";
    const family = typeof merge.family_name === "string" ? merge.family_name : "";
    const region = typeof merge.region_name === "string" ? merge.region_name : "";
    return `${family}, ${given}${region ? ` · ${region}` : ""}`;
  });
  return { count: data.length, sample };
}

export type AudienceOptions = {
  regions: Array<{ id: string; name: string; island_group: string }>;
  affiliations: Array<{ id: string; name: string }>;
  positions: Array<{ code: string; title: string }>;
  joinYears: number[];
};

/** The choice lists behind the five filter axes. Reference tables; a rep or officer sees them too, harmlessly. */
export async function listAudienceOptions(ctx: ActionContext): Promise<AudienceOptions> {
  const [regions, affiliations, positions, years] = await Promise.all([
    ctx.supabase.from("regions").select("id, name, island_group").order("sort_order"),
    ctx.supabase.from("affiliations").select("id, name").eq("is_active", true).order("name"),
    ctx.supabase.from("officer_positions").select("code, title").order("sort_order"),
    ctx.supabase.from("people").select("join_year").order("join_year", { ascending: false }).limit(2000),
  ]);
  const joinYears = [...new Set((years.data ?? []).map((r) => r.join_year))].sort((a, b) => b - a);
  return {
    regions: regions.data ?? [],
    affiliations: affiliations.data ?? [],
    positions: positions.data ?? [],
    joinYears,
  };
}
