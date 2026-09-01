-- ═══════════════════════════════════════════════════════════════════════════════════
-- 004_meta_selftest.sql — THE TEST THAT GUARDS THE GUARD.
--
-- 001_meta_force_rls.sql was observed failing by hand on 2026-09-01, against a scratch
-- unprotected table. That proves the predicate worked ON THAT DAY. It does nothing for
-- the predicate that exists in 2029, after someone has "simplified" it — and a weakened
-- predicate is invisible, because every real table in the schema is compliant, so 001
-- stays green while protecting nothing.
--
-- So the red path is encoded as a permanent, self-cleaning self-test: three scratch
-- tables are created inside the rolled-back transaction and the predicate is run against
-- them.
--
--   1  a table with NO row security at all is flagged
--   2  a table with ENABLE but NOT FORCE is flagged
--      ↑ the case that matters most: a table owner BYPASSES non-forced RLS and the
--        Supabase migration role IS the owner, so this is the half-protection a tired
--        officer actually ships, and it looks correct in the dashboard
--   3  a table with BOTH flags is NOT flagged
--      ↑ so the predicate cannot pass assertions 1 and 2 by simply flagging everything
--
-- If someone deletes the relforcerowsecurity term from the shared predicate, THIS file
-- goes red on assertion 2 while 001 stays green. That asymmetry is the whole point.
--
-- ⚠ The predicate below is mirrored from 001_meta_force_rls.sql. Keep the two identical.
-- BUILD_PLAN S1-T16.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(3);

create table public._meta_selftest_none (
  id uuid primary key default gen_random_uuid()
);

create table public._meta_selftest_enabled_not_forced (
  id uuid primary key default gen_random_uuid()
);
alter table public._meta_selftest_enabled_not_forced enable row level security;
-- deliberately NOT forced

create table public._meta_selftest_both (
  id uuid primary key default gen_random_uuid()
);
alter table public._meta_selftest_both enable row level security;
alter table public._meta_selftest_both force  row level security;

-- The shared predicate, verbatim from 001_meta_force_rls.sql.
create temporary table meta_selftest_flagged as
select c.relname::text as relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not exists (
    select 1 from pg_depend d
    where d.objid = c.oid and d.deptype = 'e'
  )
  and not (c.relrowsecurity and c.relforcerowsecurity);

select ok(
  exists (select 1 from meta_selftest_flagged where relname = '_meta_selftest_none'),
  'the FORCE-RLS predicate flags a table with no row security at all'
);

select ok(
  exists (select 1 from meta_selftest_flagged where relname = '_meta_selftest_enabled_not_forced'),
  'the FORCE-RLS predicate flags a table with ENABLE but not FORCE (the owner-bypass case)'
);

select ok(
  not exists (select 1 from meta_selftest_flagged where relname = '_meta_selftest_both'),
  'the FORCE-RLS predicate does NOT flag a table with both ENABLE and FORCE'
);

select * from finish();

-- Rollback drops all three scratch tables and the temp table. Nothing survives the run.
rollback;
