-- ═══════════════════════════════════════════════════════════════════════════════════
-- 022_identity_rls.sql  —  §2 of 0014: public.people and public.user_roles
--
-- WHAT:
--    1-8   EXACT `people` row counts for the eight authenticated fixtures
--    9     anon cannot read public.people at all
--   10     regional_rep_a's and regional_rep_b's people sets are DISJOINT
--   11-19  EXACT `user_roles` row counts for all nine fixtures, anon included
--   20-28  auth_role() answers for every fixture WITHOUT 42P17 recursion
--   29-32  the write boundary on user_roles: tech_admin AND aal2, and nobody else
--
-- ── THE ARITHMETIC, from test-helpers/fixtures.sql ──────────────────────────────────
--                        people   user_roles
--     exec_admin            6          8
--     tech_admin            0          8
--     crrd_admin            6          1
--     moderator             6          1
--     officer               6          1
--     regional_rep_a        2          1
--     regional_rep_b        2          1
--     member                1          1
--     anon               (raises)      0
--
--   TWO OF THESE ARE SURPRISING AND BOTH ARE REAL PROPERTIES OF 0014, NOT FIXTURE
--   ACCIDENTS:
--
--   • tech_admin sees ZERO people. people_read names exec_admin, crrd_admin, moderator,
--     officer, regional_rep and member — tech_admin is simply absent. That is PRD OQ-5
--     ("configure the system and control access" is not "read everyone's address")
--     expressed as a MISSING ROLE LITERAL rather than as a comment, and it is why
--     BUILD_PLAN S6-T13 lands the CTO on /system instead of on an all-zero dashboard that
--     would read as a broken system.
--
--   • anon RAISES rather than returning zero. 0015 revokes ALL on public.people from anon,
--     so the refusal happens at the GRANT before RLS is ever consulted. The fixtures header
--     records anon's people count as 0 because that table describes ROW visibility; the
--     grant layer refuses first, which is strictly stronger, and assertion 9 asserts the
--     stronger property.
--
--   Each regional rep sees 2 people, not 3: memberships_read scopes a rep by region with NO
--   term filter, so P1's ARCHIVED NCR membership is visible to rep_a — but people_read's
--   rep branch also requires `m.term_id = current_term_id()`, so P1 the PERSON is not. Both
--   are defensible readings of PRD US-F1 and they disagree; the fixture makes the
--   disagreement measurable and flags it for the 0014 owner rather than reconciling it here.
--
-- WHY 20-28 EXIST AT ALL — THE RECURSION HAZARD. public.user_roles carries FORCE ROW LEVEL
--   SECURITY, which applies to the table OWNER as well. auth_role() is a SECURITY DEFINER
--   function that SELECTs user_roles, so if its owner lacked BYPASSRLS it would re-enter the
--   very policy that calls it and fail with 42P17 — and it would fail HOURS after the
--   function was declared fine, at the moment the policies landed. 0014 avoids it by writing
--   the user_roles policies with NO auth_role() call: the self-read compares auth.uid()
--   directly and the admin read goes through is_admin_reader(). These nine assertions are
--   the behavioural proof that the arrangement holds from a real authenticated session for
--   every role, and they are what would catch a future "tidy-up" that routes those policies
--   back through auth_role().
--
-- ⚠ POSITIVE CONTROL FIRST (assertion 1). A malformed claim makes auth.uid() NULL, which
--   makes auth_role() NULL, which makes every policy return zero rows — and every deny
--   assertion in this file then passes for the WRONG REASON. exec_admin seeing exactly 6
--   people is what makes tech_admin's 0 meaningful.
--
-- CITATION:  BUILD_PLAN S2-T16; ARCHITECTURE.md §5 ("Role storage and revocation");
--            DATA_MODEL.md §2.2, §6/0004, §6/0014; PRD §3 v1.0 items 1, 2, 3, 10;
--            PRD US-A1, US-A3, US-D1, US-D2, US-E3, US-E4, US-F1, US-I1, US-J1, OQ-5;
--            CBL Art. III §2.3 (the CTO), Art. VI §4.2 (the OQ-13 bootstrap gap).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir ../test-helpers/auth.sql
\ir ../test-helpers/fixtures.sql

select plan(32);


-- A spare account for the write assertions at the end. Created here, as the session role,
-- because `auth.users` is GoTrue's and nothing in this schema writes it — assertions 29-32
-- are about public.user_roles, and they need a valid FK target that is not already bound.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values (
  '00000000-0000-4000-a000-0000000000aa', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'spare.grantee@fixture.start-sys.test', '',
  now(), now(), now(), '{}'::jsonb, '{}'::jsonb
)
on conflict (id) do nothing;

-- Scratch space for assertion 10's intersection. Created and granted by the session role;
-- pg_temp USAGE is already granted to PUBLIC by auth.sql.
create temporary table _people_scope (
  who       text not null,
  person_id uuid not null
) on commit drop;

grant insert, select on _people_scope to public;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-8 — exact people counts
-- ═══════════════════════════════════════════════════════════════════════════════════
-- count(p.id) rather than count(*): `id` is one of the six columns 0015 grants, so the
-- query names a column it is unambiguously entitled to read and the assertion measures the
-- ROW policy rather than incidentally re-testing the column grant (019's subject).

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is((select count(p.id)::int from public.people p), 6,
  'exec_admin reads all 6 people — POSITIVE CONTROL; every zero below is void without it');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is((select count(p.id)::int from public.people p), 0,
  'tech_admin reads 0 people — PRD OQ-5, expressed as a role literal MISSING from '
  'people_read rather than as a comment');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is((select count(p.id)::int from public.people p), 6,
  'crrd_admin reads all 6 people — the operational heart of the system (PRD US-D1)');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select is((select count(p.id)::int from public.people p), 6,
  'moderator reads all 6 people — you cannot review an application without reading it');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is((select count(p.id)::int from public.people p), 6,
  'officer reads all 6 people ROWS — PRD US-D2 grants the rows; what an officer cannot '
  'read is COLUMNS, and that boundary is 019''s and 029''s, never a policy''s');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a (NCR)
insert into _people_scope select 'a', p.id from public.people p;
select is((select count(p.id)::int from public.people p), 2,
  'regional_rep_a reads exactly 2 people — its own region''s CURRENT-term scholars (P3, P4); '
  'P1''s archived NCR membership does not make P1 visible (PRD US-F1)');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b (R07)
insert into _people_scope select 'b', p.id from public.people p;
select is((select count(p.id)::int from public.people p), 2,
  'regional_rep_b reads exactly 2 people (P5, P6) — the mirror image');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is((select count(p.id)::int from public.people p), 1,
  'member reads exactly 1 person — their own. PRD US-E4: "the member sees only their own '
  'assignment, never anyone else''s"');
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-10 — anon, and the two reps' disjointness
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_anon();
select throws_ok(
  $$ select id from public.people $$,
  '42501'::char(5),
  null::text,
  'anon cannot read public.people at all — 0015 revokes ALL from anon, so the refusal is '
  'at the GRANT and never even reaches a policy (PRD US-A1)'
);
select pg_temp.logout();

-- 10 — PRD US-F1: "two reps of different regions see disjoint member sets." Asserted as an
-- empty INTERSECTION rather than as two equal counts, because two reps each seeing the same
-- two people would satisfy assertions 6 and 7 and be a total scope failure.
select is(
  (select count(*)::int
     from (select person_id from _people_scope where who = 'a'
           intersect
           select person_id from _people_scope where who = 'b') s),
  0,
  'regional_rep_a and regional_rep_b see DISJOINT people — the intersection is EMPTY, not '
  'merely the counts equal (PRD US-F1)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11-19 — exact user_roles counts
-- ═══════════════════════════════════════════════════════════════════════════════════
-- user_roles is THE LIVE ACCESS-CONTROL ANSWER (ARCHITECTURE.md §5), read per statement,
-- which is what makes revocation instant and is why roles are never stamped into a JWT.
-- Every account may see its OWN row — that is the read getSessionContext() makes on
-- literally every request — and only exec_admin and tech_admin may enumerate the org's
-- accounts. A moderator has no business doing so.

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is((select count(*)::int from public.user_roles), 8,
  'exec_admin enumerates all 8 accounts — PRD US-I1 oversight');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is((select count(*)::int from public.user_roles), 8,
  'tech_admin enumerates all 8 accounts — PRD US-E3, the role that assigns and revokes');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is((select count(*)::int from public.user_roles), 1,
  'crrd_admin sees exactly its OWN user_roles row — operational power is not oversight');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select is((select count(*)::int from public.user_roles), 1,
  'moderator sees exactly its own user_roles row');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is((select count(*)::int from public.user_roles), 1,
  'officer sees exactly its own user_roles row');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is((select count(*)::int from public.user_roles), 1,
  'regional_rep_a sees exactly its own user_roles row');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select is((select count(*)::int from public.user_roles), 1,
  'regional_rep_b sees exactly its own user_roles row');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is((select count(*)::int from public.user_roles), 1,
  'member sees exactly its own user_roles row');
select pg_temp.logout();

select pg_temp.login_anon();
select is((select count(*)::int from public.user_roles), 0,
  'anon sees 0 user_roles rows — anon holds a default SELECT privilege on the table, so '
  'what empties it is the MISSING ANON POLICY (deny by default)');
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20-28 — auth_role() answers for every fixture, with no 42P17
-- ═══════════════════════════════════════════════════════════════════════════════════
-- See the recursion note in the header. `is()` rather than `lives_ok()` on purpose: a
-- lives_ok would pass for a function that had been "fixed" into returning a constant, and
-- the VALUE is what every policy in the schema branches on.

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');
select is((select public.auth_role()), 'exec_admin'::public.org_role,
  'auth_role() = exec_admin, with no 42P17 from the FORCE-RLS user_roles policies');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');
select is((select public.auth_role()), 'tech_admin'::public.org_role,
  'auth_role() = tech_admin');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');
select is((select public.auth_role()), 'crrd_admin'::public.org_role,
  'auth_role() = crrd_admin');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');
select is((select public.auth_role()), 'moderator'::public.org_role,
  'auth_role() = moderator — the tier whose boundary against crrd_admin is easiest to '
  'widen by accident (OQ-14)');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');
select is((select public.auth_role()), 'officer'::public.org_role,
  'auth_role() = officer');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');
select is((select public.auth_role()), 'regional_rep'::public.org_role,
  'auth_role() = regional_rep for rep_a — the ROLE is the capability; the REGION is a '
  'separate binding, read by auth_region_ids()');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');
select is((select public.auth_role()), 'regional_rep'::public.org_role,
  'auth_role() = regional_rep for rep_b');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');
select is((select public.auth_role()), 'member'::public.org_role,
  'auth_role() = member');
select pg_temp.logout();

select pg_temp.login_anon();
select is((select public.auth_role()), null::public.org_role,
  'auth_role() is NULL for anon — and NULL in a policy predicate reads as "no", which is '
  'the deny-by-default direction');
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 29-32 — writing user_roles: tech_admin AND aal2, and nobody else
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-E3: "As a Technical Admin, I can assign and revoke system roles" — sole authority.
-- PRD US-A3: gated on aal2, so the role-assignment surface cannot be reached from a session
-- that has only a password. is_user_roles_writer() (0014) is the conjunction, and it is
-- SECURITY DEFINER for the same recursion reason as is_admin_reader().
--
-- Run last, because assertion 32 actually inserts a ninth user_roles row.
--
-- ⚠ THE aal1 CASE IS THE DATABASE BACKSTOP FOR THE MFA MIDDLEWARE. It holds even if
--   middleware.ts is deleted and even if the API is called directly — which is the whole
--   claim ARCHITECTURE.md §5 makes about the two-layer design.

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin, aal2
select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-4000-a000-0000000000aa', 'officer') $$,
  '42501'::char(5),
  null::text,
  'exec_admin CANNOT write user_roles — role assignment is the CTO''s alone (PRD US-E3), '
  'and this is the narrowing that creates the OQ-13 bootstrap gap ARCHITECTURE.md §5 flags: '
  'while the CTO seat is vacant nobody can grant tech_admin to the CEO''s designated acting '
  'officer (CBL Art. VI §4.2). That is a human decision, never something to widen here'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin, aal2
select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-4000-a000-0000000000aa', 'officer') $$,
  '42501'::char(5),
  null::text,
  'crrd_admin cannot write user_roles — the CCDO runs operations, not access control'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal1');   -- tech_admin, aal1
select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-4000-a000-0000000000aa', 'officer') $$,
  '42501'::char(5),
  null::text,
  'tech_admin at aal1 cannot write user_roles — the aal2 predicate is the DATABASE half of '
  'PRD US-A3/US-A4 and holds with the MFA middleware removed entirely'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal2');   -- tech_admin, aal2
select lives_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-4000-a000-0000000000aa', 'officer') $$,
  'tech_admin at aal2 CAN write user_roles — asserted explicitly, because a policy that '
  'refused everyone would satisfy 29-31 and leave the org unable to onboard anybody'
);
select pg_temp.logout();


select * from finish();

rollback;
