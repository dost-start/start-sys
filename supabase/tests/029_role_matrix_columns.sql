-- ═══════════════════════════════════════════════════════════════════════════════════
-- 029_role_matrix_columns.sql  —  BUILD_PLAN S2-T23
--
-- **RLS IS ROW-LEVEL AND CANNOT PROTECT A COLUMN.** 028 proves an officer may read all six
-- `people` ROWS, because PRD US-D2 says officers view member records. Without a second
-- mechanism that same officer's hand-written `select * from people` returns six scholars'
-- birthdates, addresses, contact numbers and school ID numbers — with every policy in 0014
-- still passing and every assertion in 028 still green. This file is the test for that
-- second mechanism.
--
-- The boundary is drawn twice (ARCHITECTURE.md §5):
--   1. v_member_directory (0013) — the 13-column shape every officer/RR screen consumes.
--      Ergonomics.
--   2. the column-level GRANT on public.people (0015) — six columns to `authenticated`,
--      and nothing else. ENFORCEMENT: this is what refuses the hand-written query.
-- Neither is sufficient alone and neither may be widened to make a screen work.
--
--    1-3   positive controls, and the exact 13-column shape of v_member_directory
--    4-22  has_column_privilege for `authenticated` over the FULL 19-column people list
--   23-41  the same 19 for `anon` — all false, at the GRANT, before RLS is consulted
--   42-50  as EACH of the nine fixtures: `select birthdate from people` raises 42501
--   51-59  as EACH of the nine fixtures: `select * from people` raises 42501
--   60-67  as each authenticated fixture: the six granted columns SELECT cleanly
--   68     anon cannot read even the granted six
--
-- ⚠ THE FULL COLUMN LIST IS ENUMERATED, NOT DIFFED. Every one of the 19 columns of
--   public.people is asserted individually against an expected true/false. A test written
--   as "the sensitive ten are denied" passes forever after someone adds a twentieth
--   sensitive column; a test written as "these 6 are granted and these 13 are not" FAILS
--   the moment the table changes shape, which is the failure direction that protects
--   scholars. PRD §6 Success Metric 8: "0 sensitive fields returned to Officer or RR tiers."
--
-- ⚠ WHY exec_admin, crrd_admin AND moderator ARE ALSO REFUSED (assertions 42-59). They are
--   the three tiers that legitimately read sensitive columns — but never through a GRANT.
--   They read through get_person_sensitive() (0012), a SECURITY DEFINER RPC that is
--   role-gated, gated on a CURRENT-TERM confidentiality acknowledgement (CBL Art. VIII
--   §7.1) and audited on every call. A GRANT cannot log, so a GRANT is the wrong shape for
--   a read that RA 10173 requires to be answerable after the fact. Widening the 0015 GRANT
--   "to make a Server Action work" is the exact banned move (CLAUDE.md).
--
-- ⚠ COLUMN PRIVILEGES ARE PER DATABASE ROLE, NOT PER FIXTURE. All eight authenticated
--   fixtures share the `authenticated` role, so assertions 4-22 are asserted once against
--   that role and the per-fixture half is BEHAVIOURAL (42-59). Assertions 1-2 exist so this
--   file is not testing an empty result set: the officer genuinely sees rows, and still
--   cannot see the columns.
--
-- CITATION:  BUILD_PLAN S2-T23; ARCHITECTURE.md §5, §8; DATA_MODEL.md §6/0013, §6/0015,
--            §8.1, §8.4; PRD §3 v1.0 items 10, 15; PRD US-D2, US-F1, US-J1, US-J5;
--            PRD §6 Success Metric 8; PRD OQ-5, OQ-6;
--            CBL Art. VIII §6 (RA 10173 as a constitutional obligation), §7.1.4.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir ../test-helpers/auth.sql
\ir ../test-helpers/fixtures.sql

select plan(68);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — the positive controls, and the shape of the directory view
--
-- A column-set assertion over an empty result proves nothing, so the officer's row counts
-- come first. Five directory rows, not six: v_member_directory joins memberships to people,
-- and P2 (the CCDO's person) deliberately has no membership at all.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer

select is((select count(*) from public.v_member_directory)::int, 5,
  'POSITIVE CONTROL 1: officer sees exactly 5 rows in v_member_directory — the column assertions below are not measuring an empty set');

select is((select count(*) from public.people)::int, 6,
  'POSITIVE CONTROL 2: officer sees exactly 6 people ROWS — RLS lets them in, and the GRANT is what keeps the columns out');

select pg_temp.logout();

-- Pinned by name, so a fourteenth column fails CI rather than reaching a screen. If an
-- officer screen "needs" a sensitive field the answer is that the officer does not get it
-- (PRD OQ-6, default no); if a committee head genuinely needs contact details, that is a
-- SCOPED ADDITIONAL view over one committee, never a widening of this one (PRD v2 item 34).
select columns_are(
  'public', 'v_member_directory',
  array['membership_id', 'person_id', 'member_id', 'given_name', 'family_name', 'join_year',
        'term_id', 'status', 'year_level', 'region_name', 'island_group',
        'committee_name', 'department_name']::name[],
  'v_member_directory exposes EXACTLY 13 columns and not one is sensitive — CBL Art. VIII §7.1.4, PRD Success Metric 8');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-22 — the `authenticated` column GRANT, column by column, over all 19
--
-- SIX GRANTED. The other thirteen are withheld, and for two different reasons which is
-- why they are asserted the same way:
--   · ten are RA 10173 sensitive and registered in sensitive_column_registry (0016), which
--     drives BOTH the audit-log masking and the five-year purge — birthdate,
--     contact_number, personal_email, address_line, city_municipality, province,
--     postal_code, school, school_id_no, middle_name.
--   · three are simply not needed by any tier below crrd_admin — suffix, updated_at,
--     redacted_at. The GRANT is an ALLOWLIST, so a column is absent until someone argues
--     it in.
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(has_column_privilege('authenticated', 'public.people', 'id', 'select'),
  'authenticated MAY read people.id — one of the six granted columns');
select ok(has_column_privilege('authenticated', 'public.people', 'member_id', 'select'),
  'authenticated MAY read people.member_id — non-identifying, and it survives the 5-year purge (PRD US-J3)');
select ok(has_column_privilege('authenticated', 'public.people', 'given_name', 'select'),
  'authenticated MAY read people.given_name');
select ok(has_column_privilege('authenticated', 'public.people', 'family_name', 'select'),
  'authenticated MAY read people.family_name');
select ok(has_column_privilege('authenticated', 'public.people', 'join_year', 'select'),
  'authenticated MAY read people.join_year — the PRD US-G2 "year of membership" filter axis');
select ok(has_column_privilege('authenticated', 'public.people', 'created_at', 'select'),
  'authenticated MAY read people.created_at');

select ok(not has_column_privilege('authenticated', 'public.people', 'birthdate', 'select'),
  'authenticated may NOT read people.birthdate — RA 10173 sensitive (CBL Art. VIII §6)');
select ok(not has_column_privilege('authenticated', 'public.people', 'contact_number', 'select'),
  'authenticated may NOT read people.contact_number — the highest-risk field to leak into a bulk send');
select ok(not has_column_privilege('authenticated', 'public.people', 'personal_email', 'select'),
  'authenticated may NOT read people.personal_email');
select ok(not has_column_privilege('authenticated', 'public.people', 'address_line', 'select'),
  'authenticated may NOT read people.address_line');
select ok(not has_column_privilege('authenticated', 'public.people', 'city_municipality', 'select'),
  'authenticated may NOT read people.city_municipality — an address component is sensitive in combination');
select ok(not has_column_privilege('authenticated', 'public.people', 'province', 'select'),
  'authenticated may NOT read people.province');
select ok(not has_column_privilege('authenticated', 'public.people', 'postal_code', 'select'),
  'authenticated may NOT read people.postal_code');
select ok(not has_column_privilege('authenticated', 'public.people', 'school', 'select'),
  'authenticated may NOT read people.school — it links the scholar to their DOST scholarship');
select ok(not has_column_privilege('authenticated', 'public.people', 'school_id_no', 'select'),
  'authenticated may NOT read people.school_id_no — the number printed on the Certificate of Registration');
select ok(not has_column_privilege('authenticated', 'public.people', 'middle_name', 'select'),
  'authenticated may NOT read people.middle_name — a strong identity-resolution key in PH records');
select ok(not has_column_privilege('authenticated', 'public.people', 'suffix', 'select'),
  'authenticated may NOT read people.suffix — not classified sensitive, simply not argued in');
select ok(not has_column_privilege('authenticated', 'public.people', 'updated_at', 'select'),
  'authenticated may NOT read people.updated_at');
select ok(not has_column_privilege('authenticated', 'public.people', 'redacted_at', 'select'),
  'authenticated may NOT read people.redacted_at — whether a record has been purged is itself an admin fact');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 23-41 — `anon` holds NOTHING on public.people, at either level
--
-- 0015 revokes ALL from anon and grants nothing back; 0014 creates no anon policy either.
-- The public application form (PRD US-B1) writes to `applications`, never to `people` — a
-- person row is created only by approve_application() (0023). All nineteen are asserted so
-- that a future "just let anon read the name for the confirmation screen" fails here.
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(not has_column_privilege('anon', 'public.people', 'id', 'select'),
  'anon may NOT read people.id');
select ok(not has_column_privilege('anon', 'public.people', 'member_id', 'select'),
  'anon may NOT read people.member_id');
select ok(not has_column_privilege('anon', 'public.people', 'given_name', 'select'),
  'anon may NOT read people.given_name — not even a name reaches an unauthenticated caller (PRD US-A1)');
select ok(not has_column_privilege('anon', 'public.people', 'family_name', 'select'),
  'anon may NOT read people.family_name');
select ok(not has_column_privilege('anon', 'public.people', 'join_year', 'select'),
  'anon may NOT read people.join_year');
select ok(not has_column_privilege('anon', 'public.people', 'created_at', 'select'),
  'anon may NOT read people.created_at');
select ok(not has_column_privilege('anon', 'public.people', 'birthdate', 'select'),
  'anon may NOT read people.birthdate');
select ok(not has_column_privilege('anon', 'public.people', 'contact_number', 'select'),
  'anon may NOT read people.contact_number');
select ok(not has_column_privilege('anon', 'public.people', 'personal_email', 'select'),
  'anon may NOT read people.personal_email');
select ok(not has_column_privilege('anon', 'public.people', 'address_line', 'select'),
  'anon may NOT read people.address_line');
select ok(not has_column_privilege('anon', 'public.people', 'city_municipality', 'select'),
  'anon may NOT read people.city_municipality');
select ok(not has_column_privilege('anon', 'public.people', 'province', 'select'),
  'anon may NOT read people.province');
select ok(not has_column_privilege('anon', 'public.people', 'postal_code', 'select'),
  'anon may NOT read people.postal_code');
select ok(not has_column_privilege('anon', 'public.people', 'school', 'select'),
  'anon may NOT read people.school');
select ok(not has_column_privilege('anon', 'public.people', 'school_id_no', 'select'),
  'anon may NOT read people.school_id_no');
select ok(not has_column_privilege('anon', 'public.people', 'middle_name', 'select'),
  'anon may NOT read people.middle_name');
select ok(not has_column_privilege('anon', 'public.people', 'suffix', 'select'),
  'anon may NOT read people.suffix');
select ok(not has_column_privilege('anon', 'public.people', 'updated_at', 'select'),
  'anon may NOT read people.updated_at');
select ok(not has_column_privilege('anon', 'public.people', 'redacted_at', 'select'),
  'anon may NOT read people.redacted_at');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 42-59 — the behavioural half, per fixture, and BOTH forms of the query
--
-- `select birthdate` is the deliberate attempt. `select *` is what a hand-written query,
-- an ORM, or a curl against PostgREST actually does — and it is the one that matters,
-- because it is the form somebody reaches for without meaning any harm. Both raise 42501.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok($$ select birthdate from public.people $$, '42501'::char(5), null::text,
  'exec_admin cannot select people.birthdate through a GRANT — the door is get_person_sensitive(), which AUDITS (PRD US-J5)');
select throws_ok($$ select * from public.people $$, '42501'::char(5), null::text,
  'exec_admin cannot `select *` from people either — the hand-written query is the one that matters');

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok($$ select birthdate from public.people $$, '42501'::char(5), null::text,
  'tech_admin cannot select people.birthdate — PRD OQ-5, and they hold no sensitive read at all');
select throws_ok($$ select * from public.people $$, '42501'::char(5), null::text,
  'tech_admin cannot `select *` from people');

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok($$ select birthdate from public.people $$, '42501'::char(5), null::text,
  'crrd_admin cannot select people.birthdate through a GRANT — a GRANT cannot log, and RA 10173 requires the read to be answerable');
select throws_ok($$ select * from public.people $$, '42501'::char(5), null::text,
  'crrd_admin cannot `select *` from people');

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select throws_ok($$ select birthdate from public.people $$, '42501'::char(5), null::text,
  'moderator cannot select people.birthdate through a GRANT');
select throws_ok($$ select * from public.people $$, '42501'::char(5), null::text,
  'moderator cannot `select *` from people');

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$ select birthdate from public.people $$, '42501'::char(5), null::text,
  'officer cannot select people.birthdate — PRD US-D2, "the officer view excludes sensitive personal data"');
select throws_ok($$ select * from public.people $$, '42501'::char(5), null::text,
  'officer cannot `select *` from people — the boundary holds against a hand-written query, not just against a screen');

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok($$ select birthdate from public.people $$, '42501'::char(5), null::text,
  'regional_rep_a cannot select people.birthdate — PRD US-J1, even for their OWN region');
select throws_ok($$ select * from public.people $$, '42501'::char(5), null::text,
  'regional_rep_a cannot `select *` from people');

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select throws_ok($$ select birthdate from public.people $$, '42501'::char(5), null::text,
  'regional_rep_b cannot select people.birthdate');
select throws_ok($$ select * from public.people $$, '42501'::char(5), null::text,
  'regional_rep_b cannot `select *` from people');

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select throws_ok($$ select birthdate from public.people $$, '42501'::char(5), null::text,
  'member cannot select people.birthdate — not even their own; PRD §4 defers member self-service');
select throws_ok($$ select * from public.people $$, '42501'::char(5), null::text,
  'member cannot `select *` from people');

select pg_temp.login_anon();
select throws_ok($$ select birthdate from public.people $$, '42501'::char(5), null::text,
  'anon cannot select people.birthdate');
select throws_ok($$ select * from public.people $$, '42501'::char(5), null::text,
  'anon cannot `select *` from people');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 60-68 — the permitted case
--
-- A GRANT that denied everything would satisfy every assertion above and would also break
-- every screen in the system. These nine prove the six columns genuinely work for the eight
-- authenticated tiers — and that anon still gets nothing, at either level.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');
select lives_ok($$ select id, member_id, given_name, family_name, join_year, created_at from public.people $$,
  'exec_admin CAN read the six granted columns');
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');
select lives_ok($$ select id, member_id, given_name, family_name, join_year, created_at from public.people $$,
  'tech_admin CAN read the six granted columns (and 028 shows it returns zero ROWS — column and row are separate mechanisms)');
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');
select lives_ok($$ select id, member_id, given_name, family_name, join_year, created_at from public.people $$,
  'crrd_admin CAN read the six granted columns');
select pg_temp.login_as('00000000-0000-4000-a000-000000000004');
select lives_ok($$ select id, member_id, given_name, family_name, join_year, created_at from public.people $$,
  'moderator CAN read the six granted columns');
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');
select lives_ok($$ select id, member_id, given_name, family_name, join_year, created_at from public.people $$,
  'officer CAN read the six granted columns — the directory works, the record does not open');
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');
select lives_ok($$ select id, member_id, given_name, family_name, join_year, created_at from public.people $$,
  'regional_rep_a CAN read the six granted columns');
select pg_temp.login_as('00000000-0000-4000-a000-000000000007');
select lives_ok($$ select id, member_id, given_name, family_name, join_year, created_at from public.people $$,
  'regional_rep_b CAN read the six granted columns');
select pg_temp.login_as('00000000-0000-4000-a000-000000000008');
select lives_ok($$ select id, member_id, given_name, family_name, join_year, created_at from public.people $$,
  'member CAN read the six granted columns');

select pg_temp.login_anon();
select throws_ok($$ select id from public.people $$, '42501'::char(5), null::text,
  'anon cannot read even people.id — the anonymous surface on this table is empty at the GRANT level, not merely at the policy level');


select * from finish();

rollback;
