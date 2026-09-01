-- ═══════════════════════════════════════════════════════════════════════════════════
-- 012_identity_structure.sql
--
-- Structural assertions over 0004_identity.sql. These are CONSTRAINTS, not policies: no
-- role is impersonated here, because none of what is asserted below depends on who is
-- asking. The nine-fixture row-count and column-set matrices are 022/028/029.
--
--    1-2   a malformed member_id is refused              23514  (member_id_format)
--    3-4   2099-001 and 2099-1000 both live              — the {3,} in the regex is
--                                                          load-bearing: the 1000th member
--                                                          of a year must roll over, not
--                                                          collide (DATA_MODEL.md §4)
--    5     member_id is unique                           23505
--    6     member_id may be NULL                         — a person exists before
--                                                          approve_application() mints one
--    7     join_year outside 2000..2100 is refused       23514
--    8     a blank given_name is refused                 23514
--    9     member_id_counters.last_seq may not go < 0    23514
--   10     a regional_rep with no region is refused      23514  (rr_needs_region)
--   11     a regional_rep WITH a region lives
--   12     a non-rep with no region lives                — person_id/region_id are
--                                                          nullable in both directions
--                                                          on purpose (OQ-12)
--   13     one person cannot hold two accounts           23505  (user_roles.person_id UNIQUE)
--   14-16  the three indexes exist                       — US-I2 search and the
--                                                          person_id lookup walked on
--                                                          every member request
--   17     all three tables are ENABLE + FORCE RLS
--
-- PRD §3 v1.0 items 3, 9, 10; PRD US-A2, US-C3, US-C4, US-E3, US-F1, US-I2.
-- DATA_MODEL.md §6/0004, §4.
--
-- ⚠ NOT ASSERTED HERE, BY DESIGN: allocate_member_id() and the member_id immutability
-- trigger do not exist until 0022 (BUILD_PLAN S4-T1). Their assertions live in
-- 047/048. This file must stay green both before and after 0022 lands, with no edit.
--
-- Fixture values are deliberately in the 2099 join year and the c000 UUID block so this
-- file never collides with supabase/test-helpers/fixtures.sql (b000 people, a000 users)
-- or with 0016_seed.sql. Everything is rolled back.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(17);

-- ── people: member_id format ───────────────────────────────────────────────────────

-- 1
select throws_ok(
  $$ insert into public.people (member_id, join_year, given_name, family_name)
     values ('24-1', 2099, 'Malformed', 'ShortYear') $$,
  '23514'::char(5),
  null::text,
  'member_id "24-1" is refused (23514) — the year must be four digits'
);

-- 2
select throws_ok(
  $$ insert into public.people (member_id, join_year, given_name, family_name)
     values ('2099-01', 2099, 'Malformed', 'ShortSeq') $$,
  '23514'::char(5),
  null::text,
  'member_id "2099-01" is refused (23514) — the sequence is at least three digits'
);

-- 3
select lives_ok(
  $$ insert into public.people (member_id, join_year, given_name, family_name)
     values ('2099-001', 2099, 'Wellformed', 'FirstOfYear') $$,
  'member_id "2099-001" is accepted'
);

-- 4 — the {3,} case. Without it the 1000th member of a year has nowhere to go.
select lives_ok(
  $$ insert into public.people (member_id, join_year, given_name, family_name)
     values ('2099-1000', 2099, 'Wellformed', 'ThousandthOfYear') $$,
  'member_id "2099-1000" is accepted — 2099-999 rolls over rather than colliding'
);

-- 5
select throws_ok(
  $$ insert into public.people (member_id, join_year, given_name, family_name)
     values ('2099-001', 2099, 'Duplicate', 'MemberId') $$,
  '23505'::char(5),
  null::text,
  'a duplicate member_id is refused (23505) — PRD US-C3, unique across the whole system'
);

-- 6 — a person exists before an ID is minted; approve_application() writes it later.
select lives_ok(
  $$ insert into public.people (join_year, given_name, family_name)
     values (2099, 'Unapproved', 'NoIdYet') $$,
  'member_id may be NULL — a person row can exist before approval mints an ID'
);

-- ── people: the remaining CHECKs ───────────────────────────────────────────────────

-- 7
select throws_ok(
  $$ insert into public.people (join_year, given_name, family_name)
     values (1999, 'OutOfRange', 'JoinYear') $$,
  '23514'::char(5),
  null::text,
  'join_year outside 2000..2100 is refused (23514)'
);

-- 8
select throws_ok(
  $$ insert into public.people (join_year, given_name, family_name)
     values (2099, '   ', 'BlankGiven') $$,
  '23514'::char(5),
  null::text,
  'a whitespace-only given_name is refused (23514) — PRD Data Integrity NFR'
);

-- ── member_id_counters ─────────────────────────────────────────────────────────────

-- 9
select throws_ok(
  $$ insert into public.member_id_counters (join_year, last_seq) values (2099, -1) $$,
  '23514'::char(5),
  null::text,
  'member_id_counters.last_seq may not be negative (23514)'
);

-- ── user_roles ─────────────────────────────────────────────────────────────────────
-- A test region of its own, so this file does not depend on 0016_seed.sql having run.
insert into public.regions (code, name, island_group, sort_order)
values ('ZZTESTA', 'Structure Test Region A', 'Luzon', 9001);

-- auth.users rows are needed for the FK. Inserted with explicit ids in the c000 block so
-- they cannot collide with the shared fixture accounts; every other auth.users column
-- carries a GoTrue default.
insert into auth.users (id, email)
values
  ('00000000-0000-4000-c000-000000000001', 'structure-rep@example.invalid'),
  ('00000000-0000-4000-c000-000000000002', 'structure-rep2@example.invalid'),
  ('00000000-0000-4000-c000-000000000003', 'structure-tech@example.invalid'),
  ('00000000-0000-4000-c000-000000000004', 'structure-dupe@example.invalid');

-- 10 — PRD US-F1. A rep with no region is either a rep who can see nothing, or — with one
-- carelessly NULL-tolerant policy — a rep who can see everything. Refuse the row instead.
select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-4000-c000-000000000001', 'regional_rep') $$,
  '23514'::char(5),
  null::text,
  'a regional_rep with no region_id is refused (23514) — rr_needs_region, PRD US-F1'
);

-- 11
select lives_ok(
  $$ insert into public.user_roles (user_id, role, region_id)
     select '00000000-0000-4000-c000-000000000001', 'regional_rep', id
       from public.regions where code = 'ZZTESTA' $$,
  'a regional_rep WITH a region_id is accepted'
);

-- 12 — user_roles.person_id and region_id are nullable in both directions on purpose:
-- a tech_admin need not be a member, and a member need not have an account (OQ-12).
select lives_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-4000-c000-000000000003', 'tech_admin') $$,
  'a non-rep role with no region_id is accepted'
);

-- 13
insert into public.user_roles (user_id, role, person_id)
select '00000000-0000-4000-c000-000000000002', 'member', id
  from public.people where member_id = '2099-001';

select throws_ok(
  $$ insert into public.user_roles (user_id, role, person_id)
     select '00000000-0000-4000-c000-000000000004', 'member', id
       from public.people where member_id = '2099-001' $$,
  '23505'::char(5),
  null::text,
  'one person cannot hold two accounts (23505) — user_roles.person_id is UNIQUE'
);

-- ── indexes ────────────────────────────────────────────────────────────────────────

-- 14
-- has_index()'s 4-argument form is ambiguous in pgTAP (schema, table, index, COLUMN
-- vs schema, table, index, description), so this asserts against the catalog directly.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'people' and indexname = 'people_name_trgm'),
  1,
  'people_name_trgm exists — PRD US-I2 partial-name search is an index scan, not a seq scan'
);

-- 15
-- has_index()'s 4-argument form is ambiguous in pgTAP (schema, table, index, COLUMN
-- vs schema, table, index, description), so this asserts against the catalog directly.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'people' and indexname = 'people_join_year'),
  1,
  'people_join_year exists — PRD US-G2 "year of membership" filter'
);

-- 16
-- has_index()'s 4-argument form is ambiguous in pgTAP (schema, table, index, COLUMN
-- vs schema, table, index, description), so this asserts against the catalog directly.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'user_roles' and indexname = 'user_roles_person'),
  1,
  'user_roles_person exists — the person_id lookup walked on every member request'
);

-- ── RLS ────────────────────────────────────────────────────────────────────────────
-- 001_meta_force_rls.sql asserts this over the whole schema; asserted again here because
-- FORCE (not merely ENABLE) is what makes the boundary hold against the table OWNER, and
-- the Supabase migration role IS the owner.

-- 17
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('people', 'member_id_counters', 'user_roles')
      and c.relrowsecurity
      and c.relforcerowsecurity),
  3,
  'people, member_id_counters and user_roles all carry ENABLE + FORCE ROW LEVEL SECURITY'
);

select * from finish();

rollback;
