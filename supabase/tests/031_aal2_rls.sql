-- ═══════════════════════════════════════════════════════════════════════════════════
-- 031_aal2_rls.sql  —  BUILD_PLAN S2-T25, the DATABASE backstop for 2FA
--
-- PRD §3 v1.0 item 2 / US-A3: TOTP enrolment is mandatory for every account above Member
-- tier. Middleware enforces it as UX; `has_aal2()` inside three write policies enforces it
-- as a fact. **This file is what proves the middleware is not load-bearing:** delete
-- middleware.ts tomorrow, call the API directly with a password-only session, and
-- user_roles, terms, application_windows and rr_region_grants still refuse the write.
--
--    1-2   has_aal2() itself answers correctly for an aal1 and an aal2 session
--    3-5   READS ARE NOT GATED ON aal2 — deliberate, and asserted so nobody "hardens" it
--    6-11  aal1 writes are refused, all four tables, both INSERT and UPDATE shapes
--   12-16  the same writes at aal2 succeed — the permitted case, so 6-11 are not vacuous
--   17-19  ADR 0003: application_windows is crrd_admin's AND tech_admin's, aal2 either way
--   20-22  role still matters: aal2 alone buys exec_admin and member nothing
--   23-24  is_user_roles_writer() is the composed predicate, and it composes both halves
--
-- ⚠ AN INSERT REFUSED BY RLS RAISES 42501; AN UPDATE REFUSED BY RLS AFFECTS 0 ROWS.
--   BUILD_PLAN S2-T25's acceptance says "tech_admin at aal1 gets 0 rows affected on
--   inserts"; that is not how Postgres behaves. A WITH CHECK failure is evaluated against
--   the proposed row and raises; a USING failure filters the scan so there is nothing to
--   update. Both shapes are asserted here, and the plan's phrasing is corrected rather than
--   accommodated.
--
-- ⚠ WHY ASSERTIONS 3-5 EXIST. It is tempting to read "2FA is mandatory" as "an aal1 session
--   sees nothing", and a future maintainer may well try to add has_aal2() to the read
--   policies. That would break the enrolment screen: PRD US-A3 requires an unenrolled
--   officer to reach an enrolment page and see no ORGANIZATIONAL DATA, which is a different
--   requirement from seeing no rows at all. Reads are gated by ROLE; writes by role AND
--   aal. The asymmetry is the design, so it is documented as an assertion rather than a
--   comment.
--
-- CITATION:  BUILD_PLAN S2-T25, S2-T17; ARCHITECTURE.md §5 ("Authentication and 2FA");
--            DATA_MODEL.md §9; PRD §3 v1.0 items 1, 2, 3; PRD US-A2, US-A3, US-A4, US-B4,
--            US-E3, US-H2; docs/decisions/0003-application-window-authority.md;
--            CBL Art. VI §4.2 (the OQ-13 bootstrap gap this guard creates).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir ../test-helpers/auth.sql
\ir ../test-helpers/fixtures.sql

select plan(24);


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
-- Two spare accounts, because a user_roles INSERT needs an auth.users row that does not
-- already hold a role (user_id is the primary key). One open application_window, so the
-- read assertions below are not counting an empty table.
-- ═══════════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-4000-a000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'spare.one@fixture.start-sys.test', '',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-a000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'spare.two@fixture.start-sys.test', '',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
select id, 'membership_application', now() - interval '1 day', now() + interval '30 days'
from public.terms where status = 'active';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-2 — has_aal2() itself
--
-- SECURITY INVOKER and touching no table: it reads only `auth.jwt() ->> 'aal'`. When the
-- claim is absent the comparison yields NULL, which RLS reads as "no" — deny by default.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal1');   -- tech_admin @ aal1
select is(public.has_aal2(), false,
  'has_aal2() is FALSE for a password-only session — PRD US-A3, the second factor is a claim the session must have earned');

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal2');   -- tech_admin @ aal2
select is(public.has_aal2(), true,
  'has_aal2() is TRUE once the second factor is satisfied — the positive control for every deny below');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3-5 — READS ARE NOT GATED ON aal2, ON PURPOSE
--
-- PRD US-A3: an officer-or-above account without an enrolled second factor "sees an
-- enrolment screen and no organizational data". That is a statement about ORGANIZATIONAL
-- DATA, which tech_admin does not hold in the first place (OQ-5, see 028). System
-- configuration — the term list, the account list, the application schedule — must stay
-- readable at aal1 or the enrolment flow has nothing to render.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal1');

select is((select count(*) from public.terms)::int, 2,
  'tech_admin at aal1 still READS the 2 terms — reads are gated by role, writes by role AND aal (PRD US-A3)');

select is((select count(*) from public.user_roles)::int, 8,
  'tech_admin at aal1 still READS all 8 user_roles — the enrolment flow needs to resolve who is calling');

select is((select count(*) from public.application_windows)::int, 1,
  'tech_admin at aal1 still READS the application schedule');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 6-11 — aal1 WRITES ARE REFUSED, on all four gated tables
--
-- These four are the privileged surface: who holds which role (US-E3), when a term begins
-- and ends (US-H2), when applications are open (US-B4), and which extra regions a rep may
-- read. A stolen password alone reaches none of them.
-- ═══════════════════════════════════════════════════════════════════════════════════

select throws_ok($$
    insert into public.user_roles (user_id, role)
    values ('00000000-0000-4000-a000-000000000009', 'officer') $$,
  '42501'::char(5), null::text,
  'tech_admin at aal1 CANNOT insert a user_role — PRD US-A3 backstopped in the database, not only in middleware');

select throws_ok($$
    insert into public.terms (label, starts_on, ends_on, status)
    values ('2091-2092', date '2091-06-01', date '2092-05-31', 'draft') $$,
  '42501'::char(5), null::text,
  'tech_admin at aal1 CANNOT insert a term — defining terms is the privileged half of PRD US-H2');

select throws_ok($$
    insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
    select id, 'committee_application', now(), now() + interval '10 days'
    from public.terms where status = 'active' $$,
  '42501'::char(5), null::text,
  'tech_admin at aal1 CANNOT open an application window — PRD US-B4');

select throws_ok($$
    insert into public.rr_region_grants (user_id, region_id, granted_by)
    select '00000000-0000-4000-a000-000000000006', r.id, '00000000-0000-4000-a000-000000000002'
    from public.regions r where r.code = 'R07' $$,
  '42501'::char(5), null::text,
  'tech_admin at aal1 CANNOT widen a regional rep''s scope — that is an access-control change (PRD US-E3)');

select is(pg_temp.rows_affected($$
    update public.terms set archived_at = now()
     where id = '00000000-0000-4000-d000-000000000001' $$), 0,
  'tech_admin at aal1 UPDATE on terms affects 0 rows — the USING half refuses silently, unlike the INSERT half');

select is(pg_temp.rows_affected($$
    update public.user_roles set role = 'member'
     where user_id = '00000000-0000-4000-a000-000000000005' $$), 0,
  'tech_admin at aal1 CANNOT demote an account — the role-assignment surface is unreachable from a password-only session');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12-16 — the same writes at aal2 succeed
--
-- Without these five, assertions 6-11 would be satisfied by a policy that denies
-- everything — which is a broken system that passes its own security tests.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal2');

select lives_ok($$
    insert into public.user_roles (user_id, role)
    values ('00000000-0000-4000-a000-000000000009', 'officer') $$,
  'tech_admin at aal2 CAN insert a user_role — PRD US-E3, sole authority over access control');

select lives_ok($$
    insert into public.terms (label, starts_on, ends_on, status)
    values ('2091-2092', date '2091-06-01', date '2092-05-31', 'draft') $$,
  'tech_admin at aal2 CAN insert a term (as `draft` — one_active_term forbids a second active one)');

select lives_ok($$
    insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
    select id, 'committee_application', now(), now() + interval '10 days'
    from public.terms where status = 'active' $$,
  'tech_admin at aal2 CAN open an application window');

select lives_ok($$
    insert into public.rr_region_grants (user_id, region_id, granted_by)
    select '00000000-0000-4000-a000-000000000006', r.id, '00000000-0000-4000-a000-000000000002'
    from public.regions r where r.code = 'R07' $$,
  'tech_admin at aal2 CAN widen a regional rep''s scope');

select is(pg_temp.rows_affected($$
    update public.terms set archived_at = now()
     where id = '00000000-0000-4000-d000-000000000001' $$), 1,
  'tech_admin at aal2 UPDATE on terms affects exactly 1 row');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 17-19 — ADR 0003: the application window has TWO writers, and aal2 still applies
--
-- PRD US-B4 says "As a CRRD Admin, I can open and close the application period";
-- ARCHITECTURE.md §5 lists application_windows among the tables only tech_admin writes.
-- Shipping both resolves the conflict in the direction that survives an empty CTO seat
-- (PRD OQ-13) — a tech_admin-only gate would mean the CCDO cannot open the application
-- period at the one moment that seat is most likely to be vacant.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003', 'aal2');   -- crrd_admin @ aal2
select lives_ok($$
    insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
    select id, 'membership_renewal', now(), now() + interval '10 days'
    from public.terms where status = 'active' $$,
  'crrd_admin at aal2 CAN open an application window — ADR 0003, PRD US-B4');

select pg_temp.login_as('00000000-0000-4000-a000-000000000003', 'aal1');   -- crrd_admin @ aal1
select throws_ok($$
    insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
    select id, 'freeform', now(), now() + interval '10 days'
    from public.terms where status = 'active' $$,
  '42501'::char(5), null::text,
  'crrd_admin at aal1 CANNOT — the second writer is still bound by the second factor');

select pg_temp.login_as('00000000-0000-4000-a000-000000000003', 'aal2');
select throws_ok($$
    insert into public.terms (label, starts_on, ends_on, status)
    values ('2092-2093', date '2092-06-01', date '2093-05-31', 'draft') $$,
  '42501'::char(5), null::text,
  'crrd_admin at aal2 still CANNOT define a term — ADR 0003 widened windows, not the term lifecycle (PRD US-H2)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20-22 — aal2 is a CONJUNCT, not a substitute for the role
--
-- The predicate is `role AND aal2`. A fully-authenticated CEO is still not the CTO: PRD
-- US-H2 refuses exec_admin the term lifecycle explicitly, "with the denial surfacing as a
-- permission error, not a silent no-op". That narrowing is what ARCHITECTURE.md §5's
-- rollover callout is about, and PRD OQ-13 is the open consequence.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000001', 'aal2');   -- exec_admin @ aal2
select throws_ok($$
    insert into public.terms (label, starts_on, ends_on, status)
    values ('2093-2094', date '2093-06-01', date '2094-05-31', 'draft') $$,
  '42501'::char(5), null::text,
  'exec_admin at aal2 CANNOT define a term — the CTO leads the term lifecycle (OQ-7 resolved 2026-09-01; the vacancy risk is OQ-13)');

select throws_ok($$
    insert into public.user_roles (user_id, role)
    values ('00000000-0000-4000-a000-00000000000a', 'officer') $$,
  '42501'::char(5), null::text,
  'exec_admin at aal2 CANNOT assign a role — and this is exactly the CBL Art. VI §4.2 bootstrap gap flagged in ARCHITECTURE.md §5, not an oversight');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008', 'aal2');   -- member @ aal2
select throws_ok($$
    insert into public.user_roles (user_id, role)
    values ('00000000-0000-4000-a000-00000000000a', 'exec_admin') $$,
  '42501'::char(5), null::text,
  'member at aal2 CANNOT grant themselves or anyone else a role — the privilege-escalation case, refused at the data layer');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 23-24 — is_user_roles_writer(), the composed predicate
--
-- SECURITY DEFINER for the FORCE-RLS recursion reason documented on is_admin_reader():
-- a predicate evaluated INSIDE a policy on public.user_roles may not read user_roles as
-- the invoker, or the policy re-enters itself (42P17). Asserting the composition directly
-- means a future edit that drops either conjunct fails here by name.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal1');
select is(public.is_user_roles_writer(), false,
  'is_user_roles_writer() is FALSE for tech_admin at aal1 — the aal conjunct is doing work');

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal2');
select is(public.is_user_roles_writer(), true,
  'is_user_roles_writer() is TRUE only for tech_admin AND aal2 — PRD US-E3 + US-A3, composed in one predicate');


select * from finish();

rollback;
