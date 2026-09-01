-- ═══════════════════════════════════════════════════════════════════════════════════
-- 066_dashboard_view_columns.sql  —  no read surface may carry a sensitive column, ever
--
-- WHAT:
--    1-4    the EXACT column set of each of the four read surfaces
--    5-8    ★ the intersection of each view's columns with sensitive_column_registry is
--           EMPTY — data-driven, so a column classified in 2029 is checked on the next run
--    9-12   `security_invoker=true` is present in reloptions
--   13-16   `security_barrier=true` is present in reloptions
--   17-20   anon holds NO SELECT privilege on any of them
--   21-24   authenticated DOES (the positive half — a privilege test that only ever asserts
--           absence passes just as well against a view that does not exist)
--   25-27   the three new aggregates are VIEWS, not tables
--
-- WHY:  PRD US-J1 ("restriction is enforced at the data layer, not by omitting a column from
--   a page"), US-D2 (the officer view excludes sensitive personal data), US-A1, and PRD §6
--   Success Metric 8 ("0 sensitive fields returned to Officer or RR tiers"). CBL Art. VIII §6
--   makes RA 10173 a constitutional obligation, and Art. VIII §7.1.4 designates "private
--   member data" confidential. BUILD_PLAN S6-T4. ADR 0007.
--
-- ⚠ WHY 5-8 ARE DATA-DRIVEN AND NOT A HAND-KEPT LIST. A test that enumerated the ten
--   sensitive `people` columns inline would be correct on the day it was written and would
--   quietly stop protecting the eleventh. `sensitive_column_registry` is the RA 10173
--   classification AS DATA (DATA_MODEL.md §8.1) and it already drives two other mechanisms —
--   mask_sensitive() before an audit write, and redact_expired_pii() at the five-year mark.
--   Making it drive this assertion too means **classifying a column is the single act that
--   protects it everywhere**, which is CONVENTIONS.md §13 rule 4 turned into a CI failure.
--
-- ⚠ THE JOIN IS ON column_name ALONE, NOT ON (table_name, column_name), AND THAT IS
--   DELIBERATE. A sensitive column name is sensitive wherever it surfaces: a view that
--   re-exposed `birthdate` or `contact_number` under a different parent would still be a
--   leak, and scoping the join to the registry's own table_name would let exactly that
--   through. The cost is a possible false positive on a generic name (`payload`, `merge`) —
--   which produces a conversation, whereas the false negative produces a breach.
--
-- ⚠ WHY 9-16 READ pg_class.reloptions RATHER THAN TRUSTING THE MIGRATION. `security_invoker`
--   is the entire scoping story for the three aggregates (ADR 0007), and it fails SILENTLY:
--   dropped, the views compute as their BYPASSRLS owner and a regional rep sees org-wide
--   totals with no error anywhere. 065 catches that behaviourally; these four catch it
--   structurally, on every run, without needing fixture data. Two independent detectors for
--   one silent failure is proportionate.
--
-- ⚠ 25-27 EXIST TO DOCUMENT WHAT IS *NOT* BEING CIRCUMVENTED. 001_meta_force_rls.sql
--   enumerates `relkind = 'r'` and requires ENABLE + FORCE ROW LEVEL SECURITY on every one.
--   These three objects are views, so they are outside that scan by construction — not
--   exempted from it. A view cannot carry RLS of its own; it carries the RLS of the tables
--   beneath it, which is precisely what `security_invoker` arranges. Asserting relkind here
--   means that if one of them were ever rewritten as a materialized view or a table, this
--   file says so rather than the meta-test silently gaining a new unprotected relation.
--
-- ⚠ THIS FILE NEEDS NO FIXTURE DATA. Every assertion is a catalog fact, which is why it is
--   the cheapest suite in the slice to run and the one most likely to still be meaningful in
--   2029. helpers/auth.psql is included only for the temp-schema grant that keeps the file's
--   shape identical to its neighbours.
--
-- CITATION:  BUILD_PLAN S6-T1, S6-T4; ADR 0007; ADR 0006; ARCHITECTURE.md §5, §8;
--            DATA_MODEL.md §6/0013, §8.1, §9, §13 rule 4; CONVENTIONS.md §13 rule 4;
--            PRD US-A1, US-D2, US-J1; PRD §6 Success Metric 8; CBL Art. VIII §6, §7.1.4.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql

select plan(27);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-4 — the exact column set of every read surface
--
-- columns_are() fails on an EXTRA column as well as a missing one, which is the direction
-- that matters: adding `contact_number` to a dashboard view to make a screen work fails here
-- before it reaches a screen. Widening one of these is never the fix — if a surface "needs"
-- a sensitive field, the answer is that this tier does not get it (PRD OQ-6, default no).
-- ═══════════════════════════════════════════════════════════════════════════════════

-- `::name` and `::name[]` are required, not stylistic: pgTAP declares
-- columns_are(NAME, NAME, NAME[], TEXT) and a bare text[] literal will not resolve to it.
-- Same form 018_v_member_directory.sql uses.
select columns_are(
  'public'::name,
  'v_membership_status_counts'::name,
  array['term_id', 'status', 'member_count']::name[],
  'v_membership_status_counts exposes exactly 3 columns and no more'
);

select columns_are(
  'public'::name,
  'v_membership_region_counts'::name,
  array[
    'term_id',
    'region_id',
    'region_code',
    'region_name',
    'island_group',
    'sort_order',
    'member_count'
  ]::name[],
  'v_membership_region_counts exposes exactly 7 columns — the region render set plus the '
  'id a tile links through on, and nothing from public.people'
);

select columns_are(
  'public'::name,
  'v_membership_committee_counts'::name,
  array[
    'term_id',
    'committee_id',
    'committee_code',
    'committee_name',
    'member_count'
  ]::name[],
  'v_membership_committee_counts exposes exactly 5 columns'
);

-- Re-asserted here alongside the three new views rather than left to 018, so that ONE file
-- answers "what can a read surface show?" for the whole slice. 018 owns the same list — and
-- the same reloptions, anon and registry-intersection assertions — for its own reasons.
-- The overlap is cheap, and the day the two disagree the diff says which one moved.
select columns_are(
  'public'::name,
  'v_member_directory'::name,
  array[
    'membership_id',
    'person_id',
    'member_id',
    'given_name',
    'family_name',
    'join_year',
    'term_id',
    'status',
    'year_level',
    'region_name',
    'island_group',
    'committee_name',
    'department_name'
  ]::name[],
  'v_member_directory still exposes exactly its 13 non-sensitive columns (PRD US-D2)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5-8 — ★ NO READ SURFACE SHARES A COLUMN NAME WITH sensitive_column_registry ★
--
-- The headline assertions of this file. Driven by the registry, so classifying a column is
-- what protects it — here, in the audit log, and at the five-year purge, all at once.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int
     from information_schema.columns c
     join public.sensitive_column_registry s on s.column_name = c.column_name
    where c.table_schema = 'public' and c.table_name = 'v_membership_status_counts'),
  0,
  'v_membership_status_counts shares NO column name with sensitive_column_registry '
  '(RA 10173 / CBL Art. VIII §6)'
);

select is(
  (select count(*)::int
     from information_schema.columns c
     join public.sensitive_column_registry s on s.column_name = c.column_name
    where c.table_schema = 'public' and c.table_name = 'v_membership_region_counts'),
  0,
  'v_membership_region_counts shares NO column name with sensitive_column_registry'
);

select is(
  (select count(*)::int
     from information_schema.columns c
     join public.sensitive_column_registry s on s.column_name = c.column_name
    where c.table_schema = 'public' and c.table_name = 'v_membership_committee_counts'),
  0,
  'v_membership_committee_counts shares NO column name with sensitive_column_registry'
);

select is(
  (select count(*)::int
     from information_schema.columns c
     join public.sensitive_column_registry s on s.column_name = c.column_name
    where c.table_schema = 'public' and c.table_name = 'v_member_directory'),
  0,
  'v_member_directory shares NO column name with sensitive_column_registry — PRD Success '
  'Metric 8, "0 sensitive fields returned to Officer or RR tiers"'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-12 — security_invoker = true, read out of the catalog
--
-- Without it the view executes as its owner, which holds BYPASSRLS, and every scoping
-- guarantee in 065 evaporates WITH NO ERROR ANYWHERE. This is the single clause the whole
-- dashboard authorization model rests on.
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(
  (select 'security_invoker=true' = any (c.reloptions)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_membership_status_counts'),
  'v_membership_status_counts is security_invoker = true — scoping is INHERITED from '
  'memberships_read, never restated (ADR 0007)'
);

select ok(
  (select 'security_invoker=true' = any (c.reloptions)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_membership_region_counts'),
  'v_membership_region_counts is security_invoker = true'
);

select ok(
  (select 'security_invoker=true' = any (c.reloptions)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_membership_committee_counts'),
  'v_membership_committee_counts is security_invoker = true'
);

select ok(
  (select 'security_invoker=true' = any (c.reloptions)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_member_directory'),
  'v_member_directory is still security_invoker = true'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-16 — security_barrier = true
--
-- Stops a caller pushing a cheap, leaky function into a WHERE clause and having the planner
-- evaluate it BEFORE the view's own qualifiers — the classic way to read rows through a
-- restricting view one error message at a time.
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(
  (select 'security_barrier=true' = any (c.reloptions)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_membership_status_counts'),
  'v_membership_status_counts is security_barrier = true'
);

select ok(
  (select 'security_barrier=true' = any (c.reloptions)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_membership_region_counts'),
  'v_membership_region_counts is security_barrier = true'
);

select ok(
  (select 'security_barrier=true' = any (c.reloptions)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_membership_committee_counts'),
  'v_membership_committee_counts is security_barrier = true'
);

select ok(
  (select 'security_barrier=true' = any (c.reloptions)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_member_directory'),
  'v_member_directory is still security_barrier = true'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 17-20 — anon holds NO SELECT privilege on any read surface
--
-- PRD US-A1: no organizational record reaches an unauthenticated caller. A headcount IS an
-- organizational record. Supabase's default privileges grant ALL on new objects in `public`
-- to anon, so each of these is only false because 0032 and 0013 explicitly revoke it — the
-- absence is a written statement, not an accident, and this is what proves it stayed written.
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(
  not has_table_privilege('anon', 'public.v_membership_status_counts', 'SELECT'),
  'anon has NO SELECT on v_membership_status_counts (PRD US-A1)'
);

select ok(
  not has_table_privilege('anon', 'public.v_membership_region_counts', 'SELECT'),
  'anon has NO SELECT on v_membership_region_counts'
);

select ok(
  not has_table_privilege('anon', 'public.v_membership_committee_counts', 'SELECT'),
  'anon has NO SELECT on v_membership_committee_counts'
);

select ok(
  not has_table_privilege('anon', 'public.v_member_directory', 'SELECT'),
  'anon has NO SELECT on v_member_directory'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 21-24 — authenticated DOES hold SELECT
--
-- The positive half, and it is not ceremony: a privilege suite that only ever asserts ABSENCE
-- passes identically against a view that was dropped, renamed or never created. These four
-- are what make 17-20 mean "revoked from anon" instead of "not there".
--
-- Granting SELECT to `authenticated` is not a widening. security_invoker means the caller
-- still needs their own privileges on memberships/regions/committees and still faces every
-- policy on them, so this ONE grant yields org-wide totals for an officer, one region for a
-- rep and nothing at all for tech_admin.
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(
  has_table_privilege('authenticated', 'public.v_membership_status_counts', 'SELECT'),
  'authenticated HAS SELECT on v_membership_status_counts — the row set is then decided by '
  'memberships_read, not by this grant'
);

select ok(
  has_table_privilege('authenticated', 'public.v_membership_region_counts', 'SELECT'),
  'authenticated HAS SELECT on v_membership_region_counts'
);

select ok(
  has_table_privilege('authenticated', 'public.v_membership_committee_counts', 'SELECT'),
  'authenticated HAS SELECT on v_membership_committee_counts'
);

select ok(
  has_table_privilege('authenticated', 'public.v_member_directory', 'SELECT'),
  'authenticated HAS SELECT on v_member_directory'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 25-27 — the three aggregates are VIEWS ('v'), not tables and not matviews
--
-- Documents what is not being circumvented (see the header). A materialized view would be
-- the dangerous rewrite: it cannot carry RLS at all — it is computed once, by its owner, and
-- every caller reads the same pre-computed rows, which would hand a regional rep org-wide
-- totals BY CONSTRUCTION. relkind 'm' would pass 065 the moment the matview was refreshed by
-- an admin, so it needs its own detector here.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_membership_status_counts'),
  'v',
  'v_membership_status_counts is a plain VIEW — a matview cannot carry RLS and would leak '
  'org-wide totals to a regional rep by construction'
);

select is(
  (select c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_membership_region_counts'),
  'v',
  'v_membership_region_counts is a plain VIEW'
);

select is(
  (select c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_membership_committee_counts'),
  'v',
  'v_membership_committee_counts is a plain VIEW'
);


select * from finish();

rollback;
