-- ═══════════════════════════════════════════════════════════════════════════════════
-- 070_reference_choices_rls.sql  —  programs and universities (0037), the SRS choice lists
--
-- WHAT:
--    1-2   the seed: exactly thirteen programs (CRRD SRS 2026-09-05, verbatim; CBL Art. I §4)
--          and a non-empty university starter list, every university in a real region
--    3-11  every fixture — anon included — reads the SAME full lists: the public form has
--          to render both dropdowns before anyone signs in
--   12-15  crrd_admin and tech_admin can add a row; officer, regional_rep_a, crrd_deputy?
--          — no: crrd_deputy IS crrd_admin and succeeds — so the denials are officer,
--          regional_rep_a and anon, each refused at 42501
--   16-17  UPDATE: crrd_admin can retire a program (is_active = false); officer affects 0 rows
--   18-20  no DELETE policy, no DELETE grant, both RLS flags on both tables
--
-- WHY THE LISTS ARE TABLES. "Form is hardcoded but choices are flexible based on the data"
--   (meeting 2026-09-05). A new accredited program (CBL Art. VII §2.4, amendment-paced)
--   or a university that starts producing scholars is a CRRD row, never a deploy —
--   ARCHITECTURE.md §8 Extensibility. A retired program is is_active = false, so historical
--   people.program_id keeps its foreign key; CLAUDE.md: never hard-delete anything.
--
-- CITATION:  0037; PRD OQ-17 (resolved: closed list); CBL Art. I §4, Art. VII §2.4;
--            CRRD SRS 2026-09-05 ("University*", "Program*").
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(20);

create or replace function pg_temp.rows_affected(p_sql text) returns int
language plpgsql
as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── 1-2 — the seed ─────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from public.programs),
  13,
  'exactly THIRTEEN programs are seeded — the SRS list, verbatim (CBL Art. I §4)');

select ok(
  (select count(*) > 0
     and bool_and(exists (select 1 from public.regions r where r.id = u.region_id))
     from public.universities u),
  'the university starter list is non-empty and every row sits in a real region');

-- ── 3-11 — everyone reads the same lists ───────────────────────────────────────────
create temp table fx_ref_counts on commit drop as
  select (select count(*)::int from public.programs)     as programs,
         (select count(*)::int from public.universities) as universities;
grant select on fx_ref_counts to public;

select pg_temp.login_anon();
select is((select count(*)::int from public.programs), (select programs from fx_ref_counts),
  'anon reads every program — the public form renders the dropdown before sign-in');
select is((select count(*)::int from public.universities), (select universities from fx_ref_counts),
  'anon reads every university');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is((select count(*)::int from public.programs), (select programs from fx_ref_counts),
  'officer reads every program');
select is((select count(*)::int from public.universities), (select universities from fx_ref_counts),
  'officer reads every university');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is((select count(*)::int from public.universities), (select universities from fx_ref_counts),
  'regional_rep_a reads every university — the RR view filters by university, so the list is not region-scoped');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member (revoked tier)
select is((select count(*)::int from public.programs), (select programs from fx_ref_counts),
  'the revoked tier reads the reference list too — it is public data, nothing of anyone''s');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is((select count(*)::int from public.programs), (select programs from fx_ref_counts),
  'crrd_admin reads every program');
select is((select count(*)::int from public.universities), (select universities from fx_ref_counts),
  'crrd_admin reads every university');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is((select count(*)::int from public.programs), (select programs from fx_ref_counts),
  'tech_admin reads every program');
select pg_temp.logout();

-- ── 12-15 — who may add a choice ───────────────────────────────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select lives_ok(
  $$ insert into public.programs (code, name, sort_order)
     values ('FIXT_NEW', 'Fixture Program (Art. VII §2.4 amendment)', 999) $$,
  'crrd_admin CAN add a program — an accredited program lands as a row citing the amendment, not a deploy');
select lives_ok(
  $$ insert into public.universities (name, region_id, city_municipality, kind)
     select 'Fixture State University', id, 'Fixture City', 'public'
       from public.regions where code = 'NCR' $$,
  'crrd_admin CAN add a university');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ insert into public.programs (code, name, sort_order) values ('OFF_TRY', 'Officer Try', 998) $$,
  '42501'::char(5), null::text,
  'officer CANNOT add a program — PRD US-D2, no write path exists for the Officer tier');
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ insert into public.universities (name, region_id, kind)
     select 'Anon University', id, 'private' from public.regions where code = 'NCR' $$,
  '42501'::char(5), null::text,
  'anon CANNOT add a university — the public form READS the list; it never writes it');
select pg_temp.logout();

-- ── 16-17 — retiring, not deleting ─────────────────────────────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  pg_temp.rows_affected($$ update public.programs set is_active = false where code = 'FIXT_NEW' $$),
  1,
  'crrd_admin retires a program with is_active = false — history keeps its foreign key');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is(
  pg_temp.rows_affected($$ update public.universities set is_active = false $$),
  0,
  'regional_rep_a affects ZERO rows on update — PRD US-F2, the absence of a policy is the enforcement');
select pg_temp.logout();

-- ── 18-20 — no delete, and the meta-invariants on both tables ─────────────────────
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename in ('programs', 'universities')
      and cmd in ('DELETE', 'ALL')),
  0,
  'no DELETE (and no ALL) policy on programs or universities — CLAUDE.md, never hard-delete');

select ok(
  not has_table_privilege('authenticated', 'public.programs', 'DELETE')
  and not has_table_privilege('anon', 'public.programs', 'DELETE')
  and not has_table_privilege('authenticated', 'public.universities', 'DELETE')
  and not has_table_privilege('anon', 'public.universities', 'DELETE'),
  'no DELETE grant either — 0037 revoked Supabase''s default ALL before granting back');

select ok(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('programs', 'universities')),
  'both tables have ENABLE and FORCE ROW LEVEL SECURITY — the S1-T15 meta-test, restated locally');

select * from finish();

rollback;
