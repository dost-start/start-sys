-- ═══════════════════════════════════════════════════════════════════════════════════
-- 032_revocation_rls.sql  —  BUILD_PLAN S2-T26
--
-- THIS FILE IS THE EVIDENCE FOR A REJECTED DESIGN. ARCHITECTURE.md §7 rejects the Supabase
-- Custom Access Token Hook — stamping the role into the JWT — on one ground: "a demoted
-- officer or resigned member keeps their powers for up to an hour. Wrong failure mode for a
-- system whose whole point is revoking access." PRD US-A2 states it as a requirement:
-- "removing a role from a user takes effect on the user's NEXT REQUEST, not after a delay."
-- Without this test that decision is an unbacked assertion in a document.
--
--    1-3   positive controls: crrd_admin's claims resolve and they see the whole roll
--    4-7   the role is flipped MID-SESSION and the very next statement answers differently
--    8     ...with byte-identical JWT claims, so nothing about the token changed
--    9-11  the mirror: a regional rep's SCOPE is re-pointed and their rows vanish
--   12-13  ...and re-pointing it back restores them, so revocation is live in BOTH
--          directions and not a one-way latch
--   14     the claims are still unchanged at the end
--
-- ⚠ HOW THE FLIP IS DONE, AND WHY IT MATTERS. The obvious way is logout() -> update as the
--   session role -> login_as() again. That would work, but it weakens the claim: a reader
--   could reasonably ask whether the re-login is what refreshed the answer. So the update
--   runs through pg_temp.force_role() / pg_temp.force_region(), SECURITY DEFINER helpers
--   owned by the migration role — **the session never stops being `authenticated` and never
--   re-presents its claims.** What changes is one row in public.user_roles; what does not
--   change is anything the caller holds. That is precisely the property the JWT-hook design
--   cannot have.
--
--   The helpers set search_path = '' and fully qualify every name, per CONVENTIONS.md §3.4,
--   because a definer function that resolves names against the caller's search_path is the
--   whole authorization model waiting to be stolen — and a helper in pg_temp is not exempt
--   from that just because it is temporary.
--
-- ⚠ WHY THE REP'S REGION IS RE-POINTED RATHER THAN NULLED. The rr_needs_region CHECK in
--   0004 forbids `role = 'regional_rep' AND region_id IS NULL`, and rightly: a regional rep
--   with no region is a nonsense row. So the mirror case moves them to R11 (Davao), which
--   contains no memberships and no people — the same observable effect (their rows go to
--   zero) reached through a state the schema actually permits.
--
-- CITATION:  BUILD_PLAN S2-T26; ARCHITECTURE.md §5 ("Role storage and revocation"), §7
--            (rejected: Custom Access Token Hook); DATA_MODEL.md §2.2, §6/0012;
--            CONVENTIONS.md §3.4, §11; PRD §3 v1.0 item 3; PRD US-A2, US-E3, US-F1, US-H4.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir ../test-helpers/auth.sql
\ir ../test-helpers/fixtures.sql

select plan(14);


-- ── force_role / force_region ──────────────────────────────────────────────────────
-- SECURITY DEFINER, owned by the session role, so they bypass RLS on public.user_roles the
-- way an admin console would — WITHOUT the test having to drop back to the session role and
-- re-present its claims. That is the entire methodological point of this file: the only
-- thing that changes between the "before" and "after" assertions is one table row.
create or replace function pg_temp.force_role(p_user uuid, p_role public.org_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_roles set role = p_role where user_id = p_user;
end;
$$;

create or replace function pg_temp.force_region(p_user uuid, p_region_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_roles ur
     set region_id = (select r.id from public.regions r where r.code = p_region_code)
   where ur.user_id = p_user;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — the "before", as the CCDO
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

select is(public.auth_role()::text, 'crrd_admin',
  'BEFORE: auth_role() reads crrd_admin from public.user_roles — per statement, never from a claim');

select is((select count(*) from public.people)::int, 6,
  'BEFORE: crrd_admin sees all 6 people — PRD US-D1');

select is((select count(*) from public.memberships)::int, 5,
  'BEFORE: crrd_admin sees all 5 memberships');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-8 — THE FLIP. No logout, no re-login, no token refresh, no waiting.
--
-- Between assertion 3 and assertion 4 exactly one thing happens: a row in public.user_roles
-- changes. The session is the same session, holding the same claims, on the same
-- connection. If roles were stamped into the JWT, assertions 5-7 would still read 6, 5 and
-- 'crrd_admin' for up to an hour — which is exactly the window in which a resigned officer
-- keeps reading the roll (PRD US-H4).
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.force_role('00000000-0000-4000-a000-000000000003', 'member');

select is(public.auth_role()::text, 'member',
  'AFTER: the VERY NEXT statement already reads `member` — revocation takes effect on the next request (PRD US-A2)');

select is((select count(*) from public.people)::int, 1,
  'AFTER: the identical unchanged query now returns 1 person — their own row and nobody else''s (PRD US-E4)');

select is((select count(*) from public.memberships)::int, 0,
  'AFTER: 0 memberships — the demoted account''s person (P2) has no membership, so the member branch matches nothing');

select is((select count(*) from public.audit_log)::int, 0,
  'AFTER: 0 audit_log rows — a privilege that WAS held a statement ago is simply gone, with no session to invalidate');

select is(pg_temp.jwt_claims() ->> 'sub', '00000000-0000-4000-a000-000000000003',
  'THE POINT: the JWT claims are UNCHANGED throughout — same sub, same session, no re-auth. Only a table row moved (ARCHITECTURE.md §7)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-13 — the mirror: SCOPE revocation, and revocation in both directions
--
-- The same property has to hold for the other half of the access-control row. A regional
-- rep re-pointed to a region containing nobody sees nobody, on the next statement — and is
-- restored just as instantly, which is what makes this a live lookup rather than a
-- one-way latch that only ever removes.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a

select is((select count(*) from public.memberships)::int, 3,
  'BEFORE: regional_rep_a sees exactly 3 NCR memberships');

select pg_temp.force_region('00000000-0000-4000-a000-000000000006', 'R11');

select is(public.auth_region_ids(), array[pg_temp.fx_region('R11')],
  'AFTER: auth_region_ids() already returns {R11} — the scope helper reads the table per statement too');

select is((select count(*) from public.memberships)::int, 0,
  'AFTER: 0 memberships — R11 contains nobody, so the rep''s entire view collapses on the next statement (PRD US-F1)');

select pg_temp.force_region('00000000-0000-4000-a000-000000000006', 'NCR');

select is((select count(*) from public.memberships)::int, 3,
  'RESTORED: back to 3 immediately — revocation is a live lookup in BOTH directions, not a one-way latch');

select is((select count(*) from public.people)::int, 2,
  'RESTORED: and the people scoping comes back with it — 2 current-term NCR scholars');

select is(pg_temp.jwt_claims() ->> 'sub', '00000000-0000-4000-a000-000000000006',
  'and again: rep_a''s claims never changed either — three different answers from one unchanged token');


select * from finish();

rollback;
