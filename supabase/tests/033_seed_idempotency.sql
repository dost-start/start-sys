-- ═══════════════════════════════════════════════════════════════════════════════════
-- 033_seed_idempotency.sql  —  BUILD_PLAN S2-T13
--
-- 0016_seed.sql is the Constitution as data. It is also the file most likely to be re-run
-- by accident — on a `db reset`, in a restore drill (BUILD_PLAN S7-T16), or deliberately
-- when an Art. XII amendment lands as a corrected seed. So "running it twice changes
-- nothing" is not a nicety: a seed that duplicates rows on re-run turns a routine restore
-- into a corrupted org chart, and a seed that FAILS on re-run turns it into a dead restore.
--
-- The file therefore does the only honest version of this test: it captures every count,
-- **executes the real 0016_seed.sql a second time via \ir**, and re-checks every count.
-- Not a paraphrase of the seed, not a hand-copied subset — the actual file, so a future
-- edit to the seed is covered by this test the day it is written.
--
--    1-8   the counts and sets before
--          ...then the seed runs a SECOND time. There is no assertion for the run itself:
--          a failure aborts the file, which is a stronger statement than any lives_ok.
--    9-16  every count again, unchanged
--   17     the seven departments AND their Chiefs, as a set — a count alone would not
--          catch a swapped head_position
--   18     the audit_log grew by ZERO rows, i.e. nothing was actually written
--
-- ⚠ NO FIXTURES ARE LOADED. test-helpers/fixtures.sql adds a second term and a committee,
--   which would make assertions 4 and 6 read 2 and 1 and quietly turn this file into a test
--   of the fixture rather than of the seed. What is asserted here is the state of a freshly
--   migrated database and nothing else.
--
-- ⚠ THE THREE IDEMPOTENCY STRATEGIES IN 0016 ARE DIFFERENT ON PURPOSE, and assertion 18 is
--   what tells them apart from "it happened to not crash":
--     regions / registry / departments  ON CONFLICT DO NOTHING — settled content, must not
--                                       churn.
--     officer_positions                 ON CONFLICT DO UPDATE — an Art. XII amendment that
--                                       renames a position lands as a re-run, and DO
--                                       NOTHING would silently ignore the amendment.
--     terms                             INSERT ... WHERE NOT EXISTS — ON CONFLICT (label)
--                                       would not protect anything, because the constraint
--                                       that actually bites is the one_active_term PARTIAL
--                                       unique index. A seed that can fail on re-run is not
--                                       idempotent.
--
-- CITATION:  BUILD_PLAN S2-T13, S7-T16; DATA_MODEL.md §6/0016, §9; ARCHITECTURE.md §4.3;
--            PRD §3 v1.0 items 3, 4; PRD US-E2, US-H2, US-K1;
--            CBL Art. III §2, §3, §4, §4.6, §5; Art. V §1; Art. XII; RA 12000 (2024).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(18);


-- audit_log's delta is the assertion that separates "the seed re-ran harmlessly" from "the
-- seed re-ran and quietly rewrote rows". `terms` carries trg_terms_audit, so a bootstrap
-- term inserted a second time would show up here even if a count elsewhere happened to
-- stay right.
create temp table fx_audit_before as
  select count(*)::int as n from public.audit_log;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-8 — BEFORE
-- ═══════════════════════════════════════════════════════════════════════════════════

select is((select count(*)::int from public.regions), 18,
  'BEFORE: 18 regions — RA 12000 (2024) created the Negros Island Region, so it is 18 and not 17');

select is((select count(*)::int from public.officer_positions), 23,
  'BEFORE: 23 officer positions — CBL Art. III §2 (9), §3 (12), §4.6 (1), §5 (1)');

select is((select count(*)::int from public.officer_positions where is_administrator), 4,
  'BEFORE: exactly 4 administrators — CEO, COO, CTO, CCDO and nobody else');

select is((select count(*)::int from public.terms), 1,
  'BEFORE: exactly 1 term exists — the bootstrap term, and no fixture term (this file loads no fixtures)');

select is((select count(*)::int from public.terms where status = 'active'), 1,
  'BEFORE: exactly 1 ACTIVE term — the one_active_term partial unique index');

select is(
  (select count(*)::int from public.departments
    where term_id = (select id from public.terms where status = 'active')),
  7,
  'BEFORE: the active term has exactly 7 departments — CBL Art. III §4');

select is((select count(*)::int from public.committees), 0,
  'BEFORE: ZERO committees — CBL Art. III §5 makes them discretionary and per-term, so the seed deliberately creates none');

select is((select count(*)::int from public.sensitive_column_registry), 17,
  'BEFORE: 17 sensitive_column_registry rows — the RA 10173 classification, as data (CBL Art. VIII §6)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- RUN THE REAL SEED A SECOND TIME
--
-- The actual migration file, not a copy. If any statement in it raises — a unique
-- violation on regions, a partial-index collision on terms, a FK failure on
-- departments.head_position — this file aborts here and the run reports the failure
-- directly. That abort IS the strongest form of the assertion, which is why there is no
-- separate `lives_ok` wrapper: wrapping it would swallow the error into a single failed
-- test and hide which statement actually broke.
-- ═══════════════════════════════════════════════════════════════════════════════════

\ir ../migrations/0016_seed.sql


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-18 — AFTER: every count and set unchanged
-- ═══════════════════════════════════════════════════════════════════════════════════

select is((select count(*)::int from public.regions), 18,
  'AFTER: still 18 regions — ON CONFLICT (code) DO NOTHING held');

select is((select count(*)::int from public.officer_positions), 23,
  'AFTER: still 23 officer positions — ON CONFLICT DO UPDATE re-applied the same values without adding rows');

select is((select count(*)::int from public.officer_positions where is_administrator), 4,
  'AFTER: still exactly 4 administrators — a re-run cannot create a fifth (and the admin_is_c_suite CHECK would refuse one anyway)');

select is((select count(*)::int from public.terms), 1,
  'AFTER: still exactly 1 term — block 4''s `INSERT ... WHERE NOT EXISTS` is a clean no-op once any term exists');

select is((select count(*)::int from public.terms where status = 'active'), 1,
  'AFTER: still exactly 1 ACTIVE term — the re-run did not collide with the one_active_term index, which is what ON CONFLICT (label) would have done');

select is(
  (select count(*)::int from public.departments
    where term_id = (select id from public.terms where status = 'active')),
  7,
  'AFTER: still exactly 7 departments on the active term — CBL Art. III §4 survives a re-run');

select is((select count(*)::int from public.committees), 0,
  'AFTER: still ZERO committees — the seed never creates one, so a re-run cannot resurrect a dissolved committee (CBL Art. III §5.4)');

select is((select count(*)::int from public.sensitive_column_registry), 17,
  'AFTER: still 17 registry rows — a duplicated classification would double every audit mask lookup');

select bag_eq(
  $$ select code, head_position from public.departments
      where term_id = (select id from public.terms where status = 'active') $$,
  $$ values ('EXEC','CEO'), ('TECH','CTO'), ('FIN','CFO'), ('MKTG','CMO'),
            ('COMMS','CCO'), ('CRRD','CCDO'), ('EVENTS','CEVO') $$,
  'AFTER: the seven departments and their Chiefs are UNCHANGED — CBL Art. III §4.1-§4.7; a count alone would not catch a swapped head_position');

select is(
  (select count(*)::int from public.audit_log) - (select n from fx_audit_before),
  0,
  'AFTER: the audit log grew by ZERO rows — the re-run wrote nothing at all, which is what "idempotent" has to mean rather than "did not crash"');


select * from finish();

rollback;
