-- ═══════════════════════════════════════════════════════════════════════════════════
-- 046_applications_review_rls.sql  —  the review boundary: rows AND columns
--
-- WHAT:
--    1-9    the nine-fixture EXACT row-count matrix on public.applications
--   10-25   the EXACT visible column set: a set-equality assertion against a literal list,
--           then all fifteen granted columns individually
--   26-31   the six WITHHELD columns, asserted individually
--   32-34   the behavioural half — a reviewer session actually raises 42501 on payload, on
--           applicant_email, and on `select *`
--   35-39   the UPDATE column set: exactly three, and four of the withheld ones named
--   40-43   the negative space — no DELETE policy, both RLS flags, no write policy naming a
--           read-only tier
--   44-45   the anonymous intake path survived 0027's revoke
--
-- WHY BOTH HALVES, IN ONE FILE. **RLS IS ROW-LEVEL AND CANNOT PROTECT A COLUMN.**
--   042_applications_read_rls.sql asserts the ROW boundary and says so explicitly — it
--   deliberately does not assert columns, because at the time it was written `authenticated`
--   held table-level SELECT on all 21 and asserting that would have created a test S4 had to
--   delete. 0027_applications_review_grants.sql closes the column half, and 042's own header
--   names THIS FILE as where the exact-column-set assertion belongs. Assertions 1-9 are
--   repeated here rather than left to 042 because a column-set assertion over an EMPTY result
--   set proves nothing: the counts are what make assertions 10-34 mean something.
--
-- ⚠ POSITIVE CONTROL FIRST (1). A malformed claim makes auth.uid() NULL, which makes
--   auth_role() NULL, which makes every policy return zero rows — and the six zeroes below
--   would all pass for the wrong reason. Nothing here is trusted until assertion 1 is 5.
--
-- ⚠ THE RED THIS FILE MUST BE ABLE TO SHOW (BUILD_PLAN S4-T23). Add `officer` to the
--   applications_read role list in a scratch migration and assertion 5 fails, naming the
--   officer fixture's count. Add `grant select (payload) … to authenticated` and assertions
--   10, 27 and 32 all fail. Verify both by hand once; a boundary test that has never gone red
--   is a boundary test nobody knows works.
--
-- CITATION:  BUILD_PLAN S4-T4, S4-T8, S4-T23; ARCHITECTURE.md §5; DATA_MODEL.md §6/0008,
--            §6/0015, §8.1; PRD §3 v1.0 items 8, 10; PRD US-C1, US-D2, US-F2, US-J1, US-J2;
--            PRD OQ-5, OQ-6; CBL Art. III §2.9, Art. VIII §6, Art. X §2.4-2.5;
--            CONVENTIONS.md §8.1 (nine fixture names, exact counts, never `> 0`).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/review-fixtures.psql

select plan(45);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-9 — the nine-fixture exact row-count matrix
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Five applications, in four states (helpers/review-fixtures.psql §4). Every assertion is
-- `is(count, N)`. NEVER `> 0` — a `> 0` assertion passes against a policy that returns
-- everything, which is the failure this matrix exists to catch (CONVENTIONS.md §8.1).
--
-- `count(*)` is deliberately used rather than `select id`: Postgres permits count(*) to a
-- role holding SELECT on ANY column, so these nine assertions measure the ROW policy alone
-- and are not contaminated by the column grant that assertions 10-31 measure separately.

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.applications), 5,
  'POSITIVE CONTROL — crrd_admin (the CCDO) reads all 5 applications regardless of status '
  '(PRD US-C1). Every zero below is trusted only because this is 5'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is(
  (select count(*)::int from public.applications), 5,
  'exec_admin reads all 5 — PRD US-C1 names CRRD and Executive Admins together'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select is(
  (select count(*)::int from public.applications), 5,
  'crrd_deputy reads all 5 — the operational tier. ARCHITECTURE.md §5: you cannot review an '
  'application without reading it'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is(
  (select count(*)::int from public.applications), 0,
  'tech_admin reads 0 applications — PRD OQ-5, default NO. "Configure the system and control '
  'access" is not "read every applicant''s birthdate, address and school ID"'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is(
  (select count(*)::int from public.applications), 0,
  'officer reads 0 applications — PRD US-D2/US-J1. The Special Advisor sits in this tier '
  '(CBL Art. III §2.9) and independently reviews appeals (Art. X §2.4-2.5), so an '
  'adjudicator must not also see the intake queue'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is(
  (select count(*)::int from public.applications), 0,
  'regional_rep_a reads 0 applications — a rep''s scope is their region''s MEMBERS, never the '
  'intake queue (PRD US-F1)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select is(
  (select count(*)::int from public.applications), 0,
  'regional_rep_b reads 0 applications — asserted separately from rep_a so a per-region '
  'predicate accidentally admitting one region cannot hide behind the other'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select is(
  (select count(*)::int from public.applications), 0,
  'member reads 0 applications — PRD §2: "members can only access forms". Not even their own '
  'application, which is why there is no accountless status-lookup surface either'
);
select pg_temp.logout();

select pg_temp.login_anon();
select is(
  (select count(*)::int from public.applications), 0,
  'anon reads 0 applications and gets ZERO ROWS rather than 42501 — the missing SELECT policy '
  'is the anti-enumeration mechanism, and it answers identically whether or not the table has '
  'rows (0008 §6)'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10 — THE EXACT VISIBLE COLUMN SET
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ★ The assertion 0027 exists for, and the one that makes a future widening fail in CI
--   rather than pass in review. ★
--
-- Written as set-equality against a LITERAL list, over the table's FULL column list read
-- from pg_attribute. Two properties follow, and both matter:
--   · granting a withheld column fails this immediately
--   · adding a NEW column to `applications` and granting it fails this too — a column that
--     nobody has classified defaults to failing rather than to leaking
--
-- pg_attribute rather than information_schema.columns, because information_schema filters by
-- the CURRENT user's privileges and would quietly shrink the universe being tested.
select set_eq(
  $$ select a.attname::text
       from pg_attribute a
      where a.attrelid = 'public.applications'::regclass
        and a.attnum > 0
        and not a.attisdropped
        and has_column_privilege('authenticated', 'public.applications', a.attname, 'SELECT') $$,
  ARRAY[
    'id', 'term_id', 'status',
    'applicant_given_name', 'applicant_family_name',
    'proof_drive_file_id', 'proof_mime_type', 'proof_size_bytes', 'proof_verified_at',
    'noa_drive_file_id', 'noa_mime_type', 'noa_size_bytes', 'noa_verified_at',
    'person_id', 'reviewed_by', 'reviewed_at', 'review_note',
    'submitted_at', 'created_at'
  ]::text[],
  'EXACT SELECT column set on applications is the NINETEEN renderable columns and nothing '
  'else (0027 + the four noa_* columns of 0040). A new column, or a widened grant, fails here'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11-25 — the fifteen, individually
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Individually as well as as a set, so a failure names the column rather than printing a
-- diff of two 15-element arrays at 2am.

select ok(has_column_privilege('authenticated', 'public.applications', 'id', 'SELECT'),
  'id is readable — row identity, and the proof proxy''s path parameter');

select ok(has_column_privilege('authenticated', 'public.applications', 'term_id', 'SELECT'),
  'term_id is readable — the term filter and the historical-retrieval selector (PRD US-H3)');

select ok(has_column_privilege('authenticated', 'public.applications', 'status', 'SELECT'),
  'status is readable — the Pending/Approved/Rejected queue filter (PRD US-C1)');

select ok(has_column_privilege('authenticated', 'public.applications', 'applicant_given_name', 'SELECT'),
  'applicant_given_name is readable — a name is not withheld anywhere in this system');

select ok(has_column_privilege('authenticated', 'public.applications', 'applicant_family_name', 'SELECT'),
  'applicant_family_name is readable');

select ok(has_column_privilege('authenticated', 'public.applications', 'proof_drive_file_id', 'SELECT'),
  'proof_drive_file_id IS readable, though registered sensitive — the proof proxy authorizes '
  'by selecting it with the CALLER''S OWN JWT (ARCHITECTURE.md §4.1 step 7). The registry '
  'drives masking and the purges, not GRANTs');

select ok(has_column_privilege('authenticated', 'public.applications', 'proof_mime_type', 'SELECT'),
  'proof_mime_type is readable — it decides PDF iframe vs <img> vs the HEIC notice, and the '
  'proxy sets Content-Type from the STORED value, never from the provider''s response header');

select ok(has_column_privilege('authenticated', 'public.applications', 'proof_size_bytes', 'SELECT'),
  'proof_size_bytes is readable — the reviewer''s sanity check on a truncated upload');

select ok(has_column_privilege('authenticated', 'public.applications', 'proof_verified_at', 'SELECT'),
  'proof_verified_at is readable — whether the server re-verified provider metadata, which is '
  'what makes the size and MIME trustworthy at all');

select ok(has_column_privilege('authenticated', 'public.applications', 'person_id', 'SELECT'),
  'person_id is readable — links an approved application to the member it produced');

select ok(has_column_privilege('authenticated', 'public.applications', 'reviewed_by', 'SELECT'),
  'reviewed_by is readable — PRD US-C2: the deciding officer is named, and the screen must be '
  'able to show what the audit log records');

select ok(has_column_privilege('authenticated', 'public.applications', 'reviewed_at', 'SELECT'),
  'reviewed_at is readable');

select ok(has_column_privilege('authenticated', 'public.applications', 'review_note', 'SELECT'),
  'review_note is readable — PRD US-C2: rejection records a reason, and a reason nobody can '
  'read is not recorded in any useful sense');

select ok(has_column_privilege('authenticated', 'public.applications', 'submitted_at', 'SELECT'),
  'submitted_at is readable — the default sort is submission time (PRD US-C1)');

select ok(has_column_privilege('authenticated', 'public.applications', 'created_at', 'SELECT'),
  'created_at is readable');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 26-31 — the six WITHHELD, individually
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Each one is a `not has_column_privilege` assertion in its own right, so widening any single
-- column fails with that column's name and its reason attached.

select ok(not has_column_privilege('authenticated', 'public.applications', 'applicant_email', 'SELECT'),
  'applicant_email is NOT readable by any session — RA 10173 sensitive (0008 §7). Reachable '
  'only through the audited get_application_detail() (0026)');

select ok(not has_column_privilege('authenticated', 'public.applications', 'payload', 'SELECT'),
  'payload is NOT readable by any session — the densest PII object in the schema (birthdate, '
  'address, contact number, school ID). PRD US-C1''s "every submitted field" is served by the '
  'audited RPC, never by widening this grant');

select ok(not has_column_privilege('authenticated', 'public.applications', 'proof_web_view_link', 'SELECT'),
  'proof_web_view_link is NOT readable by any session — PRD US-J2. A provider URL is one '
  'forwarded link from a Certificate of Registration on the public internet, and it would '
  'bypass the audited proxy entirely. 0026 strips it from the RPC output as well');

select ok(not has_column_privilege('authenticated', 'public.applications', 'submit_token_hash', 'SELECT'),
  'submit_token_hash is NOT readable — a live authorization secret for finalize_application() '
  '(0019), not a record field');

select ok(not has_column_privilege('authenticated', 'public.applications', 'submit_token_expires_at', 'SELECT'),
  'submit_token_expires_at is NOT readable — withheld alongside its hash; meaningless without '
  'it and an invitation to ask for the token');

select ok(not has_column_privilege('authenticated', 'public.applications', 'redacted_at', 'SELECT'),
  'redacted_at is NOT readable — the deliberate sixteenth, declined (0027 §1). Nothing in v1.0 '
  'renders it on the LIST, and the detail page reads the whole row through 0026 where it is '
  'returned like any other field');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 32-34 — the behavioural half
-- ═══════════════════════════════════════════════════════════════════════════════════
-- has_column_privilege() reads the catalog; these three read the actual refusal a
-- hand-written query gets. Assertion 34 is the one that matters most in practice, because
-- `select *` is what a session ACTUALLY types — and with column grants it expands to all 21
-- columns and is refused whole rather than silently narrowed.

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

select throws_ok(
  $$ select payload from public.applications limit 1 $$,
  '42501'::char(5), null::text,
  'crrd_admin — the widest-reading role in the system — still raises 42501 on payload. The '
  'CCDO reads sensitive data through the audited RPC, not through a hand-written select'
);

select throws_ok(
  $$ select applicant_email from public.applications limit 1 $$,
  '42501'::char(5), null::text,
  'crrd_admin raises 42501 on applicant_email — same mechanism, same reason'
);

select throws_ok(
  $$ select * from public.applications limit 1 $$,
  '42501'::char(5), null::text,
  'crrd_admin raises 42501 on `select *` — the query a session actually types. A column grant '
  'refuses the whole statement rather than quietly returning fewer columns, which is the '
  'correct failure direction'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 35-39 — the UPDATE column set
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD §4: "applicant contacts CRRD, CRRD edits the application." Three columns wide, and the
-- absences are the point — granting `status` would let a reviewer approve an application with
-- a hand-written UPDATE, skipping the member-ID mint, the membership insert and the person
-- resolution, producing an "approved" row with no member behind it (PRD US-C3).

select set_eq(
  $$ select a.attname::text
       from pg_attribute a
      where a.attrelid = 'public.applications'::regclass
        and a.attnum > 0
        and not a.attisdropped
        and has_column_privilege('authenticated', 'public.applications', a.attname, 'UPDATE') $$,
  ARRAY['applicant_given_name', 'applicant_family_name', 'review_note']::text[],
  'EXACT UPDATE column set on applications is exactly THREE (0027 §2). payload is v1.1 and '
  'deliberately absent: a blind whole-object overwrite would wipe ten fields to correct one, '
  'and it cannot be read to be edited anyway'
);

select ok(not has_column_privilege('authenticated', 'public.applications', 'status', 'UPDATE'),
  'status is NOT updatable by any session — the decision path is approve_application() and '
  'reject_application(), and nothing else. The privilege is the answer; the CHECK and the '
  'transition trigger are the backstop');

select ok(not has_column_privilege('authenticated', 'public.applications', 'person_id', 'UPDATE'),
  'person_id is NOT updatable — written only by approve_application(), in the transaction '
  'that mints the member ID (PRD US-C3)');

select ok(not has_column_privilege('authenticated', 'public.applications', 'reviewed_by', 'UPDATE'),
  'reviewed_by is NOT updatable — a reviewer must not be able to attribute their own decision '
  'to somebody else (PRD US-C2, US-I1)');

select ok(not has_column_privilege('authenticated', 'public.applications', 'proof_drive_file_id', 'UPDATE'),
  'proof_drive_file_id is NOT updatable — proof metadata is written only by '
  'finalize_application() from a server-side re-fetch of the provider''s own metadata, never '
  'from a claim');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 40-43 — the negative space
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'applications' and cmd = 'DELETE'), 0,
  'ZERO DELETE policies on applications — none exists anywhere in the schema and none may be '
  'added (CLAUDE.md, PRD Reliability NFR). An application that should not have been submitted '
  'is REDACTED (0020), never removed'
);

select ok(
  (select c.relrowsecurity from pg_class c
    where c.oid = 'public.applications'::regclass),
  'applications has ENABLE ROW LEVEL SECURITY'
);

select ok(
  (select c.relforcerowsecurity from pg_class c
    where c.oid = 'public.applications'::regclass),
  'applications has FORCE ROW LEVEL SECURITY — ENABLE alone is not enough, because a table '
  'OWNER bypasses non-forced RLS and the Supabase migration role IS the owner'
);

-- PRD US-D2 and US-F2 as a property of the DATABASE rather than of the UI: "no update, create
-- or delete path EXISTS for the Officer tier on any record", "this is enforced at the data
-- layer, so it holds even if a UI control is mistakenly rendered."
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename  = 'applications'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      -- \m and \M are Postgres word boundaries, so `crrd_admin` does not match `admin`
      -- and `crrd_deputy` does not match anything here.
      and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
          ~ '\m(officer|regional_rep|member|tech_admin)\M'
  ), 0,
  'NO write policy on applications names officer, regional_rep, member or tech_admin. '
  '"Officers cannot edit" is a MISSING POLICY, not a missing button (PRD US-D2, US-F2)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 44-45 — the anonymous intake path survived 0027's revoke
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0027 opens with `revoke all on public.applications from authenticated`, which is exactly the
-- statement a future maintainer tidies into "from anon, authenticated". If that happens,
-- /apply breaks during application week with an error that reads like a form bug. 0027
-- asserts these two at MIGRATION time; they are asserted again here so the breakage lands in
-- CI as well as in the migration.

select ok(has_table_privilege('anon', 'public.applications', 'INSERT'),
  'anon RETAINS INSERT on applications — the public form writes as the anon database role '
  '(the Server Action holds no session). applications_insert_anon is the control; the '
  'privilege is a prerequisite for it doing anything (PRD US-B1)');

select ok(has_table_privilege('anon', 'public.applications', 'SELECT'),
  'anon RETAINS SELECT on applications — kept so an anonymous read returns ZERO ROWS from the '
  'missing policy rather than 42501 from a missing privilege. Both refuse; the empty set is '
  'the better anti-enumeration answer (0008 §6)');


select * from finish();

rollback;
