-- ═══════════════════════════════════════════════════════════════════════════════════
-- 065_dashboard_views_rls.sql  —  the dashboards inherit their scoping, and never restate it
--
-- WHAT:
--    1-6    POSITIVE CONTROL — crrd_admin's exact row set and exact sum(member_count) from
--           all three aggregate views
--    7-24   the other three all-see tiers: exec_admin, crrd_deputy, officer
--   25-30   tech_admin sees ZERO of everything, and that is a designed answer
--   31-36   regional_rep_a — region A only, with region A's own status mix
--   37-42   regional_rep_b — region B only, with a DIFFERENT status mix
--   43-48   the member tier sees exactly their own single row
--   49-51   anon is REFUSED (42501), not returned empty
--   52      the two reps' region sets are DISJOINT (PRD US-F1)
--   53      the committee panel does NOT sum to the headcount, asserted as a number
--   54-55   the ARCHIVED term still answers, proving the views do not embed current_term_id()
--
-- WHY:  PRD §3 v1.0 item 13 (admin dashboard), 14 (RR dashboard), 15 (officer dashboard);
--   PRD US-D2, US-D4, US-F1, US-F2, US-H3. BUILD_PLAN S6-T3. ADR 0007.
--
-- ⚠ THIS IS THE FILE THE WHOLE SLICE GATES ON, AND IT MUST BE VERIFIED RED BEFORE ANY UI
--   WORK STARTS. The three views in 0032 are declared `security_invoker = true`, and that one
--   clause is the entire scoping story: a regional rep's totals are correct because
--   memberships_read (0014 §4) is evaluated for THEM, not because any code below or in the
--   views filters by region. Written WITHOUT that clause — or "optimised" into a SECURITY
--   DEFINER RPC that checks auth_role() itself — the aggregates compute as their BYPASSRLS
--   owner and **a regional rep silently sees org-wide totals on a page whose list beneath
--   shows one region.** No error, no crash, no log entry, and it looks perfectly right to
--   whoever is testing as an admin.
--
--   THE RED-VERIFICATION (BUILD_PLAN S6-T3 acceptance): flip one view to
--   `security_invoker = false` in a scratch migration, `pnpm db:reset && pnpm test:rls`,
--   and confirm assertions 31-42 fail with the rep sets showing the org-wide numbers. Then
--   revert. **A scoping test that has never been seen red is a scoping test nobody knows
--   works** — and this one CANNOT be caught by any other route, because assertions 1-24
--   stay green under exactly that break.
--
-- ⚠ tech_admin's ZEROS (25-30) ARE AN EXPECTED VALUE, NOT A BUG. memberships_read names
--   exec_admin, crrd_admin, crrd_deputy, officer, a region-scoped regional_rep branch and a
--   self-scoped member branch — and does NOT name tech_admin (PRD OQ-5, least privilege:
--   "configure the system and control access" is not "read everyone's address"). They are
--   PINNED here rather than left unasserted, so the day someone widens that policy CI says
--   exactly what changed. It is also why BUILD_PLAN S6-T13 lands the CTO on /system rather
--   than on an all-zero dashboard that would read as a broken system.
--
-- ⚠ crrd_deputy's FULL VISIBILITY (13-18) is likewise READ OUT OF THE POLICY, not assumed.
--   memberships_read does name crrd_deputy, so a crrd_deputy's dashboard is an admin's.
--
-- ⚠ THIS FILE MUTATES NOTHING after its fixtures, which is why the numbers below can be
--   written down. The arithmetic they derive from is the table at the head of
--   helpers/dashboard-fixtures.psql, and that table is authoritative — if a policy changes,
--   go there to decide whether a new number is correct or a regression.
--
-- CITATION:  BUILD_PLAN S6-T1, S6-T3, S6-T14, S6-T17; ADR 0007; ARCHITECTURE.md §5, §9;
--            DATA_MODEL.md §3.1, §6/0013, §9; PRD §3 v1.0 items 13-15; PRD US-D2, US-D4,
--            US-F1, US-F2, US-H3, US-J1; PRD §6 Success Metric 8;
--            CBL Art. III §5 (a member may serve on more than one committee).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/dashboard-fixtures.psql

select plan(55);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- Row-set renderers
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Each returns ONE deterministic string for a view, so an assertion failure prints the whole
-- row set side by side with what was expected instead of a bare count that says a number
-- moved but not which bucket.
--
-- SECURITY INVOKER (the default, and load-bearing): they resolve what the CALLING fixture
-- can see. A definer helper would hand every role the same answer and this entire file would
-- pass while proving nothing.
--
-- `collate "C"` on the sort is NOT decoration. Under a linguistic collation (en_US.UTF-8,
-- ICU) punctuation is ignored at the primary level, so '_UNASSIGNED' can sort before
-- 'FIXT_ETHICS' on one machine and after it on another — a flake that would arrive weeks
-- later on a different laptop and be blamed on the policy. "C" makes byte order the order.
--
-- '(none)' rather than NULL or '' for the empty set, so a zero-visibility tier reads as a
-- deliberate expectation in the test output rather than as a null nobody looked at.
create or replace function pg_temp.dash_status(p_term uuid) returns text
language sql stable as $$
  select coalesce(string_agg(s, ' | ' order by s collate "C"), '(none)')
  from (
    select v.status::text || '=' || v.member_count::text as s
    from public.v_membership_status_counts v
    where v.term_id = p_term
  ) q;
$$;

create or replace function pg_temp.dash_region(p_term uuid) returns text
language sql stable as $$
  select coalesce(string_agg(s, ' | ' order by s collate "C"), '(none)')
  from (
    select v.region_code || '=' || v.member_count::text as s
    from public.v_membership_region_counts v
    where v.term_id = p_term
  ) q;
$$;

-- coalesce on committee_code renders the NULL (unassigned) bucket as a named bucket, which
-- is what the dashboard does too. A NULL left as NULL would silently vanish from the
-- aggregated string and the bucket that matters most — everyone with no committee — would
-- stop being asserted.
create or replace function pg_temp.dash_committee(p_term uuid) returns text
language sql stable as $$
  select coalesce(string_agg(s, ' | ' order by s collate "C"), '(none)')
  from (
    select coalesce(v.committee_code, '_UNASSIGNED') || '=' || v.member_count::text as s
    from public.v_membership_committee_counts v
    where v.term_id = p_term
  ) q;
$$;

create or replace function pg_temp.dash_status_sum(p_term uuid) returns int
language sql stable as $$
  select coalesce(sum(member_count), 0)::int
  from public.v_membership_status_counts where term_id = p_term;
$$;

create or replace function pg_temp.dash_region_sum(p_term uuid) returns int
language sql stable as $$
  select coalesce(sum(member_count), 0)::int
  from public.v_membership_region_counts where term_id = p_term;
$$;

create or replace function pg_temp.dash_committee_sum(p_term uuid) returns int
language sql stable as $$
  select coalesce(sum(member_count), 0)::int
  from public.v_membership_committee_counts where term_id = p_term;
$$;

-- Scratchpad for the disjointness proof (52). CREATED by the session role, WRITTEN while
-- impersonating — auth.psql grants the temp schema USAGE, not CREATE.
create temp table fx_dash_scope (rep text, region_code text);
grant insert, select on fx_dash_scope to public;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-6 — crrd_admin: THE POSITIVE CONTROL
--
-- Runs FIRST and deliberately. A malformed claim makes auth.uid() NULL, which makes
-- auth_role() NULL, which makes every policy return zero rows — and every deny assertion in
-- this file would then pass FOR THE WRONG REASON. Assertions 1-6 are non-zero and specific,
-- so nothing below them is trusted until they hold.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin (CCDO)

select is(
  pg_temp.dash_status(pg_temp.fx_active_term()),
  'active=12 | graduated=2 | resigned=1',
  'POSITIVE CONTROL — crrd_admin reads the exact status row set for the active term'
);

select is(
  pg_temp.dash_status_sum(pg_temp.fx_active_term()), 15,
  'crrd_admin status counts sum to 15 — every membership in the active term'
);

select is(
  pg_temp.dash_region(pg_temp.fx_active_term()),
  'NCR=9 | R07=6',
  'crrd_admin reads both regions with their exact headcounts'
);

select is(
  pg_temp.dash_region_sum(pg_temp.fx_active_term()), 15,
  'crrd_admin region counts sum to 15 — the same 15 memberships, grouped differently'
);

select is(
  pg_temp.dash_committee(pg_temp.fx_active_term()),
  'FIXT_DASH_OPS=2 | FIXT_ETHICS=3 | _UNASSIGNED=11',
  'crrd_admin reads both committees plus the unassigned bucket (LEFT JOIN, 0032)'
);

select is(
  pg_temp.dash_committee_sum(pg_temp.fx_active_term()), 16,
  'crrd_admin committee counts sum to SIXTEEN against a headcount of 15 — D01 holds two '
  'seats (CBL Art. III §5). The panel does not sum, by design; ADR 0007 §4'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7-12 — exec_admin (CEO/COO). Identical to crrd_admin: memberships_read names both.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin

select is(pg_temp.dash_status(pg_temp.fx_active_term()),
  'active=12 | graduated=2 | resigned=1', 'exec_admin — exact status row set');
select is(pg_temp.dash_status_sum(pg_temp.fx_active_term()), 15,
  'exec_admin — status counts sum to 15');
select is(pg_temp.dash_region(pg_temp.fx_active_term()),
  'NCR=9 | R07=6', 'exec_admin — exact region row set');
select is(pg_temp.dash_region_sum(pg_temp.fx_active_term()), 15,
  'exec_admin — region counts sum to 15');
select is(pg_temp.dash_committee(pg_temp.fx_active_term()),
  'FIXT_DASH_OPS=2 | FIXT_ETHICS=3 | _UNASSIGNED=11', 'exec_admin — exact committee row set');
select is(pg_temp.dash_committee_sum(pg_temp.fx_active_term()), 16,
  'exec_admin — committee counts sum to 16');

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-18 — crrd_deputy (DCCDO-C / DCCDO-D / DCTO-PD)
--
-- FULL visibility, and it is the POLICY that says so, not an assumption: memberships_read
-- names 'crrd_deputy' alongside the two admin tiers. The crrd_deputy's boundary against
-- crrd_admin is structural (create a committee, issue an rr_send_grant, assign a role) and
-- lives in 0014 §5 — it is not a narrower READ of the same rows. Asserted here so a future
-- narrowing of memberships_read cannot land silently.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy

select is(pg_temp.dash_status(pg_temp.fx_active_term()),
  'active=12 | graduated=2 | resigned=1', 'crrd_deputy — exact status row set (memberships_read names crrd_admin)');
select is(pg_temp.dash_status_sum(pg_temp.fx_active_term()), 15,
  'crrd_deputy — status counts sum to 15');
select is(pg_temp.dash_region(pg_temp.fx_active_term()),
  'NCR=9 | R07=6', 'crrd_deputy — exact region row set');
select is(pg_temp.dash_region_sum(pg_temp.fx_active_term()), 15,
  'crrd_deputy — region counts sum to 15');
select is(pg_temp.dash_committee(pg_temp.fx_active_term()),
  'FIXT_DASH_OPS=2 | FIXT_ETHICS=3 | _UNASSIGNED=11', 'crrd_deputy — exact committee row set');
select is(pg_temp.dash_committee_sum(pg_temp.fx_active_term()), 16,
  'crrd_deputy — committee counts sum to 16');

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19-24 — officer (every other Chief and Deputy, plus the Special Advisor)
--
-- The officer tier sees the same COUNTS as an admin and none of the same COLUMNS. That is
-- not a contradiction: RLS is row-level, the column boundary is the GRANT in 0015 plus
-- v_member_directory, and these views expose no `people` column at all so they never touch
-- the second mechanism. 066 asserts that emptiness directly.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer

select is(pg_temp.dash_status(pg_temp.fx_active_term()),
  'active=12 | graduated=2 | resigned=1', 'officer — exact status row set');
select is(pg_temp.dash_status_sum(pg_temp.fx_active_term()), 15,
  'officer — status counts sum to 15');
select is(pg_temp.dash_region(pg_temp.fx_active_term()),
  'NCR=9 | R07=6', 'officer — exact region row set');
select is(pg_temp.dash_region_sum(pg_temp.fx_active_term()), 15,
  'officer — region counts sum to 15');
select is(pg_temp.dash_committee(pg_temp.fx_active_term()),
  'FIXT_DASH_OPS=2 | FIXT_ETHICS=3 | _UNASSIGNED=11', 'officer — exact committee row set');
select is(pg_temp.dash_committee_sum(pg_temp.fx_active_term()), 16,
  'officer — committee counts sum to 16');

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 25-30 — tech_admin sees NOTHING, and that is the design
--
-- Not a gap and not a fixture accident: memberships_read (0014 §4) does not name tech_admin.
-- PRD OQ-5's default answer is NO — the CTO configures the system and controls access, which
-- is not the same as reading everyone's record. These zeros are PINNED so that widening the
-- policy turns this file red and names the change.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin (CTO)

select is(pg_temp.dash_status(pg_temp.fx_active_term()), '(none)',
  'tech_admin reads ZERO status rows — memberships_read does not name tech_admin (PRD OQ-5)');
select is(pg_temp.dash_status_sum(pg_temp.fx_active_term()), 0,
  'tech_admin status counts sum to 0');
select is(pg_temp.dash_region(pg_temp.fx_active_term()), '(none)',
  'tech_admin reads ZERO region rows');
select is(pg_temp.dash_region_sum(pg_temp.fx_active_term()), 0,
  'tech_admin region counts sum to 0');
select is(pg_temp.dash_committee(pg_temp.fx_active_term()), '(none)',
  'tech_admin reads ZERO committee rows');
select is(pg_temp.dash_committee_sum(pg_temp.fx_active_term()), 0,
  'tech_admin committee counts sum to 0 — hence BUILD_PLAN S6-T13 lands the CTO on /system');

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 31-36 — regional_rep_a (NCR): region A only, with region A's own status mix
--
-- ★ THE ASSERTIONS THIS FILE EXISTS FOR, TOGETHER WITH 37-42. ★
-- Nothing in 0032 mentions a region. These numbers are right because memberships_read's
-- regional_rep branch is evaluated for this caller, THROUGH the view. If they ever equal the
-- admin numbers above, `security_invoker` has been lost and the dashboards are leaking.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a (NCR)

select is(
  pg_temp.dash_status(pg_temp.fx_active_term()),
  'active=7 | graduated=2',
  'rep_a reads ONLY region A''s status mix — no `resigned` bucket exists in NCR (PRD US-F1)'
);

select is(pg_temp.dash_status_sum(pg_temp.fx_active_term()), 9,
  'rep_a status counts sum to 9, not 15');

select is(
  pg_temp.dash_region(pg_temp.fx_active_term()),
  'NCR=9',
  'rep_a reads exactly ONE region row, their own'
);

select is(pg_temp.dash_region_sum(pg_temp.fx_active_term()), 9,
  'rep_a region counts sum to 9');

select is(
  pg_temp.dash_committee(pg_temp.fx_active_term()),
  'FIXT_DASH_OPS=2 | FIXT_ETHICS=2 | _UNASSIGNED=6',
  'rep_a sees both committees but ETHICS at 2 not 3 — P6 (R07) is outside their scope'
);

select is(pg_temp.dash_committee_sum(pg_temp.fx_active_term()), 10,
  'rep_a committee counts sum to 10 against a region headcount of 9 — D01''s two seats again');

-- Capture for the disjointness proof at 52.
insert into fx_dash_scope (rep, region_code)
select 'rep_a', v.region_code
from public.v_membership_region_counts v
where v.term_id = pg_temp.fx_active_term();

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 37-42 — regional_rep_b (R07): a DIFFERENT region with a DIFFERENT status mix
--
-- The asymmetry is deliberate (helpers/dashboard-fixtures.psql §4): region A carries
-- graduated rows and region B carries a resigned row, so a scoping bug cannot return a
-- plausible-looking symmetric answer that still passes.
--
-- 41 is the sharpest assertion in the file: rep_b's committee view has NO FIXT_DASH_OPS
-- bucket at all, because no R07 membership holds a seat on it — even though committees_read
-- is `using (true)` and rep_b can read the committee ROW. The aggregate is scoped by the
-- MEMBERSHIPS it counts, not by the committee it names. A leak would appear here as a third
-- bucket materialising out of nowhere.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b (R07)

select is(
  pg_temp.dash_status(pg_temp.fx_active_term()),
  'active=5 | resigned=1',
  'rep_b reads ONLY region B''s status mix — no `graduated` bucket exists in R07'
);

select is(pg_temp.dash_status_sum(pg_temp.fx_active_term()), 6,
  'rep_b status counts sum to 6, not 15 and not rep_a''s 9');

select is(
  pg_temp.dash_region(pg_temp.fx_active_term()),
  'R07=6',
  'rep_b reads exactly ONE region row, their own'
);

select is(pg_temp.dash_region_sum(pg_temp.fx_active_term()), 6,
  'rep_b region counts sum to 6');

select is(
  pg_temp.dash_committee(pg_temp.fx_active_term()),
  'FIXT_ETHICS=1 | _UNASSIGNED=5',
  'rep_b CANNOT SEE FIXT_DASH_OPS AT ALL — no R07 membership holds a seat on it, so the '
  'bucket does not exist for them even though committees_read is `using (true)`'
);

select is(pg_temp.dash_committee_sum(pg_temp.fx_active_term()), 6,
  'rep_b committee counts sum to 6 — nobody in R07 holds two seats, so this one DOES sum');

insert into fx_dash_scope (rep, region_code)
select 'rep_b', v.region_code
from public.v_membership_region_counts v
where v.term_id = pg_temp.fx_active_term();

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 43-48 — the member tier sees exactly their own row
--
-- PRD US-E4: "the member sees only their own assignment, never anyone else's; no
-- organizational roster is reachable from the member view." An aggregate IS a roster —
-- a headcount is an organizational record — so the member tier resolving to their own
-- single row is the correct and required answer, not a degenerate case.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member (P4)

select is(pg_temp.dash_status(pg_temp.fx_active_term()), 'active=1',
  'member reads exactly their own membership in the status view (PRD US-E4)');
select is(pg_temp.dash_status_sum(pg_temp.fx_active_term()), 1,
  'member status counts sum to 1');
select is(pg_temp.dash_region(pg_temp.fx_active_term()), 'NCR=1',
  'member reads one region row — their own region, count 1, NOT NCR''s real 9');
select is(pg_temp.dash_region_sum(pg_temp.fx_active_term()), 1,
  'member region counts sum to 1');
select is(pg_temp.dash_committee(pg_temp.fx_active_term()), 'FIXT_ETHICS=1',
  'member sees only the committee they sit on, and no unassigned bucket');
select is(pg_temp.dash_committee_sum(pg_temp.fx_active_term()), 1,
  'member committee counts sum to 1');

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 49-51 — anon is REFUSED, not returned empty
--
-- Different failure shape from every other deny in this suite, and the difference is the
-- point. Elsewhere a denial is an EMPTY SET produced by a missing policy under FORCE RLS.
-- Here 0032 revokes ALL from anon, so the refusal happens at the GRANT and raises 42501
-- before any policy is consulted. PRD US-A1: no organizational record reaches an
-- unauthenticated caller — and a headcount is a record.
--
-- 066 asserts the same boundary from the catalog with has_table_privilege. Both halves are
-- kept because they can disagree, and only this one is what a request actually hits.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_anon();

select throws_ok(
  $$ select count(*) from public.v_membership_status_counts $$,
  '42501'::char(5), null::text,
  'anon is REFUSED on v_membership_status_counts (GRANT, not an empty set) — PRD US-A1'
);

select throws_ok(
  $$ select count(*) from public.v_membership_region_counts $$,
  '42501'::char(5), null::text,
  'anon is REFUSED on v_membership_region_counts'
);

select throws_ok(
  $$ select count(*) from public.v_membership_committee_counts $$,
  '42501'::char(5), null::text,
  'anon is REFUSED on v_membership_committee_counts'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 52 — the two reps' region sets are DISJOINT
--
-- PRD US-F1: "two reps of different regions see disjoint member sets." Asserting the
-- INTERSECTION is empty, not merely that the counts differ — two reps could both be leaking
-- the same org-wide set and still show different-looking numbers if the leak were partial.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from (
     select region_code from fx_dash_scope where rep = 'rep_a'
     intersect
     select region_code from fx_dash_scope where rep = 'rep_b'
   ) x),
  0,
  'rep_a and rep_b resolve DISJOINT region sets in the aggregate views (PRD US-F1)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 53 — the committee panel does not sum, stated as a number
--
-- Recorded as its own assertion rather than left implicit in 5-6, because this is the
-- property a future maintainer is most likely to "fix". CBL Art. III §5 places no limit on
-- how many committees a member may serve; D01 holds two seats, so the committee total
-- exceeds the headcount by exactly one. ADR 0007 §4.
--
-- If someone makes the panel sum by picking one committee per member, THIS assertion goes
-- red and says why — which is the whole reason it is written as an inequality with a
-- specific difference rather than as prose in a comment.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

select is(
  pg_temp.dash_committee_sum(pg_temp.fx_active_term())
    - pg_temp.dash_status_sum(pg_temp.fx_active_term()),
  1,
  'the committee panel exceeds the headcount by exactly 1 — D01''s second seat. It does not '
  'sum, by design; never "fix" it by picking one committee per member (ADR 0007 §4)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 54-55 — the ARCHIVED term still answers
--
-- The three views group BY term_id and deliberately do NOT call current_term_id() (0032,
-- ADR 0007 §2), so one definition serves both the current-term dashboards and the admin-only
-- historical read (PRD US-H3). fixtures.psql leaves exactly one membership in the archived
-- 2025-2026 term — P1, NCR — and these two assertions are what would fail the day someone
-- "simplifies" the views by embedding the active term.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.dash_status(pg_temp.fx_archived_term()), 'active=1',
  'the archived term still answers — the views group by term_id and never embed '
  'current_term_id() (ADR 0007 §2, PRD US-H3)'
);

select is(
  pg_temp.dash_region(pg_temp.fx_archived_term()), 'NCR=1',
  'the archived term''s single NCR membership resolves in the region view'
);

select pg_temp.logout();


select * from finish();

rollback;
