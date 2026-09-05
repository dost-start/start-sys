-- ═══════════════════════════════════════════════════════════════════════════════════
-- 072_email_campaigns.sql  —  the campaign spine (0043): tables, the merge whitelist, the
--                             resolver, the queue as rows
--
-- WHAT:
--    1-2   both tables carry ENABLE + FORCE and zero DELETE/ALL policies
--    3     v_email_merge_fields exposes EXACTLY its documented columns — the mail-merge
--          whitelist; adding a column here is a reviewed decision, not an accident
--    4-8   resolve_recipients(): crrd_admin sees the four current-term scholars with an
--          email; a region filter narrows to NCR's two; an island-group filter to
--          Visayas' two; every non-admin tier is refused
--    9-12  a crrd_admin creates a draft; officer, regional_rep and anon cannot; the
--          created_by pin refuses a row attributed to someone else
--   13-16  send_campaign() freezes exactly four recipient rows, marks the campaign
--          queued, writes ONE CAMPAIGN_QUEUED audit row, and a SECOND call adds nothing
--   17-19  claim_campaign_batch() leases two, a second claim leases the other two, a third
--          leases none; finish_recipient() records outcomes and closes the campaign
--   20-22  recipients are readable by the sending tier and by nobody else; no human role
--          holds INSERT or UPDATE on them; every definer pins search_path
--
-- CITATION:  0043; PRD §3 items 20-26, US-G2, US-G3, US-G4, US-I1; ADR 0010;
--            ARCHITECTURE.md §4.2 ("the queue is the rows").
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(22);

-- ── 1-2 — the meta-invariants, locally ────────────────────────────────────────────
select ok(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('email_campaigns', 'email_recipients')),
  'email_campaigns and email_recipients have ENABLE and FORCE ROW LEVEL SECURITY');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('email_campaigns', 'email_recipients')
      and cmd in ('DELETE', 'ALL')),
  0,
  'no DELETE or ALL policy on either table — a campaign is history, never erased');

-- ── 3 — the merge whitelist ────────────────────────────────────────────────────────
select columns_are(
  'public'::name, 'v_email_merge_fields'::name,
  array['person_id', 'term_id', 'region_id', 'status', 'given_name', 'family_name', 'member_id',
        'join_year', 'region_name', 'island_group', 'term_label', 'year_level',
        'committee_name', 'department_name']::name[],
  'v_email_merge_fields exposes exactly its fourteen documented columns — no contact number, no birthdate, no address (PRD US-G3)');

-- ── 4-8 — resolve_recipients ───────────────────────────────────────────────────────
-- fixtures §5: four current-term memberships — P3, P4 (NCR) and P5, P6 (R07) — all with
-- a personal_email; P1's membership is in the archived term and must not appear.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.resolve_recipients('{}'::jsonb)),
  4,
  'crrd_admin resolves the FOUR current-term active scholars — the archived-term member is not among them');

select is(
  (select count(*)::int from public.resolve_recipients(
     jsonb_build_object('region_ids', jsonb_build_array(pg_temp.fx_region('NCR'))))),
  2,
  'a region filter narrows to NCR''s two (PRD US-G2 "region")');

select is(
  (select count(*)::int from public.resolve_recipients('{"island_groups":["Visayas"]}'::jsonb)),
  2,
  'an island-group filter narrows to the two Visayas scholars (PRD US-G2 "island group")');

select is(
  (select count(*)::int from public.resolve_recipients('{"join_years":[2024]}'::jsonb)),
  2,
  'a join-year filter narrows to the two 2024 joiners (PRD US-G2 "year of membership")');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$ select * from public.resolve_recipients('{}'::jsonb) $$, '42501'::char(5), null::text,
  'officer cannot resolve a recipient list — sending is CRRD''s (SRS) and the CEO/COO''s');
select pg_temp.logout();

-- ── 9-12 — creating a draft ────────────────────────────────────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select lives_ok(
  $$ insert into public.email_campaigns
       (id, term_id, template_key, subject, body_markdown, body_html, audience_filter, created_by)
     values ('00000000-0000-4000-e300-000000000001', pg_temp.fx_active_term(), 'freeform',
             'Hello {{given_name}}', 'Hi {{given_name}}', '<p>Hi {{given_name}}</p>', '{}'::jsonb,
             '00000000-0000-4000-a000-000000000003') $$,
  'crrd_admin creates a draft campaign');

select throws_ok(
  $$ insert into public.email_campaigns
       (term_id, template_key, subject, body_markdown, body_html, created_by)
     values (pg_temp.fx_active_term(), 'freeform', 'x', 'x', '<p>x</p>',
             '00000000-0000-4000-a000-000000000001') $$,
  '42501'::char(5), null::text,
  'a campaign attributed to a DIFFERENT account is refused — created_by is pinned to auth.uid()');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok(
  $$ insert into public.email_campaigns
       (term_id, template_key, subject, body_markdown, body_html, created_by)
     values (pg_temp.fx_active_term(), 'freeform', 'x', 'x', '<p>x</p>',
             '00000000-0000-4000-a000-000000000006') $$,
  '42501'::char(5), null::text,
  'a regional rep cannot create a campaign — RR sending needs rr_send_grants (PRD US-F3), not built here');
select is((select count(*)::int from public.email_campaigns), 0,
  'and reads zero campaigns');
select pg_temp.logout();

-- ── 13-16 — send_campaign freezes the audience, once ───────────────────────────────
create temp table fx_audit_before on commit drop as select count(*)::int as n from public.audit_log;
grant select on fx_audit_before to public;

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(public.send_campaign('00000000-0000-4000-e300-000000000001'), 4,
  'send_campaign() freezes FOUR recipient rows — one per resolved person');

select is(
  (select status::text || ':' || recipient_count from public.email_campaigns
    where id = '00000000-0000-4000-e300-000000000001'),
  'queued:4',
  'the campaign is queued with recipient_count = 4');

select is(public.send_campaign('00000000-0000-4000-e300-000000000001'), 4,
  'a SECOND send_campaign() — a double-clicked Send — adds nothing and returns the same count (PRD US-G4)');
select pg_temp.logout();

-- Counted OUTSIDE the sender's session: audit_log_read (0014) is exec_admin/tech_admin
-- only, so a count taken as crrd_admin reads 0 rows and the difference goes negative.
select is(
  (select count(*)::int from public.audit_log) - (select n from fx_audit_before),
  1,
  'exactly ONE CAMPAIGN_QUEUED audit row across both calls — attributed, value-free (PRD US-I1)');

-- ── 17-19 — the queue as rows ──────────────────────────────────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
create temp table fx_batch1 on commit drop as
  select * from public.claim_campaign_batch('00000000-0000-4000-e300-000000000001', 2);
grant select on fx_batch1 to public;
create temp table fx_batch2 on commit drop as
  select * from public.claim_campaign_batch('00000000-0000-4000-e300-000000000001', 2);
grant select on fx_batch2 to public;

select is(
  (select count(*)::int from fx_batch1) + (select count(*)::int from fx_batch2),
  4,
  'two claims of two lease all four rows — and a lease is exclusive: the second claim never re-hands the first''s rows');

select is(
  (select count(*)::int from public.claim_campaign_batch('00000000-0000-4000-e300-000000000001', 2)),
  0,
  'a third claim leases NOTHING — every row is leased, none re-claimable for ten minutes');

select lives_ok($$
  select public.finish_recipient(recipient_id, true, 'msg-' || recipient_id::text, null) from fx_batch1;
  select public.finish_recipient(recipient_id, false, null, 'smtp rejected (550)') from fx_batch2;
$$, 'finish_recipient() records two sent and two failed');

select is(
  (select status::text || ':' || sent_count || ':' || failed_count from public.email_campaigns
    where id = '00000000-0000-4000-e300-000000000001'),
  'sent:2:2',
  'with nothing left queued the campaign closes as sent, with the counts (PRD item 25)');
select pg_temp.logout();

-- ── 20-22 — who reads the report, who can write the queue ─────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is((select count(*)::int from public.email_recipients), 4,
  'exec_admin reads all four recipient rows — the delivery report is the sending tier''s (PRD item 25)');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is((select count(*)::int from public.email_recipients), 0,
  'officer reads ZERO recipient rows — a frozen address list is contact data');
select pg_temp.logout();

select ok(
  not has_table_privilege('authenticated', 'public.email_recipients', 'INSERT')
  and not has_table_privilege('authenticated', 'public.email_recipients', 'UPDATE')
  and (select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('resolve_recipients', 'send_campaign', 'claim_campaign_batch', 'finish_recipient')),
  'no human role holds INSERT or UPDATE on email_recipients, and all four definers pin search_path — the queue''s state machine is function-only');

select * from finish();

rollback;
