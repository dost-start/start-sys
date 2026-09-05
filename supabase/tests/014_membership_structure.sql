-- ═══════════════════════════════════════════════════════════════════════════════════
-- 014_membership_structure.sql
--
-- Structural assertions over 0006_membership.sql. The headline is assertions 2 and 3:
-- `unique (person_id, term_id)` IS the PRD's "one membership record per term" (US-H1),
-- and the SAME person in a DIFFERENT term must succeed — that second case is the renewal
-- path, and a test that only proved the duplicate is refused would happily pass on a
-- constraint that had been widened to `unique (person_id)`.
--
--    1     one membership lives
--    2     a second membership for the same (person, term) is refused   23505  ← US-H1
--    3     the same person in a DIFFERENT term lives                    ← the renewal case
--    4-6   year_level is bounded to 1..8                                23514
--    7     expected_grad_year is bounded to 2000..2100                  23514
--    8     region_id is NOT NULL                                        23502  ← US-F1
--                                                                         scoping reads it
--    9     status defaults to 'active'
--   10     member_affiliations is keyed on the MEMBERSHIP, once          23505
--   11     writing a membership into an ARCHIVED term is refused         42501
--   12     writing a member_affiliation whose parent membership is in an
--          archived term is refused                                      42501
--   13-15  the three indexes exist
--   16     both tables are ENABLE + FORCE RLS
--   17     member_id does NOT exist on memberships                       ← the structural
--                                                                         half of US-C4
--
-- PRD §3 v1.0 items 4, 10, 11; PRD US-C4, US-D1, US-F1, US-H1, US-H5.
-- DATA_MODEL.md §6/0006, §2.2, §2.3, §7.3.
--
-- ⚠ NOT ASSERTED HERE, BY DESIGN: the CBL Art. VII status state machine — including the
-- exec_admin-only 'terminated' edges — is enforced by enforce_membership_transition() in
-- 0028 (BUILD_PLAN S5-T1) and asserted in 060. This file must stay green both before and
-- after 0028 lands, so every insert below uses 'active' or an explicitly legal value and
-- no transition is exercised.
--
-- Fixture values use the 2091-2094 term range, the ZZTEST* reference codes and the d000
-- UUID block so they cannot collide with 0016_seed.sql or the shared fixtures. Terms are
-- created as 'draft' so the `one_active_term` partial unique index is never contended.
-- Everything is rolled back.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(17);

-- ── fixtures, all local to this transaction ────────────────────────────────────────
insert into public.regions (code, name, island_group, sort_order)
values ('ZZTESTB', 'Membership Test Region', 'Visayas', 9002);

insert into public.affiliations (code, name)
values ('ZZTEST_AFFILIATION', 'Membership Test Affiliation');

insert into public.terms (label, starts_on, ends_on, status) values
  ('2091-2092', date '2091-06-01', date '2092-05-31', 'draft'),
  ('2092-2093', date '2092-06-01', date '2093-05-31', 'draft'),
  ('2093-2094', date '2093-06-01', date '2094-05-31', 'draft');

insert into public.people (id, join_year, given_name, family_name) values
  ('00000000-0000-4000-d000-000000000001', 2091, 'Renewing', 'Scholar'),
  ('00000000-0000-4000-d000-000000000002', 2091, 'Second', 'Scholar');

-- ── the core constraint ────────────────────────────────────────────────────────────

-- 1
select lives_ok(
  $$ insert into public.memberships (person_id, term_id, region_id, year_level, expected_grad_year)
     select '00000000-0000-4000-d000-000000000001',
            (select id from public.terms where label = '2091-2092'),
            (select id from public.regions where code = 'ZZTESTB'),
            1, 2095 $$,
  'a membership for a person in a term is accepted'
);

-- 2 — PRD US-H1 / MVP item 4, as a database constraint.
select throws_ok(
  $$ insert into public.memberships (person_id, term_id, region_id)
     select '00000000-0000-4000-d000-000000000001',
            (select id from public.terms where label = '2091-2092'),
            (select id from public.regions where code = 'ZZTESTB') $$,
  '23505'::char(5),
  null::text,
  'a second membership for the same (person, term) is refused (23505) — PRD US-H1'
);

-- 3 — THE RENEWAL CASE. This must live, or a member could not return next year.
select lives_ok(
  $$ insert into public.memberships (person_id, term_id, region_id)
     select '00000000-0000-4000-d000-000000000001',
            (select id from public.terms where label = '2092-2093'),
            (select id from public.regions where code = 'ZZTESTB') $$,
  'the SAME person in a DIFFERENT term is accepted — a member''s history is a sequence'
);

-- ── the bounded columns ────────────────────────────────────────────────────────────

-- 4
select throws_ok(
  $$ insert into public.memberships (person_id, term_id, region_id, year_level)
     select '00000000-0000-4000-d000-000000000002',
            (select id from public.terms where label = '2091-2092'),
            (select id from public.regions where code = 'ZZTESTB'), 0 $$,
  '23514'::char(5),
  null::text,
  'year_level 0 is refused (23514)'
);

-- 5
select throws_ok(
  $$ insert into public.memberships (person_id, term_id, region_id, year_level)
     select '00000000-0000-4000-d000-000000000002',
            (select id from public.terms where label = '2091-2092'),
            (select id from public.regions where code = 'ZZTESTB'), 9 $$,
  '23514'::char(5),
  null::text,
  'year_level 9 is refused (23514)'
);

-- 6
select lives_ok(
  $$ insert into public.memberships (person_id, term_id, region_id, year_level)
     select '00000000-0000-4000-d000-000000000002',
            (select id from public.terms where label = '2091-2092'),
            (select id from public.regions where code = 'ZZTESTB'), 5 $$,
  'year_level 5 is accepted — the range is inclusive at both ends (1..5 since 0038, the SRS form)'
);

-- 7 — the sole input to the renewal-eligibility predicate (PRD US-G7, OQ-3).
select throws_ok(
  $$ insert into public.memberships (person_id, term_id, region_id, expected_grad_year)
     select '00000000-0000-4000-d000-000000000002',
            (select id from public.terms where label = '2092-2093'),
            (select id from public.regions where code = 'ZZTESTB'), 1999 $$,
  '23514'::char(5),
  null::text,
  'expected_grad_year outside 2000..2100 is refused (23514)'
);

-- 8 — PRD US-F1 regional scoping reads memberships.region_id, so it cannot be optional.
select throws_ok(
  $$ insert into public.memberships (person_id, term_id)
     select '00000000-0000-4000-d000-000000000002',
            (select id from public.terms where label = '2093-2094') $$,
  '23502'::char(5),
  null::text,
  'region_id is NOT NULL (23502) — PRD US-F1 scoping has nothing to scope on without it'
);

-- 9
select is(
  (select status::text from public.memberships
    where person_id = '00000000-0000-4000-d000-000000000001'
      and term_id = (select id from public.terms where label = '2092-2093')),
  'active',
  'memberships.status defaults to active'
);

-- ── member_affiliations ────────────────────────────────────────────────────────────

insert into public.member_affiliations (membership_id, affiliation_id)
select m.id, a.id
  from public.memberships m, public.affiliations a
 where m.person_id = '00000000-0000-4000-d000-000000000001'
   and m.term_id = (select id from public.terms where label = '2091-2092')
   and a.code = 'ZZTEST_AFFILIATION';

-- 10 — the cohort is a fact about a TERM membership, recorded once (DATA_MODEL §2.2).
select throws_ok(
  $$ insert into public.member_affiliations (membership_id, affiliation_id)
     select m.id, a.id
       from public.memberships m, public.affiliations a
      where m.person_id = '00000000-0000-4000-d000-000000000001'
        and m.term_id = (select id from public.terms where label = '2091-2092')
        and a.code = 'ZZTEST_AFFILIATION' $$,
  '23505'::char(5),
  null::text,
  'a membership cannot join the same affiliation twice (23505) — composite PK'
);

-- ── the archived-term freeze (DATA_MODEL.md §7.3) ──────────────────────────────────
-- Archived means read-only for EVERY role, including exec_admin. The rows below are
-- written while 2093-2094 is still 'draft', then the term is archived, so the guard is
-- exercised on a write that arrives afterwards — which is the real-world shape.

insert into public.memberships (person_id, term_id, region_id)
select '00000000-0000-4000-d000-000000000002',
       (select id from public.terms where label = '2093-2094'),
       (select id from public.regions where code = 'ZZTESTB');

update public.terms set status = 'archived', archived_at = now() where label = '2093-2094';

-- 11
select throws_ok(
  $$ insert into public.memberships (person_id, term_id, region_id)
     select '00000000-0000-4000-d000-000000000001',
            (select id from public.terms where label = '2093-2094'),
            (select id from public.regions where code = 'ZZTESTB') $$,
  '42501'::char(5),
  null::text,
  'writing a membership into an archived term is refused (42501)'
);

-- 12 — member_affiliations carries NO term_id, so this exercises the membership-resolving
-- variant of the guard. Attaching reject_write_to_archived_term() here instead would fail
-- at runtime with "record new has no field term_id".
select throws_ok(
  $$ insert into public.member_affiliations (membership_id, affiliation_id)
     select m.id, a.id
       from public.memberships m, public.affiliations a
      where m.person_id = '00000000-0000-4000-d000-000000000002'
        and m.term_id = (select id from public.terms where label = '2093-2094')
        and a.code = 'ZZTEST_AFFILIATION' $$,
  '42501'::char(5),
  null::text,
  'a member_affiliation whose parent membership is in an archived term is refused (42501)'
);

-- ── indexes ────────────────────────────────────────────────────────────────────────

-- 13
-- has_index()'s 4-argument form is ambiguous in pgTAP (schema, table, index, COLUMN
-- vs schema, table, index, description), so this asserts against the catalog directly.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'memberships' and indexname = 'memberships_term_status_region'),
  1,
  'memberships_term_status_region exists — the RR dashboard and the faceted member grid'
);

-- 14
-- has_index()'s 4-argument form is ambiguous in pgTAP (schema, table, index, COLUMN
-- vs schema, table, index, description), so this asserts against the catalog directly.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'memberships' and indexname = 'memberships_current'),
  1,
  'memberships_current exists — the partial index every current-term dashboard uses'
);

-- 15
-- has_index()'s 4-argument form is ambiguous in pgTAP (schema, table, index, COLUMN
-- vs schema, table, index, description), so this asserts against the catalog directly.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'memberships' and indexname = 'memberships_person'),
  1,
  'memberships_person exists — "show me this person''s whole history" (PRD US-H3)'
);

-- ── RLS ────────────────────────────────────────────────────────────────────────────

-- 16
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('memberships', 'member_affiliations')
      and c.relrowsecurity
      and c.relforcerowsecurity),
  2,
  'memberships and member_affiliations both carry ENABLE + FORCE ROW LEVEL SECURITY'
);

-- ── the structural half of PRD US-C4 ───────────────────────────────────────────────
-- 17 — member_id is on `people`, so renewal (which writes THIS table) has no code path
-- that could renumber anyone. If a future migration ever adds the column here, that
-- protection is gone and this assertion is the thing that says so.
select hasnt_column(
  'public', 'memberships', 'member_id',
  'memberships has NO member_id column — 2024-001 cannot become 2025-001 (PRD US-C4)'
);

select * from finish();

rollback;
