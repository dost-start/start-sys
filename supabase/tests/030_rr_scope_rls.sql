-- ═══════════════════════════════════════════════════════════════════════════════════
-- 030_rr_scope_rls.sql  —  BUILD_PLAN S2-T24
--
-- PRD US-F1: "two reps of different regions see disjoint member sets", and members outside
-- a rep's region are not returned "including via direct record access, search, filters or
-- exports". PRD US-F2: "Regional Representatives cannot delete or alter any record."
--
-- The UI half of this is the locked `rr-scope-leak` Playwright flow (S6-T15). This file is
-- the DATA-LAYER half, and it makes three assertions a UI test structurally cannot:
--
--   1. DISJOINTNESS AS AN INTERSECTION, not as two counts that happen to differ. Two reps
--      each seeing "2 rows" is satisfied by a broken predicate that returns the same two
--      rows to both. Asserting `intersection = 0` is not.
--   2. DIRECT-ID PROBES. A rep asking for another region's row BY PRIMARY KEY — the exact
--      thing a curl against PostgREST does, and the thing no rendered page ever attempts.
--   3. THE PROBE RETURNS ZERO ROWS, NOT AN ERROR. CONVENTIONS.md §4.3: an RLS-empty result
--      maps to `not_found`, NEVER to `unauthorized`, because "forbidden" confirms the row
--      exists — which discloses that a named scholar has a record. That is the leak with no
--      data in it, and assertions 24-25 are what pin it.
--
--    1-2   positive controls: the claims resolve, and the rep's scope is exactly NCR
--    3-7   rep_a: memberships, directory and people, all NCR, exact counts
--    8-12  rep_b: the mirror image, all R07
--   13-15  the three disjointness assertions
--   16-23  eight direct-id probes, four each way, all returning 0 rows
--   24-25  and two of them proven to return CLEANLY rather than to raise
--   26-33  US-F2: no write path exists in any direction, on any table
--   34     structural: no INSERT/UPDATE/ALL policy anywhere names regional_rep
--   35-36  rr_region_grants is itself scoped
--
-- ⚠ THE FIXTURE'S COMMITTEE IS CROSS-REGION ON PURPOSE (P4/NCR and P6/R07), so each rep
--   sees exactly ONE of its two committee_memberships rows. A same-region committee would
--   let a scoping predicate that ignores the region return both rows and still look right.
--   The same logic is why this file seeds a department_assignment in EACH region below.
--
-- ⚠ rep_a SEES 3 MEMBERSHIPS BUT ONLY 2 PEOPLE, and that is a real policy disagreement
--   rather than an arithmetic slip: memberships_read scopes a rep by region with NO term
--   filter, so P1's ARCHIVED NCR membership is visible; people_read additionally requires a
--   CURRENT-term membership, so P1 the PERSON is not. Flagged for the 0014 owner in the
--   fixtures header, measured here rather than left latent.
--
-- CITATION:  BUILD_PLAN S2-T24, S6-T15; ARCHITECTURE.md §5; CONVENTIONS.md §4.3;
--            DATA_MODEL.md §2.2, §9; PRD §3 v1.0 item 14; PRD US-F1, US-F2, US-I2, US-J1;
--            PRD §6 Success Metric 8; CBL Art. III §4.6, Art. IV §6.4.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(36);


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


-- ═══════════════════════════════════════════════════════════════════════════════════
-- LOCAL SEED, as the session role
--
-- ONE department_assignment IN EACH REGION. The fixture leaves department_assignments
-- empty, and a direct-id probe against a row that does not exist returns zero for the
-- wrong reason — it proves nothing about scoping. Seeding one per region means assertions
-- 19 and 23 probe rows that genuinely EXIST and are genuinely refused.
--
-- ONE rr_region_grant for rep_b, on R11 (Davao). Deliberately a region with NO memberships
-- and NO people, so rep_b's counts in assertions 8-12 are unchanged while assertions 35-36
-- stop being a nine-zeros no-op over an empty table.
-- ═══════════════════════════════════════════════════════════════════════════════════

insert into public.department_assignments (membership_id, department_id)
select v.membership_id, d.id
from (values
  ('00000000-0000-4000-c000-000000000002'::uuid),   -- P4, NCR   (region A)
  ('00000000-0000-4000-c000-000000000004'::uuid)    -- P6, R07   (region B)
) as v(membership_id)
cross join public.departments d
where d.code = 'CRRD' and d.term_id = (select id from public.terms where status = 'active');

insert into public.rr_region_grants (user_id, region_id, granted_by)
select '00000000-0000-4000-a000-000000000007', r.id, '00000000-0000-4000-a000-000000000002'
from public.regions r where r.code = 'R11';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-7 — regional_rep_a, scoped to NCR
--
-- Assertion 2 is the one that makes every zero further down meaningful. If auth_region_ids()
-- returned {} — which is what a malformed claim produces — every scoped predicate would
-- match nothing and every "sees 0 rows" assertion below would pass while protecting nothing.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a

select is(public.auth_role()::text, 'regional_rep',
  'POSITIVE CONTROL 1: rep_a''s claims resolve — auth_role() is regional_rep, not NULL');

select is(public.auth_region_ids(), array[pg_temp.fx_region('NCR')],
  'POSITIVE CONTROL 2: rep_a''s scope is EXACTLY {NCR} — not empty, which is what a malformed claim would produce');

select is((select count(*) from public.memberships)::int, 3,
  'rep_a sees exactly 3 memberships — 2 current NCR + 1 archived NCR');

select is(
  (select count(*) from public.memberships m
     where m.region_id <> pg_temp.fx_region('NCR'))::int,
  0,
  'EVERY membership rep_a can see is NCR — not "mostly", not "the first page"; zero rows from any other region');

select is((select count(*) from public.v_member_directory)::int, 2,
  'rep_a sees exactly 2 directory rows — the view joins people, and P1''s archived-only membership drops out');

select is(
  (select count(*) from public.v_member_directory
     where region_name <> 'National Capital Region')::int,
  0,
  'EVERY v_member_directory row rep_a can see is NCR — security_invoker means the view inherits the policy, it does not restate it');

select is((select count(*) from public.people)::int, 2,
  'rep_a sees exactly 2 people — CURRENT-term NCR scholars only (PRD US-F1)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 8-12 — regional_rep_b, scoped to R07 (+ an R11 grant that contains nobody)
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b

select is(array_length(public.auth_region_ids(), 1), 2,
  'rep_b''s scope is TWO regions — their primary R07 plus the R11 rr_region_grant, unioned by auth_region_ids()');

select is((select count(*) from public.memberships)::int, 2,
  'rep_b still sees exactly 2 memberships — R11 contains nobody, so the extra grant widens scope without widening data');

select is(
  (select count(*) from public.memberships m
     where m.region_id <> pg_temp.fx_region('R07'))::int,
  0,
  'EVERY membership rep_b can see is R07 — zero rows from NCR');

select is((select count(*) from public.v_member_directory)::int, 2,
  'rep_b sees exactly 2 directory rows');

select is(
  (select count(*) from public.people)::int, 2,
  'rep_b sees exactly 2 people — R07 scholars only');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-15 — DISJOINTNESS, as an intersection
--
-- Each side is materialised into a temp table WHILE IMPERSONATING THAT REP, so what is
-- compared is genuinely what each rep can read rather than what the session role can. The
-- temp tables live in pg_temp and are rolled back with the test transaction.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- The tables are CREATED by the session role and only INSERTED INTO while impersonating.
-- Creating them under the fixture would need CREATE on this session's temp schema, which
-- test-helpers/auth.sql grants nobody (it grants USAGE only, deliberately) — and a test
-- that fails on a privilege unrelated to the boundary it is asserting is a test that gets
-- deleted rather than fixed.
create temp table fx_a_memberships (id uuid);
create temp table fx_a_people      (id uuid);
create temp table fx_a_directory   (membership_id uuid);
create temp table fx_b_memberships (id uuid);
create temp table fx_b_people      (id uuid);
create temp table fx_b_directory   (membership_id uuid);
grant insert, select on fx_a_memberships, fx_a_people, fx_a_directory,
                        fx_b_memberships, fx_b_people, fx_b_directory to public;

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');
insert into fx_a_memberships select id from public.memberships;
insert into fx_a_people      select id from public.people;
insert into fx_a_directory   select membership_id from public.v_member_directory;

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');
insert into fx_b_memberships select id from public.memberships;
insert into fx_b_people      select id from public.people;
insert into fx_b_directory   select membership_id from public.v_member_directory;

select pg_temp.logout();

select is(
  (select count(*) from fx_a_memberships a join fx_b_memberships b on a.id = b.id)::int,
  0,
  'rep_a''s and rep_b''s membership sets are DISJOINT — PRD US-F1, asserted as an intersection and not as two counts that differ');

select is(
  (select count(*) from fx_a_people a join fx_b_people b on a.id = b.id)::int,
  0,
  'rep_a''s and rep_b''s people sets are DISJOINT');

select is(
  (select count(*) from fx_a_directory a join fx_b_directory b on a.membership_id = b.membership_id)::int,
  0,
  'rep_a''s and rep_b''s v_member_directory sets are DISJOINT — the screen inherits the same boundary as the table');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 16-25 — DIRECT-ID PROBES
--
-- The probes a UI test cannot make: asking for a known row BY PRIMARY KEY, which is what a
-- hand-crafted PostgREST call does. Every literal below names a row that genuinely EXISTS
-- in the other region, so a zero here is a REFUSAL and never an empty table.
--
-- Assertions 24-25 are the ones that matter most and are easy to omit: the probe must
-- return cleanly. CONVENTIONS.md §4.3 — an RLS-empty result is `not_found`, never
-- `unauthorized`, because a 403 would confirm that a named scholar has a record.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- rep_a probing region B

select is((select count(*) from public.memberships
            where id = '00000000-0000-4000-c000-000000000003')::int, 0,
  'rep_a probing P5''s R07 MEMBERSHIP by primary key gets 0 rows — direct record access is scoped too (PRD US-F1)');

select is((select count(*) from public.people
            where id = '00000000-0000-4000-b000-000000000005')::int, 0,
  'rep_a probing P5 the PERSON by primary key gets 0 rows');

select is((select count(*) from public.committee_memberships
            where membership_id = '00000000-0000-4000-c000-000000000004')::int, 0,
  'rep_a probing P6''s COMMITTEE_MEMBERSHIP gets 0 rows — a cross-region committee does not leak its other half');

select is((select count(*) from public.department_assignments
            where membership_id = '00000000-0000-4000-c000-000000000004')::int, 0,
  'rep_a probing P6''s DEPARTMENT_ASSIGNMENT gets 0 rows — the row exists (seeded above), it is refused');

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- rep_b probing region A

select is((select count(*) from public.memberships
            where id = '00000000-0000-4000-c000-000000000002')::int, 0,
  'rep_b probing P4''s NCR membership by primary key gets 0 rows — the mirror image');

select is((select count(*) from public.people
            where id = '00000000-0000-4000-b000-000000000004')::int, 0,
  'rep_b probing P4 the person gets 0 rows — P4 carries the planted sensitive literals, so this is the probe that would leak them');

select is((select count(*) from public.committee_memberships
            where membership_id = '00000000-0000-4000-c000-000000000002')::int, 0,
  'rep_b probing P4''s committee_membership gets 0 rows');

select is((select count(*) from public.department_assignments
            where membership_id = '00000000-0000-4000-c000-000000000002')::int, 0,
  'rep_b probing P4''s department_assignment gets 0 rows');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');

select lives_ok(
  $$ select count(*) from public.memberships where id = '00000000-0000-4000-c000-000000000003' $$,
  'the cross-region membership probe returns CLEANLY — an RLS-empty result is not_found, never unauthorized (CONVENTIONS.md §4.3)');

select lives_ok(
  $$ select count(*) from public.people where id = '00000000-0000-4000-b000-000000000005' $$,
  'the cross-region person probe returns CLEANLY — a 403 here would confirm that a named scholar has a record, which is the leak with no data in it');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 26-33 — US-F2: "Regional Representatives cannot delete or alter any record"
--
-- Note the two different failure shapes and that BOTH are asserted. An UPDATE is refused by
-- a USING clause, which filters the scan, so it affects 0 rows silently. An INSERT is
-- refused by a WITH CHECK clause, which is evaluated against the proposed row, so it
-- raises 42501. And an UPDATE on `people` raises instead of returning 0, because
-- 0015_grants.sql revoked the privilege outright — a different mechanism again.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(pg_temp.rows_affected($$
    update public.memberships set year_level = 7
     where id = '00000000-0000-4000-c000-000000000002' $$), 0,
  'rep_a CANNOT update a membership in their OWN region — regional access is not regional editing (PRD US-F2)');

select is(pg_temp.rows_affected($$
    update public.memberships set year_level = 7
     where id = '00000000-0000-4000-c000-000000000003' $$), 0,
  'rep_a CANNOT update a membership in region B either — refused twice over, by scope and by the absence of a write policy');

select throws_ok(
  $$ update public.people set given_name = 'Tampered'
      where id = '00000000-0000-4000-b000-000000000004' $$,
  '42501'::char(5), null::text,
  'rep_a UPDATE on people RAISES rather than returning 0 — 0015 revoked the privilege, so this never reaches a policy at all');

select throws_ok($$
    insert into public.memberships (person_id, term_id, status, region_id)
    select '00000000-0000-4000-b000-000000000002', t.id, 'active', r.id
    from public.terms t, public.regions r
    where t.status = 'active' and r.code = 'NCR' $$,
  '42501'::char(5), null::text,
  'rep_a INSERT into memberships is REFUSED — no create path exists for the RR tier on any record');

select throws_ok($$
    insert into public.committee_memberships (membership_id, committee_id)
    values ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-e000-000000000001') $$,
  '42501'::char(5), null::text,
  'rep_a INSERT into committee_memberships is REFUSED');

select throws_ok($$
    insert into public.department_assignments (membership_id, department_id)
    select '00000000-0000-4000-c000-000000000001', d.id from public.departments d
     where d.code = 'TECH' and d.term_id = (select id from public.terms where status = 'active') $$,
  '42501'::char(5), null::text,
  'rep_a INSERT into department_assignments is REFUSED');

-- The self-widening attack, and the reason rr_region_grants is tech_admin's rather than the
-- rep's own: if a rep could grant themselves a region, US-F1 would be advisory.
select throws_ok($$
    insert into public.rr_region_grants (user_id, region_id, granted_by)
    select '00000000-0000-4000-a000-000000000006', r.id, '00000000-0000-4000-a000-000000000006'
    from public.regions r where r.code = 'R07' $$,
  '42501'::char(5), null::text,
  'rep_a CANNOT grant themselves another region — rr_region_grants is tech_admin''s (PRD US-E3), or US-F1 would be advisory');

select is(pg_temp.rows_affected($$
    update public.committees set name = 'Tampered'
     where id = '00000000-0000-4000-e000-000000000001' $$), 0,
  'rep_a CANNOT rename a committee they can read — read access and write access are separate policies, and only one exists');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 34-36 — the structural backstop, and rr_region_grants' own scoping
--
-- Assertion 34 is what keeps US-F2 true in 2029: the behaviour tests above enumerate the
-- tables that exist TODAY, while this one covers every table that will ever exist.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.logout();

select is(
  (select coalesce(string_agg(format('%s.%s (%s)', tablename, policyname, cmd), ', ' order by tablename, policyname), '')
     from pg_policies
    where schemaname = 'public'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '''regional_rep'''),
  '',
  'NO INSERT/UPDATE/ALL policy anywhere in public names regional_rep — PRD US-F2 is a MISSING POLICY, not a missing button');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- rep_a
select is((select count(*) from public.rr_region_grants)::int, 0,
  'rep_a sees 0 rr_region_grants — they hold none, and they may not enumerate rep_b''s');

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- rep_b
select is((select count(*) from public.rr_region_grants)::int, 1,
  'rep_b sees exactly 1 rr_region_grant — their own R11 grant; knowing which regions you cover is not a disclosure');


select * from finish();

rollback;
