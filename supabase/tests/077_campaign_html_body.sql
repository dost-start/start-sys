-- ═══════════════════════════════════════════════════════════════════════════════════
-- 077_campaign_html_body.sql  —  a campaign body may be a pasted HTML template (0049)
--
-- WHAT:
--    1     body_format exists, is NOT NULL, and defaults to 'markdown' — so every
--          campaign stored before 0049 keeps meaning exactly what it meant
--    2     a third format is refused by the CHECK, not silently accepted
--    3     a markdown campaign is still held to 20,000 characters
--    4     an html campaign may exceed that, which is the entire point of the column
--    5     an html campaign is still capped, at 200 KB of source
--    6     body_html carries its own 256 KB backstop
--    7     an empty body_html is refused (the sanitiser can empty a body; a row that
--          would send a blank message must not be storable)
--    8     the tier boundary is UNCHANGED by this migration: an officer still cannot
--          write a campaign in either format
--    9     RLS is still ENABLED and FORCED on the table after the ALTERs
--
-- WHAT THIS FILE DELIBERATELY DOES NOT ASSERT: that the stored html is sanitised.
--   Postgres has no HTML parser; the allowlist is lib/campaigns/sanitize.ts and is
--   proven by lib/campaigns/sanitize.test.ts (24 assertions, including the four scheme
--   and event-handler cases). Asserting it here would mean writing a second, weaker
--   sanitiser in SQL to check the first one — two implementations, both then wrong in
--   different ways. The database's job in 0049 is the format discriminator and the size
--   backstops, and that is what is asserted below. See ADR 0014.
--
-- CITATION:  0049; ADR 0014; PRD US-G1, US-G3; SRS "Email Sending".
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(9);

-- ── 1 — the column, its default, and what it means for pre-0049 rows ───────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
insert into public.email_campaigns
  (id, term_id, template_key, subject, body_markdown, body_html, created_by)
values ('00000000-0000-4000-e700-000000000001', pg_temp.fx_active_term(), 'freeform',
        'Pre-0049 shape', 'Hi {{given_name}}', '<p>Hi {{given_name}}</p>',
        '00000000-0000-4000-a000-000000000003');

select is(
  (select body_format from public.email_campaigns
    where id = '00000000-0000-4000-e700-000000000001'),
  'markdown',
  'an INSERT that names no body_format gets markdown — every campaign written before 0049 still means what it meant');

-- ── 2 — the CHECK is a closed set ──────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.email_campaigns
       (term_id, template_key, subject, body_format, body_markdown, body_html, created_by)
     values (pg_temp.fx_active_term(), 'freeform', 'x', 'mjml', 'x', '<p>x</p>',
             '00000000-0000-4000-a000-000000000003') $$,
  '23514'::char(5), null::text,
  'a body_format outside {markdown, html} is refused — a new renderer is a migration, not a row');

-- ── 3-4 — the source-length rule follows the format ────────────────────────────────
select throws_ok(
  format(
    $$ insert into public.email_campaigns
         (term_id, template_key, subject, body_format, body_markdown, body_html, created_by)
       values (%L::uuid, 'freeform', 'too long', 'markdown', %L, '<p>x</p>',
               '00000000-0000-4000-a000-000000000003') $$,
    pg_temp.fx_active_term(), repeat('x', 20001)),
  '23514'::char(5), null::text,
  'markdown is still capped at 20,000 characters');

select lives_ok(
  format(
    $$ insert into public.email_campaigns
         (id, term_id, template_key, subject, body_format, body_markdown, body_html, created_by)
       values ('00000000-0000-4000-e700-000000000002', %L::uuid, 'freeform', 'designed',
               'html', %L, '<p>x</p>', '00000000-0000-4000-a000-000000000003') $$,
    pg_temp.fx_active_term(), '<p>' || repeat('x', 25000) || '</p>'),
  'a pasted HTML template may exceed the markdown cap — a designed template from a builder is 30-80 KB');

-- ── 5 — but it is still capped, at 200 KB ──────────────────────────────────────────
select throws_ok(
  format(
    $$ insert into public.email_campaigns
         (term_id, template_key, subject, body_format, body_markdown, body_html, created_by)
       values (%L::uuid, 'freeform', 'far too big', 'html', %L, '<p>x</p>',
               '00000000-0000-4000-a000-000000000003') $$,
    pg_temp.fx_active_term(), repeat('x', 204801)),
  '23514'::char(5), null::text,
  'a pasted body over 200 KB is refused at the data layer, not only by the composer');

-- ── 6-7 — the rendered body's own backstops ────────────────────────────────────────
select throws_ok(
  format(
    $$ insert into public.email_campaigns
         (term_id, template_key, subject, body_format, body_markdown, body_html, created_by)
       values (%L::uuid, 'freeform', 'runaway', 'html', '<p>x</p>', %L,
               '00000000-0000-4000-a000-000000000003') $$,
    pg_temp.fx_active_term(), repeat('x', 262145)),
  '23514'::char(5), null::text,
  'body_html carries a 256 KB backstop so a runaway row cannot be written at all');

select throws_ok(
  $$ insert into public.email_campaigns
       (term_id, template_key, subject, body_format, body_markdown, body_html, created_by)
     values (pg_temp.fx_active_term(), 'freeform', 'empty', 'html', '<p>x</p>', '',
             '00000000-0000-4000-a000-000000000003') $$,
  '23514'::char(5), null::text,
  'an EMPTY body_html is refused — a campaign that would send a blank message is not storable');
select pg_temp.logout();

-- ── 8 — the tier boundary is untouched by this migration ───────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ insert into public.email_campaigns
       (term_id, template_key, subject, body_format, body_markdown, body_html, created_by)
     values (pg_temp.fx_active_term(), 'freeform', 'x', 'html', '<p>x</p>', '<p>x</p>',
             '00000000-0000-4000-a000-000000000005') $$,
  '42501'::char(5), null::text,
  'an officer still cannot write a campaign in EITHER format — 0049 adds a column, never a capability');
select pg_temp.logout();

-- ── 9 — the meta-invariant, after the ALTERs ───────────────────────────────────────
select ok(
  (select c.relrowsecurity and c.relforcerowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'email_campaigns'),
  'email_campaigns still has ENABLE and FORCE ROW LEVEL SECURITY after 0049');

select * from finish();
rollback;
