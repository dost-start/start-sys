-- ═══════════════════════════════════════════════════════════════════════════════════
-- 016_auth_helpers.sql  —  the five functions every RLS policy in the schema calls
--
-- auth_role(), auth_person_id(), auth_region_id(), auth_region_ids() and current_term_id()
-- are the whole of the authorization *context*. Every policy body in 0014_rls.sql is a
-- comparison against one of their return values, so a defect in any one of them is a defect
-- in every policy at once — and it would not show up as a failing policy test, it would show
-- up as every policy quietly agreeing on the wrong answer.
--
--   1-10  each of the five is SECURITY DEFINER and carries `SET search_path = ''`
--     11  all five are STABLE (cached per statement, not re-evaluated per row)
--     12  their owner holds BYPASSRLS or SUPERUSER  ← THE RECURSION CANARY
--     13  auth_role() executes for an impersonated fixture with no 42P17
--  14-18  it returns the right role, the right person, and NULL where NULL is correct
--  19-22  the region helpers scope a regional rep to their own region and nobody else's
--     23  current_term_id() resolves the active term
--
-- ⚠ ASSERTION 12 IS THE ONE THAT SAVES AN AFTERNOON, AND IT FAILS HOURS LATE IF ABSENT.
--   public.user_roles carries FORCE ROW LEVEL SECURITY, which applies to the table owner
--   too. auth_role() reads user_roles; the user_roles read policy calls auth_role(). If the
--   function's owner lacks BYPASSRLS the definer context does not escape RLS, and the two
--   recurse — 42P17, infinite recursion detected in policy for relation "user_roles".
--   The trap is the timing: the function is declared fine in 0012 and everything is green
--   until 0014's policies land, which in this build is a different file and, in the sprint,
--   a different hour. Asserting the property directly turns a mystifying runtime failure
--   into a named test. (BUILD_PLAN S2-T7 acceptance; S2 risk table, row 2.)
--
-- ⚠ THE POSITIVE CONTROL COMES FIRST. Assertions 14-17 check for SPECIFIC values, never for
--   "not null". A malformed JWT claim makes auth.uid() NULL, which makes auth_role() NULL,
--   which makes every deny assertion in this suite pass for entirely the wrong reason. This
--   file is where that would be caught, so nothing here may be written as a nullity check
--   where an equality check is possible. (test-helpers/auth.sql, note under login_as.)
--
-- CITATION:  BUILD_PLAN S2-T7, S2-T16; ARCHITECTURE.md §5 ("Role storage and revocation");
--            CONVENTIONS.md §3.4 (search_path is mandatory on every definer function);
--            DATA_MODEL.md §6/0012; PRD US-A2, US-E3, US-F1; CBL Art. V §1.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir ../test-helpers/auth.sql
\ir ../test-helpers/fixtures.sql

select plan(23);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-10 — SECURITY DEFINER + SET search_path = '', per function
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Both halves are load-bearing and they fail differently.
--
-- SECURITY DEFINER without `search_path = ''` is the worse of the two: the function then
-- resolves unqualified names against the CALLER's search_path, so any account able to
-- create a schema ahead of `public` can plant its own `user_roles` and have auth_role()
-- read it — owning the entire authorization model in one CREATE TABLE. CONVENTIONS.md §3.4
-- makes it mandatory with no exceptions, which is exactly the kind of rule that decays into
-- a comment unless something checks it.
--
-- proconfig is matched with LIKE 'search_path=%' rather than compared to a literal, because
-- Postgres normalises `SET search_path = ''` differently across versions (`search_path=` vs
-- `search_path=""`). The property under test is "a search_path is pinned", not its spelling.

select ok(
  (select prosecdef from pg_proc where oid = 'public.auth_role()'::regprocedure),
  'auth_role() is SECURITY DEFINER — required, because user_roles carries FORCE RLS'
);

select ok(
  (select exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     from pg_proc p where p.oid = 'public.auth_role()'::regprocedure),
  'auth_role() pins search_path — CONVENTIONS.md §3.4'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.auth_person_id()'::regprocedure),
  'auth_person_id() is SECURITY DEFINER'
);

select ok(
  (select exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     from pg_proc p where p.oid = 'public.auth_person_id()'::regprocedure),
  'auth_person_id() pins search_path'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.auth_region_id()'::regprocedure),
  'auth_region_id() is SECURITY DEFINER'
);

select ok(
  (select exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     from pg_proc p where p.oid = 'public.auth_region_id()'::regprocedure),
  'auth_region_id() pins search_path'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.auth_region_ids()'::regprocedure),
  'auth_region_ids() is SECURITY DEFINER'
);

select ok(
  (select exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     from pg_proc p where p.oid = 'public.auth_region_ids()'::regprocedure),
  'auth_region_ids() pins search_path'
);

-- current_term_id() shipped in 0005_terms.sql rather than 0012, and is asserted here with
-- the others because it is the fifth member of the same context set: every dashboard view
-- and every term-scoped policy calls it, and nothing else re-checks its definer properties.
select ok(
  (select prosecdef from pg_proc where oid = 'public.current_term_id()'::regprocedure),
  'current_term_id() is SECURITY DEFINER'
);

select ok(
  (select exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     from pg_proc p where p.oid = 'public.current_term_id()'::regprocedure),
  'current_term_id() pins search_path'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11 — all five are STABLE
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Not a performance nicety. STABLE lets the planner evaluate these once per STATEMENT
-- instead of once per ROW; a VOLATILE auth_role() would be re-executed for every row a
-- policy filters, turning one index probe into 4,000 and putting the 3-second Performance
-- NFR (PRD §6 row 2) out of reach on the member grid alone. ARCHITECTURE.md §5 says so
-- explicitly, which makes it an invariant rather than an optimisation.
select is(
  (select count(*)::int
     from pg_proc p
    where p.oid in (
            'public.auth_role()'::regprocedure,
            'public.auth_person_id()'::regprocedure,
            'public.auth_region_id()'::regprocedure,
            'public.auth_region_ids()'::regprocedure,
            'public.current_term_id()'::regprocedure)
      and p.provolatile <> 's'),
  0,
  'all five context helpers are STABLE — one evaluation per statement, not per row'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12 — THE RECURSION CANARY (see the header)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- pg_roles rather than pg_authid: pg_authid is superuser-only and this file must be
-- runnable by whatever role CI connects as.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_roles r on r.oid = p.proowner
    where p.oid in (
            'public.auth_role()'::regprocedure,
            'public.auth_person_id()'::regprocedure,
            'public.auth_region_id()'::regprocedure,
            'public.auth_region_ids()'::regprocedure,
            'public.current_term_id()'::regprocedure)
      and not (r.rolbypassrls or r.rolsuper)),
  0,
  'every context helper is owned by a BYPASSRLS/SUPERUSER role — without this, '
  'auth_role() recurses into the user_roles policy that calls it (42P17)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-18 — the helpers answer for the impersonated fixture
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

-- 13 — the recursion assertion's behavioural twin. Property 12 says the owner CAN escape
-- RLS; this says it actually DOES, from inside a real authenticated session with the
-- user_roles policies in force. Both are kept: 12 fails with a clear cause, 13 fails with
-- the symptom, and a future refactor that satisfies one without the other is caught.
select lives_ok(
  $$ select public.auth_role() $$,
  'auth_role() executes as an authenticated session without 42P17 recursion'
);

-- 14 — THE POSITIVE CONTROL. If this fails, every deny assertion in the suite is void.
select is(
  (select public.auth_role()),
  'crrd_admin'::public.org_role,
  'auth_role() returns crrd_admin for the crrd_admin fixture — POSITIVE CONTROL'
);

-- 15 — the person binding the member-portal policies and the CBL Art. VIII §7.1
-- confidentiality gate both key on.
select is(
  (select public.auth_person_id()),
  '00000000-0000-4000-b000-000000000002'::uuid,
  'auth_person_id() returns the crrd_admin fixture''s person (P2)'
);

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin

-- 16 — a SECOND role, so 14 cannot be satisfied by a function that returns a constant.
select is(
  (select public.auth_role()),
  'exec_admin'::public.org_role,
  'auth_role() returns exec_admin for the exec_admin fixture — distinguishes roles'
);

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin

-- 17 — user_roles.person_id is nullable in both directions on purpose (DATA_MODEL.md
-- §6/0004: "null for a tech_admin who is not a member"). This is also the belt to OQ-5's
-- braces: the confidentiality gate keys on auth_person_id(), so even with the role guard on
-- get_person_sensitive() removed, tech_admin could not satisfy it.
select is(
  (select public.auth_person_id()),
  null::uuid,
  'auth_person_id() is NULL for tech_admin — the unbound-account case, OQ-5 defence in depth'
);

select pg_temp.logout();
select pg_temp.login_anon();

-- 18 — deny by default. NULL is the correct answer for an account with no user_roles row,
-- because every policy compares against a role literal and a NULL comparison yields NULL,
-- which RLS treats as "no".
select is(
  (select public.auth_role()),
  null::public.org_role,
  'auth_role() is NULL for anon — deny by default, PRD US-A1'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19-22 — regional scope
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-F1: "members outside the rep's region are not returned"; "two reps of different
-- regions see disjoint member sets." Those are policy assertions (030); what is asserted
-- here is the INPUT the policies compare against, because a rep who leaks another region
-- leaks it here first.

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a, NCR

select is(
  (select public.auth_region_id()),
  (select id from public.regions where code = 'NCR'),
  'auth_region_id() returns NCR for regional_rep_a'
);

-- The array form is what the policies actually compare against
-- (`region_id = any(public.auth_region_ids())`), so it is asserted as an exact array and
-- not merely as "contains NCR". rep_a holds no rr_region_grants rows, so exactly one.
select is(
  (select public.auth_region_ids()),
  array[(select id from public.regions where code = 'NCR')]::uuid[],
  'auth_region_ids() is exactly {NCR} for regional_rep_a — no extra rr_region_grants'
);

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b, R07

select is(
  (select public.auth_region_ids()),
  array[(select id from public.regions where code = 'R07')]::uuid[],
  'auth_region_ids() is exactly {R07} for regional_rep_b — disjoint from rep_a'
);

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member

-- 22 — '{}' and not NULL, and the distinction is deliberate (0012's comment): `x = any(NULL)`
-- is NULL, which RLS reads as "no" today but is three-valued logic sitting inside a security
-- predicate; `x = any('{}')` is unambiguously FALSE. An account with no region returning an
-- empty array removes that whole class of surprise from every policy body at once.
select is(
  (select public.auth_region_ids()),
  '{}'::uuid[],
  'auth_region_ids() is {} — never NULL — for an account with no region'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 23 — current_term_id()
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The fixture adds an ARCHIVED 2025-2026 term alongside the seeded active one, so this
-- asserts the function picks the active row rather than simply the only row. CBL Art. V §1;
-- the one_active_term partial unique index (0005) is what guarantees "limit 1" is
-- deterministic rather than arbitrary.
select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

select is(
  (select public.current_term_id()),
  (select id from public.terms where status = 'active'),
  'current_term_id() returns the ACTIVE term, with an archived term also present'
);

select pg_temp.logout();

select * from finish();

rollback;
