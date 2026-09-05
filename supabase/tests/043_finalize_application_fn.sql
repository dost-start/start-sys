-- ═══════════════════════════════════════════════════════════════════════════════════
-- 043_finalize_application_fn.sql  —  the token gate that replaces an anon UPDATE policy
--
-- WHAT:
--    1-4   POSITIVE CONTROL — the correct token flips draft -> pending and stamps the
--          SERVER-VERIFIED proof metadata
--    5-6   idempotent retry: same token, same file, and nothing moves
--    7-10  the capability gate: a wrong token and an expired token each raise 42501 and
--          leave the row exactly as it was
--   11-12  an unknown application id RETURNS SILENTLY and creates nothing
--   13-15  the metadata allowlist: bad MIME, oversize and missing reference each raise 23514
--   16     a decided application cannot be re-finalized
--   17-19  **the duplicate swallow** — a second live application for the same (term, email)
--          returns SUCCESS, stays draft, and produces no second live row
--   20-21  a submission straddling the closing instant is refused at the data layer
--
-- WHY EVERY ASSERTION HERE IS MADE AS `anon`: this function is the only thing standing
--   between an anonymous caller and an UPDATE on public.applications. Testing it as the
--   session role would test the SQL and not the boundary.
--
-- ⚠ THE THREE ANTI-ENUMERATION ASSERTIONS ARE 11, 17 AND 19, AND THEY ARE THE POINT.
--   A public form must not become a way to ask the database questions:
--     · 11 — an unknown id returns silently rather than raising, so the function is not an
--       oracle for whether a given application id exists. Application ids appear in URLs.
--     · 17/19 — a repeat submission from an address that has already applied returns the
--       SAME void success as a first-time submission, leaving the duplicate as a draft for
--       the sweep. Without this the form tells a stranger which email addresses have
--       already applied. This is also the whole reason 0008 defers the uniqueness constraint
--       to non-draft rows.
--
-- ⚠ WHY THE TOKEN IS NOT CLEARED ON SUCCESS — assertion 5 is the reason. Clearing it would
--   make a retried finalize fail the capability gate at step 3 and never reach the
--   idempotency branch at step 4, which turns a lost response on Philippine mobile data into
--   a hard error for the applicant. The residual is a spent digest on a pending row: masked
--   out of every audit entry, expiring on its own, and able to trigger nothing but the
--   no-op above.
--
-- CITATION:  BUILD_PLAN S3-T6; 0019_finalize_application.sql; ARCHITECTURE.md §4.1 steps 3-5;
--            DATA_MODEL.md §3.2; PRD §3 v1.0 items 5, 6, 7; PRD US-B2, US-B3, US-B4.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(22);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- fixture: an open window and five drafts, each isolating one branch
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Separate rows per branch so no assertion depends on the state another one left behind —
-- the failure mode where fixing one test silently breaks three.
--
-- The hashes are computed here with the SAME expression the function uses. That is
-- deliberate: if the digest scheme is ever changed, this file goes red because the stored
-- hash no longer matches, rather than going green against a hardcoded digest that no longer
-- means anything.
insert into public.application_windows (id, term_id, form_kind, opens_at, closes_at)
values ('00000000-0000-4000-9000-000000000002',
        pg_temp.fx_active_term(), 'membership_application',
        now() - interval '1 day', now() + interval '7 days');

-- consented_at on EVERY row, drafts included: since 0035, startApplication records
-- consent at the draft INSERT (the trigger stamps server values), and the
-- submitted_has_consent CHECK fires at the draft -> pending flip — a consent-less
-- draft is not the production shape and would make finalize itself raise 23514.
insert into public.applications
  (id, term_id, status, applicant_email, applicant_given_name, applicant_family_name,
   payload, proof_drive_file_id, submit_token_hash, submit_token_expires_at, consented_at,
   noa_drive_file_id)
values
  -- A1 — the happy path and the idempotent retry.
  ('00000000-0000-4000-8000-000000000101', pg_temp.fx_active_term(), 'draft',
   'finalize.happy@fixture.start-sys.test', 'Finalize', 'Happy', '{}'::jsonb, null,
   encode(sha256(convert_to('tok-alpha-happy', 'UTF8')), 'hex'), now() + interval '1 hour', now(), null),

  -- A2 — the wrong-token, metadata-allowlist and closed-window branches.
  ('00000000-0000-4000-8000-000000000102', pg_temp.fx_active_term(), 'draft',
   'finalize.validation@fixture.start-sys.test', 'Finalize', 'Validation', '{}'::jsonb, null,
   encode(sha256(convert_to('tok-bravo-validation', 'UTF8')), 'hex'), now() + interval '1 hour', now(), null),

  -- A3 — a token that is CORRECT but has EXPIRED. The distinction the applicant must not be
  -- able to make: this raises identically to a wrong token.
  ('00000000-0000-4000-8000-000000000103', pg_temp.fx_active_term(), 'draft',
   'finalize.expired@fixture.start-sys.test', 'Finalize', 'Expired', '{}'::jsonb, null,
   encode(sha256(convert_to('tok-charlie-expired', 'UTF8')), 'hex'), now() - interval '1 hour', now(), null),

  -- A4 — SAME EMAIL AS A1, in the same term. Once A1 is pending, finalizing this one hits the
  -- partial unique index. That collision is what 17-19 assert gets swallowed.
  ('00000000-0000-4000-8000-000000000104', pg_temp.fx_active_term(), 'draft',
   'finalize.happy@fixture.start-sys.test', 'Finalize', 'Duplicate', '{}'::jsonb, null,
   encode(sha256(convert_to('tok-delta-duplicate', 'UTF8')), 'hex'), now() + interval '1 hour', now(), null),

  -- A5 — already DECIDED. pending_has_proof (0008) requires a reference on any non-draft row.
  ('00000000-0000-4000-8000-000000000105', pg_temp.fx_active_term(), 'rejected',
   'finalize.decided@fixture.start-sys.test', 'Finalize', 'Decided', '{}'::jsonb, 'ref-decided',
   encode(sha256(convert_to('tok-echo-decided', 'UTF8')), 'hex'), now() + interval '1 hour', now(), 'noa-decided');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-4 — POSITIVE CONTROL: the flip, and what it stamps
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_anon();

-- 1 — 6 MiB, because that is what a phone photo of a Certificate of Registration actually
-- weighs and it is above Vercel's 4.5MB request-body cap. The number is a reminder that the
-- bytes never came through us: the browser PUT them straight to the document store and the
-- server re-fetched the provider's own metadata before calling this (ARCHITECTURE.md §4.1).
select lives_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000101',
       'tok-alpha-happy',
       'ref-happy-verified',
       'image/jpeg',
       6291456::bigint,
       'noa-happy-verified',
       'application/pdf',
       262144::bigint) $$,
  'POSITIVE CONTROL: anon with the correct, unexpired token finalizes the application — '
  'every denial below is trusted only because this succeeds'
);

select pg_temp.logout();

select is(
  (select status::text from public.applications
    where id = '00000000-0000-4000-8000-000000000101'),
  'pending',
  'the flip is draft -> pending. "Submitted" is prose for this flip; `pending` is the enum '
  'value the PRD itself uses (DATA_MODEL.md §3.2)'
);

-- 3 — the size stored is the one PASSED IN, which the caller obtained from the provider's
-- own metadata — never the size the browser claimed (ARCHITECTURE.md §4.1 step 5). A test
-- that used a small file would pass even if the bytes had wrongly been routed through a
-- Vercel function, which caps bodies at 4.5MB.
select is(
  (select proof_size_bytes from public.applications
    where id = '00000000-0000-4000-8000-000000000101'),
  6291456::bigint,
  'proof_size_bytes is the SERVER-VERIFIED size (6 MiB), stored verbatim — the client''s '
  'claim about what it uploaded is never what lands in the row'
);

select ok(
  (select proof_verified_at is not null
      and submitted_at      is not null
      and proof_mime_type   = 'image/jpeg'
      and proof_drive_file_id = 'ref-happy-verified'
      and noa_drive_file_id   = 'noa-happy-verified'
      and noa_mime_type       = 'application/pdf'
      and noa_verified_at is not null
     from public.applications
    where id = '00000000-0000-4000-8000-000000000101'),
  'proof_verified_at, submitted_at, proof_mime_type, proof_drive_file_id AND the three noa_* fields are all stamped '
  'in the same statement — a half-finalized row is not a state this function can produce'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5-6 — idempotent retry
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The lost-response case: the applicant's connection dropped after the flip and the browser
-- retried. It must not be an error, and it must not move anything.

create temp table t_a1_before on commit drop as
  select submitted_at, proof_verified_at
    from public.applications
   where id = '00000000-0000-4000-8000-000000000101';

select pg_temp.login_anon();
select lives_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000101',
       'tok-alpha-happy',
       'ref-happy-verified',
       'image/jpeg',
       6291456::bigint,
       'noa-happy-verified',
       'application/pdf',
       262144::bigint) $$,
  'a retried finalize with the SAME token and the SAME file reference succeeds — and this '
  'assertion is why the token is deliberately not cleared on success (0019 step 8)'
);
select pg_temp.logout();

-- 6 — "succeeds" is not enough; it has to be a genuine NO-OP. If the retry had fallen through
-- to the UPDATE, submitted_at would have moved to the second call's now().
select ok(
  (select a.submitted_at      = b.submitted_at
      and a.proof_verified_at = b.proof_verified_at
     from public.applications a, t_a1_before b
    where a.id = '00000000-0000-4000-8000-000000000101'),
  'the retry changed NOTHING — submitted_at and proof_verified_at are byte-identical, so the '
  'early return really is an early return and not a second UPDATE'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7-10 — the capability gate
-- ═══════════════════════════════════════════════════════════════════════════════════
-- All four failure modes inside step 3 of the function raise the SAME code with the SAME
-- message. A caller must not be able to tell "there is no token on this row" from "your
-- token is wrong" from "you are too late" — each distinction is a probe.

select pg_temp.login_anon();

select throws_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000102',
       'tok-wrong-entirely',
       'ref-attacker', 'application/pdf', 1024::bigint, 'noa-doc', 'application/pdf', 1024::bigint) $$,
  '42501'::char(5), null::text,
  'a WRONG token raises 42501 — the one-row bearer capability is what authorizes this call, '
  'and there is no anon UPDATE policy to fall back on'
);

select throws_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000103',
       'tok-charlie-expired',
       'ref-late', 'application/pdf', 1024::bigint, 'noa-doc', 'application/pdf', 1024::bigint) $$,
  '42501'::char(5), null::text,
  'a CORRECT but EXPIRED token raises 42501, identically to a wrong one — the applicant '
  'cannot distinguish the two, which is deliberate'
);

select pg_temp.logout();

-- 9-10 — and neither attempt moved the row it targeted. A refusal that half-wrote is worse
-- than no refusal.
select is(
  (select status::text from public.applications
    where id = '00000000-0000-4000-8000-000000000102'),
  'draft',
  'the wrong-token attempt left its row untouched — still draft'
);

select is(
  (select status::text from public.applications
    where id = '00000000-0000-4000-8000-000000000103'),
  'draft',
  'the expired-token attempt left its row untouched — still draft'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11-12 — an unknown id returns SILENTLY
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Anti-enumeration point 1. If "no such row" and "wrong token" were distinguishable, this
-- function would be an oracle for whether a given application id exists — and application
-- ids appear in URLs.

select pg_temp.login_anon();
select lives_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-0000000009ff',
       'tok-anything',
       'ref-nothing', 'application/pdf', 1024::bigint, 'noa-doc', 'application/pdf', 1024::bigint) $$,
  'an UNKNOWN application id returns silently rather than raising — the function is not an '
  'oracle for whether an application id exists'
);
select pg_temp.logout();

select is(
  (select count(*)::int from public.applications),
  5,
  'and the silent return created nothing — still exactly the five seeded applications'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-15 — the metadata allowlist, re-checked at the data layer
-- ═══════════════════════════════════════════════════════════════════════════════════
-- These four MIME types are the allowlist from lib/documents/types.ts, restated in SQL. They
-- are restated rather than shared because this is the LAST gate: if the TypeScript allowlist
-- is ever widened by accident, the database still refuses. 23514 maps to `validation` in
-- lib/action-result.ts, so the applicant gets a field error rather than a crash.

select pg_temp.login_anon();

select throws_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000102',
       'tok-bravo-validation',
       'ref-executable', 'application/x-msdownload', 1024::bigint, 'noa-doc', 'application/pdf', 1024::bigint) $$,
  '23514'::char(5), null::text,
  'a disallowed MIME type raises 23514 EVEN WITH A VALID TOKEN — the allowlist is not a '
  'client-side convenience'
);

select throws_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000102',
       'tok-bravo-validation',
       'ref-huge', 'application/pdf', 10485761::bigint, 'noa-doc', 'application/pdf', 1024::bigint) $$,
  '23514'::char(5), null::text,
  'one byte over MAX_PROOF_BYTES (10 MiB) raises 23514 — asserted at the boundary, not at a '
  'comfortable distance from it'
);

select throws_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000102',
       'tok-bravo-validation',
       '   ', 'application/pdf', 1024::bigint, 'noa-doc', 'application/pdf', 1024::bigint) $$,
  '23514'::char(5), null::text,
  'a blank document reference raises 23514 — PRD US-B2 makes proof of enrollment part of '
  'the application, and pending_has_proof would refuse the row anyway'
);

-- 16 — a DECIDED application. Terminal by design: reversing an approval would orphan a
-- minted member ID (PRD US-C3), and a rejection is a recorded decision. 55000 is
-- object_not_in_prerequisite_state — semantically exact, and unreachable in practice.
select throws_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000105',
       'tok-echo-decided',
       'ref-reopen', 'application/pdf', 1024::bigint, 'noa-doc', 'application/pdf', 1024::bigint) $$,
  '55000'::char(5), null::text,
  'a REJECTED application cannot be re-finalized even with a valid token — draft -> pending '
  'is the only edge this function may traverse (DATA_MODEL.md §3.2)'
);

select throws_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000102',
       'tok-bravo-validation',
       'ref-same', 'application/pdf', 1024::bigint,
       'ref-same', 'application/pdf', 1024::bigint) $$,
  '23514'::char(5), null::text,
  'the SAME reference for both documents raises 23514 — the registration form and the '
  'Notice of Award are two files (SRS 2026-09-05), and one upload cannot stand in for both'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 17-19 — THE DUPLICATE SWALLOW
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A4 carries the same (term_id, applicant_email) as A1, which is now pending. Promoting A4
-- collides with the partial unique index. The function catches that unique_violation, rolls
-- the UPDATE back inside its own subtransaction and returns the SAME void success a
-- first-time submission gets — so the response cannot be used to learn that this address has
-- already applied. The duplicate stays a draft and purge_abandoned_drafts() redacts it in
-- thirty days.

select pg_temp.login_anon();
select lives_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000104',
       'tok-delta-duplicate',
       'ref-duplicate', 'image/png', 2048::bigint, 'noa-doc', 'application/pdf', 1024::bigint) $$,
  'a DUPLICATE (term, email) finalize returns SUCCESS, not an error — the response is '
  'byte-identical to a first-time submission, so the public form cannot be used to '
  'enumerate which addresses have already applied'
);
select pg_temp.logout();

select is(
  (select status::text from public.applications
    where id = '00000000-0000-4000-8000-000000000104'),
  'draft',
  'the duplicate row STAYS DRAFT — the subtransaction rolled its UPDATE back, so nothing '
  'was half-written, and the abandoned-draft sweep will redact it in thirty days'
);

select is(
  (select count(*)::int from public.applications
    where applicant_email = 'finalize.happy@fixture.start-sys.test'
      and status <> 'draft'),
  1,
  'exactly ONE live application exists for that address — the constraint still does its real '
  'job even though the caller was told nothing about it'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20-21 — the window is re-asserted at submit time
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-B4 applied to the SECOND half of the flow. The anon INSERT policy checked the window
-- when the draft was created; between then and now the applicant uploaded a file, which takes
-- real time on mobile data. A submission straddling the closing instant is refused HERE — not
-- by a hidden button, and not by whatever closing time the browser happened to believe.

update public.application_windows
   set opens_at  = now() - interval '30 days',
       closes_at = now() - interval '1 minute'
 where id = '00000000-0000-4000-9000-000000000002';

select pg_temp.login_anon();
select throws_ok(
  $$ select public.finalize_application(
       '00000000-0000-4000-8000-000000000102',
       'tok-bravo-validation',
       'ref-just-too-late', 'application/pdf', 1024::bigint, 'noa-doc', 'application/pdf', 1024::bigint) $$,
  '42501'::char(5), null::text,
  'a valid token is NOT enough once the window has closed — PRD US-B4 is enforced on the '
  'finalize half of the flow as well as on the insert half'
);
select pg_temp.logout();

select is(
  (select status::text from public.applications
    where id = '00000000-0000-4000-8000-000000000102'),
  'draft',
  'and that row is still a draft — a refused submission does not leave a half-submitted '
  'application in the review queue'
);


select * from finish();

rollback;
