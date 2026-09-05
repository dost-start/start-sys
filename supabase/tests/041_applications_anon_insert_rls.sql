-- ═══════════════════════════════════════════════════════════════════════════════════
-- 041_applications_anon_insert_rls.sql  —  the only unauthenticated write path
--
-- WHAT:
--    1-2   POSITIVE CONTROL — with a window open, an anonymous INSERT SUCCEEDS and lands
--          as exactly one `draft` row
--    3-8   the six NULL/pin conjuncts: status, person_id, reviewed_by, reviewed_at,
--          proof_drive_file_id and submitted_at each refuse a forged value
--    9-11  term scoping: an archived term, a draft term and a foreign term are all refused
--   12-13  form_kind and window state: the wrong kind of window does not open this one
--   14-15  the window CLOSED and the window still in the FUTURE
--   16-17  anon SELECT returns zero WITH ROWS PRESENT — the anti-enumeration mechanism,
--          asserted behind its own anti-vacuity control
--   18-19  no authenticated role may insert an application either
--   20-21  the partial unique index: two DRAFTS with the same (term, email) coexist, a
--          second LIVE one does not
--
-- ⚠ THE ASSERTION THAT MUST NEVER BE DELETED IS 1. The anon INSERT policy's `exists`
--   sub-select reads public.application_windows AS ANON, so it is itself subject to
--   application_windows_read_anon (0014). If that policy or the 0015 §4 grant behind it is
--   ever narrowed, every anonymous submission fails with an opaque row-level-security error
--   **that reads exactly like a form bug** — and gets "fixed" by widening something worse.
--   Assertion 1 turns that failure into a red CI run in the RLS suite instead of a lost
--   afternoon during application week (BUILD_PLAN S3 risk table).
--
-- ⚠ AND THE ONE TO VERIFY RED, ONCE, BY HAND (BUILD_PLAN S3-T23): comment the `exists`
--   sub-select out of applications_insert_anon in a scratch migration and confirm 14 and 15
--   fail. A closed-window refusal that has never been observed failing is a refusal nobody
--   knows works.
--
-- ⚠ AN INSERT REFUSED BY RLS *RAISES* 42501. Every denial below is therefore throws_ok, not
--   a row count — the UPDATE-fails-silently asymmetry does not apply on this path.
--
-- ⚠ WHICH GUARD FIRES FIRST, on the archived-term case (9): BEFORE triggers run before the
--   RLS WITH CHECK, so trg_applications_freeze_archived raises before the policy is even
--   evaluated. Both raise 42501, so the assertion is stable either way — but if you are
--   debugging it, that is the order.
--
-- CITATION:  BUILD_PLAN S3-T4, S3-T5; DATA_MODEL.md §9, §6/0008; ARCHITECTURE.md §4.1;
--            PRD §3 v1.0 items 5, 7; PRD US-B1, US-B3, US-B4, US-A1.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(22);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- fixture: an OPEN membership_application window on the active term
-- ═══════════════════════════════════════════════════════════════════════════════════
-- application_windows carries `unique (term_id, form_kind)`, so there is exactly ONE row per
-- kind per term and every state change below is an UPDATE of this row, never a second insert.
-- The fixtures file does not create one — no S2 test needed a window — so this file owns it.
insert into public.application_windows (id, term_id, form_kind, opens_at, closes_at)
values ('00000000-0000-4000-9000-000000000001',
        pg_temp.fx_active_term(),
        'membership_application',
        now() - interval '1 day',
        now() + interval '7 days');

-- A second term in `draft`, for assertion 10. `one_active_term` is a PARTIAL unique index on
-- status='active', so a draft term is free to exist alongside the active one. Dates satisfy
-- both CBL Art. V §1 CHECKs (ends in May, ends in the year after it starts).
insert into public.terms (id, label, starts_on, ends_on, status)
values ('00000000-0000-4000-d000-000000000009', '2027-2028',
        date '2027-06-01', date '2028-05-31', 'draft');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-2 — POSITIVE CONTROL
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_anon();

-- 1 — see the ⚠ note in the header. This is the assertion that catches a narrowed
-- application_windows anon policy before an applicant does.
select lives_ok(
  $$ insert into public.applications
       (id, term_id, applicant_email, applicant_given_name, applicant_family_name,
        payload, submit_token_hash, submit_token_expires_at, consented_at)
     values ('00000000-0000-4000-8000-000000000001',
             public.current_term_id(),
             'happy.path@fixture.start-sys.test', 'Happy', 'Path',
             '{"region_code":"NCR"}'::jsonb,
             'not-a-real-digest', now() + interval '1 hour', now()) $$,
  'POSITIVE CONTROL: anon CAN insert an application while a membership_application window '
  'is open — PRD US-B1, "reachable without an account, by link"'
);

-- 1b — REGRESSION (QA hunt, 2026-09-02): an anon INSERT ... RETURNING must RAISE.
-- Postgres applies SELECT policies to the returned row, and `applications` deliberately
-- has NO anon SELECT policy (the anti-enumeration mechanism, 0008 §5). startApplication
-- once used `.insert().select()` — supabase-js's RETURNING form — and every real
-- submission failed 42501 while this suite stayed green, because every insert here was
-- a plain INSERT. This is the assertion that keeps `.select()` off that insert.
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name,
        payload, submit_token_hash, submit_token_expires_at)
     values (public.current_term_id(),
             'returning.probe@fixture.start-sys.test', 'Returning', 'Probe',
             '{"region_code":"NCR"}'::jsonb,
             'not-a-real-digest', now() + interval '1 hour')
     returning id $$,
  '42501'::char(5), null::text,
  'anon INSERT ... RETURNING raises 42501 — the missing anon SELECT policy applies to the '
  'returned row, so application code must mint ids client-side and never .select() this insert'
);

select pg_temp.logout();

-- 2 — and it landed as a draft, not as anything else.
select is(
  (select status::text from public.applications
    where id = '00000000-0000-4000-8000-000000000001'),
  'draft',
  'the anonymous insert lands as `draft` — the state machine starts at draft for everyone, '
  'always (DATA_MODEL.md §3.2)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3-8 — the pin and the NULL block
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Six conjuncts, six assertions, so a failure names the field that became forgeable rather
-- than reporting that "the policy broke".

select pg_temp.login_anon();

-- 3 — **THE ONE THAT MATTERS MOST.** Without the `status = 'draft'` pin an anonymous caller
-- inserts an APPROVED application directly. approved_has_person would then still require a
-- person_id, but relying on a CHECK constraint to close an authorization hole is an accident
-- waiting to be refactored.
select throws_ok(
  $$ insert into public.applications
       (term_id, status, applicant_email, applicant_given_name, applicant_family_name,
        proof_drive_file_id, noa_drive_file_id)
     values (public.current_term_id(), 'pending',
             'forged.status@fixture.start-sys.test', 'Forged', 'Status', 'ref-forged', 'noa-forged') $$,
  '42501'::char(5), null::text,
  'anon cannot insert with status = ''pending'' — the draft pin is what stops an anonymous '
  'caller from writing a reviewable, or approvable, row directly'
);

-- 4 — self-attaching to an existing person would hand an applicant somebody else's record.
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name, person_id)
     values (public.current_term_id(),
             'forged.person@fixture.start-sys.test', 'Forged', 'Person',
             '00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5), null::text,
  'anon cannot insert with a non-null person_id — person_id is written only by '
  'approve_application() (PRD US-C2)'
);

-- 5-6 — self-review. PRD US-C2: "both outcomes write an audit entry naming the deciding
-- officer", which requires that the applicant is not the deciding officer.
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name, reviewed_by)
     values (public.current_term_id(),
             'forged.reviewer@fixture.start-sys.test', 'Forged', 'Reviewer',
             '00000000-0000-4000-a000-000000000003') $$,
  '42501'::char(5), null::text,
  'anon cannot insert with a non-null reviewed_by — an applicant may not name their own '
  'reviewer'
);

select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name, reviewed_at)
     values (public.current_term_id(),
             'forged.reviewedat@fixture.start-sys.test', 'Forged', 'ReviewedAt', now()) $$,
  '42501'::char(5), null::text,
  'anon cannot insert with a non-null reviewed_at — an applicant may not arrive '
  'pre-reviewed'
);

-- 7 — proof metadata is written by finalize_application() AFTER a server-side re-fetch of
-- the provider's own metadata. A client that could stamp it at insert time could claim a
-- document it never uploaded (ARCHITECTURE.md §4.1 step 5).
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name,
        proof_drive_file_id)
     values (public.current_term_id(),
             'forged.proof@fixture.start-sys.test', 'Forged', 'Proof', 'ref-claimed') $$,
  '42501'::char(5), null::text,
  'anon cannot insert with proof_drive_file_id already set — the proof pointer is stamped '
  'only after the server re-verifies the provider''s metadata'
);

-- 8 — submitted_at is the applicant-facing "submitted" moment and belongs to the flip.
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name, submitted_at)
     values (public.current_term_id(),
             'forged.submitted@fixture.start-sys.test', 'Forged', 'Submitted', now()) $$,
  '42501'::char(5), null::text,
  'anon cannot insert with submitted_at already set — that timestamp belongs to the '
  'draft -> pending flip (DATA_MODEL.md §3.2)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-11 — term scoping: the client does not choose its term
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 9 — the ARCHIVED term. See the ⚠ note in the header on which guard fires first.
select throws_ok(
  format(
    $$ insert into public.applications
         (term_id, applicant_email, applicant_given_name, applicant_family_name)
       values (%L, 'archived.term@fixture.start-sys.test', 'Archived', 'Term') $$,
    '00000000-0000-4000-d000-000000000001'),
  '42501'::char(5), null::text,
  'anon cannot insert into an ARCHIVED term — archived means read-only for every role '
  '(DATA_MODEL.md §7.3), and the term pin refuses it independently'
);

-- 10 — the DRAFT term. Nothing but `term_id = current_term_id()` catches this one: there is
-- no window for it and the freeze trigger only guards `archived`.
select throws_ok(
  format(
    $$ insert into public.applications
         (term_id, applicant_email, applicant_given_name, applicant_family_name)
       values (%L, 'draft.term@fixture.start-sys.test', 'Draft', 'Term') $$,
    '00000000-0000-4000-d000-000000000009'),
  '42501'::char(5), null::text,
  'anon cannot insert into a DRAFT term — only `term_id = current_term_id()` catches this '
  'case, which is why the pin is not redundant with the window check'
);

-- 11 — a syntactically valid term id that does not exist. The FK would reject it anyway;
-- what this asserts is that the POLICY refuses first, so a probe cannot learn from the
-- difference between "no such term" and "not the current term".
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name)
     values ('00000000-0000-4000-d000-0000000000ff',
             'ghost.term@fixture.start-sys.test', 'Ghost', 'Term') $$,
  '42501'::char(5), null::text,
  'anon cannot insert against a term id that does not exist — refused by the policy, so a '
  'probe cannot distinguish "no such term" from "not the current term"'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12-15 — the window is a database fact  (PRD US-B4)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- "Enforcement is at the data layer, not by hiding the link." Each state below is produced
-- by UPDATEing the single window row, because `unique (term_id, form_kind)` forbids a second.

-- 12 — WRONG FORM KIND. A committee-application window must not open the membership form.
-- PRD US-G6's internal form and PRD US-B1's public form are different audiences entirely.
update public.application_windows
   set form_kind = 'committee_application'
 where id = '00000000-0000-4000-9000-000000000001';

select pg_temp.login_anon();
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name)
     values (public.current_term_id(),
             'wrong.kind@fixture.start-sys.test', 'Wrong', 'Kind') $$,
  '42501'::char(5), null::text,
  'a committee_application window does NOT open the membership form — the policy names the '
  'form_kind explicitly (PRD US-G6 is a different audience from US-B1)'
);
select pg_temp.logout();

-- 13 — restore it, and confirm the restoration actually works. Without this the four
-- refusals around it could all be passing because the window row was left broken.
update public.application_windows
   set form_kind = 'membership_application'
 where id = '00000000-0000-4000-9000-000000000001';

select pg_temp.login_anon();
select lives_ok(
  $$ insert into public.applications
       (id, term_id, applicant_email, applicant_given_name, applicant_family_name)
     values ('00000000-0000-4000-8000-000000000002',
             public.current_term_id(),
             'reopened@fixture.start-sys.test', 'Reopened', 'Window') $$,
  'ANTI-VACUITY CONTROL: with the window restored, anon can insert again — so 12, 14 and 15 '
  'are measuring the window state and not a permanently broken fixture'
);
select pg_temp.logout();

-- 14 — CLOSED. The forwarded / bookmarked link case: PRD US-B4, "a forwarded or bookmarked
-- link is inert". VERIFY THIS ONE RED at least once (header note).
update public.application_windows
   set opens_at  = now() - interval '30 days',
       closes_at = now() - interval '1 day'
 where id = '00000000-0000-4000-9000-000000000001';

select pg_temp.login_anon();
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name)
     values (public.current_term_id(),
             'too.late@fixture.start-sys.test', 'Too', 'Late') $$,
  '42501'::char(5), null::text,
  'anon cannot submit once the window has CLOSED — PRD US-B4: enforcement is at the data '
  'layer, so a forwarded or bookmarked /apply link is inert'
);
select pg_temp.logout();

-- 15 — NOT YET OPEN. The half that is easy to forget: `now() between opens_at and closes_at`
-- has two ends, and a window scheduled for next month must not accept anything today.
update public.application_windows
   set opens_at  = now() + interval '7 days',
       closes_at = now() + interval '30 days'
 where id = '00000000-0000-4000-9000-000000000001';

select pg_temp.login_anon();
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name)
     values (public.current_term_id(),
             'too.early@fixture.start-sys.test', 'Too', 'Early') $$,
  '42501'::char(5), null::text,
  'anon cannot submit BEFORE the window opens — `now() between opens_at and closes_at` has '
  'two ends and both are asserted'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 16-17 — the anti-enumeration mechanism, asserted against REAL ROWS
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 040 asserted this against an empty table, where a broken policy and a correct one look
-- identical. Two rows exist by now (assertions 1 and 13), so this is the real test.

-- Positive control first, as postgres: the rows genuinely exist.
select is(
  (select count(*)::int from public.applications),
  2,
  'ANTI-VACUITY CONTROL for 17: two applications exist at this point, seen as the session '
  'role'
);

select pg_temp.login_anon();
select is(
  (select count(*)::int from public.applications),
  0,
  'anon reads exactly 0 applications WITH ROWS PRESENT — no anon SELECT policy exists and '
  'that absence IS the anti-enumeration mechanism. **Do not add one to "let the applicant '
  'check their status"** (0008 §5)'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 18-19 — no authenticated role inserts an application either
-- ═══════════════════════════════════════════════════════════════════════════════════
-- There is deliberately no applications INSERT policy for `authenticated` (0008 §5): an
-- application comes from an applicant, and approve_application() creates the person. An
-- admin entering one on somebody's behalf uses the public form.

-- Reopen the window so these two refusals are about the ROLE and not about the window.
update public.application_windows
   set opens_at  = now() - interval '1 day',
       closes_at = now() + interval '7 days'
 where id = '00000000-0000-4000-9000-000000000001';

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name)
     values (public.current_term_id(),
             'crrd.attempt@fixture.start-sys.test', 'Crrd', 'Attempt') $$,
  '42501'::char(5), null::text,
  'crrd_admin cannot insert an application — no INSERT policy names `authenticated`, and '
  '0008 §6 revoked the privilege as well'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok(
  $$ insert into public.applications
       (term_id, applicant_email, applicant_given_name, applicant_family_name)
     values (public.current_term_id(),
             'exec.attempt@fixture.start-sys.test', 'Exec', 'Attempt') $$,
  '42501'::char(5), null::text,
  'exec_admin cannot insert an application either — the widest tier in the system is not '
  'wider here, because this is not a records edit'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20-21 — the partial unique index  (BUILD_PLAN S3-T4 divergence 1)
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 20 — TWO DRAFTS with the same (term_id, applicant_email) coexist. This is the whole point
-- of the partial index: an applicant whose browser dies mid-upload is not locked out, and
-- the form is not an email-enumeration oracle that errors on the second attempt.
select pg_temp.login_anon();
select lives_ok(
  $$ insert into public.applications
       (id, term_id, applicant_email, applicant_given_name, applicant_family_name,
        consented_at)
     values ('00000000-0000-4000-8000-000000000003',
             public.current_term_id(),
             'happy.path@fixture.start-sys.test', 'Happy', 'Path', now()) $$,
  'two DRAFTS with the same (term, email) both live — the uniqueness is deferred to '
  'non-draft rows so a dead browser does not lock an applicant out, and so the INSERT is '
  'not an email-enumeration oracle (S3-T4 divergence 1)'
);
select pg_temp.logout();

-- 21 — but only one LIVE application per email per term. Both rows are promoted here as the
-- session role, bypassing RLS, so what is being asserted is the INDEX and nothing else.
-- pending_has_proof (0008) requires a proof reference on any non-draft row, so both get one.
-- consented_at rides along: 0035's submitted_has_consent CHECK requires it on any
-- non-draft row (the INSERT trigger stamps the version; on UPDATE the value stands).
-- consent was recorded at the draft INSERT above (0035's trigger stamped the server
-- values); an UPDATE must NOT touch it — enforce_consent_server_values raises on any
-- change ("captured at collection and immutable thereafter").
update public.applications
   set status = 'pending', proof_drive_file_id = 'ref-live-1', noa_drive_file_id = 'noa-live-1', submitted_at = now()
 where id = '00000000-0000-4000-8000-000000000001';

select throws_ok(
  $$ update public.applications
        set status = 'pending', proof_drive_file_id = 'ref-live-2', noa_drive_file_id = 'noa-live-2', submitted_at = now()
      where id = '00000000-0000-4000-8000-000000000003' $$,
  '23505'::char(5), null::text,
  'a SECOND live application for the same (term, email) raises 23505 — the constraint still '
  'does its real job. finalize_application() catches exactly this and returns success anyway '
  '(0019 step 8), so the applicant cannot tell'
);


select * from finish();

rollback;
