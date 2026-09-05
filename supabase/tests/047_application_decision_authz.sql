-- ═══════════════════════════════════════════════════════════════════════════════════
-- 047_application_decision_authz.sql  —  who may decide, what a decision does, and what it
--                                        must never do
--
-- WHAT:
--    1-9    approve_application(): the happy path, its EXACT people/membership deltas, the
--           minted id's shape AND value, the middle_name/suffix fix, and idempotency
--   10-11   the other two reviewer roles succeed
--   12-17   approve is refused for the SIX other fixtures, each named
--   18-20   THE RETURNING APPLICANT: an existing member_id is returned unchanged and NO
--           second person row is created (PRD US-C4, US-H5)
--   21-26   reject_application(): succeeds for the three, records the ground, and creates
--           ZERO people and ZERO memberships
--   27-32   reject is refused for the SIX other fixtures
--   33-39   the state machine: a short reason, a re-decision, a draft, and three raw UPDATEs
--           against the transition trigger — including one that must LIVE
--   40-48   allocate_member_id() is unreachable from ALL NINE fixtures
--
-- WHY A DENY TEST PER ROLE AND NOT JUST A HAPPY PATH. CONVENTIONS.md §8.1: "SECURITY DEFINER
--   functions need a deny test per role, not just a happy path. A function that guards on one
--   role is one careless `or` away from granting everyone." Both RPCs run as their owner with
--   BYPASSRLS, so the guard INSIDE each body is the entire boundary — there is no policy
--   behind it to catch a miss. Six named refusals per function, plus nine on the allocator.
--
-- ⚠ POSITIVE CONTROL FIRST (1). A malformed claim makes auth.uid() NULL, which makes
--   auth_role() NULL, which makes every guard raise 42501 — and all twelve refusals below
--   would pass for the wrong reason. Nothing here is trusted until assertion 1 mints an id.
--
-- ⚠ THIS FILE DOES NOT PROVE CONCURRENCY, AND SAYS SO. `supabase test db` wraps each file in
--   a rolled-back transaction, so a second connection cannot see these fixtures and true
--   parallelism is unreachable here. 048_member_id_concurrency.sql asserts contention
--   behaviour structurally; the REAL 50-way proof is
--   lib/applications/approve-application.test.ts (BUILD_PLAN S4-T12), over 50 concurrent
--   PostgREST connections.
--
-- CITATION:  BUILD_PLAN S4-T2, S4-T3, S4-T9, S4-T12; DATA_MODEL.md §3.2, §4, §6/0012;
--            ARCHITECTURE.md §4.1 step 8, §5, §6; PRD §3 v1.0 items 8-9;
--            PRD US-C2, US-C3, US-C4, US-H1, US-H5, US-I1; PRD OQ-5;
--            CONVENTIONS.md §8.1; CBL Art. III §2.9, Art. X §2.4-2.5.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/review-fixtures.psql

select plan(48);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- fixture: six more applications, one per outcome this file consumes
-- ═══════════════════════════════════════════════════════════════════════════════════
-- helpers/review-fixtures.psql seeds five (A1 pending, A2 pending, A3 approved, A4 rejected,
-- A5 the returning applicant). Deciding an application CONSUMES it, so each success case
-- needs its own row: three approvals and three rejections across the three reviewer roles,
-- plus one draft.
--
-- ⚠ DISTINCT applicant_email ON EVERY NON-DRAFT ROW. one_application_per_email_per_term is a
-- PARTIAL unique index on (term_id, applicant_email) WHERE status <> 'draft' (0008), so a
-- reused address fails the SEED rather than the assertion.
--
-- B6 is a DRAFT and deliberately CARRIES a proof reference. pending_has_proof only constrains
-- rows past draft, so a draft with a document is legal — and assertion 39 needs a row that can
-- legally take the draft -> pending edge.
insert into public.applications (
  id, term_id, status,
  applicant_email, applicant_given_name, applicant_family_name,
  payload, proof_drive_file_id, proof_mime_type, proof_size_bytes, proof_verified_at,
  submitted_at, consented_at
)
values
  ('00000000-0000-4000-8000-000000000211', pg_temp.fx_active_term(), 'pending',
   'foxtrot.applicant@fixture.start-sys.test', 'Foxtrot', 'Applicant',
   pg_temp.fx_app_payload('NCR', 2, 2029), 'ref-b1', 'application/pdf', 101, now(), now(), now()),
  ('00000000-0000-4000-8000-000000000212', pg_temp.fx_active_term(), 'pending',
   'golf.applicant@fixture.start-sys.test', 'Golf', 'Applicant',
   pg_temp.fx_app_payload('R07', 2, 2029), 'ref-b2', 'application/pdf', 102, now(), now(), now()),
  ('00000000-0000-4000-8000-000000000213', pg_temp.fx_active_term(), 'pending',
   'hotel.applicant@fixture.start-sys.test', 'Hotel', 'Applicant',
   pg_temp.fx_app_payload('NCR', 2, 2029), 'ref-b3', 'application/pdf', 103, now(), now(), now()),
  ('00000000-0000-4000-8000-000000000214', pg_temp.fx_active_term(), 'pending',
   'india.applicant@fixture.start-sys.test', 'India', 'Applicant',
   pg_temp.fx_app_payload('R07', 2, 2029), 'ref-b4', 'application/pdf', 104, now(), now(), now()),
  ('00000000-0000-4000-8000-000000000215', pg_temp.fx_active_term(), 'pending',
   'juliett.applicant@fixture.start-sys.test', 'Juliett', 'Applicant',
   pg_temp.fx_app_payload('NCR', 2, 2029), 'ref-b5', 'application/pdf', 105, now(), now(), now()),
  ('00000000-0000-4000-8000-000000000216', pg_temp.fx_active_term(), 'draft',
   'kilo.applicant@fixture.start-sys.test', 'Kilo', 'Applicant',
   pg_temp.fx_app_payload('NCR', 2, 2029), 'ref-b6', 'application/pdf', 106, now(), null, now());

-- Scratchpads. CREATED by the session role and only WRITTEN while impersonating — a fixture
-- cannot CREATE in this session's temp schema (auth.psql grants USAGE only, deliberately),
-- and a test that fails on a privilege unrelated to the boundary it asserts is a test that
-- gets deleted rather than fixed. Same pattern as 030_rr_scope_rls.sql.
create temp table fx_ids   (k text primary key, v text);
create temp table fx_marks (k text primary key, people bigint, memberships bigint);
grant insert, select on fx_ids, fx_marks to public;

insert into fx_marks (k, people, memberships)
values ('before_a2',
        (select count(*) from public.people),
        (select count(*) from public.memberships));


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-9 — approve_application(): the happy path
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
insert into fx_ids (k, v)
values ('a2_first', public.approve_application('00000000-0000-4000-8000-000000000202'));
select pg_temp.logout();

select matches(
  (select v from fx_ids where k = 'a2_first'),
  '^\d{4}-\d{3,}$',
  'POSITIVE CONTROL — crrd_admin approves and the returned member_id matches the PRD''s '
  'joinYear-sequence shape. `{3,}` and not `{3}`: 2024-999 must roll to 2024-1000, not '
  'collide (PRD US-C3)'
);

-- The VALUE, not just the shape. join_year comes from the TERM's starts_on (2026-06-01), so
-- an application reviewed in July still joins the term that opened in June — never from
-- now(). The 2026 counter is fresh, so the first approval of the term is 001.
select is(
  (select v from fx_ids where k = 'a2_first'), '2026-001',
  'the first approval of the 2026-2027 term mints 2026-001 — join_year is derived from the '
  'TERM, not from the clock, and the counter starts at 1'
);

select is(
  (select count(*)::int - (select people::int from fx_marks where k = 'before_a2')
     from public.people), 1,
  'approval creates EXACTLY ONE people row — not zero (which would mean no member) and not '
  'two (PRD US-C3: "no approval can produce a member without an ID, or an ID without a '
  'member")'
);

select is(
  (select count(*)::int - (select memberships::int from fx_marks where k = 'before_a2')
     from public.memberships), 1,
  'approval creates EXACTLY ONE membership row — PRD US-C2, "approval creates the member''s '
  'membership record for the current term"'
);

select ok(
  exists (
    select 1
      from public.memberships m
      join public.people p on p.id = m.person_id
     where p.personal_email = 'bravo.applicant@fixture.start-sys.test'
       and m.term_id = pg_temp.fx_active_term()
       and m.status  = 'active'
       and m.region_id = pg_temp.fx_region('R07')
       and m.year_level = 3
       and m.expected_grad_year = 2028
  ),
  'the new membership is in the CURRENT term with status active, and carries the region, '
  'year level and expected graduation year read from payload — the eleven-key contract '
  '(APPLICATION_PAYLOAD_KEYS) asserted by VALUE, not by row count'
);

-- ★ THE S3-T13 GAP, CLOSED. lib/applications/schema.ts flagged that the abridged
--   approve_application() copied neither middle_name nor suffix, so the form collected both
--   and discarded both. 0023 reads them from the payload. Asserted by value, because a
--   regression here loses data silently and forever.
select ok(
  exists (
    select 1 from public.people p
     where p.personal_email = 'bravo.applicant@fixture.start-sys.test'
       and p.middle_name = 'Cruz'
       and p.suffix      = 'Jr.'
       and p.school_id_no = 'FIXT-APP-SCH'
       and p.birthdate    = date '2004-08-08'
  ),
  'middle_name AND suffix are copied onto the people row (the gap S3 handed to S4), '
  'alongside the sensitive block. Collected-and-discarded is a silent data loss'
);

-- Idempotency. PRD US-C3: "a retried or double-submitted approval returns the EXISTING ID
-- rather than issuing a second one." The `for update` lock plus the already-approved early
-- return is what makes a double-clicked Approve a success rather than a duplicate.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');
insert into fx_ids (k, v)
values ('a2_second', public.approve_application('00000000-0000-4000-8000-000000000202'));
select pg_temp.logout();

select is(
  (select v from fx_ids where k = 'a2_second'),
  (select v from fx_ids where k = 'a2_first'),
  'a SECOND approval of the same application returns the IDENTICAL member_id — idempotent on '
  'retry (PRD US-C3). This is also the double-clicked Send guard, in the database'
);

select is(
  (select count(*)::int - (select people::int from fx_marks where k = 'before_a2')
     from public.people), 1,
  'the retry created NO second people row — still exactly one'
);

select is(
  (select count(*)::int - (select memberships::int from fx_marks where k = 'before_a2')
     from public.memberships), 1,
  'the retry created NO second membership — `on conflict (person_id, term_id) do nothing` '
  'plus PRD US-H1''s unique constraint'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-11 — the other two reviewer roles
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-C1/US-C2 name CRRD and Executive Admins; ARCHITECTURE.md §5 adds crrd_deputys, who
-- own the day-to-day operational surface. The crrd_deputy case only reaches the role guard
-- because helpers/review-fixtures.psql gave P3 a confidentiality acknowledgement — see that
-- file's header for why it is not in helpers/fixtures.psql.

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
insert into fx_ids (k, v)
values ('b1', public.approve_application('00000000-0000-4000-8000-000000000211'));
select pg_temp.logout();

select matches(
  (select v from fx_ids where k = 'b1'), '^\d{4}-\d{3,}$',
  'exec_admin approves — PRD US-C2 names CRRD and Executive Admins together'
);

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
insert into fx_ids (k, v)
values ('b2', public.approve_application('00000000-0000-4000-8000-000000000212'));
select pg_temp.logout();

select matches(
  (select v from fx_ids where k = 'b2'), '^\d{4}-\d{3,}$',
  'crrd_deputy approves — the operational tier (CBL Art. III §3.9, duties Art. IV §6.2.2: the '
  'DCCDO-C runs "membership recruitment, application, retention")'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12-17 — approve is REFUSED for the six others
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Every refusal targets A1, which stays `pending` throughout: the guard raises before the row
-- is read, so a refusal must be attributable to the ROLE and not to the state.

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok(
  $$ select public.approve_application('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'tech_admin CANNOT approve — PRD OQ-5, default NO. Approving writes a person, a member ID '
  'and a membership; "configure the system and control access" is not that'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select public.approve_application('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'officer CANNOT approve — PRD US-D2, view-only. The Special Advisor sits in this tier '
  '(CBL Art. III §2.9) and independently reviews appeals (Art. X §2.4-2.5)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok(
  $$ select public.approve_application('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'regional_rep_a CANNOT approve — PRD US-F2, "regional access does not become regional '
  'editing"'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select throws_ok(
  $$ select public.approve_application('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'regional_rep_b CANNOT approve — asserted separately so a predicate admitting one region '
  'cannot hide behind the other'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select throws_ok(
  $$ select public.approve_application('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'member CANNOT approve — PRD §2: "members can only access forms"'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select public.approve_application('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'anon CANNOT approve — refused twice over: EXECUTE is revoked from anon (0023) and '
  'auth_role() is NULL inside the guard'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 18-20 — ★ THE RETURNING APPLICANT ★  (PRD US-C4, US-H5)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- P7 joined in 2024 and holds '2024-007'. A5 is their new application in the 2026-2027 term,
-- carrying their address in lower case against the mixed case on the people row — both
-- columns are `citext`, so the match is case-insensitive BY TYPE and not by a lower() someone
-- could forget.
--
-- This is the PRD's own sentence, run as a test: "those with existing IDs will not be
-- assigned new ones (e.g. 2024-001 will not become 2025-001)."

insert into fx_marks (k, people, memberships)
values ('before_a5',
        (select count(*) from public.people),
        (select count(*) from public.memberships));

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
insert into fx_ids (k, v)
values ('a5', public.approve_application('00000000-0000-4000-8000-000000000205'));
select pg_temp.logout();

select is(
  (select v from fx_ids where k = 'a5'), '2024-007',
  'a RETURNING applicant keeps their ORIGINAL member_id — 2024-007, not 2026-004. Person '
  'resolution matched on personal_email (citext) and allocate_member_id() early-returned '
  '(PRD US-C4, US-H5)'
);

select is(
  (select count(*)::int - (select people::int from fx_marks where k = 'before_a5')
     from public.people), 0,
  'and it created ZERO new people rows. A second person row is exactly how a member acquires '
  'a second member ID, which is the failure this whole path exists to prevent'
);

select is(
  (select count(*)::int - (select memberships::int from fx_marks where k = 'before_a5')
     from public.memberships), 1,
  'it DID create the new term''s membership — PRD US-H1/US-H5: renewal is a new row in a new '
  'term against the SAME identity record'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 21-26 — reject_application()
-- ═══════════════════════════════════════════════════════════════════════════════════

insert into fx_marks (k, people, memberships)
values ('before_reject',
        (select count(*) from public.people),
        (select count(*) from public.memberships));

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select lives_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000213',
                                      'Uploaded document is not a certificate of registration.') $$,
  'crrd_admin rejects a pending application'
);
select pg_temp.logout();

select ok(
  exists (
    select 1 from public.applications a
     where a.id = '00000000-0000-4000-8000-000000000213'
       and a.status = 'rejected'
       and a.review_note = 'Uploaded document is not a certificate of registration.'
       and a.reviewed_by = '00000000-0000-4000-a000-000000000003'
       and a.reviewed_at is not null
  ),
  'the rejection records the GROUND and the DECIDING OFFICER — PRD US-C2, "rejection records '
  'a reason" and "both outcomes write an audit entry naming the deciding officer"'
);

select is(
  (select count(*)::int - (select people::int from fx_marks where k = 'before_reject')
     from public.people), 0,
  'rejection creates ZERO people rows'
);

select is(
  (select count(*)::int - (select memberships::int from fx_marks where k = 'before_reject')
     from public.memberships), 0,
  'rejection creates ZERO membership rows — PRD US-C2, "rejection records a reason and LEAVES '
  'NO MEMBERSHIP RECORD". Asserted as a delta rather than trusted to the absence of an INSERT '
  'statement, which a refactor could add'
);

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select lives_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000214',
                                      'Applicant is not a DOST scholar this term.') $$,
  'exec_admin rejects'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy
select lives_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000215',
                                      'Duplicate submission; superseded by a later form.') $$,
  'crrd_deputy rejects — the operational tier decides both ways, not just the pleasant one'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 27-32 — reject is REFUSED for the six others
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A1 again, still pending. The reason string is valid in every call, so what is being
-- measured is the role guard and nothing else.

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000201',
                                      'A perfectly valid rejection ground.') $$,
  '42501'::char(5), null::text,
  'tech_admin CANNOT reject — PRD OQ-5. A rejection is an org decision about a person, not a '
  'system configuration'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000201',
                                      'A perfectly valid rejection ground.') $$,
  '42501'::char(5), null::text,
  'officer CANNOT reject — PRD US-D2, no write path exists for this tier on any record'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000201',
                                      'A perfectly valid rejection ground.') $$,
  '42501'::char(5), null::text,
  'regional_rep_a CANNOT reject — PRD US-F2'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b
select throws_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000201',
                                      'A perfectly valid rejection ground.') $$,
  '42501'::char(5), null::text,
  'regional_rep_b CANNOT reject'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select throws_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000201',
                                      'A perfectly valid rejection ground.') $$,
  '42501'::char(5), null::text,
  'member CANNOT reject'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000201',
                                      'A perfectly valid rejection ground.') $$,
  '42501'::char(5), null::text,
  'anon CANNOT reject — EXECUTE revoked (0024) and auth_role() NULL inside the guard'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 33-39 — the state machine
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

-- The 10-character floor is stated in THREE places that must agree: the rejected_has_reason
-- CHECK (0024), the guard inside reject_application(), and applicationRejectSchema's min(10)
-- in lib/applications/schema.ts. If they ever disagree the database refuses what the form
-- accepted, and the reviewer gets a 500 instead of a field error.
select throws_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000201', 'nope.') $$,
  '23514'::char(5), null::text,
  'a 5-character rejection reason raises 23514 — PRD US-C2 requires a recorded ground, and '
  '23514 maps to `validation` so the message reaches fields.review_note rather than a toast'
);

-- PRD US-C2: "an already-decided application cannot be silently re-decided; a change of
-- decision is a NEW audited action." Both directions, both terminal.
select throws_ok(
  $$ select public.reject_application('00000000-0000-4000-8000-000000000203',
                                      'Changed our minds about this approval.') $$,
  '55000'::char(5), null::text,
  'an APPROVED application cannot be rejected — it would leave a minted member ID and a live '
  'membership behind a row that says "rejected". A genuine mistake is corrected by setting '
  'the resulting memberships.status, which leaves a trail (DATA_MODEL.md §3.2)'
);

select throws_ok(
  $$ select public.approve_application('00000000-0000-4000-8000-000000000204') $$,
  '55000'::char(5), null::text,
  'a REJECTED application cannot be approved — a rejection is a recorded decision, not a '
  'draft state'
);

select throws_ok(
  $$ select public.approve_application('00000000-0000-4000-8000-000000000216') $$,
  '55000'::char(5), null::text,
  'a DRAFT cannot be approved — it was never submitted. draft -> pending is '
  'finalize_application()''s edge and nobody else''s (DATA_MODEL.md §3.2)'
);

select pg_temp.logout();

-- The trigger, independently of the RPCs. These run as the SESSION ROLE — the migration owner
-- with BYPASSRLS and every privilege — precisely because that is the caller the RPC guards
-- cannot see. A trigger is what makes PRD US-C2 true of a psql session at 2am.
select throws_ok(
  $$ update public.applications set status = 'pending'
      where id = '00000000-0000-4000-8000-000000000203' $$,
  '23514'::char(5), null::text,
  'a raw UPDATE reopening an APPROVED application raises 23514 — '
  'enforce_application_status_transition() refuses it even for a superuser session'
);

select throws_ok(
  $$ update public.applications set status = 'approved'
      where id = '00000000-0000-4000-8000-000000000204' $$,
  '23514'::char(5), null::text,
  'a raw UPDATE flipping REJECTED to APPROVED raises 23514 — the edge does not exist, and '
  'taking it would mint nothing while claiming a member exists'
);

-- ⚠ AND ONE THAT MUST LIVE. A trigger that refuses everything would pass all six assertions
-- above and break the entire intake flow. B6 is a draft carrying a proof reference, so
-- pending_has_proof is satisfied and the legal edge is genuinely available.
select lives_ok(
  $$ update public.applications set status = 'pending', submitted_at = now()
      where id = '00000000-0000-4000-8000-000000000216' $$,
  'draft -> pending LIVES — the legal edge finalize_application() takes. Asserted so a '
  'trigger that refuses everything cannot pass this file'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 40-48 — allocate_member_id() is unreachable from ALL NINE fixtures
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ★ THE FOOTGUN BUILD_PLAN S4-T1 NAMES. ★ A SECURITY DEFINER function is granted to PUBLIC by
-- default. Left alone, this one would be callable by every session — as its owner, with
-- BYPASSRLS — and a hand-written `select allocate_member_id('<person uuid>')` would mint a
-- member ID for someone who was never approved, or burn a sequence number on demand.
--
-- The internal `for update` gives no protection: the function does exactly what it says. The
-- PRIVILEGE is the boundary, and there is no policy behind it, because member_id_counters
-- deliberately has NO POLICY AT ALL (0014) — deny-by-default is the design and this revoke is
-- what stops the definer from being the way around it.
--
-- All nine, because "revoke from public" is one careless `grant execute … to public` away
-- from being undone, and the undo would be invisible in every other test in the suite.

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');
select throws_ok(
  $$ select public.allocate_member_id('00000000-0000-4000-b000-000000000002') $$,
  '42501'::char(5), null::text,
  'exec_admin CANNOT call allocate_member_id() directly — a member ID is minted only inside '
  'approve_application(), in the transaction that also creates the membership (PRD US-C3)');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');
select throws_ok(
  $$ select public.allocate_member_id('00000000-0000-4000-b000-000000000002') $$,
  '42501'::char(5), null::text, 'tech_admin CANNOT call allocate_member_id() directly');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');
select throws_ok(
  $$ select public.allocate_member_id('00000000-0000-4000-b000-000000000002') $$,
  '42501'::char(5), null::text,
  'crrd_admin CANNOT call allocate_member_id() directly — not even the CCDO, who may approve');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');
select throws_ok(
  $$ select public.allocate_member_id('00000000-0000-4000-b000-000000000002') $$,
  '42501'::char(5), null::text, 'crrd_deputy CANNOT call allocate_member_id() directly');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');
select throws_ok(
  $$ select public.allocate_member_id('00000000-0000-4000-b000-000000000002') $$,
  '42501'::char(5), null::text, 'officer CANNOT call allocate_member_id() directly');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');
select throws_ok(
  $$ select public.allocate_member_id('00000000-0000-4000-b000-000000000002') $$,
  '42501'::char(5), null::text, 'regional_rep_a CANNOT call allocate_member_id() directly');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');
select throws_ok(
  $$ select public.allocate_member_id('00000000-0000-4000-b000-000000000002') $$,
  '42501'::char(5), null::text, 'regional_rep_b CANNOT call allocate_member_id() directly');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');
select throws_ok(
  $$ select public.allocate_member_id('00000000-0000-4000-b000-000000000002') $$,
  '42501'::char(5), null::text, 'member CANNOT call allocate_member_id() directly');
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select public.allocate_member_id('00000000-0000-4000-b000-000000000002') $$,
  '42501'::char(5), null::text,
  'anon CANNOT call allocate_member_id() directly — the public surface must not be able to '
  'touch the counter table even indirectly');
select pg_temp.logout();


select * from finish();

rollback;
