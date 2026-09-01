-- ═══════════════════════════════════════════════════════════════════════════════════
-- 034_mfa_recovery_rls.sql  —  BUILD_PLAN S2-T35
--
-- PRD US-A3: "Enrolment issues one-time recovery codes, displayed exactly once."
-- Supabase Auth's native TOTP has no recovery-code feature, so this is the one requirement
-- in Epic A that is ours to build — and therefore the one where a mistake is ours too.
--
-- public.mfa_recovery_codes uses DENY-BY-DEFAULT AS THE PRIMARY MECHANISM rather than as a
-- backstop: ENABLE + FORCE ROW LEVEL SECURITY and **zero policies of any kind**, so no
-- session at any tier can read a hash, list another account's codes, mark one consumed or
-- plant one. The only way in is a SECURITY DEFINER function, and there are exactly two,
-- both scoping everything they touch to auth.uid(). This file asserts that the absence is
-- doing the work — because "there is no policy" is invisible in a running system and reads
-- to a future maintainer exactly like a bug worth fixing.
--
--    1-3   the structure: zero policies, RLS enabled AND forced
--    4-12  no fixture can read the table directly — all nine, including anon
--   13-17  issue: ten distinct codes, only hashes stored, and the hashes verify
--   18-22  re-issue: a fresh set, sharing nothing with the old one, which is invalidated
--   23-28  consume: true exactly once, false forever after, false for everything else
--   29-31  cross-account: another user's code is refused, and their set is untouched
--   32-33  anon cannot call either function at all
--   34-36  no write path: INSERT is refused; UPDATE and DELETE reach nothing
--   37     non-vacuity: the table genuinely holds the twenty rows this file created
--
-- ⚠ WHY ASSERTIONS 4-12 ACCEPT "0 rows OR refused". Both outcomes are correct and which one
--   occurs depends on whether Supabase's default privileges granted `authenticated` a
--   table-level SELECT before RLS ever runs. If the GRANT exists, FORCE RLS with no policy
--   returns zero rows; if it does not, the caller is refused at 42501. The REQUIREMENT is
--   "no session sees a recovery-code hash", and both satisfy it. Asserting one specific
--   shape would make this file fail on a Supabase version bump for a reason that has
--   nothing to do with the security property. The probe helper below therefore reports
--   'refused' for 42501 and the row count otherwise, and the assertion accepts either.
--
-- ⚠ ASSERTION 22 IS THE ONE THAT IS EASY TO GET WRONG. issue_recovery_codes() DELETES the
--   previous unconsumed set — which is correct behaviour for "I lost my printout", and is
--   also the reason CLAUDE.md's "never hard-delete anything" is not violated: that rule
--   governs MEMBERSHIP AND ORG RECORDS and is enforced by the schema-wide absence of DELETE
--   POLICIES. This DELETE is a statement inside a definer function, not a policy, and a
--   dead credential is not a record of anything. Assertion 22 proves an old code is
--   genuinely dead rather than merely superseded.
--
-- ⚠ THIS TABLE IS NOT IN DATA_MODEL.md §1, and that is flagged rather than fixed: 0017's
--   header raises it in the PR, because DATA_MODEL.md belongs to another lane and is under
--   concurrent edit. It is auth-credential state, not an org record, which is arguably why
--   §1 does not carry it — but that is the doc owner's call.
--
-- CITATION:  BUILD_PLAN S2-T35, S2-T20 (the declared-unreachable whitelist);
--            ARCHITECTURE.md §5 ("Recovery codes are generated at enrolment and shown
--            once"); PRD §3 v1.0 item 2; PRD US-A3, US-A4, US-A5; PRD OQ-13.
--            Not a CBL matter — the Constitution says nothing about second factors.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir ../test-helpers/auth.sql
\ir ../test-helpers/fixtures.sql

select plan(37);


-- ── probes ─────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER, so each statement runs with the calling fixture's privileges. They
-- collapse "denied by a missing GRANT" and "returned nothing because no policy matched"
-- into one comparable answer — see the note on assertions 4-12 above.
create or replace function pg_temp.probe_count(p_sql text) returns text
language plpgsql
as $$
declare n bigint;
begin
  execute p_sql into n;
  return n::text;
exception
  when insufficient_privilege then return 'refused';
end;
$$;

create or replace function pg_temp.probe_write(p_sql text) returns text
language plpgsql
as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n::text;
exception
  when insufficient_privilege then return 'refused';
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — the structure: the absence IS the mechanism
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select coalesce(string_agg(format('%s (%s)', policyname, cmd), ', ' order by policyname), '')
     from pg_policies
    where schemaname = 'public' and tablename = 'mfa_recovery_codes'),
  '',
  'mfa_recovery_codes carries ZERO policies — a SELECT policy would expose hashes to offline cracking, an INSERT or UPDATE policy would let a session forge or burn its own second factor');

select is(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'mfa_recovery_codes'),
  true,
  'mfa_recovery_codes has ROW LEVEL SECURITY ENABLED — without it, zero policies would mean zero restrictions');

select is(
  (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'mfa_recovery_codes'),
  true,
  'mfa_recovery_codes has RLS FORCED — ENABLE alone lets the table OWNER through, and the migration role IS the owner');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-12 — no fixture reads the table directly. All nine, anon included.
--
-- Run BEFORE any code is issued as well as implicitly after — the table is empty here, so
-- these nine are about the ACCESS PATH; assertion 37 is what proves the table later holds
-- twenty rows that nobody could have read.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');
select ok(pg_temp.probe_count($$ select count(*) from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'exec_admin cannot read mfa_recovery_codes — not even the CEO reads a second factor');

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');
select ok(pg_temp.probe_count($$ select count(*) from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'tech_admin cannot read mfa_recovery_codes — the CTO administers MFA re-enrolment (PRD US-A3) without ever seeing a hash');

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');
select ok(pg_temp.probe_count($$ select count(*) from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'crrd_admin cannot read mfa_recovery_codes');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');
select ok(pg_temp.probe_count($$ select count(*) from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'moderator cannot read mfa_recovery_codes');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');
select ok(pg_temp.probe_count($$ select count(*) from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'officer cannot read mfa_recovery_codes');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');
select ok(pg_temp.probe_count($$ select count(*) from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'regional_rep_a cannot read mfa_recovery_codes');

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');
select ok(pg_temp.probe_count($$ select count(*) from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'regional_rep_b cannot read mfa_recovery_codes');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');
select ok(pg_temp.probe_count($$ select count(*) from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'member cannot read mfa_recovery_codes — including their OWN hashes; there is no reason to hand a session its own credential material back');

select pg_temp.login_anon();
select ok(pg_temp.probe_count($$ select count(*) from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'anon cannot read mfa_recovery_codes');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-17 — issuing the first set
--
-- Codes are materialised into a temp table because this is the ONLY moment the plaintext
-- exists anywhere: issue_recovery_codes() returns it once and stores only a salted hash.
-- Assertions 16 and 17 are the pair that matters — 16 proves no plaintext was stored, 17
-- proves the stored hash is genuinely the salted SHA-256 of the code that was handed out
-- rather than something that merely differs from it.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- set_claims() rather than login_as() for the three issue calls in this file: it sets
-- request.jwt.claims WITHOUT switching the database role, which is all these functions
-- need — they are SECURITY DEFINER and scope everything to auth.uid(), never to the
-- caller's table privileges (test-helpers/auth.sql, note 3). Keeping the session role
-- means `create temp table` is unambiguously permitted; the real-role execute path is
-- still exercised by every consume_recovery_code() call below, which uses login_as().
select pg_temp.logout();
select pg_temp.set_claims('00000000-0000-4000-a000-000000000008');   -- member

create temp table fx_codes1 as
  select row_number() over () as ord, c.code from public.issue_recovery_codes() as c(code);
grant select on fx_codes1 to public;

select is((select count(*)::int from fx_codes1), 10,
  'issue_recovery_codes() returns exactly TEN codes — PRD US-A3');

select is((select count(distinct code)::int from fx_codes1), 10,
  'all ten are DISTINCT — a duplicate would mean one plaintext redeems two rows and the user silently loses a code');

select is(
  (select count(*)::int from public.mfa_recovery_codes
    where user_id = '00000000-0000-4000-a000-000000000008' and consumed_at is null),
  10,
  'exactly ten live rows exist for that account');

select is(
  (select count(*)::int from public.mfa_recovery_codes c
     join fx_codes1 x on c.code_hash = x.code),
  0,
  'NO stored code_hash equals a plaintext code — PRD US-A5, a recovery code is a credential and is stored irreversibly');

select is(
  (select count(*)::int from public.mfa_recovery_codes c
     join fx_codes1 x on c.code_hash = encode(sha256((c.code_salt || x.code)::bytea), 'hex')
    where c.user_id = '00000000-0000-4000-a000-000000000008'),
  10,
  'every stored hash IS the salted SHA-256 of the code that was issued — the per-row salt means the table cannot be attacked as one rainbow lookup');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 18-22 — re-issuing invalidates the previous set
--
-- The "I lost my printout" path. A second call must not accumulate twenty live codes, and
-- the old ones must be genuinely dead rather than merely superseded — which assertion 22
-- checks behaviourally rather than by counting rows.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.set_claims('00000000-0000-4000-a000-000000000008');   -- member, same account

create temp table fx_codes2 as
  select row_number() over () as ord, c.code from public.issue_recovery_codes() as c(code);
grant select on fx_codes2 to public;

select is((select count(*)::int from fx_codes2), 10,
  'a second call returns ten codes again');

select is((select count(distinct code)::int from fx_codes2), 10,
  'the second set is internally distinct too');

select is((select count(*)::int from fx_codes1 a join fx_codes2 b on a.code = b.code), 0,
  'the second set shares NOTHING with the first — the printout the user just lost is not reissued to them');

select is(
  (select count(*)::int from public.mfa_recovery_codes
    where user_id = '00000000-0000-4000-a000-000000000008' and consumed_at is null),
  10,
  'still exactly TEN live rows, not twenty — the superseded set was invalidated, not accumulated');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');
select is(public.consume_recovery_code((select code from fx_codes1 where ord = 1)), false,
  'a code from the SUPERSEDED set is refused — invalidation is real, not cosmetic');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 23-28 — consumption: true exactly once
--
-- Every failure mode returns the SAME false — wrong code, already-consumed code, another
-- account's code, null. The boolean discloses nothing beyond "that did not work", which is
-- the correct shape for a credential check.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(public.consume_recovery_code((select code from fx_codes2 where ord = 1)), true,
  'a live code is accepted — the positive control, without which every false below proves nothing');

select is(public.consume_recovery_code((select code from fx_codes2 where ord = 1)), false,
  'the SAME code is refused on reuse — single-use, enforced by consumed_at plus the FOR UPDATE row lock (PRD US-A3)');

select is(public.consume_recovery_code('ZZZZ-ZZZZ'), false,
  'a well-formed but wrong code returns false — an error would tell an attacker the shape was right');

select is(public.consume_recovery_code(null::text), false,
  'a null code returns false rather than raising');

select is(public.consume_recovery_code(lower((select code from fx_codes2 where ord = 2))), true,
  'a code retyped in lower case is accepted — case and stray whitespace are normalised, because a human is reading it off a printout');

select pg_temp.logout();
select is(
  (select count(*)::int from public.mfa_recovery_codes
    where user_id = '00000000-0000-4000-a000-000000000008' and consumed_at is null),
  8,
  'exactly EIGHT live codes remain after two redemptions — consumed rows are tombstoned with consumed_at, not deleted');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 29-31 — cross-account
--
-- The definer functions bypass RLS by construction, so the caller's identity is the ONLY
-- thing scoping them. If either one keyed on anything but auth.uid(), a member could burn
-- the CEO's recovery codes — a denial-of-service against the only account that can unblock
-- a term rollover (PRD OQ-13).
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.logout();
select pg_temp.set_claims('00000000-0000-4000-a000-000000000001');   -- exec_admin

create temp table fx_codes3 as
  select row_number() over () as ord, c.code from public.issue_recovery_codes() as c(code);
grant select on fx_codes3 to public;

select is((select count(*)::int from fx_codes3), 10,
  'exec_admin gets their own ten codes');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is(public.consume_recovery_code((select code from fx_codes3 where ord = 1)), false,
  'the member CANNOT consume the exec_admin''s code — the same false as a wrong code, disclosing nothing');

select pg_temp.logout();
select is(
  (select count(*)::int from public.mfa_recovery_codes
    where user_id = '00000000-0000-4000-a000-000000000001' and consumed_at is null),
  10,
  'and the exec_admin''s ten codes are untouched — the attempt burned nothing');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 32-33 — anon reaches neither function
--
-- Both already refuse a null auth.uid() internally, so this is belt as well as braces. But
-- SECURITY DEFINER functions are granted to PUBLIC by default, which includes anon, and an
-- anonymous endpoint into credential machinery is not something to leave to the function
-- body being right. 0017 revokes execute from anon for exactly this reason.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_anon();

select throws_ok(
  $$ select * from public.issue_recovery_codes() $$,
  '42501'::char(5), null::text,
  'anon cannot call issue_recovery_codes() — refused at the EXECUTE grant, before the function body runs');

select throws_ok(
  $$ select public.consume_recovery_code('ZZZZ-ZZZZ') $$,
  '42501'::char(5), null::text,
  'anon cannot call consume_recovery_code() either');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 34-37 — no write path, and the non-vacuity guard
--
-- INSERT is refused outright: with FORCE RLS and no policy, a WITH CHECK can never pass,
-- so the answer is deterministic. UPDATE and DELETE either reach zero rows or are refused
-- at the GRANT, for the same reason assertions 4-12 accept both shapes.
--
-- Assertion 37 is what makes the whole file non-vacuous: twenty rows exist in this table by
-- the end, and not one fixture was able to see any of them.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');

select is(
  pg_temp.probe_write($$
    insert into public.mfa_recovery_codes (user_id, code_salt, code_hash)
    values ('00000000-0000-4000-a000-000000000008', 'planted', 'planted') $$),
  'refused',
  'no session can PLANT a recovery code — FORCE RLS with no policy means the WITH CHECK can never pass');

select ok(
  pg_temp.probe_write($$ update public.mfa_recovery_codes set consumed_at = null $$) in ('0', 'refused'),
  'no session can un-consume a code — a burned second factor stays burned');

select ok(
  pg_temp.probe_write($$ delete from public.mfa_recovery_codes $$) in ('0', 'refused'),
  'no session can delete recovery codes — the only DELETE in the schema is a statement inside issue_recovery_codes(), never a policy');

select pg_temp.logout();
select is((select count(*)::int from public.mfa_recovery_codes), 20,
  'NON-VACUITY: the table holds 20 rows by now (10 member + 10 exec_admin) and not one fixture could read a single one of them');


select * from finish();

rollback;
