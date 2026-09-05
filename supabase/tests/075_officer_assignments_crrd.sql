-- ═══════════════════════════════════════════════════════════════════════════════════
-- 075_officer_assignments_crrd.sql  —  ADR 0012, the test half: crrd_admin becomes a
-- second RECORDER of officer_assignments, alongside exec_admin
--
-- WHAT:
--    1     positive control
--    2-3   crrd_admin CAN appoint an officer to a VACANT position — INSERT, status
--          'active' (ADR 0012)
--    4-5   crrd_admin CAN then record that same holder's separation — UPDATE, with a
--          status_note naming the CBL basis (ADR 0012)
--    6-8   officer, regional_rep_a and tech_admin CANNOT appoint — INSERT raises 42501
--    9-11  officer, regional_rep_a and tech_admin CANNOT record a separation on an
--          EXISTING assignment — UPDATE affects 0 rows
--   12     one_sitting_officer STILL refuses a second sitting holder of an already-filled
--          position, even from a role this migration widened (0007, unchanged)
--   13-14  exec_admin STILL can appoint and separate — the widening is additive, not a
--          replacement (0014, as amended by 0046)
--   15     the archived-term freeze STILL applies to the widened role — a vacancy in a
--          closed term is not a CRRD write either (0005/0007, unchanged)
--   16     memberships.status = 'terminated' (CBL Art. VII §3.2.3) is UNTOUCHED — still
--          exec_admin ONLY, regardless of this migration (0028, unchanged)
--   17-18  the catalog itself: officer_assignments_insert / _update now name crrd_admin
--   19     officer_assignments_read is STILL using(true) — the org chart stays org-public
--   20     STILL no DELETE policy on officer_assignments
--
-- ⚠ AN INSERT REFUSED BY RLS RAISES 42501; AN UPDATE REFUSED BY RLS AFFECTS 0 ROWS. Same
--   asymmetry 025_org_structure_rls.sql documents and relies on — a WITH CHECK failure is
--   evaluated against the proposed row and raises, a USING failure filters the scan so
--   there is no row to update.
--
-- ⚠ ASSERTION 16 IS throws_ok, NOT "0 rows affected", even though ADR 0012's own summary
--   says "still affects 0 rows". The ground truth, proven in 024_memberships_rls.sql, is
--   that enforce_membership_transition() (0028) raises 42501 itself for a non-exec_admin
--   attempt at 'terminated' — a real exception, evaluated BEFORE the policy's WITH CHECK
--   half is ever reached (the USING half still shows crrd_admin the active row, so the
--   BEFORE trigger fires first). Two layers, one refusal; the raise is what is actually
--   observed, so that is what is asserted here. Flagged rather than smoothed over,
--   exactly as 025's own header flags the INSERT/UPDATE asymmetry.
--
-- CITATION:  ADR 0012; DATA_MODEL.md §3.4, §13 rule 10; ARCHITECTURE.md §5;
--            PRD OQ-16, US-E5, US-E6, US-E7; CBL Art. VI §1.2, §1.6-1.7, §2.2, §3.2.3,
--            §3.2.7-8, §4; CBL Art. VII §3.2.3 (the untouched boundary).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(20);


-- SECURITY INVOKER, so the statement runs with the calling fixture's privileges.
-- Redefined per-file (pg_temp does not survive across test files) — same body as
-- 025_org_structure_rls.sql and 024_memberships_rls.sql.
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
-- 1 — positive control
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(public.auth_role()::text, 'crrd_admin',
  'POSITIVE CONTROL: the crrd_admin fixture''s claims resolve before any deny assertion is trusted');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2-3 — crrd_admin CAN appoint an officer to a vacant position (ADR 0012)
--
-- COO is deliberately empty in the fixture (CBL Art. VI §4: a vacancy is the ABSENCE of a
-- sitting assignment). P4 (b000-...004) is an existing person with no officer seat.
-- ═══════════════════════════════════════════════════════════════════════════════════

select lives_ok($$
    insert into public.officer_assignments
      (id, person_id, term_id, role, status, is_acting, status_note)
    select '00000000-0000-4000-f000-000000000101',
           '00000000-0000-4000-b000-000000000004',
           id, 'COO', 'active', false,
           'CBL Art. VI §4.2 vacancy filled; CEO designated (fixture, recorded by CRRD per ADR 0012)'
    from public.terms where status = 'active'
  $$,
  'crrd_admin CAN appoint an officer to a vacant position — ADR 0012, CBL Art. VI §4.2');

select is(
  (select status::text from public.officer_assignments
    where id = '00000000-0000-4000-f000-000000000101'),
  'active',
  'the appointment landed as an active assignment');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-5 — crrd_admin CAN then record that same holder's separation (ADR 0012)
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(pg_temp.rows_affected($$
    update public.officer_assignments
       set status = 'resigned',
           status_note = 'CBL Art. VI §2.2 resignation approved by the CEO (fixture, recorded by CRRD)'
     where id = '00000000-0000-4000-f000-000000000101'
  $$), 1,
  'crrd_admin CAN record a resignation on the officer it just appointed — ADR 0012, CBL Art. VI §2.2');

select is(
  (select status::text from public.officer_assignments
    where id = '00000000-0000-4000-f000-000000000101'),
  'resigned',
  'the separation landed, with the status_note naming the CBL basis and the decider');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 6-8 — officer, regional_rep_a, tech_admin CANNOT appoint — refused at the data layer
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$
    insert into public.officer_assignments (person_id, term_id, role, status, status_note)
    select '00000000-0000-4000-b000-000000000004', id, 'CFO', 'active',
           'officer attempting to appoint (fixture, must be refused)'
    from public.terms where status = 'active'
  $$,
  '42501'::char(5), null::text,
  'officer CANNOT appoint an officer — PRD US-D2, no write path exists for this tier on any record');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok($$
    insert into public.officer_assignments (person_id, term_id, role, status, status_note)
    select '00000000-0000-4000-b000-000000000004', id, 'CFO', 'active',
           'regional_rep attempting to appoint (fixture, must be refused)'
    from public.terms where status = 'active'
  $$,
  '42501'::char(5), null::text,
  'regional_rep_a CANNOT appoint an officer — PRD US-F2, no create/update path exists for this tier');

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok($$
    insert into public.officer_assignments (person_id, term_id, role, status, status_note)
    select '00000000-0000-4000-b000-000000000004', id, 'CFO', 'active',
           'tech_admin attempting to appoint (fixture, must be refused)'
    from public.terms where status = 'active'
  $$,
  '42501'::char(5), null::text,
  'tech_admin CANNOT appoint an officer — configuring the system (PRD OQ-5) is not recording who holds a CBL position');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-11 — officer, regional_rep_a, tech_admin CANNOT record a separation either
--
-- Target is the CCDO's own standing assignment (f000-...002), which every one of these
-- attempts must leave untouched.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is(pg_temp.rows_affected($$
    update public.officer_assignments set status = 'resigned'
     where id = '00000000-0000-4000-f000-000000000002'
  $$), 0,
  'officer CANNOT record a separation — 0 rows affected, not merely a hidden button');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is(pg_temp.rows_affected($$
    update public.officer_assignments set status = 'resigned'
     where id = '00000000-0000-4000-f000-000000000002'
  $$), 0,
  'regional_rep_a CANNOT record a separation — 0 rows affected');

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is(pg_temp.rows_affected($$
    update public.officer_assignments set status = 'resigned'
     where id = '00000000-0000-4000-f000-000000000002'
  $$), 0,
  'tech_admin CANNOT record a separation — 0 rows affected, ADR 0012 widens crrd_admin only, not tech_admin');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12 — one_sitting_officer STILL refuses a second sitting holder (0007, unchanged)
--
-- CEO is already sat by P1 (f000-...001), active, not acting. crrd_admin is now permitted
-- BY THE POLICY to attempt this insert — it must still fail, but on the CONSTRAINT, not
-- the policy: proof that widening the write policy did not also loosen the structural
-- single-occupancy guard.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok($$
    insert into public.officer_assignments (person_id, term_id, role, status, status_note)
    select '00000000-0000-4000-b000-000000000006', id, 'CEO', 'active',
           'second CEO attempt (fixture, must collide with one_sitting_officer)'
    from public.terms where status = 'active'
  $$,
  '23505'::char(5), null::text,
  'crrd_admin CANNOT seat a second sitting CEO — one_sitting_officer (0007) is unmodified by ADR 0012');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-14 — exec_admin STILL can appoint and separate — additive, not a replacement
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select lives_ok($$
    insert into public.officer_assignments
      (id, person_id, term_id, role, status, is_acting, status_note)
    select '00000000-0000-4000-f000-000000000102',
           '00000000-0000-4000-b000-000000000006',
           id, 'CMO', 'active', false,
           'CBL Art. VI §4.2 vacancy filled (fixture, recorded by exec_admin)'
    from public.terms where status = 'active'
  $$,
  'exec_admin CAN STILL appoint an officer — ADR 0012 only ADDS crrd_admin, it does not narrow exec_admin');

select is(pg_temp.rows_affected($$
    update public.officer_assignments
       set status = 'on_leave',
           status_note = 'CBL Art. VI §1.2 leave approved by the CEO (fixture)'
     where id = '00000000-0000-4000-f000-000000000102'
  $$), 1,
  'exec_admin CAN STILL record a separation — unchanged by ADR 0012');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 15 — the archived-term freeze still applies to the widened role (0005/0007, unchanged)
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok($$
    insert into public.officer_assignments (person_id, term_id, role, status, status_note)
    values ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-d000-000000000001',
            'CEVO', 'active', 'attempted appointment on an archived term (fixture, must be refused)')
  $$,
  '42501'::char(5), null::text,
  'crrd_admin CANNOT appoint into an ARCHIVED term — reject_write_to_archived_term() (0005/0007) still fires, ADR 0012 does not touch it');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 16 — memberships.status='terminated' (CBL Art. VII §3.2.3) is UNTOUCHED
--
-- Different Article, different table, different deciding body — DATA_MODEL.md §3.1/§3.4
-- names conflating these two "the single most likely future mistake in this schema".
-- ADR 0012 widens officer_assignments (Art. VI) ONLY; this proves memberships (Art. VII)
-- did not move an inch. throws_ok, not a row-count check — see the file header.
-- ═══════════════════════════════════════════════════════════════════════════════════

select throws_ok($$
    update public.memberships
       set status = 'terminated',
           ended_reason = 'CBL Art. VII 3.2.3 Executive Board majority vote (fixture)'
     where id = '00000000-0000-4000-c000-000000000002'
  $$, '42501', null,
  'crrd_admin STILL cannot set memberships.status=terminated — CBL Art. VII §3.2.3 remains exec_admin-only; ADR 0012 touches officer_assignments (Art. VI) only');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 17-20 — the catalog itself
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.logout();

select ok(
  (select with_check from pg_policies
     where schemaname = 'public' and tablename = 'officer_assignments'
       and policyname = 'officer_assignments_insert') ~ 'crrd_admin',
  'officer_assignments_insert now names crrd_admin in its WITH CHECK — ADR 0012, 0046');

select ok(
  (select qual from pg_policies
     where schemaname = 'public' and tablename = 'officer_assignments'
       and policyname = 'officer_assignments_update') ~ 'crrd_admin',
  'officer_assignments_update now names crrd_admin in its USING clause — ADR 0012, 0046');

select is(
  (select qual from pg_policies
     where schemaname = 'public' and tablename = 'officer_assignments'
       and policyname = 'officer_assignments_read'),
  'true',
  'officer_assignments_read is STILL using(true) for every authenticated tier — unmodified by 0046 (PRD US-E4)');

select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'officer_assignments' and cmd = 'DELETE'),
  0,
  'STILL no DELETE policy on officer_assignments — CLAUDE.md: no DELETE policy exists anywhere and none may be added');


select * from finish();

rollback;
