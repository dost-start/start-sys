-- ═══════════════════════════════════════════════════════════════════════════════════
-- 062_member_record_rpc_authz.sql  —  the one door to a scholar's record
--
-- WHAT:
--     1     positive control
--   2-4     the three permitted tiers, each WITH a current-term acknowledgement, are admitted
--           and get the real sensitive values back
--   5-9     one success writes exactly ONE VIEW_RECORD audit row, attributed to the caller and
--           to the scholar read, carrying NO PII in either data column
-- 10-14     the five excluded tiers are refused with 42501 — tech_admin among them
--    15     a person who does not exist is `not_found`, not `unauthorized`
-- 16-17     every REFUSED call wrote NO audit row, under any operation label
-- 18-21     with every acknowledgement removed, all three permitted tiers are refused, the
--           message names the acknowledgement, and nothing is written
-- 22-25     the function's own shape: definer, pinned search_path, no anon EXECUTE, and no
--           table UPDATE on people for anybody
--
-- WHY:  PRD US-J1 ("restriction is enforced at the data layer, not by omitting a column from
--   a page"), US-J5 ("a sensitive-column read by a user with no current-term acknowledgement
--   is refused, AND THE REFUSAL IS AN ERROR, NOT AN EMPTY RESULT") and US-I1. Under RA 10173
--   — a CONSTITUTIONAL obligation here, CBL Art. VIII §6 — "who read this scholar's address,
--   and when" is a question the organization must be able to answer, which is only true if
--   there is exactly one path and it records every trip.
--
-- ⚠ tech_admin IS THE ASSERTION MOST LIKELY TO BE "FIXED". PRD OQ-5's default answer is NO:
--   "configure the system and control access" is not "read everyone's address". Assertion 10
--   is what turns a quiet widening into a red build. If that decision is ever reversed it
--   must be a DISTINCT AUDITED ROLE, never a fourth literal in the guard.
--
-- ⚠ A DENIED READ MUST WRITE NOTHING (16, 17, 21). Both guards raise before the insert. An audit
--   log that recorded refusals would grow a row every time a misconfigured client retried,
--   and the question RA 10173 actually asks — who READ this — would stop being answerable by
--   reading it.
--
-- ⚠ AUDIT ROWS ARE READ AS THE SESSION ROLE, ALWAYS. audit_log_read (0014) admits only
--   exec_admin and tech_admin, so counting the log while impersonating a moderator would
--   return zero and every delta assertion would trivially "pass". Deltas are measured from a
--   captured baseline, never as absolute counts, because the fixtures themselves fire audit
--   triggers.
--
-- ⚠ NO SAVEPOINTS. pgTAP keeps its running test number in a temp table, so a rollback to a
--   savepoint after plan() rewinds the counter into duplicate test numbers. The
--   acknowledgements are therefore deleted ONCE, after every assertion that needs them, and
--   never restored — the same discipline as 049_document_view_audit.sql.
--
-- CITATION:  BUILD_PLAN S5-T6, S5-T9; ADR 0006; DATA_MODEL.md §8.1, §8.3, §8.4;
--            ARCHITECTURE.md §5, §9 item 5; PRD US-D1, US-I1, US-J1, US-J5; PRD OQ-5, OQ-6;
--            CBL Art. VIII §6, §7.1; Art. III §2.9; Art. X §2.4-2.5.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/records-fixtures.psql

select plan(25);

-- Scratchpad for the audit-log baselines. Written and read by the SESSION role only:
-- audit_log_read (0014) admits exec_admin and tech_admin, so counting the log while
-- impersonating any other fixture would return zero and every delta would trivially pass.
create temp table fx_audit (k text primary key, v bigint);

-- P4 is the planted-literal row (helpers/fixtures.psql): birthdate 2003-04-15,
-- contact_number +639171234567, address_line 'Planted Address Line 42',
-- school_id_no 'PLANTED-SCH-001'. Reading those specific values back is what proves the
-- function returns the row UNMASKED to an authorized, acknowledged, audited caller —
-- mask_sensitive() is for the audit log, never for the reader who just passed two guards.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — positive control
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Every refusal in this file is a 42501, and a malformed claim makes auth_role() NULL, which
-- makes the role guard raise for EVERYONE. All eight deny assertions would pass for the wrong
-- reason without this.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.people), 17,
  'POSITIVE CONTROL: crrd_admin sees 17 people. If this is 0 the claims are malformed and '
  'every refusal below is meaningless'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2-4 — the three permitted tiers, each with an acknowledgement
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin, P1, HAS ack
select is(
  (public.get_member_record('00000000-0000-4000-b000-000000000004') ->> 'contact_number'),
  '+639171234567',
  'exec_admin reads the record UNMASKED — the planted contact number comes back verbatim. '
  'mask_sensitive() protects the AUDIT LOG, not the authorized caller who has just passed '
  'two guards and been recorded'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin, P2, HAS ack
select is(
  (public.get_member_record('00000000-0000-4000-b000-000000000004') ->> 'birthdate'),
  '2003-04-15',
  'crrd_admin — the CCDO, the operational heart of the system — reads the record in full '
  '(project-head decision 2026-09-01)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator, P3, ack via records-fixtures
select is(
  (public.get_member_record('00000000-0000-4000-b000-000000000004') ->> 'school_id_no'),
  'PLANTED-SCH-001',
  'a MODERATOR reads the record in full too: ARCHITECTURE.md §5 — you cannot review an '
  'application or correct a member record without reading it. Their reads are audited '
  'identically and gated on the same acknowledgement'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5-9 — one call, one audit row, and no PII in it
-- ═══════════════════════════════════════════════════════════════════════════════════
insert into fx_audit (k, v)
values ('before_one', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select ok(
  public.get_member_record('00000000-0000-4000-b000-000000000006') is not null,
  'a fourth successful read, isolated so the audit delta below measures exactly one call'
);
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_one')
      and operation = 'VIEW_RECORD'), 1,
  'ONE call writes EXACTLY ONE VIEW_RECORD row. Not "at least one" — a function that wrote '
  'two would double every access figure, and one that memoised would answer "has anyone ever '
  'looked?" instead of the question RA 10173 asks'
);

select is(
  (select actor_user_id from public.audit_log
    where id > (select v from fx_audit where k = 'before_one')
      and operation = 'VIEW_RECORD'
    order by id desc limit 1),
  '00000000-0000-4000-a000-000000000003'::uuid,
  'the row names the ACTING USER. PRD US-I1: "each entry names the acting user, the affected '
  'record, the action, the timestamp"'
);

select ok(
  (select old_data is null and new_data is null from public.audit_log
    where id > (select v from fx_audit where k = 'before_one')
      and operation = 'VIEW_RECORD'
    order by id desc limit 1),
  'old_data AND new_data are NULL. This is a read, so there is no diff — and putting the row '
  'here would make the append-only audit log the PII store mask_sensitive() exists to '
  'prevent, which the five-year purge could then never reach (DATA_MODEL.md §8.3)'
);

select is(
  (select row_id from public.audit_log
    where id > (select v from fx_audit where k = 'before_one')
      and operation = 'VIEW_RECORD'
    order by id desc limit 1),
  '00000000-0000-4000-b000-000000000006'::uuid,
  'the row names WHICH scholar was read, by id — the only way "who looked at this person''s '
  'record" is answerable without storing the record'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-14 — the five excluded tiers
-- ═══════════════════════════════════════════════════════════════════════════════════
insert into fx_audit (k, v)
values ('before_denials', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok(
  $$ select public.get_member_record('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5), null::text,
  'TECH_ADMIN IS REFUSED. PRD OQ-5, default answer NO: the PRD grants the CTO "configure the '
  'system and control access", which is not "read everyone''s address". Reversing this must '
  'be a DISTINCT AUDITED ROLE, never a fourth literal in the guard — this assertion is what '
  'turns a quiet widening into a red build'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select public.get_member_record('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5), null::text,
  'an OFFICER is refused (PRD US-D2, OQ-6). The Special Advisor sits in this tier (CBL Art. '
  'III §2.9) and is the INDEPENDENT reviewer of appeals against termination (Art. X '
  '§2.4-2.5) — an adjudicator who could read the records of the people whose appeals they '
  'hear is the specific thing this refuses'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok(
  $$ select public.get_member_record('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5), null::text,
  'a REGIONAL REP is refused even for a scholar in their OWN region (P4 is NCR): regional '
  'scope is rows, never sensitive columns (PRD US-J1)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select throws_ok(
  $$ select public.get_member_record('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5), null::text,
  'a MEMBER is refused even for THEIR OWN record (P4 is the member fixture''s person). v1 '
  'members do not self-serve their profile; CRRD owns the record (PRD §4 deferred scope)'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select public.get_member_record('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5), null::text,
  'anon is refused — twice over: EXECUTE is revoked from anon, and auth_role() is NULL so the '
  'role guard would refuse anyway'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 15-17 — absent is not forbidden, and a refusal writes nothing
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select ok(
  public.get_member_record('00000000-0000-4000-baaa-0000000000ff') is null,
  'a person who does not exist returns NULL, not an error. CONVENTIONS.md §4.3: an absent row '
  'is `not_found`, never `unauthorized` — "forbidden" would confirm that a named scholar HAS '
  'a record, which is the leak with no data in it'
);
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_denials')
      and operation = 'VIEW_RECORD'), 0,
  'the five refusals AND the not-found lookup wrote ZERO VIEW_RECORD rows between them. The '
  'log records reads that HAPPENED, never attempts that did not'
);

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_denials')), 0,
  'and they wrote zero audit rows of ANY operation — no refusal leaked into the log under a '
  'different label either'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 18-21 — the CBL Art. VIII §7.1 gate, with every acknowledgement removed
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠ THE DELETE IS PERMANENT FOR THE REST OF THIS FILE (no savepoints — see the header). This
-- is the "day-one failure mode" ARCHITECTURE.md §5 says belongs in the rollover runbook: on
-- the morning a new term opens, nobody has signed and every sensitive read fails. That is the
-- CORRECT behaviour, and unblocking it is one INSERT by an exec_admin — not a policy change.
--
-- The DELETE itself writes no audit row: trg_confidentiality_acknowledgements_audit is
-- `after insert or update` (0012). The baseline is captured after it regardless.
delete from public.confidentiality_acknowledgements
 where term_id = pg_temp.fx_active_term();

insert into fx_audit (k, v)
values ('before_no_ack', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin, ack removed
select throws_ok(
  $$ select public.get_member_record('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5), null::text,
  'EXEC_ADMIN is refused without a current-term acknowledgement. The widest role in the '
  'system is not exempt — CBL Art. VIII §7.1 binds "all elected and appointed officers"'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin, ack removed
select throws_like(
  $$ select public.get_member_record('00000000-0000-4000-b000-000000000004') $$,
  '%confidentiality acknowledgement%',
  'the refusal MESSAGE names the missing acknowledgement, distinctly from the plain role '
  'guard. BUILD_PLAN S5-T26 renders exactly one actionable sentence from it — a generic "not '
  'authorized" here would be a correct refusal delivered as an unactionable dead end, and a '
  'newly appointed CCDO would spend their first week debugging the wrong thing'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator, ack removed
select throws_ok(
  $$ select public.get_member_record('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5), null::text,
  'the MODERATOR is refused too. All three permitted tiers were admitted above and all three '
  'are refused now, so these assertions are measuring the ACKNOWLEDGEMENT gate rather than a '
  'role guard that would have refused anyway (PRD US-J5)'
);
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from fx_audit where k = 'before_no_ack')), 0,
  'the three acknowledgement refusals wrote ZERO audit rows: the gate raises BEFORE the '
  'insert, so a read that is not permitted and a read that is not logged remain impossible to '
  'separate'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 22-25 — the function's own shape
-- ═══════════════════════════════════════════════════════════════════════════════════
select ok(
  (select p.prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_member_record'),
  'get_member_record() is SECURITY DEFINER — it has to be: 0015 revokes ALL on public.people '
  'from authenticated and grants back a six-column SELECT, so no ordinary session can reach '
  'the sensitive block at all'
);

select ok(
  (select p.proconfig::text like '%search_path=%' from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_member_record'),
  'get_member_record() pins search_path. CONVENTIONS.md §3.4: every SECURITY DEFINER function '
  'declares `set search_path = ''''` and fully-qualifies every object name, no exceptions — '
  'without it a caller can shadow a referenced object and run their own code as the definer'
);

select ok(
  not has_function_privilege('anon', 'public.get_member_record(uuid)', 'execute'),
  'anon holds no EXECUTE on get_member_record(). SECURITY DEFINER functions are granted to '
  'PUBLIC by default, so this revoke is the belt to the internal role guard''s brace'
);

select ok(
  not has_table_privilege('authenticated', 'public.people', 'UPDATE'),
  'authenticated holds NO table UPDATE on public.people. That missing GRANT is the reason '
  'update_member_record() exists at all (064) — and the reason widening the 0015 grant to '
  '"make the edit form work" is the exact banned move (CLAUDE.md)'
);


select * from finish();

rollback;
