// ─────────────────────────────────────────────────────────────────────────────
// Shared zod schemas for the campaign composer (CONVENTIONS §6: one schema, bound to the
// client form and re-run inside the Server Action). Keys are snake_case because the
// audience filter is stored verbatim as `email_campaigns.audience_filter` and read by
// `resolve_recipients()` under exactly these names (0043).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

import { unknownMergeTokens } from "./merge";
import { TEMPLATE_KEYS } from "./templates";

export const ISLAND_GROUPS = ["Luzon", "Visayas", "Mindanao"] as const;

export const AUDIENCE_STATUSES = [
  "active",
  "renewal_pending",
  "graduated",
  "resigned",
  "left",
  "terminated",
] as const;

const uuidList = z.array(z.uuid()).max(50).default([]);
const codeList = z.array(z.string().trim().min(1).max(40)).max(50).default([]);
/** Hand-picked people. 1,000 is far above the org (~600 members + 70 officers). */
const personList = z.array(z.uuid()).max(1000).default([]);

export const YEAR_LEVELS = [1, 2, 3, 4, 5] as const;

/**
 * The audience of a campaign, stored verbatim as `email_campaigns.audience_filter` and
 * read by `resolve_recipients()` / `list_audience_candidates()` under exactly these keys
 * (0043, 0047). Two halves:
 *
 *   FILTER AXES — every array is "any of"; empty means "no filter on this axis". The five
 *   PRD US-G2 axes plus department, committee, university and year level (2026-09-06).
 *
 *   SELECTION — `select_all` true (the default, and what every pre-0047 campaign means)
 *   takes everyone the axes match; false takes nobody from the axes. `person_ids` are
 *   ALWAYS added (a hand-pick survives a filter change); `excluded_person_ids` are ALWAYS
 *   removed. So: recipients = (select_all ? matches : ∅) ∪ person_ids − excluded_person_ids.
 */
export const audienceFilterSchema = z
  .object({
    join_years: z.array(z.coerce.number().int().min(2000).max(2100)).max(30).default([]),
    region_ids: uuidList,
    island_groups: z.array(z.enum(ISLAND_GROUPS)).max(3).default([]),
    statuses: z.array(z.enum(AUDIENCE_STATUSES)).max(6).default(["active"]),
    affiliation_ids: uuidList,
    role_codes: codeList,
    department_ids: uuidList,
    committee_ids: uuidList,
    university_ids: uuidList,
    year_levels: z.array(z.coerce.number().int().min(1).max(5)).max(5).default([]),
    select_all: z.boolean().default(true),
    person_ids: personList,
    excluded_person_ids: personList,
  })
  .strict();

export type AudienceFilter = z.infer<typeof audienceFilterSchema>;

/** One page of the composer's people picker. */
export const AUDIENCE_PAGE_SIZE = 50;

export const audienceCandidatesQuerySchema = z
  .object({
    audience: audienceFilterSchema,
    q: z.string().trim().max(80).default(""),
    page: z.coerce.number().int().min(1).max(200).default(1),
  })
  .strict();

export type AudienceCandidatesQuery = z.infer<typeof audienceCandidatesQuerySchema>;

/** Gmail sends roughly 500 messages a day (ADR 0010); the composer warns from here on. */
export const DAILY_SEND_WARNING_THRESHOLD = 400;

export const campaignComposeSchema = z
  .object({
    template_key: z.enum(TEMPLATE_KEYS),
    subject: z
      .string()
      .trim()
      .min(1, "Enter a subject")
      .max(200, "Subject must be 200 characters or fewer")
      .refine((value) => unknownMergeTokens(value).length === 0, {
        message: "The subject uses a merge token that does not exist",
      }),
    body_markdown: z
      .string()
      .min(1, "Write the message")
      .max(20000, "The message must be 20,000 characters or fewer")
      .refine((value) => unknownMergeTokens(value).length === 0, {
        message: "The message uses a merge token that does not exist",
      }),
    audience: audienceFilterSchema,
  })
  .strict();

export type CampaignComposeInput = z.infer<typeof campaignComposeSchema>;

export const campaignIdSchema = z.object({ id: z.uuid() }).strict();
export type CampaignIdInput = z.infer<typeof campaignIdSchema>;

/** One drain step: up to this many messages per Server Action call. */
export const DRAIN_BATCH_SIZE = 25;
