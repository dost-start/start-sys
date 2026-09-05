-- ═══════════════════════════════════════════════════════════════════════════════════
-- 073_renewal_form.sql  —  the accountless Membership Renewal Form (0044)
--
-- WHAT:
--    1-3   window gate: start_renewal() raises 42501 with no membership_renewal window,
--          and lives once one is open
--    4-7   identity: a wrong member ID / email pair is P0002; the right pair for a person
--          whose latest membership is in the ARCHIVED term creates a draft; a person who
--          is already active this term is 55000; a terminated person is 55000
--    8-11  finalize: wrong token 42501; the right token flips draft → pending stamping
--          submitted_at and both documents; unknown id is silent; the token is single-use
--   12-13  a second start_renewal() while pending is 55000 (one row per person per term);
--          the anon session reads ZERO renewal rows (no anon policy)
--   14-18  approve: officer refused 42501; crrd_admin approves; exactly one ACTIVE
--          membership in the current term; member_id UNCHANGED (US-H5); a second approve
--          returns the same member_id and adds no membership
--   19-21  the audit trail: the decision wrote an audited UPDATE with the payload masked;
--          get_renewal_detail() writes one VIEW row and carries the member id; officer's
--          detail read is 42501
--   22-23  reject: needs a ground of 10+ chars; a rejected row can be re-started (reset to
--          draft) — and the sweep redacts a stale draft
--
-- FIXTURES (helpers/fixtures.psql): P1 (2022-001, exec_admin's person) has an archived-term
--   membership only — the renewing scholar. P4 (2024-001) is active in the current term.
--   P3's row is terminated by the exec_admin fixture for the eligibility case. P2 (2022-002)
--   has no membership at all and carries the reject → re-start → sweep path.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(23);

-- The token the "browser" holds, and its digest the row stores.
create temp table fx_tok on commit drop as
  select 'renewaltoken-0000000000000000000000000000000000000000000000000000'::text as plain,
         encode(sha256(convert_to('renewaltoken-0000000000000000000000000000000000000000000000000000', 'UTF8')), 'hex') as digest;
grant select on fx_tok to public;

create temp table fx_payload on commit drop as
  select jsonb_build_object(
    'region_id', pg_temp.fx_region('R07')::text,
    'year_level', '4', 'expected_grad_year', '2028',
    'contact_number', '+639170000099', 'facebook_account', 'https://facebook.com/renewed',
    'sex', 'female', 'scholarship_award', 'merit', 'award_year', '2022'
  ) as body;
grant select on fx_payload to public;

-- ── 1-3 — the window ───────────────────────────────────────────────────────────────
select pg_temp.login_anon();
select throws_ok(
  $$ select public.start_renewal('2022-001', 'danielle.quiambao@fixture.start-sys.test',
       (select body from fx_payload), (select digest from fx_tok), now() + interval '1 hour') $$,
  '42501'::char(5), null::text,
  'with no membership_renewal window open, start_renewal() is refused at the data layer');
select pg_temp.logout();

insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
values (pg_temp.fx_active_term(), 'membership_renewal', now() - interval '1 hour', now() + interval '1 day');

select pg_temp.login_anon();
select is(
  (select count(*)::int from public.application_windows where form_kind = 'membership_renewal'),
  1,
  'anon sees the open renewal window (application_windows_read_anon, 0014)');

select lives_ok(
  $$ select public.start_renewal('2022-001', 'danielle.quiambao@fixture.start-sys.test',
       (select body from fx_payload), (select digest from fx_tok), now() + interval '1 hour') $$,
  'with the window open, the right member ID + email creates a draft');

-- ── 4-7 — identity and eligibility ─────────────────────────────────────────────────
select throws_ok(
  $$ select public.start_renewal('2022-001', 'someone.else@fixture.start-sys.test',
       (select body from fx_payload), (select digest from fx_tok), now() + interval '1 hour') $$,
  'P0002'::char(5), null::text,
  'the right member ID with the WRONG email is no match (P0002) — both halves must agree');

select throws_ok(
  $$ select public.start_renewal('2024-001', 'juan.delacruz@fixture.start-sys.test',
       (select body from fx_payload), (select digest from fx_tok), now() + interval '1 hour') $$,
  '55000'::char(5), null::text,
  'a scholar already ACTIVE this term has nothing to renew (55000)');
select pg_temp.logout();

-- Termination is an exec_admin act at the data layer (0028's trigger + 0014's policy), so
-- the fixture records it as one.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
update public.memberships set status = 'terminated', ended_reason = 'CBL Art. VII §3 fixture: majority vote recorded'
 where person_id = '00000000-0000-4000-b000-000000000003' and term_id = pg_temp.fx_active_term();
select pg_temp.logout();
select pg_temp.login_anon();
select throws_ok(
  $$ select public.start_renewal('2023-001', 'maria.santos@fixture.start-sys.test',
       (select body from fx_payload), (select digest from fx_tok), now() + interval '1 hour') $$,
  '55000'::char(5), null::text,
  'a TERMINATED member cannot renew through the form — CBL Art. VII §3; reinstatement is US-D6');
select pg_temp.logout();

create temp table fx_renewal on commit drop as
  select id from public.renewal_submissions
   where person_id = '00000000-0000-4000-b000-000000000001' and term_id = pg_temp.fx_active_term();
grant select on fx_renewal to public;

select is(
  (select status::text || ':' || (submitted_at is null)::text
     from public.renewal_submissions where id = (select id from fx_renewal)),
  'draft:true',
  'the draft is a draft: not submitted, identity verified, waiting for documents');

-- ── 8-11 — finalize ────────────────────────────────────────────────────────────────
select pg_temp.login_anon();
select throws_ok(
  $$ select public.finalize_renewal((select id from fx_renewal), 'wrong-token',
       'renewals/cor.pdf', 'application/pdf', 1024, 'renewals/noa.pdf', 'application/pdf', 2048) $$,
  '42501'::char(5), null::text,
  'a wrong token is refused (42501) and the row is untouched');

select lives_ok(
  $$ select public.finalize_renewal((select id from fx_renewal), (select plain from fx_tok),
       'renewals/cor.pdf', 'application/pdf', 1024, 'renewals/noa.pdf', 'application/pdf', 2048) $$,
  'the right token finalizes');

select lives_ok(
  $$ select public.finalize_renewal('00000000-0000-4000-e400-00000000dead', (select plain from fx_tok),
       'x', 'application/pdf', 1, 'y', 'application/pdf', 1) $$,
  'an unknown id returns silently — the endpoint is not an existence oracle');
select pg_temp.logout();

select is(
  (select status::text || ':' || (submitted_at is not null)::text || ':' || proof_drive_file_id || ':' || noa_drive_file_id
          || ':' || (submit_token_hash is null)::text
     from public.renewal_submissions where id = (select id from fx_renewal)),
  'pending:true:renewals/cor.pdf:renewals/noa.pdf:true',
  'pending, submitted_at stamped, both documents recorded, the token cleared (single use)');

-- ── 12-13 — one per person per term; nothing for anon to read ──────────────────────
select pg_temp.login_anon();
select throws_ok(
  $$ select public.start_renewal('2022-001', 'danielle.quiambao@fixture.start-sys.test',
       (select body from fx_payload), (select digest from fx_tok), now() + interval '1 hour') $$,
  '55000'::char(5), null::text,
  'a second start while one is pending is refused (55000) — one renewal per person per term');
select is((select count(*)::int from public.renewal_submissions), 0,
  'anon reads ZERO renewal rows — there is no anon policy on the table');
select pg_temp.logout();

-- ── 14-18 — approve ────────────────────────────────────────────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$ select public.approve_renewal((select id from fx_renewal)) $$, '42501'::char(5), null::text,
  'officer cannot approve a renewal');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(public.approve_renewal((select id from fx_renewal)), '2022-001',
  'crrd_admin approves and gets the EXISTING member id back — 2022-001 does not become 2026-xxxx (US-H5)');

select is(
  (select count(*)::int from public.memberships
    where person_id = '00000000-0000-4000-b000-000000000001'
      and term_id = pg_temp.fx_active_term() and status = 'active'),
  1,
  'exactly one ACTIVE membership in the current term for the renewed scholar (US-H1)');

select is(public.approve_renewal((select id from fx_renewal)), '2022-001',
  'a second approve is idempotent — same id back');
select is(
  (select count(*)::int from public.memberships
    where person_id = '00000000-0000-4000-b000-000000000001' and term_id = pg_temp.fx_active_term()),
  1,
  '…and still exactly one membership row');
select pg_temp.logout();

-- ── 19-21 — the audit trail ────────────────────────────────────────────────────────
select ok(
  exists (
    select 1 from public.audit_log
     where table_name = 'renewal_submissions' and row_id = (select id from fx_renewal)
       and operation = 'UPDATE' and new_data ->> 'status' = 'approved'
       and new_data ->> 'payload' = '«redacted»'
       and actor_user_id = '00000000-0000-4000-a000-000000000003'),
  'the approval is an audited UPDATE naming the officer, with the payload MASKED');

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin (has an ack)
select is(
  (select (public.get_renewal_detail((select id from fx_renewal))) ->> 'member_id'),
  '2022-001',
  'get_renewal_detail() carries the member id alongside the body');
select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$ select public.get_renewal_detail((select id from fx_renewal)) $$, '42501'::char(5), null::text,
  'officer cannot read a renewal in full');
select pg_temp.logout();

-- ── 22-23 — reject, re-start, sweep ────────────────────────────────────────────────
-- P2 (2022-002) has no membership at all — eligible, and a clean row for the reject path.
select pg_temp.login_anon();
do $$ begin
  perform public.start_renewal('2022-002', 'ethan.baltazar@fixture.start-sys.test',
    (select body from fx_payload), (select digest from fx_tok), now() + interval '1 hour');
  perform public.finalize_renewal(
    (select id from public.renewal_submissions where person_id = '00000000-0000-4000-b000-000000000002'),
    (select plain from fx_tok), 'renewals/cor2.pdf', 'image/jpeg', 100, 'renewals/noa2.pdf', 'image/png', 200);
end $$;
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok(
  $$ select public.reject_renewal(
       (select id from public.renewal_submissions where person_id = '00000000-0000-4000-b000-000000000002'),
       'too short') $$,
  '23514'::char(5), null::text,
  'a rejection needs a written ground of at least 10 characters (US-C2''s shape)');
do $$ begin
  perform public.reject_renewal(
    (select id from public.renewal_submissions where person_id = '00000000-0000-4000-b000-000000000002'),
    'The registration form is for last semester; please upload the current one.');
end $$;
select pg_temp.logout();

-- re-start after rejection resets the row to draft; a 31-day-old draft is swept.
select pg_temp.login_anon();
do $$ begin
  perform public.start_renewal('2022-002', 'ethan.baltazar@fixture.start-sys.test',
    (select body from fx_payload), (select digest from fx_tok), now() + interval '1 hour');
end $$;
select pg_temp.logout();
update public.renewal_submissions set created_at = now() - interval '31 days'
 where person_id = '00000000-0000-4000-b000-000000000002';
select is(
  (select count(*)::int from public.purge_abandoned_renewal_drafts()),
  1,
  'a rejected-then-restarted renewal is a draft again; after 30 days the sweep redacts it (and only it)');

select * from finish();

rollback;
