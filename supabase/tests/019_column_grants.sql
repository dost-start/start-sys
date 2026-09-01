-- ═══════════════════════════════════════════════════════════════════════════════════
-- 019_column_grants.sql  —  the mechanism RLS cannot provide
--
-- WHAT:
--    1-6   the SIX granted columns on public.people are selectable by `authenticated`
--    7-10  four registered sensitive columns are NOT — asserted individually, by name
--   11     ...and so is EVERY column sensitive_column_registry names for `people`, checked
--          data-driven so a column added in 2029 is covered without editing this file
--   12     `authenticated` holds no UPDATE privilege on public.people, at any level
--   13     `authenticated` holds no privilege at all on public.member_id_counters
--   14     anon cannot read public.people at all
--   15     ...while the SAME anon session reads exactly 18 regions — the control that
--          proves 14 is a boundary and not a broken session
--   16     no ordinary table in public grants DELETE to anon or authenticated
--   17     ...and the one documented ordering gap grants nothing, because it has no policy
--
-- WHY THIS FILE EXISTS. **RLS IS ROW-LEVEL AND CANNOT PROTECT A COLUMN.** people_read
--   (0014) lets an `officer` read every ROW of public.people, because PRD US-D2 says
--   officers view member records. Without the column GRANT in 0015, that same officer's
--   `select * from people` returns 600 scholars' birthdates, addresses, contact numbers and
--   school ID numbers — with every policy in 0014 still passing and every row-count
--   assertion in the suite still green. This file is the only place that boundary is
--   measured, and it is what actually delivers PRD US-J1 and Success Metric 8 ("0 sensitive
--   fields returned to Officer or RR tiers").
--
-- WHY 1-6 AND 7-10 ARE BOTH NEEDED. A grant that had been revoked entirely would satisfy
--   7-10 and break every officer screen. A grant that had been widened to the whole table
--   would satisfy 1-6 and leak everything. The pair is the assertion; neither half is.
--
-- WHY 15 IS SCOPED TO BASE TABLES. 0015's DELETE revoke loops over pg_tables, so this
--   assertion is scoped the same way. Views are excluded on purpose: a view holds no rows
--   of its own, and v_member_directory is not auto-updatable (it joins seven relations), so
--   a DELETE through it errors rather than deleting. The primary control everywhere is the
--   MISSING DELETE POLICY, asserted independently and CI-blockingly by
--   001_meta_force_rls.sql and 026_policy_invariants.sql; the revoked privilege is belt to
--   that brace (PRD Reliability NFR, CLAUDE.md "never hard-delete anything").
--
-- ⚠ ONE KNOWN, DOCUMENTED GAP, MEASURED RATHER THAN HIDDEN. public.mfa_recovery_codes is
--   created in 0017, which applies AFTER 0015 — so neither 0015's pg_tables loop nor its
--   explicit revokes could reach it, and Supabase's default privileges left it holding a
--   DELETE grant for anon and authenticated. 0015's own header raises this as an ACTION FOR
--   THE 0017 OWNER (add `revoke all on public.mfa_recovery_codes from anon, authenticated`).
--   Assertion 16 therefore excludes exactly that one table BY NAME so that any OTHER table
--   acquiring a DELETE grant still turns CI red, and assertion 17 proves the stale grant
--   currently grants nothing: 0017 creates no policy of any kind, so FORCE RLS denies the
--   DELETE the privilege permits. WHEN 0017 GAINS ITS REVOKE, DELETE THE EXCLUSION IN 16
--   AND ASSERTION 17 WITH IT — do not leave the exclusion behind as a permanent hole.
--
-- CITATION:  BUILD_PLAN S2-T11; ARCHITECTURE.md §5 ("Column protection — a second,
--            separate mechanism") and §8; DATA_MODEL.md §6/0015, §8.1;
--            PRD §3 v1.0 items 3, 5, 10, 15; PRD US-B1, US-D2, US-J1, US-J5, US-A3;
--            PRD Reliability NFR; PRD §6 Success Metric 8;
--            CBL Art. VIII §6 (RA 10173 as a constitutional obligation).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir ../test-helpers/auth.sql
\ir ../test-helpers/fixtures.sql

select plan(17);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-6 — the six columns that ARE granted
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0015: `revoke all on public.people from authenticated`, then a six-column
-- `grant select`. The grant is an ALLOWLIST — a column is absent until someone argues it
-- in — so these six are the whole of what any tier below crrd_admin can read directly.
-- Row visibility on top of this is people_read; the boundary a caller actually experiences
-- is the INTERSECTION of the two.

select ok(has_column_privilege('authenticated', 'public.people', 'id', 'SELECT'),
  'authenticated may read people.id — the join key every screen needs');

select ok(has_column_privilege('authenticated', 'public.people', 'member_id', 'SELECT'),
  'authenticated may read people.member_id — PRD US-I2 searches on it, and 029 asserts an '
  'officer CAN read it while it cannot read birthdate');

select ok(has_column_privilege('authenticated', 'public.people', 'given_name', 'SELECT'),
  'authenticated may read people.given_name');

select ok(has_column_privilege('authenticated', 'public.people', 'family_name', 'SELECT'),
  'authenticated may read people.family_name');

select ok(has_column_privilege('authenticated', 'public.people', 'join_year', 'SELECT'),
  'authenticated may read people.join_year — PRD US-G2''s "year of membership" filter axis');

select ok(has_column_privilege('authenticated', 'public.people', 'created_at', 'SELECT'),
  'authenticated may read people.created_at');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7-10 — four sensitive columns that are NOT granted, named individually
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Four separate assertions rather than one set difference, so a failure names the column
-- that leaked instead of reporting that a count moved. Each of these is registered in
-- sensitive_column_registry (0016) and each is reachable only through
-- get_person_sensitive() (0012) — role-guarded, gated on a current-term confidentiality
-- acknowledgement (CBL Art. VIII §7.1) and audited on every call.

select ok(not has_column_privilege('authenticated', 'public.people', 'birthdate', 'SELECT'),
  'authenticated may NOT read people.birthdate — PRD US-J1');

select ok(not has_column_privilege('authenticated', 'public.people', 'contact_number', 'SELECT'),
  'authenticated may NOT read people.contact_number — the highest-risk field to leak into '
  'a bulk send (PRD US-G3, US-J1)');

select ok(not has_column_privilege('authenticated', 'public.people', 'address_line', 'SELECT'),
  'authenticated may NOT read people.address_line — PRD US-J1');

select ok(not has_column_privilege('authenticated', 'public.people', 'school_id_no', 'SELECT'),
  'authenticated may NOT read people.school_id_no — a government-scholarship-linked '
  'identifier printed on the Certificate of Registration (PRD US-J1, US-J2)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11 — and the same, driven by the registry rather than by this file's memory
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7-10 pin four columns by name and will keep passing while an eleventh sensitive column
-- is added to `people` and quietly granted. This one reads sensitive_column_registry, which
-- CONVENTIONS.md §13 rule 4 requires a new sensitive column to join in the SAME migration
-- that creates it — so the classification and the grant boundary cannot drift apart
-- without turning CI red.
-- The join to information_schema.columns is a guard, not decoration: has_column_privilege()
-- RAISES on a column that does not exist, so a registry row naming a renamed or dropped
-- column would blow this assertion up rather than fail it. 099_security_invariants.sql owns
-- the "every registry pair names a real column" invariant; this file only measures grants.
select is(
  (select count(*)::int
     from public.sensitive_column_registry s
     join information_schema.columns c
       on c.table_schema = 'public'
      and c.table_name   = 'people'
      and c.column_name  = s.column_name
    where s.table_name = 'people'
      and has_column_privilege('authenticated', 'public.people', s.column_name, 'SELECT')),
  0,
  'NO column that sensitive_column_registry classifies on `people` is selectable by '
  'authenticated — the registry drives the boundary, so an eleventh sensitive column is '
  'covered without editing this file (DATA_MODEL.md §8.1, CONVENTIONS.md §13 rule 4)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12-13 — two privileges that must not exist anywhere
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 12 — has_ANY_column_privilege, not has_table_privilege: the strong form. A column-level
-- UPDATE grant on one harmless column would still be a direct write path around
-- update_member_record() (0030), which is where the role guard, the CBL Art. VIII §7.1
-- acknowledgement check and the audit write live. Widening this to "make a Server Action
-- work" is the exact banned move (CLAUDE.md banned patterns, BUILD_PLAN S5-T7).
select ok(
  not has_any_column_privilege('authenticated', 'public.people', 'UPDATE'),
  'authenticated holds NO update privilege on public.people at any level — member record '
  'edits go through the audited, confidentiality-gated RPC, never a direct table UPDATE'
);

-- 13 — member_id_counters holds the state that makes `2024-001` unique and gapless
-- (PRD US-C3, US-C4). 0014 creates no policy for it and 0015 revokes every privilege, so it
-- is unreachable from any session and touchable only from inside allocate_member_id()
-- (0022, SECURITY DEFINER). A SELECT here would disclose the org's intake volume; an
-- UPDATE would let a session mint a duplicate member ID.
select ok(
  not has_any_column_privilege('authenticated', 'public.member_id_counters', 'SELECT'),
  'authenticated holds NO privilege on public.member_id_counters — member-ID allocation '
  'state is reachable only from inside allocate_member_id() (DATA_MODEL.md §4 mechanism 3)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14 — anon and public.people
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Behavioural, not just declarative: 0015 revokes ALL on `people` from anon and 0014
-- creates no anon policy, so this fails at the GRANT before RLS is consulted. The public
-- application form (PRD US-B1) writes to `applications`; a person row is created only by
-- approve_application() (0023). anon has no business on this table in either direction.
select pg_temp.login_anon();

select throws_ok(
  $$ select given_name from public.people $$,
  '42501'::char(5),
  null::text,
  'anon cannot read public.people at all — refused at the GRANT, which is stronger than '
  'being emptied by a policy (PRD US-A1, US-J1)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 15 — the public application form's one read, from the same anon session
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Asserted here rather than after logout so the anon session is entered once. PRD US-B1:
-- "the form is reachable without an account" and its region dropdown must render for
-- someone who has none. 18, not 17 — RA 12000 (2024) created the Negros Island Region.
-- This is also the pairing that proves assertion 14 is a real boundary and not a broken
-- anon session: the same session that cannot read `people` CAN read `regions`.
select is(
  (select count(*)::int from public.regions),
  18,
  'anon reads exactly 18 regions — the application form''s dropdown, and the control that '
  'proves the anon session in assertion 14 is live rather than broken (PRD US-B1; RA 12000)'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 16-17 — no DELETE privilege anywhere
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 16 — PRD Reliability NFR: "no user-facing operation can delete a membership record", and
-- CLAUDE.md: accidental mass deletion is meant to be STRUCTURALLY impossible, not merely
-- unpolicied. Scoped to ordinary tables, matching 0015's pg_tables loop (see the header on
-- why views are out of scope).
--
-- public.mfa_recovery_codes is excluded BY NAME and only by name — see the ⚠ note in the
-- header. Any other table acquiring a DELETE grant still fails here.
select is(
  (select count(*)::int
     from information_schema.role_table_grants g
     join pg_tables t
       on t.schemaname = g.table_schema
      and t.tablename  = g.table_name
    where g.table_schema   = 'public'
      and g.privilege_type = 'DELETE'
      and g.grantee in ('anon', 'authenticated')
      and g.table_name <> 'mfa_recovery_codes'),
  0,
  'no ordinary table in public grants DELETE to anon or authenticated — the missing DELETE '
  'POLICY is the control, this revoked privilege is the belt to it (PRD Reliability NFR)'
);

-- 17 — and the excluded table grants nothing in practice. 0017 creates
-- mfa_recovery_codes with ENABLE + FORCE ROW LEVEL SECURITY and NO POLICY OF ANY KIND, so
-- deny-by-default refuses every operation including the DELETE its stale privilege
-- nominally permits. Access is only ever through issue_recovery_codes() and
-- consume_recovery_code(), both SECURITY DEFINER and both revoked from anon (PRD US-A3).
--
-- ⚠ WHEN 0017 GAINS `revoke all on public.mfa_recovery_codes from anon, authenticated`,
--   drop the `<>` exclusion from assertion 16 and delete this assertion. The exclusion is a
--   record of a known ordering gap, not a licence for one.
select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'mfa_recovery_codes'),
  0,
  'public.mfa_recovery_codes has ZERO policies, so FORCE RLS denies the DELETE its stale '
  'default privilege permits — the documented 0015/0017 ordering gap grants nothing'
);


select * from finish();

rollback;
