-- ═══════════════════════════════════════════════════════════════════════════════════
-- 099_security_invariants.sql  —  Day 6's manual security review, made permanent
--
-- WHAT:  The six invariants of BUILD_PLAN S7-T26, asserted against the CATALOG rather than
--        against a hand-maintained list, plus two built-in self-tests that prove the two
--        subtlest predicates still detect what they claim to detect.
--
--          1-2   (a) every table in public has ENABLE **and** FORCE ROW LEVEL SECURITY
--            3   (b) zero DELETE policies anywhere
--          4-7   (c) zero SECURITY DEFINER functions in public without SET search_path
--                    — with the offender self-test at 6-7
--          8-9   (d) audit_log grants neither UPDATE nor DELETE to any client role
--        10-13   (e) sensitive_column_registry is non-empty, every pair it names on an
--                    EXISTING table resolves to a real column, and the tables it names that
--                    do NOT yet exist are exactly the declared v1.1 forward-registrations
--                    — with the stale-column self-test at 13
--        14-15   (f) exactly four administrators, and they are CEO / COO / CTO / CCDO
--
-- WHY:  BUILD_PLAN S7-T26. Every one of these was checked by hand during S7-T29's security
--       review; a check performed once in September 2026 protects nothing in 2029, when
--       nobody remembers why it mattered. This file is where "we looked" becomes "CI looks,
--       on every merge".
--
-- ⚠ THIS FILE OVERLAPS 001, 002, 026 AND 027 ON PURPOSE, AND THE DUPLICATION IS THE POINT.
--   Those four each assert a slice of this list as part of a larger subject, so a future
--   maintainer narrowing one of them — "these two assertions belong in the audit file, not
--   the policy file" — does not silently remove the invariant from the suite. This is the
--   single file whose whole subject IS the security invariants, and it is the one to read
--   when asking "what does this system promise?".
--
-- ⚠ TWO SELF-TESTS RUN INSIDE THE ROLLED-BACK TRANSACTION (assertions 6-7 and 13). They
--   create a deliberately-offending object, assert the predicate FLAGS it, then remove it.
--   This is 004_meta_selftest.sql's discipline applied to the two predicates most likely to
--   be weakened by accident: both are `string_agg(...) = ''` shapes, and a broken one of
--   those passes silently forever because it flags nothing. A predicate that has never been
--   observed catching anything is a predicate nobody knows works.
--
-- ⚠ THERE IS NO EXCLUSION LIST FOR (a), (b), (c) OR (f). An exemption needs an ADR in
--   docs/decisions/, not a WHERE clause added at 1am. (e) carries ONE declared whitelist,
--   and it is a whitelist of tables that do not exist YET rather than of rules that do not
--   apply — see the note at 12.
--
-- CITATION: BUILD_PLAN S7-T26, S7-T29; CLAUDE.md "Banned patterns"; CONVENTIONS.md §3.4,
--           §0 rules 3-4; ARCHITECTURE.md §5, §8; DATA_MODEL.md §8.1, §9; PRD §IV NFR 3,
--           NFR 4, NFR 9; PRD Success Metric 8; CBL Art. III §2 (four administrators),
--           Art. VIII §6 (RA 10173 as a constitutional obligation).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(15);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-2 — (a) RLS is ENABLED AND FORCED on every table in public
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ENABLE alone is not enough: a table OWNER bypasses non-forced RLS, and the Supabase
-- migration role IS the owner. Half the protection reads exactly like all of it.
--
-- The expected value is the empty string so that on failure pgTAP prints the offending
-- table names as the have-value — actionable at 2am without a second query. `deptype <> 'e'`
-- skips tables owned by an EXTENSION (none of ours ever are); it exempts nothing of ours.
select is(
  (
    select coalesce(string_agg(c.relname::text, ', ' order by c.relname), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ),
  '',
  '(a) every table in public has ENABLE and FORCE ROW LEVEL SECURITY — a table shipped '
  'unprotected in 2029 cannot merge (offenders appear as the have-value)'
);

-- 2 — non-vacuity. A catalog test over an empty schema passes for the wrong reason.
select cmp_ok(
  (
    select count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  ),
  '>', 20::bigint,
  'NON-VACUITY: more than twenty tables exist in public, so assertion 1 is measuring a real '
  'schema and not an empty one'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — (b) zero DELETE policies, anywhere
-- ═══════════════════════════════════════════════════════════════════════════════════
-- CLAUDE.md: "No DELETE policy exists anywhere in the schema and none may be added."
-- Membership end is a status change; term end is a flag; a dissolved committee is one not
-- carried forward. The ABSENCE of the policy is what makes accidental mass deletion
-- structurally impossible, so the absence is the thing under test (PRD §IV NFR 4).
select is(
  (
    select coalesce(
      string_agg(format('%s.%s', p.tablename, p.policyname),
                 ', ' order by p.tablename, p.policyname),
      '')
    from pg_policies p
    where p.schemaname = 'public' and p.cmd = 'DELETE'
  ),
  '',
  '(b) no DELETE policy exists on any table in public — removal is a status change, and the '
  'missing policy is the enforcement (offenders appear as the have-value)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-7 — (c) every SECURITY DEFINER function in public pins its search_path
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A definer function without `SET search_path = ''` resolves unqualified names against the
-- CALLER's search_path. Any account that can create a schema on that path can then shadow a
-- table or an operator and have the definer function — running with the OWNER's rights —
-- execute their object instead of ours. That is a privilege-escalation primitive, not a
-- style rule (CONVENTIONS.md §3.4, "no exceptions").
--
-- proconfig is matched with LIKE 'search_path=%' rather than compared to a literal, because
-- Postgres normalises `SET search_path = ''` differently across versions.

select is(
  (
    select coalesce(string_agg(p.proname::text, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  ),
  '',
  '(c) every SECURITY DEFINER function in public sets search_path — an unpinned one is a '
  'privilege-escalation primitive, not a style violation (offenders appear as the have-value)'
);

-- 5 — non-vacuity: there ARE definer functions to check. If a refactor ever removed them
-- all, assertion 4 would go green for a reason that has nothing to do with safety.
select cmp_ok(
  (
    select count(*)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  ),
  '>', 10::bigint,
  'NON-VACUITY: more than ten SECURITY DEFINER functions exist in public, so assertion 4 is '
  'checking something'
);

-- ── SELF-TEST for (c) ──────────────────────────────────────────────────────────────
-- Create a function that breaks the rule, confirm the predicate names it, drop it. Without
-- this, weakening assertion 4 — say, dropping the `not exists` clause — leaves it green
-- forever, because every real function in the schema is compliant.
create function public._selftest_definer_without_search_path() returns integer
language sql
security definer
as $$ select 1 $$;

select is(
  (
    select coalesce(string_agg(p.proname::text, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  ),
  '_selftest_definer_without_search_path',
  'SELF-TEST: the (c) predicate DOES flag a SECURITY DEFINER function with no search_path — '
  'so assertion 4''s green means "none exist", not "the predicate is broken"'
);

drop function public._selftest_definer_without_search_path();

-- 7 — and the schema is clean again, so nothing leaks into the assertions below.
select is(
  (
    select count(*)::int
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '\_selftest%'
  ),
  0,
  'SELF-TEST CLEANUP: no _selftest function survives into the rest of this file'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 8-9 — (d) audit_log is append-only at the GRANT level
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The strong form. A policy added by a careless migration in 2029 cannot re-open what has
-- been revoked here, so "not even the CEO can rewrite history from the app" is a privilege
-- fact rather than a policy convention (ARCHITECTURE.md §8, PRD US-I1).
--
-- service_role is in the list deliberately: it is the one client role that bypasses RLS
-- entirely, so for audit_log the GRANT is the ONLY thing standing in its way.
select is(
  (
    select coalesce(
      string_agg(format('%s:%s', g.grantee, g.privilege_type),
                 ', ' order by g.grantee, g.privilege_type),
      '')
    from information_schema.role_table_grants g
    where g.table_schema   = 'public'
      and g.table_name     = 'audit_log'
      and g.privilege_type in ('UPDATE', 'DELETE')
      and g.grantee        in ('authenticated', 'anon', 'service_role')
  ),
  '',
  '(d) audit_log grants neither UPDATE nor DELETE to authenticated, anon or service_role — '
  'append-only at the GRANT level, which no later policy can undo (offenders appear as the '
  'have-value)'
);

-- 9 — non-vacuity: the table and the role names in assertion 8 resolve to real objects. A
-- typo in either would make that query return zero rows and pass for the wrong reason.
select ok(
  has_table_privilege('authenticated', 'public.audit_log', 'SELECT'),
  'NON-VACUITY: authenticated DOES hold SELECT on audit_log (row visibility is cut by '
  'audit_log_read, exec_admin and tech_admin only) — so assertion 8''s table and role names '
  'are real'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-13 — (e) the sensitive-column registry describes the schema it actually has
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠ THE FAILURE THIS CATCHES IS SILENT AND TOTAL. sensitive_column_registry drives BOTH
--   mask_sensitive() (0011) and the five-year purge. A registry row naming a column that
--   was renamed or dropped stops masking that column out of every audit row AND stops
--   purging it at year five — and NOTHING ELSE IN THE SYSTEM NOTICES. There is no error, no
--   empty result and no log line; the PII simply starts accumulating in the append-only
--   table that was designed never to hold any (DATA_MODEL.md §8.3).

-- 10 — non-empty. An empty registry masks nothing and purges nothing, and every other
-- assertion here would pass.
select cmp_ok(
  (select count(*) from public.sensitive_column_registry),
  '>', 10::bigint,
  '(e) sensitive_column_registry is populated — an empty registry masks nothing and purges '
  'nothing while every structural assertion still passes'
);

-- 11 — every pair on a table that EXISTS names a real column.
--
-- pg_attribute rather than information_schema.columns, and the difference matters:
-- information_schema filters by the CURRENT user's privileges on each table, so a column
-- the test role cannot see would read as a column that does not exist and this assertion
-- would fail — or, worse, a future privilege change would make it fail for a reason that
-- has nothing to do with the registry. pg_attribute is the ground truth (same reasoning as
-- 046_applications_review_rls.sql's header).
select is(
  (
    select coalesce(
      string_agg(format('%s.%s', r.table_name, r.column_name),
                 ', ' order by r.table_name, r.column_name),
      '')
    from public.sensitive_column_registry r
    where to_regclass('public.' || quote_ident(r.table_name)) is not null
      and not exists (
        select 1
        from pg_attribute a
        where a.attrelid = to_regclass('public.' || quote_ident(r.table_name))
          and a.attname  = r.column_name
          and a.attnum   > 0
          and not a.attisdropped
      )
  ),
  '',
  '(e) every registry pair on an existing table names a real column — a renamed or dropped '
  'column silently stops being masked and stops being purged, with no error anywhere '
  '(offenders appear as the have-value)'
);

-- 12 — the ONE declared whitelist in this file, and it is a whitelist of tables that do not
-- exist YET rather than of rules that do not apply.
--
-- DATA_MODEL.md §8.1 classifies email_recipients.to_email and .merge — a FROZEN copy of
-- contact data at send time, which outlives the five-year purge on `people` unless it is
-- classified before the table exists. 0016 registers both deliberately, and 0010_email.sql
-- is reserved for v1.1 (BUILD_PLAN "Scope honesty"). Forward-registration is correct: the
-- alternative is a v1.1 migration that creates the table and forgets the registry, which is
-- exactly the silent failure assertion 11 exists to catch.
--
-- ⚠ WHEN 0010_email.sql LANDS, THIS ASSERTION GOES RED AND THE FIX IS TO EXPECT '' HERE.
--   That red is the point: it is the reminder that assertion 11 now covers those two
--   columns for real.
select is(
  (
    select coalesce(string_agg(distinct r.table_name, ', ' order by r.table_name), '')
    from public.sensitive_column_registry r
    where to_regclass('public.' || quote_ident(r.table_name)) is null
  ),
  'email_recipients',
  '(e) the only registry table that does not exist yet is email_recipients — a DECLARED '
  'v1.1 forward-registration (DATA_MODEL.md §8.1), not an unnoticed stale row. This goes '
  'red when 0010_email.sql lands, and the fix is to expect an empty string'
);

-- ── SELF-TEST for (e) ──────────────────────────────────────────────────────────────
-- Assertion 11 is a `string_agg(...) = ''` shape, which passes silently forever if the
-- predicate stops flagging anything. Register a column that does not exist on a table that
-- does, confirm it is named, remove it.
insert into public.sensitive_column_registry (table_name, column_name, rationale)
values ('people', 'selftest_no_such_column',
        'SELF-TEST row for 099. Rolled back with this transaction; never reaches a database.');

select is(
  (
    select coalesce(
      string_agg(format('%s.%s', r.table_name, r.column_name),
                 ', ' order by r.table_name, r.column_name),
      '')
    from public.sensitive_column_registry r
    where to_regclass('public.' || quote_ident(r.table_name)) is not null
      and not exists (
        select 1
        from pg_attribute a
        where a.attrelid = to_regclass('public.' || quote_ident(r.table_name))
          and a.attname  = r.column_name
          and a.attnum   > 0
          and not a.attisdropped
      )
  ),
  'people.selftest_no_such_column',
  'SELF-TEST: the (e) predicate DOES flag a registry row naming a column that does not '
  'exist — so assertion 11''s green means the registry is accurate, not that the check is '
  'broken'
);

delete from public.sensitive_column_registry
 where table_name = 'people' and column_name = 'selftest_no_such_column';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14-15 — (f) exactly four administrators, and they are the CBL's four
-- ═══════════════════════════════════════════════════════════════════════════════════
-- CBL Art. III §2 with the project-head decision of 2026-09-01: CEO, COO, CTO, CCDO and
-- nobody else. `admin_is_c_suite` (0003) is a CHECK, so a fifth administrator needs a
-- migration with a named author — but the CHECK constrains WHICH codes may be flagged, not
-- HOW MANY are. Both halves are asserted, because "exactly four" and "these four" are
-- different claims and each can fail without the other.
--
-- A fifth administrator fails CI, not code review.

select is(
  (select count(*)::int from public.officer_positions where is_administrator),
  4,
  '(f) EXACTLY four positions are administrators — CBL Art. III §2 read with the '
  'project-head decision of 2026-09-01. A fifth fails CI, not code review'
);

select set_eq(
  $$ select code from public.officer_positions where is_administrator $$,
  ARRAY['CEO', 'COO', 'CTO', 'CCDO']::text[],
  '(f) and they are CEO, COO, CTO and CCDO — the four the CBL''s own department heads make '
  'them, asserted as a SET so a swap is caught as well as a count'
);


select * from finish();

rollback;
