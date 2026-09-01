-- ═══════════════════════════════════════════════════════════════════════════════════
-- 024_memberships_rls.sql  —  BUILD_PLAN S2-T18, the test half
--
-- `memberships` carries the highest-value policy in the slice, and the reason is
-- constitutional rather than technical: memberships_update (0014_rls.sql §4) is where
-- CBL Art. VII §3.2.3 stops being prose and becomes a database refusal. Everything else
-- in this file exists to make that assertion non-vacuous.
--
--    1-10  exact row counts per fixture, positive control first
--   11-19  nobody but exec_admin may move a membership INTO 'terminated'  (US-D5)
--   20-23  nobody but exec_admin may move one OUT of it                   (US-D6)
--   24-31  every OTHER status/field write, and who genuinely holds it
--   32-36  the INSERT boundary
--   37-39  structural: no DELETE policy, no officer/regional_rep write policy, FORCE RLS
--
-- ⚠ TWO THINGS THAT LOOK LIKE BUGS AND ARE NOT
--
-- 1. AN UPDATE REFUSED BY RLS AFFECTS 0 ROWS; AN INSERT REFUSED BY RLS RAISES 42501.
--    That asymmetry is Postgres, not us: a USING clause filters the scan (so the row is
--    simply not there to update), while a WITH CHECK clause is evaluated against the
--    proposed row and raises "new row violates row-level security policy". BUILD_PLAN
--    S2-T18's acceptance says "insert ... affects 0 rows"; the correct expectation is a
--    42501, and this file asserts the truth rather than the plan's phrasing. Flagged here
--    rather than silently smoothed over.
--
-- 2. `ended_reason` IS WRITTEN ON EVERY TERMINATION AND EVERY REVERSAL below, even though
--    nothing enforces it today. BUILD_PLAN S5-T1 adds
--    `check (status <> 'terminated' or length(btrim(ended_reason)) >= 10)` plus a trigger
--    requiring the ground to change with the decision. Writing it now means this file
--    keeps passing when 0028 lands, instead of failing in a file nobody would think to
--    look at. PRD US-D5: "recording a termination requires a written ground".
--
-- ⚠ THE POSITIVE CONTROL IS ASSERTION 2 AND IT COMES BEFORE EVERY DENY ASSERTION. A
--   malformed claim makes auth.uid() NULL, which makes auth_role() NULL, which makes every
--   policy return zero rows — and "crrd_admin cannot terminate" then passes for entirely
--   the wrong reason (test-helpers/auth.sql, note under login_as).
--
-- CITATION:  BUILD_PLAN S2-T18; ARCHITECTURE.md §5; DATA_MODEL.md §3.1, §9;
--            PRD §3 v1.0 items 10, 11; PRD US-C2, US-D1, US-D2, US-D3, US-D5, US-D6,
--            US-E4, US-F1, US-F2, US-H1; CBL Art. VII §3.1, §3.2.3, §3.2.5-3.2.6.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(39);


-- ── rows_affected() ────────────────────────────────────────────────────────────────
-- SECURITY INVOKER (the plpgsql default), so the statement runs with the CALLING
-- fixture's privileges and faces the same policies a real request faces. A refusal by a
-- USING clause returns 0 here; a refusal by a WITH CHECK clause or a missing GRANT
-- propagates as an exception, which is what throws_ok() below is for.
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
-- 1-10 — exact row counts, per fixture. Derived from test-helpers/fixtures.sql §5 and
--        the arithmetic table in that file's header. Never `> 0`: a `> 0` assertion
--        passes against a policy that returns everything.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(public.auth_role()::text, 'crrd_admin',
  'POSITIVE CONTROL: the crrd_admin fixture''s claims resolve — auth_role() is crrd_admin, not NULL');
select is((select count(*) from public.memberships)::int, 5,
  'POSITIVE CONTROL: crrd_admin sees exactly 5 memberships, so every deny below is measured against a working session');

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is((select count(*) from public.memberships)::int, 5,
  'exec_admin sees exactly 5 memberships — PRD US-D1, oversight of all org records');

-- tech_admin is absent from memberships_read, and the absence is PRD OQ-5: "configure the
-- system and control access" is not "read everyone's record".
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is((select count(*) from public.memberships)::int, 0,
  'tech_admin sees exactly 0 memberships — OQ-5 least privilege, expressed as a missing role literal');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select is((select count(*) from public.memberships)::int, 5,
  'moderator sees exactly 5 memberships — application review is impossible otherwise');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is((select count(*) from public.memberships)::int, 5,
  'officer sees exactly 5 memberships — PRD US-D2, view-only across the roll');

-- rep_a sees THREE: two current-term NCR rows plus P1's ARCHIVED NCR row. memberships_read
-- scopes a rep by region with no term filter, while people_read additionally requires a
-- CURRENT-term membership — so the rep sees 3 memberships but only 2 people. That
-- disagreement is real and is flagged in the fixtures header for the 0014 owner; it is
-- measured here rather than left latent.
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is((select count(*) from public.memberships)::int, 3,
  'regional_rep_a sees exactly 3 memberships — 2 current NCR + 1 archived NCR (PRD US-F1)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select is((select count(*) from public.memberships)::int, 2,
  'regional_rep_b sees exactly 2 memberships, disjoint from rep_a''s — PRD US-F1');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is((select count(*) from public.memberships)::int, 1,
  'member sees exactly 1 membership — their own, and no organizational roster (PRD US-E4)');

select pg_temp.login_anon();
select is((select count(*) from public.memberships)::int, 0,
  'anon sees exactly 0 memberships — PRD US-A1, no organizational record reaches an unauthenticated caller');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11-19 — INTO 'terminated': exec_admin and nobody else
--
-- CBL Art. VII §3.2.3: "A simple majority vote (50% + 1) of the Executive Board is
-- required for termination to be enacted." The WITH CHECK half of memberships_update is
-- what makes that true of the database. crrd_admin and moderator own every OTHER status
-- transition — `left` is legitimately theirs — so these two refusals are the whole point.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Since 0028, the enforce_membership_transition() trigger raises 42501 for a
-- non-exec termination attempt BEFORE the WITH CHECK half of the policy is ever
-- evaluated (the USING half still shows crrd/moderator the active row, so the
-- BEFORE trigger fires). Two layers, same refusal — the raise is the one observed.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok($$
    update public.memberships
       set status = 'terminated',
           ended_reason = 'CBL Art. VII 3.2.3 Executive Board majority vote (fixture)'
     where id = '00000000-0000-4000-c000-000000000002'
  $$, '42501', null,
  'crrd_admin CANNOT set status=terminated — CBL Art. VII §3.2.3 reserves it to the Executive Board (PRD US-D5)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select throws_ok($$
    update public.memberships
       set status = 'terminated',
           ended_reason = 'CBL Art. VII 3.2.3 Executive Board majority vote (fixture)'
     where id = '00000000-0000-4000-c000-000000000002'
  $$, '42501', null,
  'moderator CANNOT set status=terminated, despite holding every other status transition — PRD US-D3, last criterion');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is(pg_temp.rows_affected($$
    update public.memberships set status = 'terminated'
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'officer CANNOT set status=terminated — the Officer tier has no UPDATE policy at all (PRD US-D2)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is(pg_temp.rows_affected($$
    update public.memberships set status = 'terminated'
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'regional_rep_a CANNOT set status=terminated on their OWN region''s row — PRD US-F2');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is(pg_temp.rows_affected($$
    update public.memberships set status = 'terminated'
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'member CANNOT set status=terminated on their own membership — members submit forms, they do not write the roll');

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is(pg_temp.rows_affected($$
    update public.memberships set status = 'terminated'
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'tech_admin CANNOT set status=terminated — configuring the system is not deciding a membership');

select pg_temp.logout();
select is((select status::text from public.memberships where id = '00000000-0000-4000-c000-000000000002'),
  'active',
  'after six refusals the row is STILL active — the refusals changed nothing, they did not merely return 0');

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is(pg_temp.rows_affected($$
    update public.memberships
       set status = 'terminated',
           ended_reason = 'CBL Art. VII 3.2.3 Executive Board majority vote (fixture)'
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 1,
  'exec_admin CAN set status=terminated — PRD US-D5, the Executive Board records the outcome of its own vote');

select pg_temp.logout();
select is((select status::text from public.memberships where id = '00000000-0000-4000-c000-000000000002'),
  'terminated',
  'the exec_admin termination actually landed — the permitted case is not passing vacuously');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20-23 — OUT of 'terminated': the only reversal edge in the entire schema
--
-- CBL Art. VII §3.2.5-3.2.6 gives a terminated member five working days to appeal to the
-- Special Advisor, who "may recommend reconsideration". The USING half of
-- memberships_update makes an already-terminated row invisible to every writer but
-- exec_admin, so nobody else can quietly un-terminate someone the Executive Board removed.
-- Without this edge a successful appeal would be worked around by creating a second
-- `people` row — which is exactly how a member acquires a second member ID (PRD US-D6).
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(pg_temp.rows_affected($$
    update public.memberships
       set status = 'active',
           ended_reason = 'appeal upheld (fixture, unauthorized actor)'
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'crrd_admin CANNOT reverse a termination — the USING half hides an already-terminated row from them (PRD US-D6)');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select is(pg_temp.rows_affected($$
    update public.memberships
       set status = 'active',
           ended_reason = 'appeal upheld (fixture, unauthorized actor)'
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'moderator CANNOT reverse a termination — CBL Art. VII §3.2.6, the reinstatement is the Executive Board''s to record');

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is(pg_temp.rows_affected($$
    update public.memberships
       set status = 'active',
           ended_reason = 'CBL Art. VII 3.2.6 appeal upheld by the Special Advisor (fixture)'
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 1,
  'exec_admin CAN reverse a termination — the ONE reversal edge in the schema, and it is deliberate (PRD US-D6)');

select pg_temp.logout();
select is((select status::text from public.memberships where id = '00000000-0000-4000-c000-000000000002'),
  'active',
  'the reinstatement landed on the EXISTING membership row — no second person, no second member ID');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 24-31 — every other write: who genuinely holds it, and who does not
--
-- These four permitted cases matter as much as the refusals. A policy that denied
-- everything would satisfy assertions 11-23 perfectly and would also be completely broken.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(pg_temp.rows_affected($$
    update public.memberships set year_level = 3
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 1,
  'crrd_admin CAN update an ordinary member-record field — PRD US-D1, the policy is not blanket-deny');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select is(pg_temp.rows_affected($$
    update public.memberships set status = 'graduated'
     where id = '00000000-0000-4000-c000-000000000001'
  $$), 1,
  'moderator CAN set a NON-terminated status — PRD US-D3; `graduated` is the operating tier''s, `terminated` never is');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is(pg_temp.rows_affected($$
    update public.memberships set year_level = 8
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'officer CANNOT update any membership field — PRD US-D2, "no update path exists for the Officer tier on any record"');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is(pg_temp.rows_affected($$
    update public.memberships set year_level = 8
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'regional_rep_a CANNOT update a row they CAN read — PRD US-F2, regional access is not regional editing');

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select is(pg_temp.rows_affected($$
    update public.memberships set year_level = 8
     where id = '00000000-0000-4000-c000-000000000004'
  $$), 0,
  'regional_rep_b CANNOT update their own region''s row either — the absence of a policy is the enforcement');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is(pg_temp.rows_affected($$
    update public.memberships set year_level = 8
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'member CANNOT update their own membership — PRD §4, member self-service profile editing is deferred, not implicit');

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is(pg_temp.rows_affected($$
    update public.memberships set year_level = 8
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 0,
  'tech_admin CANNOT update a membership — they cannot even read one');

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is(pg_temp.rows_affected($$
    update public.memberships set year_level = 2
     where id = '00000000-0000-4000-c000-000000000002'
  $$), 1,
  'exec_admin CAN update an ordinary field — the permitted set is genuinely three roles, not one');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 32-36 — the INSERT boundary
--
-- PRD US-C2/US-H1: a membership row is created on approval and on renewal, by the three
-- operating roles (in practice from inside approve_application(), a definer). Note the
-- error, not the silent zero: an INSERT refused by WITH CHECK raises 42501. See the header.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- P2 (the CCDO's person) deliberately has NO membership in the fixture, so this insert has
-- a clean (person_id, term_id) to land on and does not fight the US-H1 unique constraint.
select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select lives_ok($$
    insert into public.memberships (person_id, term_id, status, region_id, year_level, expected_grad_year)
    select '00000000-0000-4000-b000-000000000002', t.id, 'active', r.id, 1, 2030
    from public.terms t, public.regions r
    where t.status = 'active' and r.code = 'NCR'
  $$,
  'moderator CAN insert a membership — PRD US-C2, the operating tier owns application decisions');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$
    insert into public.memberships (person_id, term_id, status, region_id)
    select '00000000-0000-4000-b000-000000000002', t.id, 'active', r.id
    from public.terms t, public.regions r
    where t.status = 'active' and r.code = 'NCR'
  $$,
  '42501'::char(5),
  null::text,
  'officer INSERT into memberships is REFUSED (42501) — a WITH CHECK failure raises, it does not affect 0 rows');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok($$
    insert into public.memberships (person_id, term_id, status, region_id)
    select '00000000-0000-4000-b000-000000000002', t.id, 'active', r.id
    from public.terms t, public.regions r
    where t.status = 'active' and r.code = 'NCR'
  $$,
  '42501'::char(5),
  null::text,
  'regional_rep_a INSERT into memberships is REFUSED — PRD US-F2');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select throws_ok($$
    insert into public.memberships (person_id, term_id, status, region_id)
    select '00000000-0000-4000-b000-000000000002', t.id, 'active', r.id
    from public.terms t, public.regions r
    where t.status = 'active' and r.code = 'NCR'
  $$,
  '42501'::char(5),
  null::text,
  'member INSERT into memberships is REFUSED — a member cannot enrol themselves into the roll');

select pg_temp.login_anon();
select throws_ok($$
    insert into public.memberships (person_id, term_id, status, region_id)
    select '00000000-0000-4000-b000-000000000002', t.id, 'active', r.id
    from public.terms t, public.regions r
    where t.status = 'active' and r.code = 'NCR'
  $$,
  '42501'::char(5),
  null::text,
  'anon INSERT into memberships is REFUSED — the only anonymous write path in the system is /apply (0008)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 37-39 — structural invariants, over the catalog rather than over behaviour
--
-- Behaviour tests prove what the policies do TODAY. These three prove what no policy is
-- ALLOWED to do, so a widening in 2029 fails here even if someone also updates the
-- expected counts above to match their change.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.logout();

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'memberships' and cmd = 'DELETE'),
  0,
  'no DELETE policy exists on memberships — membership end is a status change (PRD Reliability NFR)');

-- The role literals render as 'officer'::org_role in the policy expression text, so the
-- regex looks for a QUOTED token; that is why it cannot accidentally match the identifier
-- officer_assignments appearing in some future subquery.
select is(
  (select coalesce(string_agg(policyname, ', ' order by policyname), '')
     from pg_policies
    where schemaname = 'public'
      and tablename = 'memberships'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '''(officer|regional_rep)'''),
  '',
  'no INSERT/UPDATE policy on memberships names officer or regional_rep — PRD US-D2 and US-F2 are MISSING POLICIES (offenders appear as the have-value)');

select is(
  (select (c.relrowsecurity and c.relforcerowsecurity)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'memberships'),
  true,
  'memberships carries ENABLE and FORCE ROW LEVEL SECURITY — FORCE matters because the migration role IS the owner');


select * from finish();

rollback;
