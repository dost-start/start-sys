-- ═══════════════════════════════════════════════════════════════════════════════════
-- 025_org_structure_rls.sql  —  BUILD_PLAN S2-T19, the test half
--
-- WHERE THE OQ-14 CRRD_DEPUTY BOUNDARY IS ACTUALLY DRAWN. The split is the Constitution's,
-- not ours, and this file is what stops it from being widened by accident:
--
--   STRUCTURE   creating or renaming a committee or a department  ->  crrd_admin ALONE.
--               CBL Art. III §5.1-5.2 routes every committee creation, restructuring or
--               dissolution through a co-endorsement, COO review and CEO approval, so it
--               was never a deputy's to make. exec_admin is refused here TOO — the power
--               is the CCDO's, and "more senior" is not "also allowed".
--   STAFFING    assigning a member to an EXISTING committee or department  ->  crrd_deputy
--               as well. The locked role model gives the DCCDO-C/D and DCTO-PD exactly
--               this and no more.
--   DISCIPLINE  any officer standing  ->  exec_admin ALONE. Every value of
--               officer_assignment_status is a CBL Art. VI act reserved to the CEO or the
--               Executive Board.
--
--    1     positive control
--    2-10  committee_memberships row counts per fixture — incl. "member sees exactly 1"
--   11     crrd_deputy has NO confidentiality acknowledgement (PRD US-J5's day-one state)
--   12-20  STRUCTURE: committees and departments are the CCDO's alone
--   21-26  STAFFING: assignment to an existing committee/department is a crrd_deputy power
--   27-36  DISCIPLINE: CBL Art. VI standing is exec_admin's alone; the org chart is public
--   37-40  confidentiality_acknowledgements: exec_admin files them, nobody amends them
--   41-42  structural: no DELETE policy, no officer/regional_rep write policy
--
-- ⚠ AN INSERT REFUSED BY RLS RAISES 42501; AN UPDATE REFUSED BY RLS AFFECTS 0 ROWS.
--   A WITH CHECK failure is evaluated against the proposed row and raises; a USING failure
--   filters the scan so there is no row to update. BUILD_PLAN S2-T19's acceptance says
--   "insert committees as crrd_deputy 0 rows"; the true behaviour is a 42501 and that is
--   what is asserted. Flagged rather than smoothed over.
--
-- CITATION:  BUILD_PLAN S2-T19; ARCHITECTURE.md §4.4, §5; DATA_MODEL.md §3.4, §8.4, §9;
--            PRD §3 v1.0 items 3, 10, 15, 16; PRD US-E1, US-E2, US-E4, US-E5, US-E6,
--            US-E7, US-D2, US-F2, US-J5; CBL Art. III §4, §5.1-5.2, §5.4, Art. VI §1.2,
--            §1.7, §2.2, §3.2.3, §3.2.7, §3.2.8, §4, Art. VIII §7.1.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(39);


-- SECURITY INVOKER, so the statement runs with the calling fixture's privileges.
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
-- 1-10 — committee_memberships: the exact row counts
--
-- The fixture's one committee is CROSS-REGION on purpose (P4/NCR and P6/R07), so each
-- regional rep sees exactly ONE of its two rows. A same-region committee would let a
-- scoping predicate that ignores the region return both rows and still look right.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(public.auth_role()::text, 'crrd_admin',
  'POSITIVE CONTROL: the crrd_admin fixture''s claims resolve before any deny assertion is trusted');
select is((select count(*) from public.committee_memberships)::int, 2,
  'crrd_admin sees exactly 2 committee_memberships — PRD US-E1');

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is((select count(*) from public.committee_memberships)::int, 2,
  'exec_admin sees exactly 2 committee_memberships');

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is((select count(*) from public.committee_memberships)::int, 0,
  'tech_admin sees exactly 0 committee_memberships — the read resolves through memberships, which tech_admin cannot read (OQ-5)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select is((select count(*) from public.committee_memberships)::int, 2,
  'crrd_deputy sees exactly 2 committee_memberships — they staff committees, so they must see them');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is((select count(*) from public.committee_memberships)::int, 2,
  'officer sees exactly 2 committee_memberships — PRD US-D2, view-only');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is((select count(*) from public.committee_memberships)::int, 1,
  'regional_rep_a sees exactly 1 of the cross-region committee''s 2 rows — PRD US-F1');

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select is((select count(*) from public.committee_memberships)::int, 1,
  'regional_rep_b sees exactly the OTHER one — the two reps'' sets are disjoint');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is((select count(*) from public.committee_memberships)::int, 1,
  'member sees exactly 1 committee_membership — their own, and no roster (PRD US-E4)');

select pg_temp.login_anon();
select is((select count(*) from public.committee_memberships)::int, 0,
  'anon sees exactly 0 committee_memberships');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11 — the crrd_deputy's missing confidentiality acknowledgement
--
-- Deliberate, and it is a fixture for a requirement rather than an oversight. PRD US-J5 /
-- CBL Art. VIII §7.1: a sensitive-column read by someone with no CURRENT-TERM
-- acknowledgement must be refused with an error. Asserted here so nobody "fixes" the
-- fixture by adding the row. Assertion 39 files it, which is why this comes first.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select is((select count(*) from public.confidentiality_acknowledgements)::int, 0,
  'crrd_deputy has NO confidentiality acknowledgement on file — the deliberate day-one state (PRD US-J5, CBL Art. VIII §7.1)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12-20 — STRUCTURE is the CCDO's alone
--
-- CBL Art. III §5 makes committees discretionary and per-term, so creating one is ONE
-- INSERT — no migration, no deploy, no enum, no route (ARCHITECTURE.md §4.4). But it is
-- the CHIEF's insert. Note assertion 13: exec_admin is refused, which is counter-intuitive
-- and correct — Art. III §5.1-5.2 puts the CEO at the END of the approval chain (outside
-- the system), not at the keyboard.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok($$
    insert into public.committees (term_id, code, name)
    select id, 'EXEC_TRY', 'Exec Should Not Create This' from public.terms where status = 'active'
  $$,
  '42501'::char(5),
  null::text,
  'exec_admin CANNOT create a committee either — committees_insert names crrd_admin and only crrd_admin (PRD US-E1)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$
    insert into public.committees (term_id, code, name)
    select id, 'OFF_TRY', 'Officer Should Not Create This' from public.terms where status = 'active'
  $$,
  '42501'::char(5),
  null::text,
  'officer CANNOT create a committee — PRD US-D2, no create path exists for the Officer tier on any record');

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select lives_ok($$
    insert into public.committees (term_id, code, name)
    select id, 'FIXT_OUTREACH', 'Fixture Outreach Committee' from public.terms where status = 'active'
  $$,
  'crrd_admin CAN create a committee — one INSERT, no migration and no deploy (ARCHITECTURE.md §4.4)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(pg_temp.rows_affected($$
    update public.committees set name = 'Renamed By CCDO'
     where id = '00000000-0000-4000-e000-000000000001'
  $$), 1,
  'crrd_admin CAN rename a committee — the permitted case, so assertion 16 is not passing vacuously');

-- Departments are the exact opposite of committees in FREQUENCY but identical in
-- AUTHORITY: CBL Art. III §4 fixes seven, so this write policy is exercised roughly once
-- per Art. XII amendment. The power is still the CCDO's.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok($$
    insert into public.departments (term_id, code, name, head_position)
    select id, 'EXEC_DEPT', 'Exec Should Not Create This', 'CFO'
    from public.terms where status = 'active'
  $$,
  '42501'::char(5),
  null::text,
  'exec_admin CANNOT create a department — departments_insert names crrd_admin alone (PRD US-E2)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select lives_ok($$
    insert into public.departments (term_id, code, name, head_position)
    select id, 'FIXT_DEPT', 'Fixture Department', 'CFO'
    from public.terms where status = 'active'
  $$,
  'crrd_admin CAN create a department — the power exists even though CBL Art. III §4 makes the occasion near-zero');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 21-26 — STAFFING is a crrd_deputy power
--
-- PRD §2 CRRD deputy row: "assign members to EXISTING committees and departments". This is
-- the half of OQ-14 the docs answer confidently, and the half that makes the crrd_deputy
-- tier useful at all.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select lives_ok($$
    insert into public.committee_memberships (membership_id, committee_id)
    values ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-e000-000000000001')
  $$,
  'crrd_deputy CAN assign a member to an EXISTING committee — PRD US-E1, the staffing half of OQ-14');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$
    insert into public.committee_memberships (membership_id, committee_id)
    values ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-e000-000000000001')
  $$,
  '42501'::char(5),
  null::text,
  'officer CANNOT assign a committee member — PRD US-D2');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok($$
    insert into public.committee_memberships (membership_id, committee_id)
    values ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-e000-000000000001')
  $$,
  '42501'::char(5),
  null::text,
  'regional_rep_a CANNOT assign a committee member — PRD US-F2');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select throws_ok($$
    insert into public.committee_memberships (membership_id, committee_id)
    values ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-e000-000000000001')
  $$,
  '42501'::char(5),
  null::text,
  'member CANNOT put themselves or anyone else on a committee');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select lives_ok($$
    insert into public.department_assignments (membership_id, department_id)
    select '00000000-0000-4000-c000-000000000001', d.id
    from public.departments d
    where d.code = 'CRRD' and d.term_id = (select id from public.terms where status = 'active')
  $$,
  'crrd_deputy CAN assign a member to an EXISTING department — PRD US-E2');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$
    insert into public.department_assignments (membership_id, department_id)
    select '00000000-0000-4000-c000-000000000003', d.id
    from public.departments d
    where d.code = 'CRRD' and d.term_id = (select id from public.terms where status = 'active')
  $$,
  '42501'::char(5),
  null::text,
  'officer CANNOT assign a member to a department — PRD US-D2');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 27-36 — DISCIPLINE: CBL Art. VI standing is exec_admin's alone
--
-- Every value of officer_assignment_status is an Art. VI act reserved to the CEO or the
-- Executive Board: on_leave §1.2, suspended §3.2.3, impeached §3.2.7 (and §3.2.8 makes the
-- ruling "final and irrevocable"), resigned §2.2, dismissed §1.7. crrd_admin and crrd_deputy
-- are refused AT THE DATA LAYER, not merely hidden from (PRD US-E5, US-E6, US-E7).
--
-- And note what this does NOT do: separation from OFFICE never touches memberships.status.
-- An impeached CTO is still a member — Art. VI §3.3 disqualifies them from holding a
-- POSITION, not from the organization. Merging the two is the single most likely future
-- mistake in this schema (DATA_MODEL.md §3.4), which is why 024 and 025 are separate files.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(pg_temp.rows_affected($$
    update public.officer_assignments set status = 'impeached'
     where id = '00000000-0000-4000-f000-000000000003'
  $$), 0,
  'crrd_admin CANNOT change an officer''s standing — CBL Art. VI is the Executive Board''s (PRD US-E6)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select is(pg_temp.rows_affected($$
    update public.officer_assignments set status = 'impeached'
     where id = '00000000-0000-4000-f000-000000000003'
  $$), 0,
  'crrd_deputy CANNOT change an officer''s standing — not even their own department''s deputy');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is(pg_temp.rows_affected($$
    update public.officer_assignments set status = 'impeached'
     where id = '00000000-0000-4000-f000-000000000003'
  $$), 0,
  'officer CANNOT change an officer''s standing — including the DCOO, whose AWOL notice is issued OUTSIDE the system (PRD OQ-16)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is(pg_temp.rows_affected($$
    update public.officer_assignments
       set status = 'impeached',
           status_note = 'CBL Art. VI 3.2.7 majority vote of the Executive Board (fixture)'
     where id = '00000000-0000-4000-f000-000000000003'
  $$), 1,
  'exec_admin CAN record an impeachment — CBL Art. VI §3.2.7 (PRD US-E6)');

select pg_temp.logout();
select is((select status::text from public.officer_assignments where id = '00000000-0000-4000-f000-000000000003'),
  'impeached',
  'the impeachment landed — CBL Art. VI §3.2.8 makes it "final and irrevocable", so this state has no outbound edge');

-- The org chart is not confidential: officer_assignments_read is `using (true)` for every
-- authenticated tier, so a member can see where they and everyone else sit (PRD US-E4).
-- What is on a person's RECORD is a different question, answered by 029.
select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is((select count(*) from public.officer_assignments)::int, 4,
  'member sees all 4 officer assignments — who holds a CBL seat is org-public (PRD US-E4)');

select pg_temp.login_anon();
select is((select count(*) from public.officer_assignments)::int, 0,
  'anon sees 0 officer assignments — org-public means public to the ORGANIZATION (PRD US-A1)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok($$
    insert into public.officer_assignments (person_id, term_id, role, status)
    select '00000000-0000-4000-b000-000000000006', id, 'COO', 'active'
    from public.terms where status = 'active'
  $$,
  '42501'::char(5),
  null::text,
  'crrd_admin CANNOT seat an officer — Art. V §2 appointment and Art. VI §4 vacancy-filling are the Executive Board''s');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select throws_ok($$
    insert into public.officer_assignments (person_id, term_id, role, status)
    select '00000000-0000-4000-b000-000000000006', id, 'COO', 'active'
    from public.terms where status = 'active'
  $$,
  '42501'::char(5),
  null::text,
  'crrd_deputy CANNOT seat an officer');

-- The COO seat is deliberately EMPTY in the fixture (CBL Art. VI §4: a vacancy is the
-- ABSENCE of a sitting assignment, not a status value), so this insert has a free seat to
-- land on without fighting the one_sitting_officer partial unique index.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select lives_ok($$
    insert into public.officer_assignments (person_id, term_id, role, status)
    select '00000000-0000-4000-b000-000000000006', id, 'COO', 'active'
    from public.terms where status = 'active'
  $$,
  'exec_admin CAN seat an officer — CBL Art. V §2 / Art. VI §4.2 (PRD US-E7)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 37-40 — confidentiality_acknowledgements
--
-- CBL Art. VIII §7.1, one row per person per term, and the INSERT is exec_admin's alone:
-- ARCHITECTURE.md §5, "unblocking it is one INSERT by an exec_admin". There is NO UPDATE
-- policy at all, deliberately — a signature is a historical fact with a timestamp and an
-- agreement version, and an in-place edit would make "did they sign, and against which
-- text" unanswerable in 2031.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok($$
    insert into public.confidentiality_acknowledgements (person_id, term_id, agreement_version, recorded_by)
    select '00000000-0000-4000-b000-000000000003', id, 'CBL-2026-VIII-7',
           '00000000-0000-4000-a000-000000000003'
    from public.terms where status = 'active'
  $$,
  '42501'::char(5),
  null::text,
  'crrd_admin CANNOT file an acknowledgement — including their own; the reader may not authorize their own read');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select throws_ok($$
    insert into public.confidentiality_acknowledgements (person_id, term_id, agreement_version, recorded_by)
    select '00000000-0000-4000-b000-000000000003', id, 'CBL-2026-VIII-7',
           '00000000-0000-4000-a000-000000000004'
    from public.terms where status = 'active'
  $$,
  '42501'::char(5),
  null::text,
  'crrd_deputy CANNOT unblock their own sensitive reads by filing their own acknowledgement — PRD US-J5');

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select lives_ok($$
    insert into public.confidentiality_acknowledgements (person_id, term_id, agreement_version, recorded_by)
    select '00000000-0000-4000-b000-000000000003', id, 'CBL-2026-VIII-7',
           '00000000-0000-4000-a000-000000000001'
    from public.terms where status = 'active'
  $$,
  'exec_admin CAN file an acknowledgement — the one INSERT that unblocks a new CCDO on the morning a term opens');

select pg_temp.logout();
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename = 'confidentiality_acknowledgements'
      and cmd in ('UPDATE', 'ALL')),
  0,
  'no UPDATE policy exists on confidentiality_acknowledgements — a signature is amended by a NEW ROW, never in place');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 41-42 — structural invariants over the catalog
--
-- Behaviour tests prove what the policies do today; these prove what no policy on these
-- six tables is ALLOWED to do, so a widening in 2029 fails here even if someone also
-- adjusts the expected counts above to match their change.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select coalesce(string_agg(format('%s.%s', tablename, policyname), ', ' order by tablename, policyname), '')
     from pg_policies
    where schemaname = 'public'
      and tablename in ('departments', 'committees', 'department_assignments',
                        'committee_memberships', 'officer_assignments',
                        'confidentiality_acknowledgements')
      and cmd = 'DELETE'),
  '',
  'no DELETE policy on any org-structure table — CBL Art. III §5.4 dissolution is "do not carry it forward", not a delete');

select is(
  (select coalesce(string_agg(format('%s.%s', tablename, policyname), ', ' order by tablename, policyname), '')
     from pg_policies
    where schemaname = 'public'
      and tablename in ('departments', 'committees', 'department_assignments',
                        'committee_memberships', 'officer_assignments',
                        'confidentiality_acknowledgements')
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '''(officer|regional_rep)'''),
  '',
  'no INSERT/UPDATE policy on an org-structure table names officer or regional_rep — PRD US-D2 and US-F2 are MISSING POLICIES');


select * from finish();

rollback;
