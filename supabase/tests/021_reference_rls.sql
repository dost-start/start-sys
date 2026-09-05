-- ═══════════════════════════════════════════════════════════════════════════════════
-- 021_reference_rls.sql  —  §1 of 0014: reference data and the audit log
--
-- WHAT:
--    1-4   the ANONYMOUS surface, enumerated exactly: 18 regions, 23 officer_positions,
--          0 sensitive_column_registry, 0 audit_log
--    5-8   POSITIVE CONTROLS — exec_admin and tech_admin see both restricted tables
--    9-20  the six other authenticated tiers see ZERO of each, asserted per role
--   21-25  the write boundary: only tech_admin may add a region, and an UPDATE fails
--          silently while an INSERT raises
--
-- WHY 1-2 ARE THE ONLY TWO ANONYMOUS READS IN THE SCHEMA. PRD US-B1: the public
--   application form is "reachable without an account", and its region dropdown has to
--   render for someone who has none. `regions` and `officer_positions` are the only tables
--   anon may read in full (`terms` and `application_windows` are narrowed by their own anon
--   policies — 023). **Widening that pair is how the public surface leaks**, and 0014's §1
--   header requires any addition to arrive with a pgTAP assertion in the same PR. This file
--   is where that assertion goes.
--
-- WHY 3-4 AND 9-20 ARE THE OTHER HALF. sensitive_column_registry is a MAP OF EXACTLY WHERE
--   THE PII IS — useful to an auditor and useful to an attacker — so it is read-restricted
--   to exec_admin and tech_admin. audit_log is restricted to the same two by PRD US-I1
--   ("the log is readable only by Executive and Technical Admins"), and note who is
--   excluded and that it is deliberate: crrd_admin and crrd_deputy are the tier whose reads
--   and writes this log records, so giving them the log would let the watched read the
--   watcher.
--
-- ⚠ POSITIVE CONTROLS BEFORE DENIALS (5-8). A malformed claim makes auth.uid() NULL, which
--   makes auth_role() NULL, which makes every policy return zero rows — and a deny
--   assertion written as "sees 0 rows" then passes for the WRONG REASON. 5-8 establish that
--   the two admitted roles genuinely see rows before the twelve zeroes are trusted.
--
-- ⚠ AN INSERT REFUSED BY RLS *RAISES*; AN UPDATE REFUSED BY RLS AFFECTS ZERO ROWS. That
--   asymmetry is Postgres, not this schema, and it is why assertions 21-24 use throws_ok
--   while 25 counts rows. A WITH CHECK violation on INSERT is reported as 42501; an UPDATE
--   whose USING clause excludes every row simply matches nothing and returns quietly.
--   BUILD_PLAN S2-T15 phrases the crrd_admin case as "affects 0 rows"; for INSERT that is
--   not what Postgres does, and this file asserts the real behaviour. Assertion 25 exists
--   so both halves of the asymmetry are visible in one place rather than being rediscovered.
--
-- CITATION:  BUILD_PLAN S2-T15; ARCHITECTURE.md §5; DATA_MODEL.md §6/0014, §8.1, §8.3;
--            PRD §3 v1.0 items 3, 5, 16; PRD US-A1, US-B1, US-E3, US-I1, US-G2;
--            CBL Art. III §2/§3/§4.6/§5 (the 23 positions), Art. XII (amendment),
--            Art. VIII §6 (RA 10173); RA 12000 (2024) — the Negros Island Region.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(25);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-4 — the anonymous surface, enumerated
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_anon();

-- 1 — 18, not 17. RA 12000 (2024) carved the Negros Island Region out of Western and
-- Central Visayas. Asserted as an exact count so a seed that silently loses or duplicates
-- a region fails here rather than in an applicant's dropdown.
select is(
  (select count(*)::int from public.regions),
  18,
  'anon reads exactly 18 regions — the public application form''s dropdown (PRD US-B1; '
  'RA 12000 (2024) makes it 18, not 17)'
);

-- 2 — the Constitution as data. Readable by anon for the same reason as regions: the
-- public surface may name a position, and the 23 titles are published in the CBL itself.
select is(
  (select count(*)::int from public.officer_positions),
  23,
  'anon reads exactly 23 officer_positions — CBL Art. III §2 (9), §3 (12), §4.6 (1), §5 (1)'
);

-- 3-4 — anon holds a SELECT privilege on both of these by Supabase default (0011 revokes
-- only UPDATE and DELETE on audit_log; 0015 revokes only DELETE broadly), so what returns
-- zero rows here is the MISSING ANON POLICY, not a missing grant. That is the deny-by-
-- default design working: with FORCE RLS on and no policy for the role, Postgres returns
-- an empty set.
select is(
  (select count(*)::int from public.sensitive_column_registry),
  0,
  'anon reads 0 sensitive_column_registry rows — the map of where the PII lives is not '
  'part of any public surface'
);

select is(
  (select count(*)::int from public.audit_log),
  0,
  'anon reads 0 audit_log rows — PRD US-A1: no organizational record reaches an '
  'unauthenticated caller'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5-8 — POSITIVE CONTROLS: the two roles that DO see the restricted pair
-- ═══════════════════════════════════════════════════════════════════════════════════
-- cmp_ok '>' rather than an exact count, deliberately: the registry grows with every
-- migration that classifies a column, and audit_log's height depends on how many rows the
-- fixture wrote. What matters here is non-empty — the exact-count discipline belongs on the
-- DENIALS below, where zero is the whole assertion.

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin

select cmp_ok(
  (select count(*)::int from public.sensitive_column_registry), '>', 0,
  'exec_admin reads sensitive_column_registry — POSITIVE CONTROL for assertions 9-20'
);

select cmp_ok(
  (select count(*)::int from public.audit_log), '>', 0,
  'exec_admin reads audit_log — PRD US-I1, and the POSITIVE CONTROL for the twelve zeroes'
);

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin

select cmp_ok(
  (select count(*)::int from public.sensitive_column_registry), '>', 0,
  'tech_admin reads sensitive_column_registry — the second admitted role, so 5 cannot be '
  'satisfied by a policy that happens to admit one hardcoded account'
);

select cmp_ok(
  (select count(*)::int from public.audit_log), '>', 0,
  'tech_admin reads audit_log — PRD US-I1'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-20 — the six other tiers see neither table
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Six roles x two tables, asserted individually so a failure names the role that gained
-- access rather than reporting that a total moved. crrd_admin and crrd_deputy are the two
-- that matter most: they are the operational heart of the system and the tier whose every
-- sensitive read this log records.

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is((select count(*)::int from public.sensitive_column_registry), 0,
  'crrd_admin reads 0 sensitive_column_registry rows');
select is((select count(*)::int from public.audit_log), 0,
  'crrd_admin reads 0 audit_log rows — the watched does not read the watcher (PRD US-I1)');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select is((select count(*)::int from public.sensitive_column_registry), 0,
  'crrd_deputy reads 0 sensitive_column_registry rows');
select is((select count(*)::int from public.audit_log), 0,
  'crrd_deputy reads 0 audit_log rows');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is((select count(*)::int from public.sensitive_column_registry), 0,
  'officer reads 0 sensitive_column_registry rows');
select is((select count(*)::int from public.audit_log), 0,
  'officer reads 0 audit_log rows');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is((select count(*)::int from public.sensitive_column_registry), 0,
  'regional_rep_a reads 0 sensitive_column_registry rows');
select is((select count(*)::int from public.audit_log), 0,
  'regional_rep_a reads 0 audit_log rows');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select is((select count(*)::int from public.sensitive_column_registry), 0,
  'regional_rep_b reads 0 sensitive_column_registry rows');
select is((select count(*)::int from public.audit_log), 0,
  'regional_rep_b reads 0 audit_log rows');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is((select count(*)::int from public.sensitive_column_registry), 0,
  'member reads 0 sensitive_column_registry rows');
select is((select count(*)::int from public.audit_log), 0,
  'member reads 0 audit_log rows — a member reaches no organizational record at all');
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 21-25 — the write boundary on reference data
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Run last, because assertion 24 actually inserts a nineteenth region and would move every
-- count above. PRD US-E3 / ARCHITECTURE.md §5: reference data is system configuration,
-- which is the Technical Admin's. A nineteenth region is a tech_admin write, never a CRRD
-- click — and note that regions_insert does NOT carry the aal2 predicate that terms and
-- user_roles do, which is why assertion 24 uses the default aal2 login without relying on it.

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok(
  $$ insert into public.regions (code, name, island_group, sort_order)
     values ('ZZ_CRRD', 'Fixture Region (crrd attempt)', 'Luzon', 991) $$,
  '42501'::char(5),
  null::text,
  'crrd_admin cannot insert a region — the WITH CHECK violation RAISES 42501 (PRD US-E3)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ insert into public.regions (code, name, island_group, sort_order)
     values ('ZZ_OFCR', 'Fixture Region (officer attempt)', 'Luzon', 992) $$,
  '42501'::char(5),
  null::text,
  'officer cannot insert a region — no policy in the whole schema names `officer` for a '
  'write, and PRD US-D2''s "view-only" is that absence (Success Metric 8)'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ insert into public.regions (code, name, island_group, sort_order)
     values ('ZZ_ANON', 'Fixture Region (anon attempt)', 'Luzon', 993) $$,
  '42501'::char(5),
  null::text,
  'anon cannot insert a region — anon holds a default INSERT privilege on the table, so '
  'what refuses this is the MISSING ANON POLICY (deny by default, PRD US-A1)'
);
select pg_temp.logout();

-- 24 — and the one role that can. Asserted with lives_ok rather than inferred from the
-- three refusals: without it, a policy that refused EVERYONE would satisfy 21-23 and break
-- the org's ability to record a constitutional amendment (CBL Art. XII).
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select lives_ok(
  $$ insert into public.regions (code, name, island_group, sort_order)
     values ('ZZ_TECH', 'Fixture Region (tech_admin)', 'Luzon', 994) $$,
  'tech_admin CAN insert a region — reference data is system configuration (PRD US-E3), '
  'and a nineteenth region lands as a tech_admin write rather than a deploy'
);
select pg_temp.logout();

-- 25 — the other half of the INSERT/UPDATE asymmetry (see the ⚠ note in the header). The
-- USING clause of regions_update admits only tech_admin, so as crrd_admin no row is even
-- VISIBLE to the update: it matches nothing and returns quietly. This is the shape a
-- careless test writes as `lives_ok` and reads as success — asserting the affected-row
-- count is what makes the refusal measurable.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

with u as (
  update public.regions set sort_order = sort_order where code = 'NCR' returning 1
)
select is(
  count(*)::int,
  0,
  'crrd_admin''s UPDATE on regions affects ZERO rows — an RLS-refused UPDATE fails '
  'SILENTLY while an RLS-refused INSERT raises, and both halves are asserted here'
) from u;

select pg_temp.logout();


select * from finish();

rollback;
