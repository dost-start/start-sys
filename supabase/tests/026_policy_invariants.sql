-- ═══════════════════════════════════════════════════════════════════════════════════
-- 026_policy_invariants.sql  —  BUILD_PLAN S2-T20, the NEGATIVE-SPACE test
--
-- Every other file in this suite asserts what the policies DO. This one asserts what no
-- policy is ALLOWED to do, over pg_policies and pg_proc rather than over fixtures — so it
-- is the file that fails when someone widens a boundary in 2029 and helpfully updates the
-- expected counts elsewhere to match their change.
--
--    1  (a) zero DELETE policies anywhere in public
--    2  (b) zero INSERT/UPDATE/ALL policies naming officer or regional_rep
--    3      ...and the ANTI-VACUITY control for (2): the same regex DOES match SELECT
--           policies, so a zero above is a real zero and not a broken pattern
--    4  (c) every table in public has a SELECT-capable policy, except a DECLARED whitelist
--    5      ...and the whitelist tables have zero policies of ANY kind
--    6      ...and the whitelist tables actually exist (so 4 and 5 are not vacuous)
--    7  (d) every SECURITY DEFINER function in public carries SET search_path
--    8      ...and there ARE such functions (anti-vacuity)
--    9  (e) no policy reads user_metadata or raw_user_meta_data
--   10      no policy is granted to the PUBLIC pseudo-role
--   11      audit_log has exactly one policy and it is SELECT
--   12      anti-vacuity: public has policies at all, i.e. 0014 actually applied
--
-- ⚠ WHY THE ROLE-LITERAL REGEX LOOKS FOR A QUOTED TOKEN. In a policy expression a role
--   renders as `'officer'::org_role`, so the pattern `'(officer|regional_rep)'` — an
--   opening quote, the name, a closing quote — matches the literal and CANNOT match the
--   identifier `officer_assignments` or `officer_positions` appearing in some future
--   subquery. A looser pattern would produce false failures that get "fixed" by loosening
--   the test, which is exactly the failure mode this file exists to prevent.
--
-- ⚠ THE WHITELIST IN ASSERTION 4 IS A DECLARATION, NOT A CONVENIENCE. Three tables are
--   meant to be unreachable by every human role — public.member_id_counters (0014 §2 and
--   0015 §3: member-ID allocation state, reachable only from inside allocate_member_id()),
--   public.mfa_recovery_codes (0017: a SELECT policy would expose hashes to offline
--   cracking, an INSERT or UPDATE policy would let a session forge or burn its own second
--   factor) and public.rate_limit_buckets (BUILD_PLAN S3-T7, not yet built). Naming them
--   here is what makes "this table has no SELECT policy" a design rather than a bug
--   somebody discovers and helpfully repairs. ADDING A NAME TO THIS LIST IS A DECISION AND
--   BELONGS IN AN ADR, NOT IN THIS FILE.
--
-- No fixtures, no impersonation: this file reads the catalog only, so it is true of the
-- schema rather than of one seeded world.
--
-- CITATION:  BUILD_PLAN S2-T20; ARCHITECTURE.md §5, §7; CONVENTIONS.md §3.4, §11, §13;
--            DATA_MODEL.md §9, §13 rules 2 and 3; PRD US-D2, US-F2, US-I1;
--            PRD Reliability NFR; CLAUDE.md banned patterns.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(12);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — (a) NO DELETE POLICY EXISTS ANYWHERE
--
-- PRD Reliability NFR: "no user-facing operation can delete a membership record."
-- Membership end is a status change, term end is a flag, and committee dissolution is not
-- carrying the row into the next term (CBL Art. III §5.4). Accidental mass deletion is
-- meant to be STRUCTURALLY impossible, and the absence of a policy is what makes it so.
-- Offenders appear as the have-value, so a failure is actionable without a second query.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select coalesce(string_agg(format('%s.%s', tablename, policyname), ', ' order by tablename, policyname), '')
     from pg_policies
    where schemaname = 'public' and cmd = 'DELETE'),
  '',
  '(a) no DELETE policy exists on any table in public — removal is a status change (offenders appear as the have-value)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2-3 — (b) THE OFFICER AND REGIONAL-REP TIERS HAVE NO WRITE PATH ANYWHERE
--
-- PRD US-D2: "no update, create or delete path exists for the Officer tier on any record."
-- PRD US-F2: "Regional Representatives cannot delete or alter any record." Both are
-- MISSING POLICIES, not missing buttons — which means nothing in the running system says
-- so out loud, and only a catalog assertion can keep it true.
--
-- Assertion 3 is the control that makes assertion 2 worth having. If the regex were wrong
-- — a typo, a Postgres change in how expressions are rendered — assertion 2 would report
-- zero offenders and pass forever while protecting nothing. So the same pattern is run
-- against SELECT policies, where it MUST match: people_read, memberships_read,
-- department_assignments_read and committee_memberships_read all name both roles.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select coalesce(string_agg(format('%s.%s (%s)', tablename, policyname, cmd), ', ' order by tablename, policyname), '')
     from pg_policies
    where schemaname = 'public'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '''(officer|regional_rep)'''),
  '',
  '(b) no INSERT/UPDATE/ALL policy anywhere names officer or regional_rep — PRD US-D2 and US-F2 as a property of the database');

select isnt(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and cmd = 'SELECT'
      and coalesce(qual, '') ~ '''(officer|regional_rep)'''),
  0,
  'ANTI-VACUITY CONTROL for (b): the same regex DOES match read policies, so the zero above is a real zero and not a broken pattern');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-6 — (c) EVERY TABLE IS READABLE BY SOMEBODY, EXCEPT THE DECLARED UNREACHABLES
--
-- With FORCE RLS on and no policy, Postgres returns zero rows and refuses every write for
-- EVERY role including the owner. That is the correct failure direction for a table
-- shipped by mistake — and it is also, for exactly three tables, the intended mechanism.
-- The difference between the two is this whitelist, which is why it is spelled out with
-- reasons in the header rather than left as a WHERE clause.
--
-- `deptype <> 'e'` skips tables owned by an extension (none of ours ever are), mirroring
-- 001_meta_force_rls.sql. It exempts no table of ours.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (
    select coalesce(string_agg(c.relname::text, ', ' order by c.relname), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      and c.relname not in ('member_id_counters', 'mfa_recovery_codes', 'rate_limit_buckets')
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = c.relname
          and p.cmd in ('SELECT', 'ALL')
      )
  ),
  '',
  '(c) every table in public has a SELECT-capable policy, except the three DECLARED unreachables (offenders appear as the have-value)');

select is(
  (select coalesce(string_agg(format('%s.%s', tablename, policyname), ', ' order by tablename, policyname), '')
     from pg_policies
    where schemaname = 'public'
      and tablename in ('member_id_counters', 'mfa_recovery_codes', 'rate_limit_buckets')),
  '',
  'the declared-unreachable tables carry ZERO policies of any kind — deny-by-default used as the mechanism, not as a backstop');

select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in ('member_id_counters', 'mfa_recovery_codes')
  ),
  2,
  'ANTI-VACUITY CONTROL for (c): member_id_counters and mfa_recovery_codes both exist, so assertions 4 and 5 are measuring something');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7-8 — (d) EVERY SECURITY DEFINER FUNCTION PINS ITS search_path
--
-- CONVENTIONS.md §3.4, no exceptions. A definer function without `SET search_path = ''`
-- resolves unqualified names against the CALLER's search_path, so any account able to
-- create a schema ahead of `public` can plant its own `user_roles` and have auth_role()
-- read it — owning the entire authorization model in one CREATE TABLE.
--
-- proconfig is matched with LIKE 'search_path=%' rather than compared to a literal,
-- because Postgres normalises `SET search_path = ''` differently across versions.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (
    select coalesce(string_agg(p.proname::text, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  ),
  '',
  '(d) every SECURITY DEFINER function in public sets search_path — CONVENTIONS.md §3.4 (offenders appear as the have-value)');

select isnt(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  ),
  0,
  'ANTI-VACUITY CONTROL for (d): public contains SECURITY DEFINER functions, so assertion 7 is not passing over an empty set');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-10 — (e) NO POLICY TRUSTS SOMETHING THE USER CAN WRITE
--
-- 9. `raw_user_meta_data` is writable BY THE USER THEMSELVES through the GoTrue API. A
--    role stored there and read by a policy is a one-line privilege escalation and the
--    single most common Supabase security bug. Roles live in public.user_roles and are
--    read per statement, which is also what makes revocation instant (032).
--
-- 10. A policy applied to the PUBLIC pseudo-role applies to `anon` as well, whatever the
--    author intended. Every policy in 0014 names its roles explicitly — `to anon`,
--    `to authenticated`, or both — and this assertion is what keeps a future `create
--    policy ... using (...)` with no TO clause from silently becoming an anonymous grant.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select coalesce(string_agg(format('%s.%s', tablename, policyname), ', ' order by tablename, policyname), '')
     from pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(user_metadata|raw_user_meta_data)'),
  '',
  '(e) no policy reads user_metadata or raw_user_meta_data — it is user-writable, so a role stored there is a privilege escalation');

select is(
  (select coalesce(string_agg(format('%s.%s', tablename, policyname), ', ' order by tablename, policyname), '')
     from pg_policies
    where schemaname = 'public'
      and 'public' = any (roles::text[])),
  '',
  'no policy is granted to the PUBLIC pseudo-role — a policy with no TO clause is an anonymous grant nobody wrote on purpose');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11-12 — the audit log, and the non-vacuity guard for the whole file
--
-- 11. PRD US-I1: "no user role can edit or delete an audit entry", and the log is readable
--     only by Executive and Technical Admins. Append-only is enforced at the GRANT level
--     in 0011 (the strong form, which a careless policy cannot re-open) — this assertion
--     covers the other half: rows are written by audit_row(), a definer trigger, so an
--     INSERT policy would let a session FORGE an audit row, and a forgeable audit log is
--     worse than no audit log.
--
-- 12. A catalog test over a schema where the migrations did not apply passes for the wrong
--     reason. Every assertion above is an "is empty" or "is zero"; this is the one that
--     fails loudly if 0014_rls.sql never ran.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select coalesce(string_agg(format('%s (%s)', policyname, cmd), ', ' order by policyname), '')
     from pg_policies
    where schemaname = 'public' and tablename = 'audit_log'),
  'audit_log_read (SELECT)',
  'audit_log carries exactly one policy and it is SELECT — no INSERT policy, so no session can forge an audit row (PRD US-I1)');

select isnt(
  (select count(*)::int from pg_policies where schemaname = 'public'),
  0,
  'ANTI-VACUITY CONTROL for the whole file: public has RLS policies at all, i.e. 0014_rls.sql actually applied');


select * from finish();

rollback;
