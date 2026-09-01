-- ═══════════════════════════════════════════════════════════════════════════════════
-- 018_v_member_directory.sql  —  the officer/RR read surface, pinned
--
-- WHAT:
--    1     columns_are() against the EXACT thirteen columns of v_member_directory
--    2-3   both reloptions — security_barrier AND security_invoker
--    4-10  exact row counts through the view per fixture, and the two reps' disjointness
--   11-12  an officer's hand-written query for a sensitive column raises 42501, and so
--          does `select *` — which is what a hand-written query actually looks like
--   13     anon cannot read the view at all
--   14     the view carries no column named in sensitive_column_registry (data-driven)
--
-- WHY assertion 1 is the whole point of the file. ARCHITECTURE.md §5 and 0013's own header
--   say it outright: **adding a column here is how Success Metric 8 ("0 sensitive fields
--   returned to Officer or RR tiers") becomes false with every other test still green.**
--   RLS is row-level and cannot refuse a column, so nothing else in the RLS suite would
--   notice a `p.contact_number` appearing in this view. columns_are() pins the list, so a
--   fourteenth column fails CI instead of reaching a screen. Assertion 14 is the same guard
--   written data-driven, so a sensitive column added under a NEW name still fails without
--   anyone remembering to edit this file.
--
-- WHY assertion 3 is not decoration. security_invoker = true makes the view execute with
--   the CALLER's privileges, so the RLS policies on memberships/people and the column
--   GRANTs in 0015 apply THROUGH it. Without it the view runs as its owner — the migration
--   role, which carries BYPASSRLS — and every officer and every regional rep reads every
--   region. That failure produces NO ERROR and looks perfectly correct to whoever is
--   testing as an admin. Assertions 6-8 are its behavioural twin: scoping is INHERITED
--   from the policies, never restated in the view, which is why there is no
--   SECURITY DEFINER "directory RPC" anywhere in this schema.
--
-- ⚠ POSITIVE CONTROL FIRST (assertion 4). A malformed claim makes auth.uid() NULL, which
--   makes auth_role() NULL, which makes every policy return zero rows — and a deny
--   assertion written as "sees 0 rows" then passes for the wrong reason. Assertion 4
--   establishes that an admin sees a known non-zero count before assertions 6-10 are
--   trusted. BUILD_PLAN S2-T14 makes that acceptance, not advice.
--
-- ── THE ARITHMETIC, derived from test-helpers/fixtures.sql ──────────────────────────
--   The view INNER JOINs people and memberships, so a membership whose PERSON the caller
--   cannot read yields no row. That is why the numbers here are not simply the fixture's
--   membership counts:
--
--     crrd_admin  5 memberships x 1 person each, no department_assignments seeded  → 5
--     officer     same policy branch as crrd_admin on both tables                  → 5
--     rep_a       3 memberships visible (c1,c2 current NCR + c5 ARCHIVED NCR) but
--                 only 2 people (people_read's rep branch also requires
--                 m.term_id = current_term_id(), so P1 is invisible) → the join
--                 drops c5                                                          → 2
--     rep_b       2 memberships (c3,c4 R07), 2 people (P5,P6)                       → 2
--     member      1 membership (own), 1 person (own)                                → 1
--     tech_admin  ABSENT from people_read AND memberships_read (PRD OQ-5)           → 0
--
--   rep_a's 3-memberships-but-2-people asymmetry is a real disagreement between
--   memberships_read and people_read, flagged in the fixtures header for the 0014 owner.
--   This file measures the consequence rather than papering over it.
--
-- CITATION:  BUILD_PLAN S2-T10; DATA_MODEL.md §6/0013, §8.1; ARCHITECTURE.md §5;
--            PRD §3 v1.0 items 12, 14, 15; PRD US-D2, US-F1, US-I3, US-J1;
--            PRD §6 Success Metric 8; CBL Art. VIII §6, §7.1.4.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(14);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — the exact column list
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Thirteen names, in the order 0013 declares them. What is NOT here is the assertion:
-- birthdate, contact_number, personal_email, address_line, city_municipality, province,
-- postal_code, school, school_id_no, middle_name, proof_drive_file_id,
-- proof_web_view_link. Reads of the first ten go through get_person_sensitive() (0012),
-- which is role-guarded, gated on a current-term confidentiality acknowledgement
-- (CBL Art. VIII §7.1) and audited on every call.
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
  'v_member_directory exposes EXACTLY 13 non-sensitive columns — a fourteenth fails CI '
  'rather than reaching an officer screen (PRD US-D2, US-J1, Success Metric 8)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2-3 — the two reloptions
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 2 — security_barrier stops a caller smuggling a cheap, leaky function into a WHERE
-- clause and having the planner evaluate it BEFORE the view's own qualifiers — the classic
-- way to read rows through a restricting view one error message at a time.
select ok(
  (select 'security_barrier=true' = any(c.reloptions)
     from pg_class c
    where c.relname = 'v_member_directory'
      and c.relnamespace = 'public'::regnamespace),
  'v_member_directory is WITH (security_barrier = true)'
);

-- 3 — THE LOAD-BEARING CLAUSE. Without it the view executes as its BYPASSRLS owner and
-- every officer reads every region, silently and with no error.
select ok(
  (select 'security_invoker=true' = any(c.reloptions)
     from pg_class c
    where c.relname = 'v_member_directory'
      and c.relnamespace = 'public'::regnamespace),
  'v_member_directory is WITH (security_invoker = true) — RLS and the column GRANTs apply '
  'THROUGH it, so regional scoping is inherited and never restated'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-10 — exact row counts through the view, per fixture
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Collected into a temp table so the two reps' sets can be intersected in assertion 8
-- after both role switches are done. The table is created and granted by the session role;
-- pg_temp USAGE is already granted to PUBLIC by auth.sql.
create temporary table _dir_scope (
  who       text not null,
  person_id uuid not null
) on commit drop;

grant insert, select on _dir_scope to public;


select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

-- 4 — THE POSITIVE CONTROL. If this is not 5, every deny assertion below is void.
select is(
  (select count(*)::int from public.v_member_directory),
  5,
  'crrd_admin reads all 5 memberships through the directory — POSITIVE CONTROL'
);

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer

-- 5 — the tier this view exists FOR (PRD §3 v1.0 item 15). Non-zero, and exactly 5:
-- "greater than zero" would pass on a policy that returned everything.
select is(
  (select count(*)::int from public.v_member_directory),
  5,
  'officer reads exactly 5 directory rows — the read-only surface of PRD item 15'
);

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a (NCR)

insert into _dir_scope select 'a', v.person_id from public.v_member_directory v;

-- 6 — PRD US-F1. Two rows, not three: the archived-term NCR membership is visible to the
-- rep on `memberships` but its PERSON is not, and the view's INNER JOIN drops it.
select is(
  (select count(*)::int from public.v_member_directory),
  2,
  'regional_rep_a reads exactly 2 directory rows — its own region, scoping INHERITED from '
  'people_read/memberships_read rather than restated in the view (PRD US-F1)'
);

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b (R07)

insert into _dir_scope select 'b', v.person_id from public.v_member_directory v;

select is(
  (select count(*)::int from public.v_member_directory),
  2,
  'regional_rep_b reads exactly 2 directory rows — the mirror image'
);

select pg_temp.logout();

-- 8 — PRD US-F1: "two reps of different regions see disjoint member sets." Asserted as an
-- empty INTERSECTION, not merely as two equal counts — two reps each seeing the same two
-- people would satisfy 6 and 7 and be a total scope failure.
select is(
  (select count(*)::int
     from (select person_id from _dir_scope where who = 'a'
           intersect
           select person_id from _dir_scope where who = 'b') s),
  0,
  'regional_rep_a and regional_rep_b see DISJOINT people through the directory — the '
  'intersection is empty, not merely the counts equal (PRD US-F1)'
);

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member

-- 9 — PRD US-E4: a member sees their own assignment and nobody else's. One row, and it is
-- their own; the fixture has four current-term memberships, so this is a real scoping
-- assertion rather than an artefact of there being only one row.
select is(
  (select count(*)::int from public.v_member_directory),
  1,
  'member reads exactly 1 directory row — their own (PRD US-E4)'
);

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin

-- 10 — PRD OQ-5, as a missing role literal. tech_admin is absent from both people_read and
-- memberships_read: "configure the system and control access" is not "read everyone's
-- address". This zero is the design, and it is why BUILD_PLAN S6-T13 lands the CTO on
-- /system rather than on an all-zero dashboard that would read as a broken system.
select is(
  (select count(*)::int from public.v_member_directory),
  0,
  'tech_admin reads 0 directory rows — least privilege, PRD OQ-5 default answer NO'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11-12 — the column boundary, from an officer session
-- ═══════════════════════════════════════════════════════════════════════════════════
-- These two are the reason 0015_grants.sql exists. people_read (0014) lets an officer read
-- every ROW of public.people; only the column-level GRANT stops the query below returning
-- 600 scholars' birthdates with every policy still passing.

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer

select throws_ok(
  $$ select birthdate from public.people $$,
  '42501'::char(5),
  null::text,
  'an officer selecting a sensitive column from public.people raises 42501 — the column '
  'GRANT refuses it, because RLS is row-level and cannot (PRD US-D2, US-J1)'
);

-- 12 — and `select *` too. Asserted separately because this is what a hand-written query
-- actually looks like, and a grant that covered the named-column case while leaving `*`
-- open would pass assertion 11 and leak everything.
select throws_ok(
  $$ select * from public.people $$,
  '42501'::char(5),
  null::text,
  'an officer''s `select * from people` raises 42501 too — `*` is ACL-checked column by '
  'column, so the boundary holds for the query a human actually types'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13 — anon cannot read the directory at all
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-A1: no organizational record reaches an unauthenticated caller, ever. 0013 revokes
-- ALL on the view from anon, so this fails at the GRANT — before RLS is even consulted,
-- which is a stronger property than "returns zero rows".
select pg_temp.login_anon();

select throws_ok(
  $$ select * from public.v_member_directory $$,
  '42501'::char(5),
  null::text,
  'anon cannot read v_member_directory at all — refused at the GRANT, not merely emptied '
  'by a policy (PRD US-A1)'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14 — no registered sensitive column appears in the view
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Assertion 1 pins the thirteen names that exist TODAY. This one is data-driven against
-- sensitive_column_registry (0003, seeded 0016), so it keeps holding when the registry
-- grows: a column classified sensitive in a future migration and simultaneously added to
-- this view fails HERE without anyone editing this file.
--
-- Matched on column_name alone rather than on (table_name, column_name), deliberately: a
-- view renames its sources (r.name -> region_name), so a table-qualified match would find
-- nothing and assert nothing. The registry's column names are distinctive enough that a
-- collision with a benign directory column is not a live risk — and if one ever arises,
-- a false failure here is the correct direction to fail.
select is(
  (select count(*)::int
     from information_schema.columns c
     join public.sensitive_column_registry s
       on s.column_name = c.column_name
    where c.table_schema = 'public'
      and c.table_name   = 'v_member_directory'),
  0,
  'no column named in sensitive_column_registry appears in v_member_directory — the '
  'RA 10173 classification is data, so this assertion survives the registry growing '
  '(CBL Art. VIII §6, DATA_MODEL.md §8.1)'
);


select * from finish();

rollback;
