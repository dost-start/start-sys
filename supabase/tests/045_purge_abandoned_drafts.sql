-- ═══════════════════════════════════════════════════════════════════════════════════
-- 045_purge_abandoned_drafts.sql  —  the weakest retention basis in the schema
--
-- WHAT:
--    1-3   POSITIVE CONTROL — exactly one of five seeded rows is selected, and the function
--          returns BOTH its id and its document reference
--    4-9   what redaction actually does: the PII is gone, the SKELETON survives, and the
--          document reference is deliberately kept so the caller can delete the file
--   10-13  what it must NOT touch: a fresh draft, an already-redacted row, a submitted
--          application, and a draft in an ARCHIVED term
--   14     idempotency: a second run returns nothing
--   15     argument validation
--   16-18  no human role may call it at all
--
-- WHY THIS FUNCTION EXISTS. **A DRAFT ROW HOLDS A REAL PERSON'S BIRTHDATE, ADDRESS, CONTACT
--   NUMBER AND SCHOOL ID NUMBER FOR SOMEONE WHO NEVER COMPLETED A SUBMISSION.** They filled
--   in the form, their upload failed or their browser died, and they walked away. There is no
--   membership, no decision and no relationship — so under RA 10173, which CBL Art. VIII §6
--   makes a constitutional obligation of this organization, there is nothing to justify
--   keeping it. Thirty days is the boring default: long enough that a genuine retry still
--   finds their draft, short enough that abandoned PII does not pile up across an
--   application period.
--
-- ⚠ ASSERTION 9 IS THE ONE THAT LOOKS WRONG AND IS NOT. proof_drive_file_id is deliberately
--   NOT nulled. Two reasons: mechanically, UPDATE ... RETURNING returns the NEW value, so
--   nulling it in the same statement would hand the caller nothing to delete; and by design,
--   the reference is the record that a document once existed here. It becomes a dangling
--   pointer the moment the job deletes the object, which is the correct end state — the
--   pointer was never the PII, the file was. redact_expired_pii() (0012) has exactly this
--   shape for exactly this reason.
--
-- ⚠ ASSERTION 13 IS A DOCUMENTED GAP, NOT A DOCUMENTED FEATURE. A draft in an archived term
--   is SKIPPED, because trg_applications_freeze_archived would raise 42501 and abort the
--   whole nightly sweep — every other row included, every night. Filtering keeps the job
--   green; the residual is that a draft created in the last ~30 days before a rollover is
--   never redacted by this function. The correct owner is the rollover runbook (sweep drafts
--   BEFORE archiving the term). Raised in the PR for the v1.2 rollover owner. **Do not close
--   the gap by weakening the freeze trigger.**
--
-- ⚠ IT REDACTS, IT NEVER DELETES. CLAUDE.md and the PRD Reliability NFR: no hard delete
--   anywhere. What survives is a SKELETON — id, term_id, status, created_at, redacted_at —
--   and that skeleton is the evidence the sweep ran. A row that vanished proves nothing.
--
-- CITATION:  BUILD_PLAN S3-T8; 0020_purge_abandoned_drafts.sql; DATA_MODEL.md §8.1, §8.2,
--            §7.3; ARCHITECTURE.md §8; PRD US-J2, US-J3; PRD §4 Non-Goals ("Data deletion of
--            any kind by any user"); CBL Art. VIII §6 (RA 10173).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(18);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- fixture: five rows, four of which must survive untouched
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A sweep that redacted everything would satisfy a naive "did it redact?" test. Every row
-- below exists to make one specific over-reach visible.

-- A third term, for the archived-term carve-out (assertion 13). It has to be inserted as
-- `draft`, receive its application, and only then be archived — because
-- trg_applications_freeze_archived refuses an INSERT into an already-archived term. That is
-- the same three-step shape test-helpers/fixtures.sql uses for its historical membership,
-- and it is a fixture-construction order, not a hole.
insert into public.terms (id, label, starts_on, ends_on, status)
values ('00000000-0000-4000-d000-00000000000a', '2024-2025',
        date '2024-06-01', date '2025-05-31', 'draft');

insert into public.applications
  (id, term_id, status, applicant_email, applicant_given_name, applicant_family_name,
   payload, proof_drive_file_id, proof_web_view_link,
   submit_token_hash, submit_token_expires_at, submitted_at, redacted_at, created_at, consented_at,
   noa_drive_file_id)
values
  -- D1 — a FRESH draft. One day old. Somebody may still be mid-upload; touching this would
  -- destroy a live application in progress.
  ('00000000-0000-4000-8000-000000000201', pg_temp.fx_active_term(), 'draft',
   'fresh.draft@fixture.start-sys.test', 'Fresh', 'Draft',
   '{"marker":"fresh"}'::jsonb, 'ref-fresh', 'https://example.invalid/fresh',
   'hash-fresh', now() + interval '1 hour', null, null, now() - interval '1 day', null, null),

  -- D2 — THE ONE ROW THAT SHOULD BE PURGED. Thirty-one days old, never submitted.
  ('00000000-0000-4000-8000-000000000202', pg_temp.fx_active_term(), 'draft',
   'abandoned.draft@fixture.start-sys.test', 'Abandoned', 'Draft',
   '{"marker":"abandoned","birthdate":"2003-04-15"}'::jsonb,
   'ref-abandoned', 'https://example.invalid/abandoned',
   'hash-abandoned', now() + interval '1 hour', null, null, now() - interval '31 days', null, null),

  -- D3 — old enough, but ALREADY REDACTED. Its payload is left intact on purpose: if the
  -- function selected on payload emptiness rather than on redacted_at, this row would be
  -- returned a second time and assertion 11 would catch it.
  ('00000000-0000-4000-8000-000000000203', pg_temp.fx_active_term(), 'draft',
   'already.redacted@fixture.start-sys.test', 'Already', 'Redacted',
   '{"marker":"already"}'::jsonb, 'ref-already', null,
   null, null, null, now() - interval '10 days', now() - interval '31 days', null, null),

  -- D4 — old, but SUBMITTED. A pending application is a live record awaiting a decision and
  -- has a retention basis this function has nothing to say about. pending_has_proof (0008)
  -- requires the reference on any non-draft row.
  ('00000000-0000-4000-8000-000000000204', pg_temp.fx_active_term(), 'pending',
   'submitted.long.ago@fixture.start-sys.test', 'Submitted', 'LongAgo',
   '{"marker":"pending"}'::jsonb, 'ref-pending', 'https://example.invalid/pending',
   'hash-pending', now() + interval '1 hour', now() - interval '30 days', null,
   now() - interval '31 days', now(), 'noa-pending'),

  -- D5 — old and abandoned, but in the term that is about to be ARCHIVED. See assertion 13.
  ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-d000-00000000000a', 'draft',
   'archived.term.draft@fixture.start-sys.test', 'ArchivedTerm', 'Draft',
   '{"marker":"archived"}'::jsonb, 'ref-archived', 'https://example.invalid/archived',
   'hash-archived', now() + interval '1 hour', null, null, now() - interval '31 days', null, null);

-- Now freeze that term. From here on, any write touching D5 raises 42501.
update public.terms
   set status = 'archived', archived_at = now()
 where id = '00000000-0000-4000-d000-00000000000a';

-- Run it ONCE and capture. Every assertion below reads this snapshot rather than calling the
-- function again — a function that redacts is not something to invoke casually inside an
-- assertion, and re-running it would change the very state being measured.
create temp table purge_run_1 on commit drop as
  select * from public.purge_abandoned_drafts();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — POSITIVE CONTROL and the selection
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from purge_run_1),
  1,
  'POSITIVE CONTROL: exactly ONE of the five seeded rows is selected — the sweep is narrow, '
  'and every "untouched" assertion below is trusted only because this is 1 and not 0'
);

select is(
  (select application_id from purge_run_1),
  '00000000-0000-4000-8000-000000000202'::uuid,
  'and it is the right one — the 31-day-old, never-submitted, not-yet-redacted draft'
);

-- 3 — **THE HALF THAT IS USUALLY MISSED.** Clearing the database columns while leaving the
-- Certificate of Registration in Drive or in a bucket forever is the most common way this
-- kind of requirement gets quietly failed: the audit looks clean and the PDFs are still
-- there. The function returns the reference so the calling job can delete the object, and
-- this assertion is what makes that contract testable.
select is(
  (select storage_ref from purge_run_1),
  'ref-abandoned',
  'the document reference comes back with it — the purge destroys data on BOTH SIDES of the '
  'storage boundary, and the caller cannot delete a file it was never told about'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-9 — what redaction does, field by field
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select payload from public.applications
    where id = '00000000-0000-4000-8000-000000000202'),
  '{}'::jsonb,
  'the payload is emptied — it was the densest PII object in the schema (birthdate, address, '
  'contact number, school ID) and it is registered sensitive for that reason'
);

select ok(
  (select applicant_email       = 'redacted@invalid'
      and applicant_given_name  = 'redacted'
      and applicant_family_name = 'redacted'
     from public.applications
    where id = '00000000-0000-4000-8000-000000000202'),
  'email and both names are overwritten with fixed placeholders — not nulled, because the '
  'columns are NOT NULL and a skeleton has to remain a valid row'
);

select ok(
  (select redacted_at is not null
     from public.applications
    where id = '00000000-0000-4000-8000-000000000202'),
  'redacted_at is stamped — this is what makes the function idempotent (assertion 14) and '
  'what proves to an auditor that the sweep ran'
);

-- 7 — the skeleton. PRD US-J3's principle applied to drafts: non-identifying data survives so
-- the org can still answer "how many people started an application in 2026" without holding
-- anybody's address.
select ok(
  (select status::text = 'draft'
      and term_id      = pg_temp.fx_active_term()
      and created_at   < now() - interval '30 days'
     from public.applications
    where id = '00000000-0000-4000-8000-000000000202'),
  'the SKELETON survives — status, term_id and created_at are untouched. The row is redacted, '
  'never deleted (PRD Reliability NFR; CLAUDE.md "never hard-delete anything")'
);

select ok(
  (select submit_token_hash       is null
      and submit_token_expires_at is null
      and proof_web_view_link     is null
     from public.applications
    where id = '00000000-0000-4000-8000-000000000202'),
  'the submit token and the web view link are cleared — a spent capability and a pointer '
  'that PRD US-J2 forbids reaching a browser have no reason to outlive the row''s data'
);

-- 9 — see the ⚠ note in the header. This one looks like a leak and is the opposite.
select is(
  (select proof_drive_file_id from public.applications
    where id = '00000000-0000-4000-8000-000000000202'),
  'ref-abandoned',
  'proof_drive_file_id is DELIBERATELY KEPT — RETURNING yields the NEW value, so nulling it '
  'would hand the job nothing to delete; and it is the record that a document once existed. '
  'It becomes a dangling pointer once the object is gone, which is the correct end state'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-13 — what it must not touch
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Four different reasons to be skipped, asserted separately so a failure names the predicate
-- that broke rather than reporting that "the sweep over-reached".

select ok(
  (select payload = '{"marker":"fresh"}'::jsonb and redacted_at is null
     from public.applications
    where id = '00000000-0000-4000-8000-000000000201'),
  'the ONE-DAY-OLD draft is untouched — somebody may be mid-upload right now, and destroying '
  'a live application in progress is worse than keeping it thirty more days'
);

select ok(
  (select payload = '{"marker":"already"}'::jsonb
     from public.applications
    where id = '00000000-0000-4000-8000-000000000203')
  and not exists (select 1 from purge_run_1
                   where application_id = '00000000-0000-4000-8000-000000000203'),
  'an ALREADY-REDACTED row is not returned a second time — the predicate is redacted_at, not '
  'payload emptiness, so a row cannot be swept twice and double-counted in the job report'
);

select ok(
  (select payload = '{"marker":"pending"}'::jsonb and redacted_at is null
     from public.applications
    where id = '00000000-0000-4000-8000-000000000204'),
  'a SUBMITTED application is untouched however old it is — it is a live record awaiting a '
  'decision, and its retention is the five-year rule''s business, not this function''s'
);

-- 13 — the documented gap. See the ⚠ note in the header.
select ok(
  (select payload = '{"marker":"archived"}'::jsonb and redacted_at is null
     from public.applications
    where id = '00000000-0000-4000-8000-000000000205'),
  'a draft in an ARCHIVED term is SKIPPED — the freeze trigger would raise 42501 and abort '
  'the whole nightly sweep. **This is a documented residual, owned by the rollover runbook '
  '(sweep drafts before archiving), not a property to be proud of**'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14-15 — idempotency and argument validation
-- ═══════════════════════════════════════════════════════════════════════════════════

create temp table purge_run_2 on commit drop as
  select * from public.purge_abandoned_drafts();

select is(
  (select count(*)::int from purge_run_2),
  0,
  'a SECOND run returns nothing — the job runs nightly and must be a no-op on the nights '
  'there is nothing to do, or its report becomes noise nobody reads'
);

select throws_ok(
  $$ select * from public.purge_abandoned_drafts(interval '0 seconds') $$,
  '22023'::char(5), null::text,
  'a zero-length p_age RAISES rather than redacting every draft in the system, including the '
  'one somebody is filling in right now'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 16-18 — no human role may call it
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Postgres grants EXECUTE on a new function to PUBLIC, and PUBLIC includes anon and
-- authenticated — so 0020 revokes FROM PUBLIC FIRST. Revoking only from anon and
-- authenticated would leave the PUBLIC grant in place and both roles would still inherit it,
-- which is the classic way a lockdown silently does nothing. These three assertions are what
-- prove the revoke actually bit.
--
-- This is a JOB, invoked by .github/workflows/scheduled.yml through
-- /api/jobs/purge-abandoned-drafts behind JOB_SHARED_SECRET. A bulk-redaction function that
-- any admin session could call is a way to destroy an application period's intake with one
-- statement.

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok(
  $$ select * from public.purge_abandoned_drafts() $$,
  '42501'::char(5), null::text,
  'crrd_admin cannot call purge_abandoned_drafts() — the operational tier owns the review '
  'queue, not a bulk redaction of it'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok(
  $$ select * from public.purge_abandoned_drafts() $$,
  '42501'::char(5), null::text,
  'exec_admin cannot call it either — the widest tier in the system is not wider here, '
  'because this is a scheduled job and not a records action'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select * from public.purge_abandoned_drafts() $$,
  '42501'::char(5), null::text,
  'anon certainly cannot — and this is the assertion that would fail if somebody revoked '
  'from anon and authenticated without revoking from PUBLIC first'
);
select pg_temp.logout();


select * from finish();

rollback;
