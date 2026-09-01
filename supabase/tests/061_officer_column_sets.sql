-- ═══════════════════════════════════════════════════════════════════════════════════
-- 061_officer_column_sets.sql  —  the column boundary RLS cannot draw
--
-- WHAT:
--   1-2     positive controls — an officer sees a known NON-ZERO number of rows
--   3-21    the EXACT visible column set on public.people, asserted COLUMN BY COLUMN over
--           the table's full 19-column list: six granted, thirteen withheld
--  22-23    the behavioural half — `select birthdate` AND `select *` both raise 42501
--    24     v_member_directory's exact 13-column list, against a literal array
--  25-30    the regional-rep battery: exact counts, the two policies' asymmetry, disjointness
--  31-34    neither read-only tier holds a write path anywhere
--    35     no UPDATE/DELETE/ALL policy anywhere in `public` names officer or regional_rep
--
-- WHY:  **RLS IS ROW-LEVEL AND CANNOT PROTECT A COLUMN.** A policy that lets an officer read
--   a `people` row does nothing whatsoever to stop `select birthdate from people` in the same
--   session. The boundary is drawn by a SECOND, SEPARATE mechanism — the column-level GRANT
--   in 0015 — and reinforced by v_member_directory (0013). This file is where PRD Success
--   Metric 8 ("0 sensitive fields returned to Officer or RR tiers") stops being a claim.
--
--   PRD US-D2, US-J1 and OQ-6 (default: officers do NOT see contact information). CBL Art.
--   VIII §7.1.4 designates "private member data" confidential and Art. VIII §6 binds the org
--   to RA 10173, so this is a constitutional boundary as well as a statutory one. Note that
--   the Special Advisor sits in the `officer` tier (CBL Art. III §2.9, Art. X §2.4-2.5) and
--   is the independent reviewer of appeals — an adjudicator who could read the records of the
--   people whose appeals they hear is the specific thing this refuses.
--
-- ⚠ POSITIVE CONTROL FIRST, AND IT IS NOT CEREMONY. A column-set assertion over an EMPTY
--   result proves nothing: if a broken claim made auth_role() NULL, the officer would see
--   zero rows and every "cannot read birthdate" assertion below would pass while the boundary
--   was untested. Assertions 1 and 2 fix a known non-zero baseline before anything is denied.
--
-- ⚠ COLUMN BY COLUMN, NOT AS A SET DIFFERENCE. Each of the 19 columns of `public.people` gets
--   its own has_column_privilege() assertion. A future migration adding `guardian_contact`
--   to `people` will not be named here — and because the GRANT in 0015 is an allowlist, that
--   column is withheld by default, so the boundary holds and the plan count is what changes.
--   Written as a set difference, a newly added sensitive column would slip through silently.
--
-- ⚠ has_column_privilege() IS ABOUT THE `authenticated` ROLE, NOT ABOUT A FIXTURE. Column
--   GRANTs are held by the database role, and all seven authenticated tiers share it. So
--   assertions 3-21 describe a property of the ROLE that officer, regional_rep, member and
--   tech_admin all inherit, while assertions 22-23 and 31 describe what a specific fixture
--   actually experiences. Both halves are needed: the grant is the mechanism, the raised
--   42501 is the behaviour.
--
-- CITATION:  BUILD_PLAN S5-T8; ARCHITECTURE.md §5 ("Column protection"); DATA_MODEL.md
--            §6/0013, §6/0015, §8.1; PRD §3 v1.0 items 14, 15; PRD US-D2, US-F1, US-F2,
--            US-J1; PRD Success Metric 8; PRD OQ-6; CBL Art. VIII §6, §7.1.4.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/records-fixtures.psql

select plan(35);

-- Scratchpads. CREATED by the session role, WRITTEN while impersonating — auth.psql grants
-- the temp schema USAGE, not CREATE, so a fixture cannot make its own.
create temp table fx_rows  (k text primary key, v int);
create temp table fx_scope (rep text, person_id uuid);
grant insert, select on fx_rows, fx_scope to public;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-2 — positive controls
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer

select is(
  (select count(*)::int from public.people), 17,
  'POSITIVE CONTROL: an officer sees all 17 people rows. people_read names officer, and it '
  'SHOULD — the officer tier reads the directory. What an officer must not see is COLUMNS, '
  'which is what everything below measures'
);

select is(
  (select count(distinct membership_id)::int from public.v_member_directory), 15,
  'POSITIVE CONTROL: an officer sees all 15 memberships through v_member_directory. '
  '`distinct membership_id` because the view''s two LEFT JOINs fan a member on two '
  'committees into two rows — the exact fan-out search_member_directory() collapses'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3-8 — the SIX columns `authenticated` may read
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0015_grants.sql: `revoke all on public.people from authenticated`, then a six-column
-- `grant select`. These six are non-identifying and are exactly what the directory renders.
select ok(has_column_privilege('authenticated', 'public.people', 'id', 'select'),
  'authenticated MAY read people.id');
select ok(has_column_privilege('authenticated', 'public.people', 'member_id', 'select'),
  'authenticated MAY read people.member_id — an officer finding a scholar by ID is PRD US-I2, '
  'and this assertion is why the fixtures set member_id on every person: it would be vacuous '
  'against a NULL column');
select ok(has_column_privilege('authenticated', 'public.people', 'given_name', 'select'),
  'authenticated MAY read people.given_name');
select ok(has_column_privilege('authenticated', 'public.people', 'family_name', 'select'),
  'authenticated MAY read people.family_name');
select ok(has_column_privilege('authenticated', 'public.people', 'join_year', 'select'),
  'authenticated MAY read people.join_year — the "year of membership" axis (PRD US-G2)');
select ok(has_column_privilege('authenticated', 'public.people', 'created_at', 'select'),
  'authenticated MAY read people.created_at');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-21 — the THIRTEEN columns `authenticated` may NOT read
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Ten of these are the RA 10173 sensitive block registered in sensitive_column_registry
-- (0016), reachable ONLY through get_person_sensitive() (0012) and get_member_record()
-- (0030) — role-guarded, acknowledgement-gated and audited on every call. The other three
-- (suffix, updated_at, redacted_at) are withheld for a duller reason: the GRANT is an
-- allowlist, so a column is absent until someone argues it in.
select ok(not has_column_privilege('authenticated', 'public.people', 'birthdate', 'select'),
  'authenticated may NOT read people.birthdate — RA 10173 sensitive (CBL Art. VIII §6)');
select ok(not has_column_privilege('authenticated', 'public.people', 'contact_number', 'select'),
  'authenticated may NOT read people.contact_number — PRD US-D2 names contact number '
  'explicitly as excluded from the officer view');
select ok(not has_column_privilege('authenticated', 'public.people', 'personal_email', 'select'),
  'authenticated may NOT read people.personal_email');
select ok(not has_column_privilege('authenticated', 'public.people', 'address_line', 'select'),
  'authenticated may NOT read people.address_line');
select ok(not has_column_privilege('authenticated', 'public.people', 'city_municipality', 'select'),
  'authenticated may NOT read people.city_municipality');
select ok(not has_column_privilege('authenticated', 'public.people', 'province', 'select'),
  'authenticated may NOT read people.province');
select ok(not has_column_privilege('authenticated', 'public.people', 'postal_code', 'select'),
  'authenticated may NOT read people.postal_code');
select ok(not has_column_privilege('authenticated', 'public.people', 'school', 'select'),
  'authenticated may NOT read people.school');
select ok(not has_column_privilege('authenticated', 'public.people', 'school_id_no', 'select'),
  'authenticated may NOT read people.school_id_no — a DOST scholar''s government-linked '
  'identifier');
select ok(not has_column_privilege('authenticated', 'public.people', 'middle_name', 'select'),
  'authenticated may NOT read people.middle_name — classified sensitive because a full legal '
  'name is materially more identifying than a first and last');
select ok(not has_column_privilege('authenticated', 'public.people', 'suffix', 'select'),
  'authenticated may NOT read people.suffix — not classified sensitive, simply not granted. '
  'The allowlist means absent-by-default');
select ok(not has_column_privilege('authenticated', 'public.people', 'updated_at', 'select'),
  'authenticated may NOT read people.updated_at — note that update_member_record()''s '
  'optimistic-concurrency check therefore cannot be done by the client reading this column '
  'directly; the value reaches the edit form through get_member_record()');
select ok(not has_column_privilege('authenticated', 'public.people', 'redacted_at', 'select'),
  'authenticated may NOT read people.redacted_at — the five-year purge marker (PRD US-J3)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 22-23 — the behavioural half: what a hand-written query actually does
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 22 is the query a curious officer types. 23 is the query an ORM or a `select()` with no
-- column list generates, and it is the one that matters most: `select *` expands to every
-- column, so a boundary that only refused NAMED sensitive columns would leak through it.
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer

select throws_ok(
  $$ select birthdate from public.people limit 1 $$,
  '42501'::char(5), null::text,
  'an OFFICER selecting a sensitive column raises 42501 — the GRANT refuses it, not the UI. '
  'PRD US-D2: "the officer view excludes sensitive personal data"'
);

select throws_ok(
  $$ select * from public.people limit 1 $$,
  '42501'::char(5), null::text,
  '`select *` ALSO raises for an officer, and this is the assertion that matters: it is what '
  'a client with no explicit column list generates, and a boundary that only refused named '
  'columns would be bypassed by the laziest possible query'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 24 — v_member_directory's exact shape
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Pinned to a literal array so a FOURTEENTH column fails CI rather than reaching a screen.
-- ARCHITECTURE.md §5: "never widen v_member_directory to make an officer screen work" — if a
-- committee head genuinely needs contact details, that is a scoped ADDITIONAL view over one
-- committee (PRD v2 item 34), never a widening of this one.
--
-- search_member_directory() (0030) returns these thirteen concepts with committee_name and
-- department_name pluralised into arrays, so this assertion also pins that function's shape
-- by proxy.
select columns_are(
  'public', 'v_member_directory',
  ARRAY[
    'membership_id', 'person_id', 'member_id', 'given_name', 'family_name', 'join_year',
    'term_id', 'status', 'year_level', 'region_name', 'island_group',
    'committee_name', 'department_name'
  ],
  'v_member_directory exposes EXACTLY these 13 columns. No contact number, no address, no '
  'birthdate, no Drive pointer. Adding a fourteenth fails here — PRD Success Metric 8'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 25-30 — the regional-rep battery
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a (NCR)

select is(
  (select count(*)::int from public.people), 3,
  'regional_rep_a sees exactly 3 people: P3, P4 and R1, the NCR scholars with a CURRENT-TERM '
  'membership (PRD US-F1)'
);

select is(
  (select count(distinct membership_id)::int from public.v_member_directory), 3,
  'regional_rep_a sees exactly 3 directory rows'
);

-- THE ASYMMETRY, and it is a real property of two different policies rather than a fixture
-- accident. memberships_read scopes a rep by region with NO term predicate, so P1's ARCHIVED
-- NCR membership is visible in the table. people_read's regional_rep branch additionally
-- requires a membership in current_term_id(), so P1 the PERSON is not — and because
-- v_member_directory INNER JOINs people, P1's row drops out of the directory too.
-- Asserting only one of these three numbers would not notice if they ever converged.
select is(
  (select count(*)::int from public.memberships), 4,
  'regional_rep_a sees 4 MEMBERSHIPS but only 3 people and 3 directory rows: memberships_read '
  'carries no term predicate while people_read''s rep branch requires a CURRENT-term row, so '
  'P1''s archived NCR membership is visible while P1 is not. Two policies, two answers'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b (R07)
select is(
  (select count(*)::int from public.people), 2,
  'regional_rep_b sees exactly 2 people: P5 and P6, the R07 scholars. The nine transition-lab '
  'scholars sit in R03, which no rep fixture covers'
);
select is(
  (select count(distinct membership_id)::int from public.v_member_directory), 2,
  'regional_rep_b sees exactly 2 directory rows'
);
select pg_temp.logout();

-- Disjointness, computed the only way that means anything: collect each rep's actual person
-- set and intersect them. Two counts that happen to sum correctly would not catch a
-- predicate that returned the same rows to both.
--
-- The scratchpad is CREATED by the session role and only WRITTEN while impersonating:
-- auth.psql grants the temp schema USAGE, not CREATE, so `create temp table ... as select`
-- inside a login_as() block would fail on the CREATE and never reach the scoping question.
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');
insert into fx_scope select 'a', id from public.people;
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');
insert into fx_scope select 'b', id from public.people;
select pg_temp.logout();

select is(
  (select count(*)::int from (
     select person_id from fx_scope where rep = 'a'
     intersect
     select person_id from fx_scope where rep = 'b'
   ) s), 0,
  'the two regional reps'' person sets are DISJOINT — PRD US-F1: "two reps of different '
  'regions see disjoint member sets"'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 31-34 — neither read-only tier holds any write path
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Note the two DIFFERENT refusal shapes, and both are correct:
--   · memberships — the tier is simply absent from memberships_update, so the USING half is
--     false, the rows are invisible to the statement and ZERO rows are affected with no
--     error (CONVENTIONS.md §4.3: an RLS-empty result is `not_found`, never `unauthorized`).
--   · people      — `authenticated` holds no UPDATE privilege on the table AT ALL (0015
--     revokes it), so the statement raises 42501 before RLS is consulted. That missing
--     GRANT is also the reason update_member_record() (0030) has to be SECURITY DEFINER.

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
do $$
declare n int;
begin
  update public.memberships set year_level = 4
   where id = '00000000-0000-4000-c100-000000000001';    -- R1, inside rep_a's OWN region
  get diagnostics n = row_count;
  insert into fx_rows values ('rep_membership_update', n);
end;
$$;

select throws_ok(
  $$ update public.people set given_name = 'Tampered'
      where id = '00000000-0000-4000-b100-000000000001' $$,
  '42501'::char(5), null::text,
  'a REGIONAL REP updating `people` raises 42501 from the missing table GRANT, before any '
  'policy is consulted (PRD US-F2)'
);
select pg_temp.logout();

select is(
  (select v from fx_rows where k = 'rep_membership_update'), 0,
  'a regional rep''s membership update affects ZERO rows and raises nothing — the refusal is '
  'a MISSING POLICY, not a hidden button (PRD US-F2)'
);

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ update public.people set given_name = 'Tampered'
      where id = '00000000-0000-4000-b100-000000000001' $$,
  '42501'::char(5), null::text,
  'an OFFICER updating `people` raises 42501 too — "no update, create or delete path exists '
  'for the Officer tier on any record" (PRD US-D2)'
);

-- The officer counterpart of the rep's zero-rows probe above: memberships carries the
-- UPDATE table privilege (moderators need it), so for an officer the refusal arrives
-- as a MISSING POLICY — zero rows affected, no error (PRD US-D2).
do $$
declare n int;
begin
  update public.memberships set year_level = 1 where true;
  get diagnostics n = row_count;
  insert into fx_rows values ('officer_membership_update', n);
end;
$$;
select is(
  (select v from fx_rows where k = 'officer_membership_update'), 0,
  'an OFFICER''s membership update affects ZERO rows and raises nothing — the refusal is a '
  'MISSING POLICY, not a hidden button (PRD US-D2)'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 35 — the negative-space assertion
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Reads pg_policies directly rather than any fixture, so it holds for tables that do not
-- exist yet. PRD US-D2 and US-F2 as a property of the whole database: no write policy
-- anywhere may name either read-only tier. This is the assertion that goes red in 2029 when
-- somebody adds `officer` to a write policy to make a screen work.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
          ~ '''(officer|regional_rep)'''), 0,
  'NO INSERT, UPDATE, DELETE or ALL policy anywhere in `public` names officer or '
  'regional_rep. PRD US-D2 and US-F2 expressed as an absence over the whole schema, not as a '
  'per-table checklist somebody has to remember to extend'
);


select * from finish();

rollback;
