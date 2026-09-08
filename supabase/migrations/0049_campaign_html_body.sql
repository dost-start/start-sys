-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0049_campaign_html_body.sql  —  a campaign body may be a pasted HTML template
--                                 (Ethan, 2026-09-07; ADR 0014; SRS "Email Sending":
--                                  "send emails with an HTML format attached")
--
-- WHY:
--   Until now `/campaigns` accepted only the Telegram-style markdown subset, which
--   lib/campaigns/markdown.ts escapes BEFORE rendering — so the only tags that could
--   ever reach a mailbox were the ones our own renderer emitted. The CCDO builds
--   designed emails in an external template builder and pastes the finished HTML into
--   Gmail through a browser extension; to do that inside START-SYS the composer has to
--   accept markup it did not author. `body_format` records which of the two the stored
--   source is, and therefore which renderer produced `body_html`.
--
-- WHAT:
--   body_format        NEW. 'markdown' (the default, and what every campaign stored
--                      before this migration is) or 'html'. A CHECK, not an enum: two
--                      values that the application branches on, and ALTER TYPE ADD VALUE
--                      would need its own migration before the value could be used
--                      (CONVENTIONS §3.4). A third format would be one line here.
--
--   body_markdown      the CHECK is relaxed. It still holds the SOURCE the CRRD typed
--                      or pasted — the column name predates this migration and is left
--                      alone deliberately: renaming it would touch queries, types, tests
--                      and two pgTAP suites for no behavioural gain. The length rule now
--                      depends on the format: 20,000 characters of markdown (unchanged),
--                      or 200 KB of pasted HTML (Ethan, 2026-09-07: "warning is 200 kb").
--
--   body_html          gains a size backstop only.
--
-- WHAT THIS MIGRATION DOES NOT DO, STATED PLAINLY:
--   It does NOT sanitise. Postgres has no HTML parser and adding one is not on the
--   table; the allowlist lives in lib/campaigns/sanitize.ts and runs inside the Server
--   Action, whose output — never the raw paste — is what gets stored. The residual gap
--   is therefore real and bounded: a `crrd_admin` or `exec_admin` calling PostgREST
--   directly with their own JWT could write a `body_html` the allowlist would have
--   refused. That is the SAME two tiers who compose and send campaigns in the first
--   place and can already put any text in front of a recipient, the preview renders in
--   a sandboxed iframe, and a recipient's mail client strips scripts on receive. So this
--   is not a privilege boundary being crossed — but it is not "the database enforces
--   sanitisation" either, and nobody should read it that way. See ADR 0014, Risks.
--
-- ROLLBACK: forward-only. Reverting means a migration that drops the column and the two
--   constraints; any campaign stored with body_format='html' would then re-render
--   through the markdown path and go out as escaped tag soup, so the revert must also
--   decide what happens to those rows. No campaign has been sent from this column yet.
--
-- CITATION: PRD §3 items 20-26, US-G1 ("compose and send an email with HTML
--   formatting"), US-G3 (merge tokens); ADR 0010 (the Gmail transport that carries it);
--   ADR 0014 (this decision). pgTAP: supabase/tests/077_campaign_html_body.sql.
--
-- NUMBERING NOTE: 0048 is taken by a change on another branch
--   (`sql/universities-dost-sei-placements`) being written in parallel. Numbering around
--   it rather than racing for 0048 keeps both applicable in either merge order.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── the format discriminator ───────────────────────────────────────────────────────
alter table public.email_campaigns
  add column if not exists body_format text not null default 'markdown';

alter table public.email_campaigns
  drop constraint if exists email_campaigns_body_format_check;
alter table public.email_campaigns
  add constraint email_campaigns_body_format_check
  check (body_format in ('markdown', 'html'));

comment on column public.email_campaigns.body_format is
  'Which language body_markdown holds: ''markdown'' (the Telegram-style subset, escaped '
  'before rendering) or ''html'' (a designed template pasted from an email builder, run '
  'through the allowlist in lib/campaigns/sanitize.ts). Decides which renderer produced '
  'body_html. ADR 0014.';

-- ── the source-length rule now depends on the format ───────────────────────────────
-- 0043 wrote `check (length(body_markdown) between 1 and 20000)` inline, which Postgres
-- named for us. Dropping by that generated name is safe here because 0043 is the only
-- thing that ever created it; `if exists` covers a database where it was already
-- replaced.
alter table public.email_campaigns
  drop constraint if exists email_campaigns_body_markdown_check;

alter table public.email_campaigns
  drop constraint if exists email_campaigns_body_source_length;
alter table public.email_campaigns
  add constraint email_campaigns_body_source_length
  check (
    case body_format
      when 'markdown' then length(body_markdown) between 1 and 20000
      else octet_length(body_markdown) between 1 and 204800   -- 200 KB
    end
  );

-- ── a size backstop on the rendered body ───────────────────────────────────────────
-- The product rule is the 200 KB cap on the SOURCE, enforced in the zod schema and again
-- in the sanitiser. This is only here so a runaway row cannot be written at all: the
-- sanitised body plus the document shell and footer that wrap it.
alter table public.email_campaigns
  drop constraint if exists email_campaigns_body_html_size;
alter table public.email_campaigns
  add constraint email_campaigns_body_html_size
  check (octet_length(body_html) between 1 and 262144);        -- 256 KB
