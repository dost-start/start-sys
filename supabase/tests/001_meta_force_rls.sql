-- ═══════════════════════════════════════════════════════════════════════════════════
-- 001_meta_force_rls.sql — SUBSTRATE #1, written while there are zero tables.
--
-- The most important test in the repo. It enumerates pg_catalog rather than a
-- hand-maintained list, so A NEW TABLE SHIPPED UNPROTECTED IN 2029 CANNOT MERGE.
--
--   (a) every ordinary table in `public` has BOTH relrowsecurity AND relforcerowsecurity.
--       ENABLE alone is not enough: a table owner BYPASSES non-forced RLS, and the
--       Supabase migration role IS the owner. Half the protection reads as all of it.
--   (b) zero DELETE policies exist anywhere. Removal is a status change; term end is a
--       flag. Accidental mass deletion is structurally impossible, and the absence of a
--       policy is what makes that true (PRD Reliability NFR; CLAUDE.md banned patterns).
--
-- THERE IS NO EXCLUSION LIST. An exemption needs an ADR in docs/decisions/, not a WHERE
-- clause added at 1am. The only filter is `deptype <> 'e'`, which skips tables OWNED BY
-- AN EXTENSION (none of ours ever are) rather than exempting any table of ours.
--
-- Assertion (a)'s expected value is the empty string, so on failure pgTAP prints the
-- offending table names as the "have" value — actionable at 2am without a second query.
--
-- ⚠ THE PREDICATE BELOW IS MIRRORED IN 004_meta_selftest.sql, WHICH IS THE TEST THAT
-- PROVES THE PREDICATE STILL WORKS. Keep the two identical: if you weaken this one
-- (e.g. drop the relforcerowsecurity term), 004 is what goes red, because every real
-- table in the schema is compliant and this file would stay green.
--
-- Proven red by hand on 2026-09-01 — see docs/issues/2026-09-01-meta-test-proven-red.md.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(3);

-- (a) RLS is enabled AND forced on every table in public.
select is(
  (
    select coalesce(string_agg(c.relname::text, ', ' order by c.relname), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (
        select 1 from pg_depend d
        where d.objid = c.oid and d.deptype = 'e'   -- extension-owned, never ours
      )
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ),
  '',
  'every table in public has ENABLE and FORCE ROW LEVEL SECURITY (offenders appear as the have-value)'
);

-- (b) No DELETE policy exists anywhere. CLAUDE.md: "No DELETE policy exists anywhere in
--     the schema and none may be added."
select is(
  (
    select coalesce(
      string_agg(format('%s.%s', p.tablename, p.policyname), ', ' order by p.tablename, p.policyname),
      ''
    )
    from pg_policies p
    where p.schemaname = 'public'
      and p.cmd = 'DELETE'
  ),
  '',
  'no DELETE policy exists on any table in public (offenders appear as the have-value)'
);

-- (c) Non-vacuity guard. A catalog test over an empty schema passes for the wrong
--     reason; this fails loudly if migrations did not apply at all.
select ok(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  ) > 0,
  'the meta-test is not vacuous: at least one table exists in public'
);

select * from finish();

rollback;
