-- ═══════════════════════════════════════════════════════════════════════════════════
-- 003_terms_invariants.sql
--
-- The term is the load-bearing scoping decision in the whole system, and every guard
-- below is a DATABASE invariant rather than an application convention — which is the
-- only reason "exactly one active term" survives a panicked psql session at 2am during
-- rollover, at maximum officer turnover.
--
--   1  current_term_id() is NULL when no term is active
--   2  current_term_id() returns the active term
--   3  a second active term is refused           23505  (one_active_term partial unique index)
--   4  a term ending outside May is refused      23514  (CBL Art. V §1 — unconstitutional, not a typo)
--   5  a term not spanning the succeeding year   23514  (CBL Art. V §1, "of the succeeding year")
--   6  a term whose ends_on does not follow its starts_on  23514
--   7  writing to an ARCHIVED term is refused    42501  (reject_write_to_archived_term)
--
-- PRD §3 v1.0 item 4; PRD US-H1, US-H2, US-H3; DATA_MODEL.md §7.5.
--
-- ⚠ THE LIVE AUDIT-FIRING ASSERTIONS ARE NOT HERE. No audit trigger exists until
-- 0012_functions.sql attaches them; those assertions belong to 017_audit_triggers.sql
-- (BUILD_PLAN S2-T9). This file must stay green with only 0001–0011 applied AND after
-- 0012 and 0016 land, with no edit.
--
-- Labels are deliberately in the 2090s so this file never collides with the bootstrap
-- term seeded by 0016_seed.sql, and any already-active term is archived in-transaction
-- first so assertion 1 is meaningful whether or not a seed has run. Everything is rolled
-- back; `supabase test db` wraps each file in a transaction.
--
-- Note on assertions 5 and 6: term_spans_succeeding_year makes term_dates_ordered
-- unreachable in isolation (a May date in year Y+1 is always after any date in year Y),
-- so case 6 trips both CHECKs. Both are 23514, and the errcode is what is asserted.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(7);

-- Neutralise any seeded active term so assertion 1 tests the function, not the fixture.
-- Safe: reject_write_to_archived_term() is deliberately NOT attached to `terms` itself.
update public.terms set status = 'archived', archived_at = now() where status = 'active';

-- ── 1 ──────────────────────────────────────────────────────────────────────────────
select is(
  public.current_term_id(),
  null::uuid,
  'current_term_id() returns NULL when no term is active'
);

insert into public.terms (label, starts_on, ends_on, status)
values ('2090-2091', date '2090-06-01', date '2091-05-31', 'active');

-- ── 2 ──────────────────────────────────────────────────────────────────────────────
select is(
  public.current_term_id(),
  (select id from public.terms where label = '2090-2091'),
  'current_term_id() returns the single active term'
);

-- ── 3 ──────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.terms (label, starts_on, ends_on, status)
     values ('2091-2092', date '2091-06-01', date '2092-05-31', 'active') $$,
  '23505'::char(5),
  null::text,
  'a second active term is refused by the one_active_term unique index (23505)'
);

-- ── 4 ── CBL Art. V §1: the term ends in May. ──────────────────────────────────────
select throws_ok(
  $$ insert into public.terms (label, starts_on, ends_on, status)
     values ('2092-2093', date '2092-06-01', date '2093-07-31', 'draft') $$,
  '23514'::char(5),
  null::text,
  'a term ending in July is refused by term_ends_in_may (23514) — CBL Art. V §1'
);

-- ── 5 ── CBL Art. V §1: "of the succeeding year". ─────────────────────────────────
select throws_ok(
  $$ insert into public.terms (label, starts_on, ends_on, status)
     values ('2093-2095', date '2093-06-01', date '2095-05-31', 'draft') $$,
  '23514'::char(5),
  null::text,
  'a two-year term is refused by term_spans_succeeding_year (23514) — CBL Art. V §1'
);

-- ── 6 ──────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.terms (label, starts_on, ends_on, status)
     values ('2095-2095', date '2095-06-01', date '2095-05-31', 'draft') $$,
  '23514'::char(5),
  null::text,
  'a term whose ends_on does not follow its starts_on is refused (23514)'
);

-- ── 7 ── An archived term is read-only for EVERY role, including exec_admin. ──────
insert into public.terms (label, starts_on, ends_on, status, archived_at)
values ('2096-2097', date '2096-06-01', date '2097-05-31', 'archived', now());

select throws_ok(
  $$ insert into public.term_summaries (term_id, counts)
     select id, '{"total": 0}'::jsonb from public.terms where label = '2096-2097' $$,
  '42501'::char(5),
  null::text,
  'writing a term_summaries row for an archived term is refused (42501) — DATA_MODEL §7.3'
);

select * from finish();

rollback;
