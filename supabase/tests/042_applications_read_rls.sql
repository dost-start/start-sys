-- ═══════════════════════════════════════════════════════════════════════════════════
-- 042_applications_read_rls.sql  —  who may read an application, and who may not
--
-- WHAT:
--    1-9   the nine-fixture EXACT row-count matrix on public.applications: three roles see
--          all three rows, six see exactly zero
--   10-11  the exact COLUMN SET of both new tables, pinned literally
--   12-13  ENABLE + FORCE row level security on both
--   14-19  the negative space: no DELETE policy, no anon SELECT policy, no anon UPDATE
--          policy, no policy naming a read-only tier, no table-level write privilege for
--          `authenticated`, and no write policy at all on renewal_submissions
--   20-24  the renewal_submissions read matrix, including "a person reads their own"
--
-- WHY THREE ROLES AND NOT FOUR. PRD US-C1 gives application review to CRRD and Executive
--   Admins; ARCHITECTURE.md §5 gives moderators the day-to-day operational surface, because
--   **you cannot review an application without reading it**. Everyone else is out, and two
--   of the exclusions are the interesting ones:
--     · tech_admin — PRD OQ-5, default answer NO. "Configure the system and control access"
--       is not "read everyone's address", and an application row is the densest PII object
--       in the schema: a raw birthdate, address, contact number and school ID number, plus
--       a pointer to a Certificate of Registration.
--     · officer — PRD US-D2 / US-J1. The Special Advisor sits in this tier (CBL Art. III
--       §2.9, Art. X §2.4-2.5) and must not read the records of people whose appeals they
--       adjudicate.
--
-- ⚠ WHAT THIS FILE DELIBERATELY DOES **NOT** ASSERT: the column-level narrowing of
--   `applications`. Today `authenticated` holds table-level SELECT on all 21 columns and the
--   ROW policy is the whole boundary. S4-T4 (0027_applications_review_grants.sql) revokes
--   that and grants back fifteen renderable columns — withholding applicant_email, payload
--   and proof_web_view_link so that the only path to them is the audited
--   get_application_detail() RPC. Asserting today's wide column set here would create a test
--   S4 has to delete, which is the worst kind of test. **The exact-column-set assertion for
--   applications belongs in 046_applications_review_rls.sql.** Assertions 10-11 pin the TABLE
--   SHAPE instead, which is durable: a column added later fails here whether or not anyone
--   remembers to classify it.
--
-- ⚠ POSITIVE CONTROL BEFORE DENIALS (1). A malformed claim makes auth.uid() NULL, which makes
--   auth_role() NULL, which makes every policy return zero rows — and the six zeroes below
--   would then all pass for the wrong reason.
--
-- CITATION:  BUILD_PLAN S3-T4, S3-T5; DATA_MODEL.md §6/0008, §8.1; ARCHITECTURE.md §5;
--            PRD §3 v1.0 items 8, 15; PRD US-C1, US-D2, US-G7, US-H4, US-J1; PRD OQ-5, OQ-6;
--            CBL Art. III §2.9, Art. VIII §6, Art. X §2.4-2.5.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(24);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- fixture: three applications and one renewal submission
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Seeded as the session role: `applications` has no INSERT policy for `authenticated` and
-- 0008 §6 revoked the privilege as well, so this is a privileged act by construction — the
-- same shape as the people seed in test-helpers/fixtures.sql.
--
-- THREE, not one, and in three different states, so an accidentally status-filtered read
-- policy shows up as a wrong count rather than as a plausible one.
-- consented_at: any non-null value — 0035's BEFORE INSERT trigger overwrites it with
-- now() and stamps the current notice version, and the submitted_has_consent CHECK
-- requires it on every non-draft row.
insert into public.applications
  (id, term_id, status, applicant_email, applicant_given_name, applicant_family_name,
   payload, proof_drive_file_id, submitted_at, consented_at)
values
  ('00000000-0000-4000-8000-00000000000a', pg_temp.fx_active_term(), 'draft',
   'draft.applicant@fixture.start-sys.test', 'Draft', 'Applicant',
   '{"school_id_no":"FIXT-APP-A"}'::jsonb, null, null, null),
  ('00000000-0000-4000-8000-00000000000b', pg_temp.fx_active_term(), 'pending',
   'pending.applicant@fixture.start-sys.test', 'Pending', 'Applicant',
   '{"school_id_no":"FIXT-APP-B"}'::jsonb, 'ref-pending-b', now(), now()),
  ('00000000-0000-4000-8000-00000000000c', pg_temp.fx_active_term(), 'rejected',
   'rejected.applicant@fixture.start-sys.test', 'Rejected', 'Applicant',
   '{"school_id_no":"FIXT-APP-C"}'::jsonb, 'ref-rejected-c', now(), now());

-- One renewal submission, belonging to P4 — the MEMBER fixture's person. That is what makes
-- assertion 21 a real scoping test: the member sees a row because it is theirs, not because
-- the policy admits everyone.
insert into public.renewal_submissions (id, person_id, term_id, payload)
values ('00000000-0000-4000-7000-000000000001',
        '00000000-0000-4000-b000-000000000004',
        pg_temp.fx_active_term(),
        '{"confirmed":true}'::jsonb);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-9 — the nine-fixture exact row-count matrix
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Every assertion is `is(count, N)`. NEVER `> 0` — a `> 0` assertion passes against a policy
-- that returns everything, which is the failure this matrix exists to catch.

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.applications), 3,
  'POSITIVE CONTROL — crrd_admin (the CCDO) reads all 3 applications regardless of status '
  '(PRD US-C1). Every zero below is trusted only because this is 3'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is(
  (select count(*)::int from public.applications), 3,
  'exec_admin reads all 3 — PRD US-C1 names CRRD and Executive Admins together'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select is(
  (select count(*)::int from public.applications), 3,
  'moderator reads all 3 — the operational tier; you cannot review an application without '
  'reading it (ARCHITECTURE.md §5)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is(
  (select count(*)::int from public.applications), 0,
  'tech_admin reads 0 applications — PRD OQ-5, default NO. "Configure the system and '
  'control access" is not "read every applicant''s birthdate and address"'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is(
  (select count(*)::int from public.applications), 0,
  'officer reads 0 applications — PRD US-D2/US-J1, and the Special Advisor sits in this '
  'tier (CBL Art. III §2.9, Art. X §2.4-2.5)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is(
  (select count(*)::int from public.applications), 0,
  'regional_rep_a reads 0 applications — a rep''s scope is their region''s MEMBERS, never '
  'the intake queue (PRD US-F1)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select is(
  (select count(*)::int from public.applications), 0,
  'regional_rep_b reads 0 applications — asserted separately from rep_a so a policy that '
  'happened to admit one region is still caught'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is(
  (select count(*)::int from public.applications), 0,
  'member reads 0 applications — PRD §2: "members can only access forms"'
);
select pg_temp.logout();

select pg_temp.login_anon();
select is(
  (select count(*)::int from public.applications), 0,
  'anon reads 0 applications with three rows present — the missing anon SELECT policy IS '
  'the anti-enumeration mechanism (0008 §5)'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-11 — the exact table shapes, pinned literally
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A column added to either table later fails HERE, which forces the author to decide whether
-- it is sensitive (CONVENTIONS.md §13 rule 4 — register it in the same migration) before the
-- test can be updated. That is the point: the failure is the prompt.

select columns_are(
  'public'::name, 'applications'::name,
  array[
    'id', 'term_id', 'status',
    'applicant_email', 'applicant_given_name', 'applicant_family_name', 'payload',
    'proof_drive_file_id', 'proof_web_view_link', 'proof_mime_type', 'proof_size_bytes',
    'proof_verified_at',
    'submit_token_hash', 'submit_token_expires_at',
    'person_id', 'reviewed_by', 'reviewed_at', 'review_note',
    'redacted_at', 'submitted_at', 'created_at'
  ]::name[],
  'public.applications has exactly its 21 documented columns — including the two S3-T4 '
  'divergences, submit_token_hash and submit_token_expires_at'
);

select columns_are(
  'public'::name, 'renewal_submissions'::name,
  array['id', 'person_id', 'term_id', 'payload', 'submitted_at']::name[],
  'public.renewal_submissions has exactly its 5 documented columns (DATA_MODEL.md §6/0008)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12-13 — ENABLE + FORCE on both
-- ═══════════════════════════════════════════════════════════════════════════════════
-- FORCE matters and ENABLE alone is not enough: a table owner bypasses non-forced RLS and
-- the Supabase migration role IS the owner. 001_meta_force_rls.sql already enumerates
-- pg_class for this, but a table this exposed gets its own named assertion.

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.applications'::regclass),
  'public.applications has BOTH enable and force row level security'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.renewal_submissions'::regclass),
  'public.renewal_submissions has BOTH enable and force row level security'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14-19 — the negative space
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Everything below asserts an ABSENCE. These are the assertions that fail in 2029 when
-- somebody widens a boundary to make a screen work.

-- 14 — PRD Reliability NFR / CLAUDE.md: no DELETE policy anywhere, and none may be added.
-- An application that should not have been submitted is REDACTED (0020), never removed.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('applications', 'renewal_submissions')
      and cmd = 'DELETE'),
  0,
  'ZERO delete policies on applications and renewal_submissions — removal is redaction '
  '(0020), never deletion'
);

-- 15 — **the anti-enumeration mechanism, asserted as an absence rather than as a behaviour.**
-- Assertion 9 shows anon reads nothing; this shows WHY, and it is the one that catches
-- somebody adding a policy to "let the applicant check their status".
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'applications'
      and cmd in ('SELECT', 'ALL') and 'anon' = any(roles)),
  0,
  'ZERO anon SELECT policies on applications — that absence IS the anti-enumeration '
  'mechanism. An accountless status-lookup surface is a way to ask the database whether a '
  'named person applied, and the answer is PII'
);

-- 16 — and the reason finalize_application() exists at all. If this assertion ever fails,
-- the three-step upload flow has been "simplified" into a probeable predicate.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'applications'
      and cmd in ('UPDATE', 'ALL') and 'anon' = any(roles)),
  0,
  'ZERO anon UPDATE policies on applications — the draft -> pending flip goes through '
  'finalize_application()''s one-row token gate, which is the whole reason that function '
  'exists (BUILD_PLAN S3-T6)'
);

-- 17 — no policy on this table names a read-only or excluded tier, in ANY command. PRD
-- US-D2's "view-only" and US-F2's "RRs cannot alter records" are MISSING POLICIES, and
-- Success Metric 8 is checked by looking for their absence rather than by trusting a UI.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'applications'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~
          '''(officer|regional_rep|member|tech_admin)'''),
  0,
  'NO policy on applications names officer, regional_rep, member or tech_admin — the '
  'exclusions are absences in the policy text, not hidden buttons (PRD US-D2, US-F2, OQ-5)'
);

-- 18 — the privilege half. A policy without a privilege grants nothing, and the reverse is
-- also worth pinning: `authenticated` holds no table-level write on applications at all.
-- The applications_update POLICY is therefore currently inert, deliberately — S4-T4 re-grants
-- UPDATE narrowed to five editable columns, which leaves this table-level assertion true
-- (column grants do not satisfy has_table_privilege).
select ok(
  not has_table_privilege('authenticated', 'public.applications', 'insert')
  and not has_table_privilege('authenticated', 'public.applications', 'update')
  and not has_table_privilege('authenticated', 'public.applications', 'delete'),
  'authenticated holds NO table-level insert, update or delete on applications — the '
  'decision path is the SECURITY DEFINER functions in 0023/0024, and S4-T4 re-grants only '
  'five editable columns'
);

-- 19 — renewal_submissions is READ-ONLY FOR EVERYONE until v1.2 adds the member INSERT
-- policy deliberately. The read policy ships now only because 026_policy_invariants.sql
-- requires every non-whitelisted table to have one (see 0008's header collision note).
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'renewal_submissions'
      and cmd in ('INSERT', 'UPDATE', 'ALL')),
  0,
  'renewal_submissions has ZERO write policies — v1.2 adds the member INSERT policy on '
  'purpose, with its own assertions; until then no human role can write it'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20-24 — the renewal_submissions read matrix
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-H4: the renewal form is the ONE surface a departed member keeps. So the read policy
-- admits the three operational roles (reviewing a renewal is their job, PRD US-G7) and the
-- person themselves — and nobody else.

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.renewal_submissions), 1,
  'POSITIVE CONTROL — crrd_admin reads the renewal submission (PRD US-G7: CRRD resolves and '
  'reviews the renewal list)'
);
select pg_temp.logout();

-- 21 — the scoping half. The member fixture's person IS the submitter, so a row appears —
-- which is what makes assertions 22-24 meaningful rather than an artefact of an empty table.
select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member (person P4)
select is(
  (select count(*)::int from public.renewal_submissions), 1,
  'the member reads exactly 1 renewal submission — THEIR OWN, matched on auth_person_id(). '
  'PRD US-H4: the renewal form is the one surface a departed member keeps'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is(
  (select count(*)::int from public.renewal_submissions), 0,
  'officer reads 0 renewal submissions — a renewal body carries the same PII as an '
  'application payload and is registered sensitive alongside it'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is(
  (select count(*)::int from public.renewal_submissions), 0,
  'regional_rep_a reads 0 renewal submissions — regional scope is rows on memberships, '
  'never form bodies (PRD US-J1)'
);
select pg_temp.logout();

select pg_temp.login_anon();
select is(
  (select count(*)::int from public.renewal_submissions), 0,
  'anon reads 0 renewal submissions — the renewal surface belongs to people who already '
  'have an account'
);
select pg_temp.logout();


select * from finish();

rollback;
