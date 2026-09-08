// ─────────────────────────────────────────────────────────────────────────────
// Shared zod schemas for the campaign composer (CONVENTIONS §6: one schema, bound to the
// client form and re-run inside the Server Action). Keys are snake_case because the
// audience filter is stored verbatim as `email_campaigns.audience_filter` and read by
// `resolve_recipients()` under exactly these names (0043).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

import { unknownMergeTokens } from "./merge";
import {
  byteLength,
  HTML_BODY_MAX_BYTES,
  TOKEN_IN_ATTRIBUTE_MESSAGE,
  hasTokenInAttribute,
} from "./sanitize";
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

/**
 * How the stored body is written (ADR 0014). `email_campaigns.body_markdown` holds the
 * SOURCE the CRRD typed or pasted either way; this says which language it is in, and
 * therefore which renderer turns it into the `body_html` that is actually sent.
 *
 *   markdown  the Telegram-style subset (lib/campaigns/markdown.ts) — escaped first, so
 *             only our own tags can reach a mailbox
 *   html      a designed template pasted from an email builder — run through the
 *             allowlist in lib/campaigns/sanitize.ts, which is what replaces the
 *             escape-first guarantee for this path
 *
 * A campaign stored before 2026-09-07 has no `body_format` and is markdown, which is
 * what the column default and this schema's default both say.
 */
export const BODY_FORMATS = ["markdown", "html"] as const;
export type BodyFormat = (typeof BODY_FORMATS)[number];

/** The markdown body cap, unchanged since 0043 and matching the CHECK on the column. */
export const MARKDOWN_BODY_MAX_CHARS = 20000;

export { HTML_BODY_MAX_BYTES } from "./sanitize";

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
    body_format: z.enum(BODY_FORMATS).default("markdown"),
    body_markdown: z.string().min(1, "Write the message"),
    audience: audienceFilterSchema,
  })
  .strict()
  // The body's rules depend on which language it is written in, so they live here rather
  // than on the field: a 200 KB designed template is fine, a 200 KB markdown message is
  // someone pasting HTML into the wrong tab.
  .superRefine((value, ctx) => {
    if (unknownMergeTokens(value.body_markdown).length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["body_markdown"],
        message: "The message uses a merge token that does not exist",
      });
    }

    if (value.body_format === "markdown") {
      if (value.body_markdown.length > MARKDOWN_BODY_MAX_CHARS) {
        ctx.addIssue({
          code: "custom",
          path: ["body_markdown"],
          message: `The message must be ${MARKDOWN_BODY_MAX_CHARS.toLocaleString("en")} characters or fewer`,
        });
      }
      return;
    }

    if (byteLength(value.body_markdown) > HTML_BODY_MAX_BYTES) {
      ctx.addIssue({
        code: "custom",
        path: ["body_markdown"],
        message: `The pasted HTML must be ${Math.round(HTML_BODY_MAX_BYTES / 1024)} KB or smaller`,
      });
    }
    if (hasTokenInAttribute(value.body_markdown)) {
      ctx.addIssue({
        code: "custom",
        path: ["body_markdown"],
        message: TOKEN_IN_ATTRIBUTE_MESSAGE,
      });
    }
  });

export type CampaignComposeInput = z.infer<typeof campaignComposeSchema>;

export const campaignIdSchema = z.object({ id: z.uuid() }).strict();
export type CampaignIdInput = z.infer<typeof campaignIdSchema>;

/** One drain step: up to this many messages per Server Action call. */
export const DRAIN_BATCH_SIZE = 25;

/** The composer's live preview of a pasted HTML body — sanitised server-side (ADR 0014). */
export const htmlPreviewSchema = z
  .object({
    body_html: z.string().max(HTML_BODY_MAX_BYTES * 2, "The pasted HTML is far too large"),
  })
  .strict();

export type HtmlPreviewInput = z.infer<typeof htmlPreviewSchema>;
