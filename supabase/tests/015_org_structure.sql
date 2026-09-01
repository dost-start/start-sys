-- ═══════════════════════════════════════════════════════════════════════════════════
-- 015_org_structure.sql
--
-- Structural assertions over 0007_org_structure.sql. The headline is assertions 6-11: the
-- two partial unique indexes are what make CBL Art. VI §4's "vacancy" expressible as the
-- ABSENCE of a row rather than as an enum value, and they must constrain single-seat
-- positions WITHOUT constraining the two multi-seat ones the Constitution creates.
--
--    1     a department lives
--    2     a duplicate (term_id, code) department is refused          23505
--    3     head_position must name a real CBL position                23503  ← Art. III §4
--    4-5   committees are term-scoped and uniquely coded              23505
--    6     one SITTING holder of a single-seat position lives
--    7     a SECOND sitting holder is refused                         23505  ← one_sitting_officer
--    8     an ACTING holder alongside the sitting one lives           ← Art. VI §4.2
--    9     a SECOND acting holder is refused                          23505  ← one_acting_officer
--   10     a non-'active' assignment for the same seat lives          ← the index is partial:
--                                                                       a suspended officer
--                                                                       does not block their
--                                                                       own replacement
--   11     FIVE sitting REGIONAL_REPs in one term all live            ← Art. III §4.6 sets no
--                                                                       headcount; excluded
--                                                                       from both indexes
--   12     officer_assignments.status defaults to 'active'
--   13-14  the two link tables are keyed once per pair                23505
--   15     one confidentiality acknowledgement per person per term    23505  ← Art. VIII §7.1
--   16     agreement_version is NOT NULL                              23502
--   17     an officer_assignment write into an archived term          42501
--   18     a committee_membership whose parent membership is in an
--          archived term                                             42501
--   19-21  the three indexes exist
--   22     all six tables are ENABLE + FORCE RLS
--
-- PRD §3 v1.0 items 3, 10, 15; PRD US-E1..US-E7, US-J5.
-- CBL Art. III §4, §4.6, §5; Art. V §1; Art. VI §1-§4; Art. VIII §7.1.
-- DATA_MODEL.md §6/0007, §3.4, §7.3, §8.4.
--
-- ⚠ NOT ASSERTED HERE, BY DESIGN: WHO may write these tables. Every value of
-- officer_assignment_status is a CBL Art. VI act reserved to the Executive Board, and
-- departments/committees are crrd_admin-only while their assignment tables admit
-- moderators — all of that is policy, lands in 0014, and is asserted in 025. This file
-- asserts only what holds regardless of who is asking.
--
-- ⚠ REGIONAL_REP is inserted with `on conflict do nothing` rather than assumed, because
-- the two partial indexes name that string literally: the test must exercise the real
-- code, not a stand-in, and must not depend on 0016_seed.sql having run first.
--
-- Fixture values use the 2094-2096 term range, ZZTEST* reference codes and the e000 UUID
-- block. Terms are 'draft' so `one_active_term` is never contended. All rolled back.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(22);

-- ── fixtures, all local to this transaction ────────────────────────────────────────
insert into public.regions (code, name, island_group, sort_order)
values ('ZZTESTC', 'Org Structure Test Region', 'Mindanao', 9003);

-- A single-seat position of our own, plus the real REGIONAL_REP code, because the partial
-- unique indexes hardcode 'REGIONAL_REP' and 'COMMITTEE_MEMBER'.
insert into public.officer_positions (code, title, grants_org_role, is_administrator, sort_order)
values ('ZZTEST_CHIEF', 'Org Structure Test Chief', 'officer', false, 9001)
on conflict (code) do nothing;

insert into public.officer_positions (code, title, grants_org_role, is_administrator, sort_order)
values ('REGIONAL_REP', 'Regional Representative', 'regional_rep', false, 220)
on conflict (code) do nothing;

insert into public.terms (label, starts_on, ends_on, status) values
  ('2094-2095', date '2094-06-01', date '2095-05-31', 'draft'),
  ('2095-2096', date '2095-06-01', date '2096-05-31', 'draft');

insert into public.people (id, join_year, given_name, family_name) values
  ('00000000-0000-4000-e000-000000000001', 2094, 'Sitting',  'Chief'),
  ('00000000-0000-4000-e000-000000000002', 2094, 'Acting',   'Chief'),
  ('00000000-0000-4000-e000-000000000003', 2094, 'Suspended','Chief'),
  ('00000000-0000-4000-e000-000000000004', 2094, 'RepOne',   'Scholar'),
  ('00000000-0000-4000-e000-000000000005', 2094, 'RepTwo',   'Scholar'),
  ('00000000-0000-4000-e000-000000000006', 2094, 'RepThree', 'Scholar'),
  ('00000000-0000-4000-e000-000000000007', 2094, 'RepFour',  'Scholar'),
  ('00000000-0000-4000-e000-000000000008', 2094, 'RepFive',  'Scholar');

-- ── departments — CBL Art. III §4 ──────────────────────────────────────────────────

-- 1
select lives_ok(
  $$ insert into public.departments (term_id, code, name, head_position)
     select id, 'ZZTESTDEPT', 'Org Structure Test Department', 'ZZTEST_CHIEF'
       from public.terms where label = '2094-2095' $$,
  'a term-scoped department is accepted'
);

-- 2 — the same `code` in a DIFFERENT term is the cross-term join key and must be allowed;
-- twice in the SAME term is not.
select throws_ok(
  $$ insert into public.departments (term_id, code, name, head_position)
     select id, 'ZZTESTDEPT', 'Duplicate Department', 'ZZTEST_CHIEF'
       from public.terms where label = '2094-2095' $$,
  '23505'::char(5),
  null::text,
  'a duplicate (term_id, code) department is refused (23505)'
);

-- 3 — CBL Art. III §4: each department is "headed by a Chief Officer". Storing the head as
-- a POSITION code with an FK is what stops a dashboard hard-coding a string.
select throws_ok(
  $$ insert into public.departments (term_id, code, name, head_position)
     select id, 'ZZTESTDEPT2', 'Bad Head', 'NO_SUCH_POSITION'
       from public.terms where label = '2094-2095' $$,
  '23503'::char(5),
  null::text,
  'head_position must reference a real officer_positions row (23503) — CBL Art. III §4'
);

-- ── committees — CBL Art. III §5, discretionary and per term ────────────────────────

-- 4
select lives_ok(
  $$ insert into public.committees (term_id, department_id, code, name)
     select t.id, d.id, 'ZZTESTCOMM', 'Org Structure Test Committee'
       from public.terms t
       join public.departments d on d.term_id = t.id and d.code = 'ZZTESTDEPT'
      where t.label = '2094-2095' $$,
  'a committee is accepted — Art. III §5 creation is one INSERT, no migration'
);

-- 5
select throws_ok(
  $$ insert into public.committees (term_id, code, name)
     select id, 'ZZTESTCOMM', 'Duplicate Committee'
       from public.terms where label = '2094-2095' $$,
  '23505'::char(5),
  null::text,
  'a duplicate (term_id, code) committee is refused (23505)'
);

-- ── officer_assignments — CBL Art. VI single occupancy and acting designations ──────

-- 6
select lives_ok(
  $$ insert into public.officer_assignments (person_id, term_id, role)
     select '00000000-0000-4000-e000-000000000001', id, 'ZZTEST_CHIEF'
       from public.terms where label = '2094-2095' $$,
  'one SITTING holder of a single-seat position is accepted'
);

-- 7 — CBL Art. VI §4's vacancy is the ABSENCE of this row, which is only meaningful if at
-- most one can exist. There is no 'vacant' enum value and none may be added.
select throws_ok(
  $$ insert into public.officer_assignments (person_id, term_id, role)
     select '00000000-0000-4000-e000-000000000002', id, 'ZZTEST_CHIEF'
       from public.terms where label = '2094-2095' $$,
  '23505'::char(5),
  null::text,
  'a SECOND sitting holder of the same position in the same term is refused (23505)'
);

-- 8 — CBL Art. VI §4.2: the CEO designates an acting officer from the department's
-- deputies. The acting row coexists with the sitting one.
select lives_ok(
  $$ insert into public.officer_assignments (person_id, term_id, role, is_acting)
     select '00000000-0000-4000-e000-000000000002', id, 'ZZTEST_CHIEF', true
       from public.terms where label = '2094-2095' $$,
  'an ACTING holder alongside the sitting one is accepted — CBL Art. VI §4.2'
);

-- 9
select throws_ok(
  $$ insert into public.officer_assignments (person_id, term_id, role, is_acting)
     select '00000000-0000-4000-e000-000000000003', id, 'ZZTEST_CHIEF', true
       from public.terms where label = '2094-2095' $$,
  '23505'::char(5),
  null::text,
  'a SECOND acting holder of the same position in the same term is refused (23505)'
);

-- 10 — both indexes are partial on `status = 'active'`. A suspended officer (Art. VI
-- §3.2.3) must not block the record of whoever holds the seat instead.
select lives_ok(
  $$ insert into public.officer_assignments (person_id, term_id, role, status, status_note)
     select '00000000-0000-4000-e000-000000000003', id, 'ZZTEST_CHIEF', 'suspended',
            'CBL Art. VI §3.2.3 — indefinite LOA pending impeachment proceedings'
       from public.terms where label = '2094-2095' $$,
  'a non-active assignment for the same seat is accepted — the indexes are partial'
);

-- 11 — CBL Art. III §4.6 creates Regional Representatives across the 18 regions and sets
-- NO headcount, so REGIONAL_REP is excluded from both partial indexes. Five in one term.
insert into public.officer_assignments (person_id, term_id, role)
select p.id, t.id, 'REGIONAL_REP'
  from public.people p, public.terms t
 where t.label = '2094-2095'
   and p.id in ('00000000-0000-4000-e000-000000000004',
                '00000000-0000-4000-e000-000000000005',
                '00000000-0000-4000-e000-000000000006',
                '00000000-0000-4000-e000-000000000007',
                '00000000-0000-4000-e000-000000000008');

select is(
  (select count(*)::int from public.officer_assignments oa
     join public.terms t on t.id = oa.term_id
    where t.label = '2094-2095' and oa.role = 'REGIONAL_REP'
      and oa.status = 'active' and not oa.is_acting),
  5,
  'five sitting REGIONAL_REPs coexist in one term — CBL Art. III §4.6 sets no headcount'
);

-- 12
select is(
  (select status::text from public.officer_assignments
    where person_id = '00000000-0000-4000-e000-000000000001'
      and role = 'ZZTEST_CHIEF'),
  'active',
  'officer_assignments.status defaults to active'
);

-- ── the assignment link tables ─────────────────────────────────────────────────────

insert into public.memberships (id, person_id, term_id, region_id) values
  ('00000000-0000-4000-e000-0000000000a1',
   '00000000-0000-4000-e000-000000000001',
   (select id from public.terms where label = '2094-2095'),
   (select id from public.regions where code = 'ZZTESTC')),
  ('00000000-0000-4000-e000-0000000000a2',
   '00000000-0000-4000-e000-000000000002',
   (select id from public.terms where label = '2095-2096'),
   (select id from public.regions where code = 'ZZTESTC'));

insert into public.department_assignments (membership_id, department_id)
select '00000000-0000-4000-e000-0000000000a1', id
  from public.departments where code = 'ZZTESTDEPT';

insert into public.committee_memberships (membership_id, committee_id)
select '00000000-0000-4000-e000-0000000000a1', id
  from public.committees where code = 'ZZTESTCOMM';

-- 13
select throws_ok(
  $$ insert into public.department_assignments (membership_id, department_id)
     select '00000000-0000-4000-e000-0000000000a1', id
       from public.departments where code = 'ZZTESTDEPT' $$,
  '23505'::char(5),
  null::text,
  'a membership cannot be assigned to the same department twice (23505)'
);

-- 14
select throws_ok(
  $$ insert into public.committee_memberships (membership_id, committee_id)
     select '00000000-0000-4000-e000-0000000000a1', id
       from public.committees where code = 'ZZTESTCOMM' $$,
  '23505'::char(5),
  null::text,
  'a membership cannot join the same committee twice (23505)'
);

-- ── confidentiality_acknowledgements — CBL Art. VIII §7.1 ──────────────────────────
-- Grain is person x term because §7 requires the agreement "upon assuming their roles"
-- and roles are assumed per term (Art. V §1). One signature per term, not per seat: a
-- person holding two positions must not end up with two records that can disagree.

insert into public.confidentiality_acknowledgements
  (person_id, term_id, agreement_version, recorded_by)
select '00000000-0000-4000-e000-000000000001',
       (select id from public.terms where label = '2094-2095'),
       'CBL-2026-VIII-7',
       '00000000-0000-4000-a000-000000000001';

-- 15
select throws_ok(
  $$ insert into public.confidentiality_acknowledgements
       (person_id, term_id, agreement_version, recorded_by)
     select '00000000-0000-4000-e000-000000000001',
            (select id from public.terms where label = '2094-2095'),
            'CBL-2026-VIII-7',
            '00000000-0000-4000-a000-000000000001' $$,
  '23505'::char(5),
  null::text,
  'one acknowledgement per person per term (23505) — CBL Art. VIII §7.1'
);

-- 16 — which version of the agreement was signed is the compliance evidence; without it
-- the row asserts nothing checkable in 2031.
select throws_ok(
  $$ insert into public.confidentiality_acknowledgements
       (person_id, term_id, recorded_by)
     select '00000000-0000-4000-e000-000000000002',
            (select id from public.terms where label = '2094-2095'),
            '00000000-0000-4000-a000-000000000001' $$,
  '23502'::char(5),
  null::text,
  'agreement_version is NOT NULL (23502)'
);

-- ── the archived-term freeze (DATA_MODEL.md §7.3) ──────────────────────────────────
-- 2095-2096 already holds one membership, written while it was still 'draft'.

insert into public.committees (term_id, code, name)
select id, 'ZZTESTCOMM2', 'Archived Term Committee'
  from public.terms where label = '2095-2096';

update public.terms set status = 'archived', archived_at = now() where label = '2095-2096';

-- 17
select throws_ok(
  $$ insert into public.officer_assignments (person_id, term_id, role)
     select '00000000-0000-4000-e000-000000000001', id, 'ZZTEST_CHIEF'
       from public.terms where label = '2095-2096' $$,
  '42501'::char(5),
  null::text,
  'an officer_assignment write into an archived term is refused (42501)'
);

-- 18 — committee_memberships carries NO term_id, so this exercises the
-- membership-resolving variant of the guard defined in 0006.
select throws_ok(
  $$ insert into public.committee_memberships (membership_id, committee_id)
     select '00000000-0000-4000-e000-0000000000a2', id
       from public.committees where code = 'ZZTESTCOMM2' $$,
  '42501'::char(5),
  null::text,
  'a committee_membership whose parent membership is in an archived term is refused (42501)'
);

-- ── indexes ────────────────────────────────────────────────────────────────────────

-- 19
-- has_index()'s 4-argument form is ambiguous in pgTAP (schema, table, index, COLUMN
-- vs schema, table, index, description), so this asserts against the catalog directly.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'officer_assignments' and indexname = 'officer_assignments_term'),
  1,
  'officer_assignments_term exists — "who holds this position this term"'
);

-- 20
-- has_index()'s 4-argument form is ambiguous in pgTAP (schema, table, index, COLUMN
-- vs schema, table, index, description), so this asserts against the catalog directly.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'officer_assignments' and indexname = 'one_sitting_officer'),
  1,
  'one_sitting_officer exists — CBL Art. VI §4 vacancy is the absence of this row'
);

-- 21
-- has_index()'s 4-argument form is ambiguous in pgTAP (schema, table, index, COLUMN
-- vs schema, table, index, description), so this asserts against the catalog directly.
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'officer_assignments' and indexname = 'one_acting_officer'),
  1,
  'one_acting_officer exists — CBL Art. VI §4.1-4.3 acting designations'
);

-- ── RLS ────────────────────────────────────────────────────────────────────────────

-- 22
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('departments', 'committees', 'department_assignments',
                        'committee_memberships', 'officer_assignments',
                        'confidentiality_acknowledgements')
      and c.relrowsecurity
      and c.relforcerowsecurity),
  6,
  'all six org-structure tables carry ENABLE + FORCE ROW LEVEL SECURITY'
);

select * from finish();

rollback;
