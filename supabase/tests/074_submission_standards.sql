-- ═══════════════════════════════════════════════════════════════════════════════════
-- 074_submission_standards.sql  —  submission-time standards + the post-period batch (0045)
--
-- WHAT:
--     1    a sanity check that the fixture's own program/university lookups resolved to
--          real rows — a fixture bug here would make every "unknown"-branch assertion
--          below pass for the wrong reason.
--    2-11  check_submission_standards(): a fully valid payload passes ('{}'); each of the
--          six field-level standards fails in isolation when broken one at a time
--          (expected_grad_year missing, expected_grad_year at the active term's own end
--          year, program_id malformed, program_id well-formed but unknown, university_id
--          unknown, scholarship_award unrecognized, award_year malformed); an email
--          matching a person whose LATEST membership is 'terminated' fails 'applicant_email'
--          alone (CBL Art. VII §3); with NO active term the function short-circuits to
--          ONLY the 'term' key. Every call is made as anon — a real check that the EXECUTE
--          grant to anon actually works, not merely that the SQL is correct.
--   12-15  list_pending_standards(): officer and anon are refused (42501); crrd_admin sees
--          exactly the three legacy pending applications review-fixtures.psql seeds (A1,
--          A2, A5 — none of which carries university_id/program_id at all), and every one
--          of the three fails at least one standard.
--   16-19  approve_all_pending()'s guards: officer refused (42501) BEFORE the window check
--          or the loop, and the refusal writes no APPROVE_ALL audit row; anon refused;
--          while the membership_application window review-fixtures opened is still active,
--          the batch itself is refused (55000) even for crrd_admin.
--   20-21  setup: a sixth, FULLY QUALIFYING application ("foxtrot") and a renewal built
--          through start_renewal()/finalize_renewal() (like 073) — carrying a mailing-
--          address payload — are added once the window is closed.
--   22-28  the real batch: it approves exactly the one qualifying application and the one
--          renewal, skips the three legacy rows (collecting their failures, deciding none
--          of them), fails nothing, and the renewed person's people.address_line is now the
--          value the renewal payload carried (0045's addition to approve_renewal()).
--          Exactly one APPROVE_ALL audit row exists after the call.
--   29-31  a second call approves ZERO new applications and ZERO new renewals —
--          approve_application() and approve_renewal() are both already idempotent — and
--          writes a SECOND APPROVE_ALL row (one per call, not one ever).
--   32-35  the standards gate at the DATA layer: finalize_renewal() and finalize_application()
--          refuse a violating payload (23514) even when the Server Action is bypassed; the batch
--          skips a forced-pending violator instead of activating it
--
-- FIXTURES: helpers/fixtures.psql + helpers/review-fixtures.psql, exactly as 046-049 use
--   them. P1 (2022-001, exec_admin's person, danielle.quiambao@...) has an archived-term
--   membership only — the renewing scholar, same identity 073 uses. P6 (2025-007,
--   jose.pena@...) is terminated IN THIS FILE'S OWN TRANSACTION to exercise the
--   'applicant_email' standard — a mutation permanent for the rest of this file, per the
--   no-savepoints-after-plan() rule 060/062/064 already document (rollback to savepoint
--   after plan() rewinds pgTAP's own counter into duplicate test numbers).
--
-- CITATION: docs/decisions/0013-submission-standards-and-batch-approval.md;
--   supabase/migrations/0045_submission_standards.sql; PRD US-B1, US-C1, US-C2, US-C3,
--   US-C5, US-G7, US-H5; CBL Art. VII §3.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/review-fixtures.psql

select plan(35);

-- ═══════════════════════════════════════════════════════════════════════════════════
-- setup — a real, fully-qualifying payload, built from REAL seeded reference rows
-- ═══════════════════════════════════════════════════════════════════════════════════
create temp table fx_program on commit drop as
  select id from public.programs where code = 'CS';
grant select on fx_program to public;

create temp table fx_university on commit drop as
  select id from public.universities where is_active limit 1;
grant select on fx_university to public;

create temp table fx_valid_payload on commit drop as
  select jsonb_build_object(
    'birthdate',          '2004-08-08',
    'contact_number',     '+639171112222',
    'region_id',          pg_temp.fx_region('NCR')::text,
    'year_level',         2,
    'expected_grad_year', 2029,
    'middle_name',        'Cruz',
    'suffix',             'Jr.',
    'sex',                'female',
    'facebook_account',   'https://facebook.com/standardsfixture',
    'scholarship_award',  'ra_7687',
    'award_year',         '2022',
    'university_id',      (select id from fx_university)::text,
    'program_id',         (select id from fx_program)::text,
    'address_line',       'Fixture Standards Street',
    'city_municipality',  'Quezon City',
    'province',           'Metro Manila',
    'postal_code',        '1101',
    'consent_privacy_notice_version', 'v1.0.0',
    'consent_given_at',   now()::text
  ) as body;
grant select on fx_valid_payload to public;

-- Sanity: the reference rows the payload leans on actually exist (a fixture bug here would
-- make every "unknown"-branch assertion below pass for the wrong reason).
select ok(
  (select id from fx_program) is not null and (select id from fx_university) is not null,
  'the fixture found a real CS program row and a real active university row to build against'
);

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-8 — check_submission_standards(), as ANON (proves the EXECUTE grant, not just the SQL)
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_anon();

select is(
  public.check_submission_standards(
    'valid.applicant@fixture.start-sys.test', (select body from fx_valid_payload)
  ),
  '{}'::text[],
  'a fully valid payload passes every checkable standard — empty failing-keys array'
);

select is(
  public.check_submission_standards(
    'valid.applicant@fixture.start-sys.test',
    (select body from fx_valid_payload) - 'expected_grad_year'
  ),
  array['expected_grad_year']::text[],
  'a MISSING expected_grad_year fails exactly that key'
);

select is(
  public.check_submission_standards(
    'valid.applicant@fixture.start-sys.test',
    (select body from fx_valid_payload) || jsonb_build_object('expected_grad_year', 2027)
  ),
  array['expected_grad_year']::text[],
  'expected_grad_year equal to the active term''s OWN end year fails — must be LATER (PRD US-G7)'
);

select is(
  public.check_submission_standards(
    'valid.applicant@fixture.start-sys.test',
    (select body from fx_valid_payload) || jsonb_build_object('program_id', 'not-a-uuid')
  ),
  array['program_id']::text[],
  'a MALFORMED program_id fails exactly that key'
);

select is(
  public.check_submission_standards(
    'valid.applicant@fixture.start-sys.test',
    (select body from fx_valid_payload) || jsonb_build_object('program_id', gen_random_uuid()::text)
  ),
  array['program_id']::text[],
  'a well-formed but UNKNOWN program_id fails exactly that key (PRD OQ-17 closed list)'
);

select is(
  public.check_submission_standards(
    'valid.applicant@fixture.start-sys.test',
    (select body from fx_valid_payload) || jsonb_build_object('university_id', gen_random_uuid()::text)
  ),
  array['university_id']::text[],
  'a well-formed but UNKNOWN university_id fails exactly that key'
);

select is(
  public.check_submission_standards(
    'valid.applicant@fixture.start-sys.test',
    (select body from fx_valid_payload) || jsonb_build_object('scholarship_award', 'not_a_real_award')
  ),
  array['scholarship_award']::text[],
  'an unrecognized scholarship_award fails exactly that key'
);

select is(
  public.check_submission_standards(
    'valid.applicant@fixture.start-sys.test',
    (select body from fx_valid_payload) || jsonb_build_object('award_year', 'twenty-twenty-two')
  ),
  array['award_year']::text[],
  'a non-4-digit award_year fails exactly that key'
);
select pg_temp.logout();

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9 — applicant_email: a TERMINATED member's email (CBL Art. VII §3)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- P6 (2025-007, jose.pena@fixture.start-sys.test) is terminated for the rest of this file.
-- Termination is exec_admin-only at BOTH the RLS policy and the 0028 trigger.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
update public.memberships
   set status = 'terminated',
       ended_reason = 'CBL Art. VII §3 fixture: majority vote recorded for 074'
 where person_id = '00000000-0000-4000-b000-000000000006'
   and term_id = pg_temp.fx_active_term();
select pg_temp.logout();

select pg_temp.login_anon();
select is(
  public.check_submission_standards(
    'jose.pena@fixture.start-sys.test', (select body from fx_valid_payload)
  ),
  array['applicant_email']::text[],
  'an email matching a person whose LATEST membership is terminated fails ''applicant_email'' alone'
);
select pg_temp.logout();

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10 — term: with NO active term, the function short-circuits to ONLY 'term'
-- ═══════════════════════════════════════════════════════════════════════════════════
create temp table fx_term_id on commit drop as select pg_temp.fx_active_term() as id;
grant select on fx_term_id to public;

update public.terms set status = 'draft' where id = (select id from fx_term_id);

select pg_temp.login_anon();
select is(
  public.check_submission_standards(
    'valid.applicant@fixture.start-sys.test', (select body from fx_valid_payload)
  ),
  array['term']::text[],
  'with no active term, EVERY other standard is unevaluable — the result is ONLY ''term'''
);
select pg_temp.logout();

update public.terms set status = 'active' where id = (select id from fx_term_id);

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11-14 — list_pending_standards()
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select * from public.list_pending_standards() $$,
  '42501'::char(5), null::text,
  'officer cannot read the pending-standards queue'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select * from public.list_pending_standards() $$,
  '42501'::char(5), null::text,
  'anon cannot read the pending-standards queue either'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.list_pending_standards()),
  3,
  'crrd_admin sees exactly the three legacy pending applications (A1, A2, A5)'
);
select ok(
  (select bool_and(cardinality(failures) > 0) from public.list_pending_standards()),
  'every one of the three legacy pending rows fails at least one standard — none carries university_id/program_id'
);
select pg_temp.logout();

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 15-18 — approve_all_pending(): the role guard and the window guard
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select public.approve_all_pending() $$,
  '42501'::char(5), null::text,
  'officer cannot run the post-period approval batch — the guard runs before the window check and before the loop'
);
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log where operation = 'APPROVE_ALL'),
  0,
  'the refused officer call wrote NO APPROVE_ALL audit row (counted outside any session — audit_log_read is exec/tech only)'
);

select pg_temp.login_anon();
select throws_ok(
  $$ select public.approve_all_pending() $$,
  '42501'::char(5), null::text,
  'anon cannot run the batch either'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok(
  $$ select public.approve_all_pending() $$,
  '55000'::char(5), null::text,
  'the batch refuses to run (55000) while review-fixtures'' membership_application window is still open'
);
select pg_temp.logout();

-- close the window
update public.application_windows
   set closes_at = now() - interval '1 hour'
 where term_id = pg_temp.fx_active_term()
   and form_kind = 'membership_application';

-- ═══════════════════════════════════════════════════════════════════════════════════
-- setup — one FULLY QUALIFYING application, and a renewal carrying an address payload
-- ═══════════════════════════════════════════════════════════════════════════════════
insert into public.applications (
  id, term_id, status,
  applicant_email, applicant_given_name, applicant_family_name,
  payload,
  proof_drive_file_id, proof_mime_type, proof_size_bytes, proof_verified_at,
  noa_drive_file_id, noa_mime_type, noa_size_bytes, noa_verified_at,
  submitted_at, consented_at
)
values (
  '00000000-0000-4000-8000-000000000206', pg_temp.fx_active_term(), 'pending',
  'foxtrot.applicant@fixture.start-sys.test', 'Foxtrot', 'Applicant',
  (select body from fx_valid_payload),
  'ref-standards-foxtrot', 'application/pdf', 262144, now(),
  'noa-standards-foxtrot', 'application/pdf', 131072, now(),
  now() - interval '1 hour', now()
);

insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
values (pg_temp.fx_active_term(), 'membership_renewal', now() - interval '1 hour', now() + interval '1 day')
on conflict (term_id, form_kind) do nothing;

create temp table fx_renewal_tok on commit drop as
  select 'standardsrenewaltoken000000000000000000000000000000000000000'::text as plain,
         encode(sha256(convert_to(
           'standardsrenewaltoken000000000000000000000000000000000000000', 'UTF8')), 'hex') as digest;
grant select on fx_renewal_tok to public;

create temp table fx_renewal_payload on commit drop as
  select jsonb_build_object(
    'region_id', pg_temp.fx_region('R07')::text,
    'year_level', '4', 'expected_grad_year', '2028',
    'contact_number', '+639170000199', 'facebook_account', 'https://facebook.com/renewed074',
    'sex', 'female', 'scholarship_award', 'merit', 'award_year', '2022',
    'program_id', (select id from fx_program)::text,
    'university_id', (select id from fx_university)::text,
    'address_line', 'Renewed Address Line 074', 'city_municipality', 'Renewed City',
    'province', 'Renewed Province', 'postal_code', '4074'
  ) as body;
grant select on fx_renewal_payload to public;

select pg_temp.login_anon();
select lives_ok(
  $$ select public.start_renewal('2022-001', 'danielle.quiambao@fixture.start-sys.test',
       (select body from fx_renewal_payload), (select digest from fx_renewal_tok), now() + interval '1 hour') $$,
  'P1 starts a renewal carrying a mailing-address payload (like 073)'
);

-- Captured OUTSIDE the anon session: anon has no policy on renewal_submissions, so the
-- subselect would be NULL and finalize_renewal() would return silently.
select pg_temp.logout();
create temp table fx_renewal_id on commit drop as
  select id from public.renewal_submissions
   where person_id = '00000000-0000-4000-b000-000000000001' and term_id = pg_temp.fx_active_term();
grant select on fx_renewal_id to public;
select pg_temp.login_anon();

select lives_ok(
  $$ select public.finalize_renewal((select id from fx_renewal_id), (select plain from fx_renewal_tok),
       'renewals/074-cor.pdf', 'application/pdf', 1024, 'renewals/074-noa.pdf', 'application/pdf', 2048) $$,
  'the renewal is finalized to pending, both documents recorded'
);
select pg_temp.logout();

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19-25 — approve_all_pending(): the real batch, window closed
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

create temp table fx_batch_result on commit drop as
  select public.approve_all_pending() as result;
grant select on fx_batch_result to public;

select is(
  ((select result from fx_batch_result) ->> 'applications_approved')::int,
  1,
  'the batch approves exactly the ONE fully-qualifying pending application (foxtrot)'
);
select is(
  ((select result from fx_batch_result) ->> 'renewals_approved')::int,
  1,
  'the batch approves the ONE pending renewal (P1)'
);
select is(
  jsonb_array_length((select result from fx_batch_result) -> 'skipped'),
  3,
  'the three legacy pending applications (missing university_id/program_id) are SKIPPED, not decided'
);
select is(
  jsonb_array_length((select result from fx_batch_result) -> 'failed'),
  0,
  'nothing raised an unexpected error during the batch'
);
select is(
  (select status::text from public.applications where id = '00000000-0000-4000-8000-000000000206'),
  'approved',
  'the qualifying application is now approved'
);
select pg_temp.logout();

select is(
  (select address_line from public.people where id = '00000000-0000-4000-b000-000000000001'),
  'Renewed Address Line 074',
  'approve_renewal() (0045) now writes the renewal payload''s mailing address onto people'
);

select is(
  (select count(*)::int from public.audit_log where operation = 'APPROVE_ALL'),
  1,
  'exactly ONE APPROVE_ALL audit row exists after the first successful batch call'
);

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 26-28 — a second call is idempotent: approves nothing new, writes a SECOND batch row
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

create temp table fx_batch_result_2 on commit drop as
  select public.approve_all_pending() as result;
grant select on fx_batch_result_2 to public;

select is(
  ((select result from fx_batch_result_2) ->> 'applications_approved')::int,
  0,
  'a SECOND call approves ZERO new applications'
);
select is(
  ((select result from fx_batch_result_2) ->> 'renewals_approved')::int,
  0,
  'a SECOND call approves ZERO new renewals — approve_application()/approve_renewal() are both already idempotent'
);
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log where operation = 'APPROVE_ALL'),
  2,
  'a SECOND APPROVE_ALL audit row now exists — one per call, never one for all time'
);

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 32-35 — the standards gate at the DATA layer (ADR 0013 §1/§4): a violating payload never
--         becomes pending even when the Server Action is bypassed; the batch skips a
--         forced-pending violator
-- ═══════════════════════════════════════════════════════════════════════════════════
-- P2 (2022-002) has no membership — eligible to start; the payload fails the standards.
create temp table fx_bad_payload on commit drop as
  select ((select body from fx_renewal_payload) || '{"expected_grad_year":"2000"}'::jsonb) as body;
grant select on fx_bad_payload to public;

select pg_temp.login_anon();
do $$ begin
  perform public.start_renewal('2022-002', 'ethan.baltazar@fixture.start-sys.test',
    (select body from fx_bad_payload), (select digest from fx_renewal_tok), now() + interval '1 hour');
end $$;
select pg_temp.logout();
create temp table fx_bad_renewal on commit drop as
  select id from public.renewal_submissions
   where person_id = '00000000-0000-4000-b000-000000000002' and term_id = pg_temp.fx_active_term();
grant select on fx_bad_renewal to public;
select pg_temp.login_anon();
select throws_ok(
  $$ select public.finalize_renewal(
       (select id from fx_bad_renewal),
       (select plain from fx_renewal_tok),
       'renewals/074-bad-cor.pdf', 'application/pdf', 1024, 'renewals/074-bad-noa.pdf', 'application/pdf', 2048) $$,
  '23514'::char(5), null::text,
  'finalize_renewal() refuses a renewal whose expected graduation year is in the past — at the data layer'
);
select pg_temp.logout();

-- A draft application with a known token and a failing payload; the window is reopened so
-- the ONLY thing standing between it and pending is the standards gate.
update public.application_windows set closes_at = now() + interval '1 day'
 where term_id = pg_temp.fx_active_term() and form_kind = 'membership_application';
insert into public.applications (
  id, term_id, status, applicant_email, applicant_given_name, applicant_family_name, payload,
  submit_token_hash, submit_token_expires_at, consented_at
) values (
  '00000000-0000-4000-8000-000000000207', pg_temp.fx_active_term(), 'draft',
  'golf.applicant@fixture.start-sys.test', 'Golf', 'Applicant',
  (select body from fx_bad_payload),
  (select digest from fx_renewal_tok), now() + interval '1 hour', now()
);
select pg_temp.login_anon();
select throws_ok(
  $$ select public.finalize_application('00000000-0000-4000-8000-000000000207',
       (select plain from fx_renewal_tok),
       'apps/074-bad-cor.pdf', 'application/pdf', 1024, 'apps/074-bad-noa.pdf', 'application/pdf', 2048) $$,
  '23514'::char(5), null::text,
  'finalize_application() refuses an application whose expected graduation year is in the past — at the data layer'
);
select pg_temp.logout();
select is(
  (select status::text from public.applications where id = '00000000-0000-4000-8000-000000000207'),
  'draft',
  'the refused application stays a draft — nothing reached pending'
);

-- Force P2's failing renewal to pending (as a maintainer with psql would), close the
-- window again, and prove the batch SKIPS it rather than activating the membership.
update public.application_windows set closes_at = now() - interval '1 minute'
 where term_id = pg_temp.fx_active_term() and form_kind = 'membership_application';
update public.renewal_submissions
   set status = 'pending', submitted_at = now(),
       proof_drive_file_id = 'renewals/074-forced-cor.pdf', proof_mime_type = 'application/pdf', proof_size_bytes = 1,
       noa_drive_file_id   = 'renewals/074-forced-noa.pdf', noa_mime_type   = 'application/pdf', noa_size_bytes   = 1
 where person_id = '00000000-0000-4000-b000-000000000002' and term_id = pg_temp.fx_active_term();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
create temp table fx_batch_result_3 on commit drop as
  select public.approve_all_pending() as result;
grant select on fx_batch_result_3 to public;
select pg_temp.logout();

select is(
  ((select result from fx_batch_result_3) ->> 'renewals_approved')::int
    || ':' || (select status::text from public.renewal_submissions
               where person_id = '00000000-0000-4000-b000-000000000002' and term_id = pg_temp.fx_active_term())
    || ':' || (select count(*)::int from public.memberships
               where person_id = '00000000-0000-4000-b000-000000000002' and term_id = pg_temp.fx_active_term()),
  '0:pending:0',
  'the batch SKIPS a forced-pending renewal that fails the standards: not approved, still pending, no membership'
);

select * from finish();

rollback;
