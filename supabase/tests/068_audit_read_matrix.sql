-- ═══════════════════════════════════════════════════════════════════════════════════
-- 068_audit_read_matrix.sql  —  the audit log's READ boundary, against a POPULATED log
--
-- WHAT:
--    1      POSITIVE CONTROL — the log is genuinely non-empty before any denial is trusted
--    2-3    exec_admin and tech_admin read the whole log
--    4-10   the other seven fixtures read EXACTLY ZERO, asserted one role at a time
--   11-12   an audited UPDATE appends exactly ONE row, and exec_admin sees it immediately
--   13-15   there is no INSERT, no UPDATE and no DELETE policy on audit_log
--   16-21   has_table_privilege is false for UPDATE and DELETE × {authenticated, anon,
--           service_role} — append-only enforced at the GRANT level, the strong form
--
-- WHY:  PRD §3 v1.0 item 16 and PRD US-I1 — "the log is readable only by Executive and
--   Technical Admins" and "no user role can edit or delete an audit entry". BUILD_PLAN
--   S6-T20, which exists to make S6-T19's /admin/audit boundary a DATABASE property rather
--   than a page behaviour: the route reads through the caller's own client, so
--   audit_log_read (0014 §1) is the only authorization in the path and this file is what
--   proves it.
--
-- ⚠ WHY THIS FILE EXISTS WHEN 021 AND 002 ALREADY TOUCH audit_log — AND THE OVERLAP IS
--   DELIBERATE, NOT DUPLICATION. 021_reference_rls.sql asserts these boundaries against an
--   essentially EMPTY log, where a correct policy and a completely broken one look
--   identical: "sees 0 rows" passes for `crrd_admin` whether the policy excludes them or
--   whether there was simply nothing to see. 002_audit_substrate.sql asserts the GRANT
--   revocations before any trigger has ever fired. **This file re-runs both against a log
--   that fixtures.psql and dashboard-fixtures.psql have genuinely filled** — dozens of rows
--   from people, memberships, terms, committees, committee_memberships, officer_assignments
--   and confidentiality_acknowledgements inserts, plus the two status updates in
--   dashboard-fixtures §4. Assertion 1 is what converts every zero below from "nothing
--   happened" into "the policy refused".
--
-- ⚠ WHO IS EXCLUDED FROM THE LOG, AND WHY IT IS NOT AN OVERSIGHT. crrd_admin and moderator
--   are the operational tier whose reads and writes this log RECORDS. Granting them the log
--   would let the watched read the watcher — and, worse, would let them see which member
--   records another officer has been opening. exec_admin and tech_admin alone, exactly as
--   PRD US-I1 words it.
--
-- ⚠ THE LOG HOLDS NO PII, WHICH IS WHY APPEND-ONLY AND THE FIVE-YEAR PURGE CAN COEXIST.
--   audit_row() (0011) calls mask_sensitive() BEFORE the insert, replacing every value whose
--   column is named in sensitive_column_registry with a redaction marker. So the log answers
--   "who changed this scholar's contact number, and when" without STORING the number, the
--   purge never needs to reach into it, and therefore nobody ever needs a reason to grant
--   UPDATE on it. 017_audit_triggers.sql owns the masking assertion; this file owns the
--   reading of the rows that masking produced.
--
-- ⚠ 16-21 REPEAT 002 ON PURPOSE. Append-only is enforced at the GRANT level rather than by
--   the absence of a policy, because a REVOKE cannot be undone by a policy added carelessly
--   in 2029 — whereas an absent policy can simply be written. Two files asserting it is the
--   cost of that being true; the day they disagree, the diff says which one moved.
--
-- CITATION:  BUILD_PLAN S6-T19, S6-T20, S7-T26; ARCHITECTURE.md §5, §8 (History NFR);
--            DATA_MODEL.md §6/0011, §8.3, §9; CONVENTIONS.md §8.1;
--            PRD §3 v1.0 item 16; PRD US-I1, US-C1, US-C2, US-D1, US-E3, US-J1;
--            CBL Art. VIII §6.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/dashboard-fixtures.psql

select plan(21);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- Baseline
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Captured as the SESSION ROLE, which is a superuser and therefore carries BYPASSRLS — so
-- this is the true total, the number exec_admin and tech_admin must match and everybody else
-- must not.
--
-- An ABSOLUTE count would be brittle: the number of audit rows the two fixture files produce
-- is a function of how many rows they insert, which is not this file's business. Everything
-- below compares against this captured value instead, so a fixture gaining a row moves the
-- baseline and every assertion with it.
--
-- Readable by `public` because assertions 2, 3 and 12 evaluate it while impersonating.
create temp table fx_audit_base (label text primary key, n int not null);
grant select on fx_audit_base to public;

insert into fx_audit_base (label, n)
values ('before', (select count(*)::int from public.audit_log));


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — POSITIVE CONTROL: the log is genuinely populated
--
-- Runs first and everything after it depends on it. Every "sees exactly 0" assertion below
-- would pass against an empty table, against a dropped policy that returns nothing for the
-- wrong reason, and against a claims bug that makes auth.uid() NULL for every fixture. This
-- is the assertion that makes those seven zeros mean "refused".
--
-- The floor is 20 rather than an exact figure: fixtures.psql alone inserts 6 people, 5
-- memberships, a term, a committee, 2 committee_memberships, 4 officer_assignments and 2
-- acknowledgements and then archives a term — every one of which is on DATA_MODEL.md §8.3's
-- audited list — and dashboard-fixtures.psql adds 11 more people, 11 memberships, a
-- committee, 3 seats and 3 status updates on top.
-- ═══════════════════════════════════════════════════════════════════════════════════

select cmp_ok(
  (select n from fx_audit_base where label = 'before'), '>=', 20,
  'POSITIVE CONTROL — the audit log is genuinely populated by the fixtures, so every zero '
  'below means REFUSED rather than EMPTY'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2-3 — the two tiers PRD US-I1 admits
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is(
  (select count(*)::int from public.audit_log),
  (select n from fx_audit_base where label = 'before'),
  'exec_admin reads the ENTIRE audit log — PRD US-I1'
);
select pg_temp.logout();

-- tech_admin reads the log while reading ZERO people and ZERO memberships (065, 028). The
-- combination is deliberate and it is the shape of the role: the CTO can answer "who did
-- what, and when" without being able to read what was done TO. PRD OQ-5 and US-I1 pulling in
-- different directions on the same account, resolved as two different privileges.
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is(
  (select count(*)::int from public.audit_log),
  (select n from fx_audit_base where label = 'before'),
  'tech_admin reads the ENTIRE audit log — while reading zero people and zero memberships '
  '(PRD US-I1 with OQ-5)'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-10 — everybody else reads EXACTLY ZERO
--
-- One assertion per role rather than a loop: a failure has to name the tier that gained
-- access, and CONVENTIONS.md §8.1 requires exact counts per named fixture rather than an
-- aggregate that could hide one role among seven.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is((select count(*)::int from public.audit_log), 0,
  'crrd_admin reads 0 audit rows — the operational tier this log RECORDS must not read it');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select is((select count(*)::int from public.audit_log), 0,
  'moderator reads 0 audit rows — same reason as crrd_admin');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is((select count(*)::int from public.audit_log), 0,
  'officer reads 0 audit rows');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is((select count(*)::int from public.audit_log), 0,
  'regional_rep_a reads 0 audit rows — not even for their own region');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select is((select count(*)::int from public.audit_log), 0,
  'regional_rep_b reads 0 audit rows');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is((select count(*)::int from public.audit_log), 0,
  'member reads 0 audit rows — not even the entries about their own record');
select pg_temp.logout();

-- anon holds a SELECT GRANT here by Supabase default (0011 revokes only UPDATE and DELETE;
-- 0015's loop revokes only DELETE broadly), so what returns zero is the MISSING ANON POLICY
-- under FORCE RLS — deny-by-default working, not a missing privilege. That is a different
-- refusal shape from the aggregate views in 065, where anon is refused at the GRANT with
-- 42501, and the difference is worth keeping visible.
select pg_temp.login_anon();
select is((select count(*)::int from public.audit_log), 0,
  'anon reads 0 audit rows — PRD US-A1, and by a MISSING POLICY rather than a missing grant');
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11-12 — the log is live: an audited write appends exactly one row
--
-- A read-boundary suite that never watches a row arrive is asserting against a static
-- snapshot. This proves the trigger is attached, that it writes ONE row per affected row, and
-- that exec_admin sees the new entry on their very next statement with no refresh of any
-- kind — which is the same live-lookup property that makes role revocation instant (0012's
-- auth_role() reads user_roles per statement, never a JWT claim).
--
-- D03's year_level, chosen because it changes NO status: enforce_membership_transition()
-- (0028) returns early on an unchanged status, so this exercises trg_memberships_audit and
-- nothing else. The row is in the ACTIVE term, so trg_memberships_freeze_archived (0006)
-- does not fire either.
-- ═══════════════════════════════════════════════════════════════════════════════════

update public.memberships
   set year_level = 5
 where id = '00000000-0000-4000-c200-000000000003';   -- D03, NCR, active, no committee

select is(
  (select count(*)::int from public.audit_log),
  (select n from fx_audit_base where label = 'before') + 1,
  'one audited UPDATE appends exactly ONE audit row — the trigger is attached and fires per '
  'row (DATA_MODEL.md §8.3)'
);

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is(
  (select count(*)::int from public.audit_log),
  (select n from fx_audit_base where label = 'before') + 1,
  'exec_admin sees the new entry on their next statement — no refresh, no re-auth'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-15 — no INSERT, no UPDATE and no DELETE policy exists on audit_log
--
-- INSERT is as important as the other two and is the one most likely to be added by someone
-- trying to be helpful: rows are written by audit_row(), a SECURITY DEFINER trigger owned by
-- a BYPASSRLS role, so an INSERT policy would let a session FORGE an audit row — and a
-- forgeable audit log is worse than no audit log, because it is trusted.
--
-- Read from pg_policies rather than from behaviour, so the assertion holds even against a
-- policy nobody has yet found a way to trip.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and cmd = 'INSERT'),
  0,
  'no INSERT policy on audit_log — a forgeable audit row is worse than no audit row'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and cmd = 'UPDATE'),
  0,
  'no UPDATE policy on audit_log — not even the CEO can rewrite history from the app '
  '(PRD US-I1)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and cmd = 'DELETE'),
  0,
  'no DELETE policy on audit_log'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 16-21 — append-only at the GRANT level, which is the strong form
--
-- A REVOKE cannot be undone by a policy; an absent policy can simply be written. 0011's
-- `revoke update, delete on public.audit_log from authenticated, anon, service_role` is
-- therefore the real guarantee and 13-15 are the belt to it. service_role is included
-- because it is the one identity that bypasses RLS entirely — the backup job and the invite
-- flow run as it — so a grant to it would be a hole nothing else in this suite could see.
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE'),
  'authenticated has NO UPDATE grant on audit_log');
select ok(not has_table_privilege('anon', 'public.audit_log', 'UPDATE'),
  'anon has NO UPDATE grant on audit_log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'UPDATE'),
  'service_role has NO UPDATE grant on audit_log — the one identity that bypasses RLS');

select ok(not has_table_privilege('authenticated', 'public.audit_log', 'DELETE'),
  'authenticated has NO DELETE grant on audit_log');
select ok(not has_table_privilege('anon', 'public.audit_log', 'DELETE'),
  'anon has NO DELETE grant on audit_log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'DELETE'),
  'service_role has NO DELETE grant on audit_log');


select * from finish();

rollback;
