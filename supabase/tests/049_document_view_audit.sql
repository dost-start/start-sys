-- ═══════════════════════════════════════════════════════════════════════════════════
-- 049_document_view_audit.sql  —  every proof view is recorded, and every full read too
--
-- WHAT:
--    1-7    log_document_view(): one call writes exactly ONE VIEW_DOCUMENT row, attributed to
--           the caller, carrying NO document reference and NO PII — and three views write
--           three rows
--    8-11   the CBL Art. VIII §7.1 gate: a reviewer WITH an acknowledgement is admitted, the
--           same reviewer WITHOUT one is refused AND writes nothing
--   12-17   the four non-reviewer tiers and anon are refused, and the audit log did not move
--   18-25   get_application_detail(): returns applicant_email and payload, strips both proof
--           pointers and both token columns, writes one VIEW row per call, and returns NULL
--           (writing nothing) for an application that does not exist
--   26-29   the same authorization matrix on the detail RPC
--   30-32   audit_log stays append-only: no UPDATE grant, no DELETE grant, no policy for either
--
-- WHY THIS FILE EXISTS AT ALL. Under RA 10173 — a CONSTITUTIONAL obligation here, CBL Art.
--   VIII §6 — **"who looked at this scholar's Certificate of Registration, and when" is a
--   question the organization must be able to answer.** A Certificate of Registration carries
--   a student number, an address and a signature; opening one is an access to sensitive
--   personal data whether or not anything was changed. PRD US-C1 and US-J2 both require the
--   record; PRD §3 v1.0 item 16 names document views explicitly.
--
-- ⚠ THREE VIEWS MUST WRITE THREE ROWS (7). "Has anyone ever looked at this?" is not the
--   question RA 10173 asks. A function that de-duplicated, or a route that memoised, would
--   pass a count-of-at-least-one assertion and fail the requirement.
--
-- ⚠ POSITIVE CONTROL FIRST (1). Every refusal below is a 42501, and a broken fixture makes
--   auth_role() NULL, which makes every guard raise 42501 — so all nine refusals would pass
--   for the wrong reason.
--
-- ⚠ AUDIT ROWS ARE READ AS THE SESSION ROLE, ALWAYS. audit_log_read (0014) admits only
--   exec_admin and tech_admin, so reading the log while impersonating any other fixture would
--   return zero rows and every delta assertion would trivially "pass". Same discipline as
--   020_confidentiality_gate.sql. Deltas are measured from a captured baseline and never as
--   absolute counts, because the fixtures themselves fire audit triggers.
--
-- CITATION:  BUILD_PLAN S4-T5, S4-T6, S4-T11, S4-T17; ARCHITECTURE.md §4.1 step 7, §5, §8;
--            DATA_MODEL.md §8.3, §8.4; PRD §3 v1.0 items 8, 16; PRD US-C1, US-I1, US-J1,
--            US-J2, US-J5; PRD OQ-5; CBL Art. VIII §6, §7.1; Art. III §2.9, Art. X §2.4-2.5.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/review-fixtures.psql

select plan(32);


-- Scratchpads. CREATED by the session role, WRITTEN while impersonating — a fixture cannot
-- CREATE in this session's temp schema (auth.psql grants USAGE only). Same pattern as
-- 030_rr_scope_rls.sql and 047.
create temp table fx_audit  (k text primary key, v bigint);
create temp table fx_detail (k text primary key, v jsonb);
grant insert, select on fx_audit, fx_detail to public;

-- A1: pending, with a proof reference. The generic target — a view does not change its state,
-- so every assertion in this file can use it without ordering constraints.
insert into fx_audit (k, v)
values ('before_first_view', (select coalesce(max(id), 0) from public.audit_log));


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-7 — log_document_view()
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin, HAS an ack
select lives_ok(
  $$ select public.log_document_view('00000000-0000-4000-8000-000000000201') $$,
  'POSITIVE CONTROL — crrd_admin with a current-term confidentiality acknowledgement may '
  'record a document view. Every 42501 below is trusted only because this lives'
);
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_first_view')), 1,
  'exactly ONE audit row — not zero (the view would be unrecorded, which is the compliance '
  'failure) and not two (a double-write means the route and the function are both logging)'
);

select is(
  (select actor_user_id from public.audit_log
    where id > (select v from fx_audit where k = 'before_first_view')),
  '00000000-0000-4000-a000-000000000003'::uuid,
  'the row names the VIEWER — PRD US-C1: "each document view is recorded with viewer and '
  'timestamp". An audit entry without an actor answers the wrong question'
);

select ok(
  exists (
    select 1 from public.audit_log
     where id > (select v from fx_audit where k = 'before_first_view')
       and actor_role = 'crrd_admin'
       and table_name = 'applications'
       and row_id     = '00000000-0000-4000-8000-000000000201'
       and operation  = 'VIEW_DOCUMENT'
       and created_at is not null
  ),
  'operation is VIEW_DOCUMENT against the right table and row_id — a distinct operation from '
  'the trigger-written INSERT/UPDATE rows, so "show me every proof view this term" is one '
  'indexed predicate rather than a guess'
);

select ok(
  (select old_data is null and new_data is null from public.audit_log
    where id > (select v from fx_audit where k = 'before_first_view')),
  'old_data and new_data are NULL — this is a READ, so there is no diff, and putting the row '
  'here would turn the append-only log into exactly the PII store mask_sensitive() exists to '
  'prevent (DATA_MODEL.md §8.3)'
);

-- ⚠ proof_drive_file_id and proof_web_view_link are BOTH registered sensitive (0008 §7), which
-- makes mask_sensitive() redact them out of every TRIGGERED audit row. A note assembled by
-- hand bypasses that masking entirely, so it must not carry either.
select ok(
  (select note not like '%ref-review-alpha%' and note not like '%drive.example.invalid%'
     from public.audit_log
    where id > (select v from fx_audit where k = 'before_first_view')),
  'the note carries NO document reference and NO provider URL — row_id already says WHICH '
  'application, and a hand-assembled note is the one audit write that bypasses '
  'mask_sensitive()'
);

-- ★ THREE VIEWS, THREE ROWS. ★
insert into fx_audit (k, v)
values ('before_three', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');
select public.log_document_view('00000000-0000-4000-8000-000000000201');
select public.log_document_view('00000000-0000-4000-8000-000000000201');
select public.log_document_view('00000000-0000-4000-8000-000000000201');
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_three')), 3,
  'THREE successive views append THREE rows — RA 10173 asks "who looked, and WHEN", not '
  '"has anyone ever looked". A de-duplicating function or a memoising route would pass a '
  'count-of-at-least-one assertion and fail the requirement'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 8-11 — the CBL Art. VIII §7.1 gate
-- ═══════════════════════════════════════════════════════════════════════════════════
-- "All elected and appointed officers, committee members, and advisors shall sign a
-- Confidentiality Agreement" — §7.1, "upon assuming their roles", which is per term
-- (Art. V §1). DATA_MODEL.md §8.4 makes it a PRECONDITION, not a report, and PRD US-J5 is
-- explicit that the refusal is an ERROR and never an empty result.
--
-- The crrd_deputy's acknowledgement is added by helpers/review-fixtures.psql (and deliberately
-- NOT by helpers/fixtures.psql, where its absence is 020's negative case). Here the crrd_deputy
-- is admitted WITH it and then refused WITHOUT it, so the gate is proven to BITE rather than
-- merely assumed from a missing fixture row — an absence proves nothing about a function that
-- never checks, and the same fixture doing both is what makes the difference attributable to
-- the acknowledgement and not to the role.

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin, HAS an ack
select lives_ok(
  $$ select public.log_document_view('00000000-0000-4000-8000-000000000201') $$,
  'exec_admin with an acknowledgement may record a view');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy, HAS an ack here
select lives_ok(
  $$ select public.log_document_view('00000000-0000-4000-8000-000000000201') $$,
  'crrd_deputy with an acknowledgement may record a view — ARCHITECTURE.md §5: you cannot '
  'review an application without reading it, and the proof document is the point of reviewing');
select pg_temp.logout();

-- ⚠ NO SAVEPOINT HERE, DELIBERATELY. pgTAP keeps its running test number in a TEMP TABLE, so
-- a `rollback to savepoint` taken after plan() would rewind the counter and emit duplicate
-- test numbers — a TAP stream that fails for a reason having nothing to do with the schema.
-- The acknowledgement is therefore deleted ONCE, after every assertion that needs it, and is
-- never restored: assertion 29 reuses the same removed state at the foot of this file.
--
-- The DELETE itself writes no audit row (trg_confidentiality_acknowledgements_audit is
-- `after insert or update`, 0012), and the baseline is captured after it regardless.
delete from public.confidentiality_acknowledgements
 where person_id = '00000000-0000-4000-b000-000000000003'
   and term_id   = pg_temp.fx_active_term();

insert into fx_audit (k, v)
values ('before_no_ack', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy, ack removed
select throws_ok(
  $$ select public.log_document_view('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'the SAME crrd_deputy, with the acknowledgement removed, is REFUSED — CBL Art. VIII §7.1 as a '
  'precondition. PRD US-J5: an error, not an empty result. **This is the deliberate day-one '
  'failure mode: on the morning a term opens, nobody has signed and no document opens**'
);
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_no_ack')), 0,
  'and the refused call wrote ZERO audit rows — a denied read must not look like a read in '
  'the log, or "who viewed this document" stops being answerable'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12-17 — the non-reviewer tiers
-- ═══════════════════════════════════════════════════════════════════════════════════

insert into fx_audit (k, v)
values ('before_denials', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok(
  $$ select public.log_document_view('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'tech_admin CANNOT view a proof document — PRD OQ-5, default NO. A Certificate of '
  'Registration is a scholar''s student number and address, and "configure the system" is '
  'not a claim on it');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select public.log_document_view('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'officer CANNOT — PRD US-J1. The Special Advisor sits in this tier (CBL Art. III §2.9) and '
  'independently reviews appeals (Art. X §2.4-2.5)');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok(
  $$ select public.log_document_view('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'regional_rep_a CANNOT — PRD US-J1: regional scope is ROWS on memberships, never sensitive '
  'columns and never documents');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select throws_ok(
  $$ select public.log_document_view('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'member CANNOT — not even for their own application. PRD §2: "members can only access '
  'forms"');
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select public.log_document_view('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'anon CANNOT — PRD US-J2: "no anyone-with-the-link sharing exists on any uploaded document", '
  'and the audit write behind the proxy is unreachable without a session');
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_denials')), 0,
  'FIVE refusals wrote ZERO audit rows between them — a refusal is not a view'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 18-25 — get_application_detail()
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-C1: "the detail view shows EVERY SUBMITTED FIELD." Those fields are applicant_email
-- and payload, both withheld from every session by the GRANT in 0027 (asserted in 046), so
-- this RPC is the only door — and coming through it writes an audit row.

insert into fx_audit (k, v)
values ('before_detail', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
insert into fx_detail (k, v)
values ('a1', public.get_application_detail('00000000-0000-4000-8000-000000000201'));
select pg_temp.logout();

select ok(
  (select v ? 'applicant_email' and v ->> 'applicant_email' = 'alpha.applicant@fixture.start-sys.test'
     from fx_detail where k = 'a1'),
  'the detail RPC RETURNS applicant_email — this is the door, and masking here would defeat '
  'its entire purpose. mask_sensitive() is for the AUDIT LOG, not for an authorized caller '
  'who has passed two guards and been recorded'
);

select ok(
  (select v ? 'payload' and (v -> 'payload') ->> 'school_id_no' = 'FIXT-APP-SCH'
     from fx_detail where k = 'a1'),
  'the detail RPC RETURNS the payload in full — PRD US-C1''s "every submitted field", served '
  'by an audited RPC rather than by widening a column GRANT'
);

select ok(
  (select not (v ? 'proof_web_view_link') from fx_detail where k = 'a1'),
  'proof_web_view_link is STRIPPED — PRD US-J2. A provider URL must never reach a browser: it '
  'is one forwarded link from a Certificate of Registration on the public internet and it '
  'would bypass the audited proxy entirely'
);

select ok(
  (select not (v ? 'proof_drive_file_id') from fx_detail where k = 'a1'),
  'proof_drive_file_id is STRIPPED, even though 0027 grants it for SELECT. That asymmetry is '
  'deliberate: the grant exists for the proxy''s server-side lookup, and this output goes to '
  'a SCREEN, where a provider file id is a durable handle in the DOM'
);

select ok(
  (select not (v ? 'submit_token_hash') and not (v ? 'submit_token_expires_at')
     from fx_detail where k = 'a1'),
  'both submit-token columns are STRIPPED — a live authorization secret for '
  'finalize_application() (0019) and its expiry, neither of which is a record field'
);

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_detail')
      and operation = 'VIEW'), 1,
  'ONE VIEW audit row per detail read — merely OPENING the detail page is an access to '
  'sensitive personal data and is recorded as one (RA 10173 / CBL Art. VIII §6)'
);

-- An application that does not exist. CONVENTIONS.md §4.3: an absent row is not_found, never
-- unauthorized — "forbidden" would confirm that an application with this id exists.
insert into fx_audit (k, v)
values ('before_missing', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');
insert into fx_detail (k, v)
values ('missing', public.get_application_detail('00000000-0000-4000-8000-0000000009ff'));
select pg_temp.logout();

select is(
  (select v from fx_detail where k = 'missing'), null::jsonb,
  'a NON-EXISTENT application returns NULL rather than raising — an absent row is not_found, '
  'and raising "forbidden" would confirm that an application with a guessed id exists'
);

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_missing')), 0,
  'and it wrote ZERO audit rows — nothing was viewed, and logging a miss would let the audit '
  'log itself become the enumeration oracle 0008 refuses to build'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 26-29 — the same matrix on the detail RPC
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A definer function needs a deny test per role, not just a happy path (CONVENTIONS.md §8.1):
-- this one runs as its owner with BYPASSRLS, so the guard inside the body is the entire
-- boundary and there is no policy behind it to catch a miss.

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok(
  $$ select public.get_application_detail('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'tech_admin CANNOT read an application in full — PRD OQ-5, and the exclusion is stated in '
  'the guard so that removing applications_read later does not silently open this door');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select public.get_application_detail('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text, 'officer CANNOT read an application in full — PRD US-D2/US-J1');
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select public.get_application_detail('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'anon CANNOT — EXECUTE revoked (0026) and auth_role() NULL inside the guard');
select pg_temp.logout();

-- The crrd_deputy's acknowledgement was removed before assertion 10 and never restored (see
-- the note there on why no savepoint is used), so this is the same reviewer in the same
-- unacknowledged state, refused at the OTHER sensitive door.
select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy, ack removed
select throws_ok(
  $$ select public.get_application_detail('00000000-0000-4000-8000-000000000201') $$,
  '42501'::char(5), null::text,
  'a crrd_deputy without a current-term acknowledgement is REFUSED by the detail RPC too — the '
  'gate is asserted on BOTH sensitive doors, because a gate on one of two doors is a gate on '
  'neither (CBL Art. VIII §7.1, PRD US-J5)');
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 30-32 — audit_log stays append-only
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-I1: "no user role can edit or delete an audit entry." Enforced at the GRANT level,
-- which is the strong form — a policy added later cannot re-open a privilege that was never
-- granted. Asserted here because both functions in this file INSERT into audit_log, and the
-- obvious wrong way to make that work would have been an INSERT policy plus a grant.

select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE'),
  'authenticated holds NO UPDATE on audit_log — not even the CEO can rewrite history from '
  'the app (PRD US-I1)'
);

select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'DELETE'),
  'authenticated holds NO DELETE on audit_log'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'audit_log'
      and cmd in ('UPDATE', 'DELETE', 'ALL')), 0,
  'ZERO UPDATE, DELETE or ALL policies on audit_log — the revoke and the missing policies are '
  'two independent mechanisms, and both must hold. The document-view rows this file asserts '
  'are worth nothing if they can be edited afterwards'
);


select * from finish();

rollback;
