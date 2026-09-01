-- ═══════════════════════════════════════════════════════════════════════════════════
-- test-helpers/auth.sql  —  role impersonation for the pgTAP suite
--
-- WHAT:      Five pg_temp helper functions that let a test statement run *as* one of the
--            nine role fixtures, so every assertion in this suite is made against the
--            same authorization path a real request takes:
--
--              pg_temp.set_claims(uuid, aal)  set request.jwt.claims ONLY — DB role unchanged
--              pg_temp.login_as(uuid, aal)    set_claims + become the `authenticated` role
--              pg_temp.login_anon()           become the `anon` role, no claims
--              pg_temp.logout()               back to the session role, claims cleared
--              pg_temp.jwt_claims()           read back what is currently set (debugging)
--
-- WHY:       ARCHITECTURE.md §5 — "RLS + column GRANTs are THE enforcement boundary". A
--            test that asserts a boundary while connected as the migration owner asserts
--            nothing: postgres carries BYPASSRLS, so every policy in the schema is invisible
--            to it. Impersonation is the entire reason the pgTAP suite is an executable
--            specification of who can see what rather than a schema-shape checker.
--
-- USAGE:     \ir ../test-helpers/auth.sql        (once, at the top of a test file, before
--                                                 ../test-helpers/fixtures.sql)
--
--            select pg_temp.login_as('00000000-0000-4000-a000-000000000003');  -- crrd_admin
--            select is( (select count(*) from public.people)::int, 6, '...' );
--            select pg_temp.logout();
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- THREE THINGS THAT ARE NOT OBVIOUS AND WILL COST AN AFTERNOON IF REDISCOVERED
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- 1. `set_config('role', ..., true)` — NOT `SET LOCAL ROLE`.
--    `SET LOCAL ROLE` issued inside a PL/pgSQL body is unreliable across function-exit
--    boundaries; the GUC form with is_local => true is the shape Supabase's own test
--    helpers use and it plainly lasts to the end of the transaction. `set_config('role',
--    'none', true)` is the documented equivalent of RESET ROLE and is always permitted,
--    which matters because `authenticated` is not a member of `postgres` and could not
--    SET ROLE back by name.
--
-- 2. The temp schema needs an explicit USAGE grant.
--    A temp schema's default ACL gives PUBLIC nothing, so once a test has become
--    `authenticated` it could not call pg_temp.logout() to get back out — the helper would
--    lock the session out of its own escape hatch. The DO block below grants USAGE on this
--    session's temp schema to PUBLIC. It is resolved dynamically through
--    pg_my_temp_schema() because the schema is named pg_temp_<backend-id> and that number
--    differs per connection.
--
-- 3. set_claims() deliberately does NOT change the database role.
--    auth.uid() and auth.jwt() read the `request.jwt.claims` GUC, never the DB role, so
--    claims alone are enough to attribute an action to a fixture user while the statement
--    still runs with the session's own privileges. 017_audit_triggers.sql depends on
--    exactly that: `authenticated` holds no UPDATE grant on public.people (0015_grants.sql
--    revokes ALL and grants back a six-column SELECT), so an audit-attribution test that
--    used login_as() would fail at the GRANT and never reach the trigger it is testing.
--    Column-boundary assertions belong to 019/029; trigger assertions belong to 017. Using
--    set_claims there keeps each file testing one thing.
--
-- Everything here lives in pg_temp and is rolled back with the test transaction. Nothing
-- in this file touches the schema under test.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- See note 2. Idempotent: re-granting is harmless if a second helper file repeats it.
do $$
begin
  execute format('grant usage on schema %s to public', pg_my_temp_schema()::regnamespace);
end;
$$;


-- ── set_claims ─────────────────────────────────────────────────────────────────────
-- Impersonation WITHOUT a role switch. auth.uid() resolves from request.jwt.claims ->> 'sub'
-- and auth.jwt() returns the whole object, so auth_role(), auth_person_id(),
-- auth_region_ids() and has_aal2() all answer for the named fixture immediately.
--
-- `aal` is a real claim, not decoration: 0014_rls.sql gates every write to user_roles,
-- terms and application_windows on has_aal2(), which reads `auth.jwt() ->> 'aal'`
-- (PRD US-A3, US-A4). Default 'aal2' so the common case is a fully-authenticated session;
-- pass 'aal1' to test the second-factor backstop.
--
-- session_id is derived from the user id rather than randomised so a test run is
-- reproducible and a claims dump is greppable back to the fixture that produced it.
create or replace function pg_temp.set_claims(
  p_user uuid,
  p_aal  text default 'aal2'
) returns void
language plpgsql
as $$
begin
  if p_aal not in ('aal1', 'aal2') then
    raise exception 'set_claims: aal must be aal1 or aal2, got %', p_aal;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',        p_user::text,
      'role',       'authenticated',
      'aal',        p_aal,
      'session_id', p_user::text,
      'aud',        'authenticated',
      'iss',        'supabase-pgtap-fixture'
    )::text,
    true                                   -- is_local: reverted by the test's ROLLBACK
  );
end;
$$;

comment on function pg_temp.set_claims(uuid, text) is
  'Set request.jwt.claims for a fixture user WITHOUT switching the database role. Use when '
  'a test needs the audit trigger to attribute an action to that user but the statement '
  'itself must retain session privileges (017_audit_triggers.sql). See note 3.';


-- ── login_as ───────────────────────────────────────────────────────────────────────
-- The normal entry point. Claims first, role second — if the role switch were first, a
-- failure in between would leave the session as `authenticated` with stale claims, which
-- is the one state that produces a *silently passing* deny test.
--
-- ⚠ THE FAILURE MODE THIS SUITE MUST NEVER HAVE: a malformed claim makes auth.uid() NULL,
-- which makes auth_role() NULL, which makes every policy return zero rows — and a deny
-- assertion written as "sees 0 rows" then passes for the wrong reason. Every fixture file
-- must therefore assert a POSITIVE control (an admin sees a known non-zero count) before
-- any deny assertion is trusted. BUILD_PLAN S2-T14 makes that acceptance, not advice.
create or replace function pg_temp.login_as(
  p_user uuid,
  p_aal  text default 'aal2'
) returns void
language plpgsql
as $$
begin
  perform pg_temp.set_claims(p_user, p_aal);
  perform set_config('role', 'authenticated', true);
end;
$$;

comment on function pg_temp.login_as(uuid, text) is
  'Become the `authenticated` role carrying this fixture user''s JWT claims. The standard '
  'way to assert an RLS or column-GRANT boundary. Pass aal => ''aal1'' to test the '
  'second-factor backstop (PRD US-A3/US-A4).';


-- ── login_anon ─────────────────────────────────────────────────────────────────────
-- The anonymous public surface: PRD US-A1 ("no page other than the public application form
-- is reachable without logging in") and US-B4 ("a forwarded link is inert outside the
-- window"). anon is a row in the role matrix, never an afterthought.
--
-- Claims are cleared to the empty string rather than left stale, so auth.uid() is NULL —
-- current_setting(..., true) on an empty string is what Supabase's auth.uid() treats as
-- absent.
create or replace function pg_temp.login_anon() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

comment on function pg_temp.login_anon() is
  'Become the `anon` role with no JWT claims. The unauthenticated public surface.';


-- ── logout ─────────────────────────────────────────────────────────────────────────
-- Back to the session role (postgres) so the test file can seed more fixture data or read
-- the audit log directly. `role` => 'none' is SET ROLE NONE, i.e. RESET ROLE, and is
-- always permitted regardless of the role currently in effect — see note 1.
--
-- Role is reset BEFORE the claims are cleared, because clearing a GUC is the operation
-- most likely to be refused from a restricted role; doing it in this order means logout()
-- cannot half-succeed and strand the session.
create or replace function pg_temp.logout() returns void
language plpgsql
as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

comment on function pg_temp.logout() is
  'Return to the session role and clear JWT claims. Call before any statement that must '
  'run with the migration owner''s privileges (seeding, reading audit_log directly).';


-- ── jwt_claims ─────────────────────────────────────────────────────────────────────
-- Debugging aid, and the fastest way to diagnose the silent-pass failure mode above: if a
-- deny assertion is passing and you cannot say why, print this. NULL here means auth.uid()
-- is NULL and the test is measuring nothing.
create or replace function pg_temp.jwt_claims() returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;

comment on function pg_temp.jwt_claims() is
  'The claims currently in effect, or NULL. If this is NULL inside a login_as() block, '
  'auth.uid() is NULL and every policy is returning zero rows for the WRONG reason.';
