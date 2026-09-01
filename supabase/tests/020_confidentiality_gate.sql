-- ═══════════════════════════════════════════════════════════════════════════════════
-- 020_confidentiality_gate.sql  —  CBL Art. VIII §7.1 as a precondition, not a reminder
--
-- WHAT:
--    1     POSITIVE CONTROL — crrd_admin has a current-term acknowledgement on file
--    2-4   ...and reads the real, UNMASKED sensitive block through get_person_sensitive()
--    5-8   one call writes EXACTLY ONE audit row: VIEW_SENSITIVE, attributed, values-free
--    9     exec_admin, the second acknowledged role, succeeds identically
--   10-13  moderator — acknowledged NOWHERE — is REFUSED WITH AN ERROR, the message names
--          the acknowledgement, and the refusal writes NO audit row
--   14-18  tech_admin, officer, regional_rep_a, member and anon each raise 42501
--   19     two calls write two rows — the log answers "who looked, and when", not "ever"
--   20     a person who does not exist returns NULL, not a refusal
--
-- WHY THE MODERATOR CASE IS THE FILE. PRD US-J5 is explicit: "a sensitive-column read by a
--   user with no current-term acknowledgement is REFUSED, AND THE REFUSAL IS AN ERROR, NOT
--   AN EMPTY RESULT." An empty result would be indistinguishable from "this scholar has no
--   contact number on file", and the CCDO would spend the first week of a term debugging
--   the wrong thing. fixtures.sql deliberately gives P3 (the moderator's person) NO
--   acknowledgement row precisely so this behaviour has something to be asserted against.
--   **DO NOT ADD AN ACK ROW FOR THE MODERATOR TO MAKE A TEST GO GREEN** — assertions 10-13
--   are asserting the refusal.
--
--   That refusal is also the deliberate day-one failure mode ARCHITECTURE.md §5 and §9
--   describe: on the morning a new term opens nobody has acknowledged, so every sensitive
--   read fails until an exec_admin records the acknowledgements. It belongs in the rollover
--   runbook (PRD US-K1, OQ-18), never in a code change.
--
-- WHY 5-8 AND 13 ARE A PAIR. RA 10173, made a constitutional obligation by CBL Art. VIII
--   §6, requires "who looked at this scholar's data, and when" to be answerable. 5-8 prove
--   an authorized read IS recorded; 13 proves a REFUSED read is NOT — a log in which denials
--   look like reads cannot answer the question it exists for. Assertion 8 is the other half
--   of that discipline: old_data and new_data are NULL on purpose, because putting the row
--   in the log would turn the audit log into exactly the PII store mask_sensitive() exists
--   to prevent (DATA_MODEL.md §8.3).
--
-- WHY 14 IS NOT NEGOTIABLE. tech_admin is excluded by PRD OQ-5, default answer NO:
--   "configure the system and control access" is not "read everyone's address". If that is
--   ever reversed it must be a DISTINCT, AUDITED ROLE — never a quiet widening of the guard
--   in get_person_sensitive(). The fixture makes the exclusion doubly true: tech_admin's
--   user_roles.person_id is NULL, so even with the role guard removed the account could not
--   satisfy the acknowledgement lookup, which keys on auth_person_id().
--
-- ⚠ EVERY AUDIT COUNT IS A DELTA, NEVER AN ABSOLUTE. Including the fixtures writes audit
--   rows of its own (people, user_roles, memberships, terms, committee_memberships and
--   confidentiality_acknowledgements all carry the trigger, and step 6 of fixtures.sql
--   updates a term). A test asserting `count(*) from audit_log = 1` would be asserting a
--   property of the fixture and would break the day the fixture grows a row.
--
-- CITATION:  BUILD_PLAN S2-T12; DATA_MODEL.md §8.3, §8.4; ARCHITECTURE.md §5, §9;
--            PRD US-J1, US-J5, US-I1, US-D2, OQ-5, OQ-6, OQ-18;
--            CBL Art. VIII §6 (RA 10173), §7.1 and §7.1.4, Art. III §2.9, Art. X §2.4-2.5.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir ../test-helpers/auth.sql
\ir ../test-helpers/fixtures.sql

select plan(20);


-- Scratch space, created and granted by the session role. INSERTs return no rows, so the
-- fixture sessions can record what they read without emitting anything the TAP parser
-- would have to step over. pg_temp USAGE is already granted to PUBLIC by auth.sql.
create temporary table _gate_marks (k text primary key, v bigint) on commit drop;
create temporary table _gate_reads (k text primary key, v jsonb)  on commit drop;

grant insert, select on _gate_marks to public;
grant insert, select on _gate_reads to public;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-8 — the acknowledged crrd_admin: the authorized path, end to end
-- ═══════════════════════════════════════════════════════════════════════════════════

insert into _gate_marks (k, v)
values ('crrd_read', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin, P2, acked

-- 1 — THE POSITIVE CONTROL, and it is the specific one this file needs. If the claims were
-- malformed, auth_person_id() would be NULL, has_confidentiality_ack() would be false, and
-- EVERY assertion below would "pass" as a refusal — including the ones that are supposed to
-- prove the gate lets an acknowledged reader through.
select ok(
  (select public.has_confidentiality_ack()),
  'crrd_admin has a CURRENT-TERM confidentiality acknowledgement on file — POSITIVE '
  'CONTROL (CBL Art. VIII §7.1, person x term grain)'
);

-- One call. Captured rather than selected bare, so exactly one audit row is produced and
-- assertions 5-8 can count it.
insert into _gate_reads (k, v)
select 'crrd', public.get_person_sensitive('00000000-0000-4000-b000-000000000004');  -- P4

select pg_temp.logout();

select ok(
  (select v is not null from _gate_reads where k = 'crrd'),
  'get_person_sensitive() returns a row to an acknowledged crrd_admin — PRD US-J1'
);

-- 3-4 — the REAL values, unmasked. mask_sensitive() is for the audit log, which must never
-- store PII; it is not for a caller who has just passed two guards and been recorded.
-- Masking here would defeat the entire purpose of the function, and asserting "not null"
-- alone would not catch it. P4 carries the four canonical planted literals (fixtures.sql).
select is(
  (select v ->> 'birthdate' from _gate_reads where k = 'crrd'),
  '2003-04-15',
  'the returned birthdate is the real, UNMASKED value — masking is the audit log''s job, '
  'never the authorized reader''s'
);

select is(
  (select v ->> 'contact_number' from _gate_reads where k = 'crrd'),
  '+639171234567',
  'the returned contact_number is the real, UNMASKED value'
);

-- 5 — exactly one. Not "at least one": a function that logged per column, or a trigger
-- attached twice, would double every entry in the log and nothing else would notice.
select is(
  (select count(*)::int from public.audit_log
    where id > (select v from _gate_marks where k = 'crrd_read')),
  1,
  'one authorized sensitive read writes EXACTLY ONE audit row — RA 10173 / CBL Art. VIII §6'
);

select is(
  (select operation from public.audit_log
    where id > (select v from _gate_marks where k = 'crrd_read')),
  'VIEW_SENSITIVE',
  'the operation is VIEW_SENSITIVE — distinguishable from an INSERT/UPDATE in the log'
);

-- 7 — "including the user responsible" (PRD US-I1), verbatim, as a value.
select is(
  (select actor_user_id from public.audit_log
    where id > (select v from _gate_marks where k = 'crrd_read')),
  '00000000-0000-4000-a000-000000000003'::uuid,
  'actor_user_id names the crrd_admin account that made the read'
);

-- 8 — and the log holds NO VALUES. This is what keeps the append-only audit log compatible
-- with the five-year purge: the log holds no PII, so the purge never needs to reach into
-- it, so nobody ever needs a reason to grant UPDATE on it (DATA_MODEL.md §8.3, PRD US-J3).
select ok(
  (select old_data is null and new_data is null from public.audit_log
    where id > (select v from _gate_marks where k = 'crrd_read')),
  'the VIEW_SENSITIVE row carries NO old_data and NO new_data — the log records the ACT, '
  'never the values it was about'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9 — the second acknowledged role
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Two permitted roles rather than one, so assertion 2 cannot be satisfied by a function
-- that happens to admit whichever role the test tried first.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin, P1, acked

select lives_ok(
  $$ select public.get_person_sensitive('00000000-0000-4000-b000-000000000004') $$,
  'exec_admin, also acknowledged, reads sensitive data — the guard admits a role set, not '
  'one hardcoded account'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-13 — the moderator: permitted by ROLE, refused by the CONSTITUTION
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The most important block in the file. The moderator tier IS in
-- get_person_sensitive()'s role guard — PRD §2 and ARCHITECTURE.md §5: "you cannot review
-- an application without reading it." What stops this call is Art. VIII §7.1 alone. So
-- these four assertions isolate the acknowledgement gate from the role guard, which is
-- exactly what makes them able to prove the gate exists at all.

insert into _gate_marks (k, v)
values ('mod_refused', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator, P3, NOT acked

-- 10 — the fixture precondition, asserted rather than assumed. If someone "fixes" the
-- fixture by adding an ack row for P3, this fails FIRST and names the cause, instead of
-- assertions 11-13 failing with the mystifying message that a refusal did not happen.
select ok(
  not (select public.has_confidentiality_ack()),
  'the moderator fixture has NO current-term acknowledgement — the deliberate negative '
  'case for PRD US-J5, and it must stay that way'
);

select throws_ok(
  $$ select public.get_person_sensitive('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5),
  null::text,
  'an unacknowledged moderator is REFUSED WITH AN ERROR (42501), never handed an empty '
  'result — PRD US-J5, CBL Art. VIII §7.1'
);

-- 12 — the message is a requirement, not a nicety. assert_confidentiality_ack() raises
-- 42501 exactly like the plain role guard does, so the SQLSTATE alone cannot tell a CCDO
-- whose signature is missing from an officer who was never entitled. The distinct message
-- is what lets the UI render the one actionable sentence that unblocks the reader
-- (BUILD_PLAN S5-T26). A generic "not authorized" here would be a correct refusal
-- delivered as an unactionable dead end.
select throws_like(
  $$ select public.get_person_sensitive('00000000-0000-4000-b000-000000000004') $$,
  '%acknowledgement%',
  'the refusal message NAMES the missing confidentiality acknowledgement, so the failure is '
  'actionable and distinguishable from a plain role refusal'
);

select pg_temp.logout();

-- 13 — and a denied read is NOT logged as a read. The audit write in
-- get_person_sensitive() sits AFTER both guards precisely so this holds; a log in which
-- refusals appear as VIEW_SENSITIVE rows cannot answer "who read this scholar's address".
--
-- ⚠ ASSERTED AFTER logout(), AND THAT ORDERING IS LOAD-BEARING. audit_log_read (0014)
-- admits only exec_admin and tech_admin, so a moderator session reads ZERO audit rows no
-- matter what is in the table — this assertion would pass vacuously if it ran one line
-- earlier. Every audit_log read in this file happens as the session role for that reason.
select is(
  (select count(*)::int from public.audit_log
    where id > (select v from _gate_marks where k = 'mod_refused')),
  0,
  'a REFUSED read writes ZERO audit rows — the guards run before the audit write, so a '
  'denial never appears in the log as a read'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14-18 — the five tiers with no path to sensitive data at all
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A SECURITY DEFINER function needs a deny test PER ROLE, not just a happy path: one
-- careless `or` in the guard grants everyone, and nothing else in this suite would see it.

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok(
  $$ select public.get_person_sensitive('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5),
  null::text,
  'tech_admin is refused — PRD OQ-5, default NO. "Configure the system and control access" '
  'is not "read everyone''s address"; reversing this needs a distinct AUDITED role, never a '
  'quiet widening of this guard'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select public.get_person_sensitive('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5),
  null::text,
  'officer is refused — PRD US-D2/US-J1/OQ-6. The Special Advisor sits in this tier '
  '(CBL Art. III §2.9) and must not read the records of people whose appeals they '
  'adjudicate (Art. X §2.4-2.5)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select throws_ok(
  $$ select public.get_person_sensitive('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5),
  null::text,
  'regional_rep is refused even for a person INSIDE its own region — regional scope is '
  'rows, never sensitive columns (PRD US-F1, US-J1)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
select throws_ok(
  $$ select public.get_person_sensitive('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5),
  null::text,
  'member is refused even for THEIR OWN person row — the member portal is forms only; '
  'self-service profile editing is deliberately deferred (PRD §4)'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select public.get_person_sensitive('00000000-0000-4000-b000-000000000004') $$,
  '42501'::char(5),
  null::text,
  'anon is refused at the EXECUTE grant — 0012 and 0015 both revoke it, so the internal '
  'role guard is not the only thing standing between the public and a scholar''s PII'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19 — the log counts reads, not readers
-- ═══════════════════════════════════════════════════════════════════════════════════
-- RA 10173 asks "who looked at this scholar's ID, AND WHEN" — not "has anyone ever looked".
-- A function that logged only the first read per session, or deduplicated by person, would
-- satisfy assertion 5 and quietly destroy the log's usefulness.

insert into _gate_marks (k, v)
values ('two_reads', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

insert into _gate_reads (k, v)
select 'crrd_2', public.get_person_sensitive('00000000-0000-4000-b000-000000000004');  -- P4

insert into _gate_reads (k, v)
select 'crrd_3', public.get_person_sensitive('00000000-0000-4000-b000-000000000003');  -- P3

select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from _gate_marks where k = 'two_reads')),
  2,
  'two successive reads append TWO audit rows — the log records every access, not merely '
  'the first (RA 10173; CBL Art. VIII §6)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20 — a person who does not exist is not_found, never unauthorized
-- ═══════════════════════════════════════════════════════════════════════════════════
-- CONVENTIONS.md §4.3: an empty result maps to `not_found`, never `unauthorized`. Raising
-- "forbidden" for an id that has no row would CONFIRM which ids do have rows — an
-- enumeration oracle over the membership roll, disclosed one error message at a time.
-- The function returns NULL and lets the caller map it.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

insert into _gate_reads (k, v)
select 'absent', public.get_person_sensitive('00000000-0000-4000-b000-0000000000ff');

select pg_temp.logout();

select is(
  (select v from _gate_reads where k = 'absent'),
  null::jsonb,
  'a person id with no row returns NULL rather than raising — an empty result is '
  'not_found, and "forbidden" would confirm which ids exist (CONVENTIONS.md §4.3)'
);


select * from finish();

rollback;
