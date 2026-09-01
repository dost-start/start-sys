-- ═══════════════════════════════════════════════════════════════════════════════════
-- 017_audit_triggers.sql  —  the nine triggers, the actor, and the masking
--
-- PRD US-I1 / the History NFR: "log significant administrative actions ... INCLUDING THE
-- USER RESPONSIBLE." That last clause is why the audit is a DATABASE trigger and not an
-- application write — ARCHITECTURE.md §8: "trigger-based, not application-based, so no code
-- path can skip it." This file is what makes that claim checkable.
--
--    1-9  all nine trg_<table>_audit triggers are attached (DATA_MODEL.md §8.3 + US-B4)
--  10-18  a crrd_admin UPDATE of a sensitive column writes EXACTLY ONE row, attributed to
--         that account, with the sensitive value MASKED and the non-sensitive one intact
--  19-22  an unauthenticated write is attributed to 'system', not left unattributed
--  23-24  a composite-primary-key table audits correctly (row_id NULL, payload intact)
--
-- ⚠ WHY THE UPDATE USES set_claims() AND NOT login_as(). 0015_grants.sql revokes ALL on
--   public.people from `authenticated` and grants back a SIX-COLUMN SELECT — there is no
--   UPDATE grant for any human role, by design (member records are written through the
--   audited RPCs in 0030, never by a direct table UPDATE). An audit test that became
--   `authenticated` would therefore fail at the GRANT and never reach the trigger it exists
--   to test, and the obvious "fix" would be to widen the grant — the single worst outcome
--   available in this schema. set_claims() sets request.jwt.claims WITHOUT switching the
--   database role, so auth.uid() and auth_role() answer for the crrd_admin fixture while the
--   statement itself retains session privileges. The column boundary is 019 and 029's
--   subject; the trigger is this file's. Each file tests one thing.
--
-- ⚠ EVERY COUNT HERE IS A DELTA, NEVER AN ABSOLUTE. Including the fixtures writes audit rows
--   of its own (user_roles, people, memberships, terms and committee_memberships all carry
--   the trigger, and step 6 of fixtures.sql updates a term), so a test asserting
--   `count(*) from audit_log = 1` would be asserting a property of the fixture rather than of
--   the trigger, and would break the day the fixture grows a row. Marks are captured in a
--   temp table before each action and every assertion counts forward from them.
--
-- ⚠ THE MASKING ASSERTION IS THE POINT OF THE WHOLE FILE. mask_sensitive() (0011) reads
--   sensitive_column_registry (0003, seeded 0016) at write time, so assertions 11-13 prove
--   the REGISTRY DRIVES the redaction — not that a marker is hardcoded somewhere. That is
--   what keeps the append-only audit log from becoming a PII backdoor, and it is what makes
--   append-only compatible with the five-year purge: the log holds no PII, so the purge never
--   needs to reach into it, so nobody ever needs a reason to grant UPDATE on it
--   (DATA_MODEL.md §8.3, RA 10173, CBL Art. VIII §6).
--
-- CITATION:  BUILD_PLAN S2-T9; PRD §3 v1.0 item 16, US-I1, US-B4, US-D1, US-E3;
--            DATA_MODEL.md §8.3; ARCHITECTURE.md §8; CBL Art. VIII §6, §7.1.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(24);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-9 — the audited set is attached
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Each is asserted BY NAME rather than by counting triggers, so a failure says which table
-- lost its audit rather than that the total moved. A table on this list without its trigger
-- is a table whose changes are unattributable — and PRD US-I1 names four of these
-- explicitly (membership status updates, officer role changes, application decisions,
-- document views).
--
-- application_windows is the ninth and is NOT on DATA_MODEL.md §8.3's list. PRD US-B4 states
-- outright that "opening and closing a window is written to the audit log with the
-- responsible user", so the doc and the requirement disagree and the requirement wins.
-- Flagged in 0012's header rather than silently resolved; asserted here so the divergence
-- cannot be quietly undone by someone tidying the schema against §8.3.

select ok((select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'people' and t.tgname = 'trg_people_audit')),
  'trg_people_audit is attached — PRD US-D1, before/after on every record change');

select ok((select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'memberships' and t.tgname = 'trg_memberships_audit')),
  'trg_memberships_audit is attached — PRD US-D3/US-D5, status updates and terminations');

select ok((select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'officer_assignments' and t.tgname = 'trg_officer_assignments_audit')),
  'trg_officer_assignments_audit is attached — CBL Art. VI standing changes');

select ok((select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'user_roles' and t.tgname = 'trg_user_roles_audit')),
  'trg_user_roles_audit is attached — "officer role changes", named in the History NFR');

select ok((select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'terms' and t.tgname = 'trg_terms_audit')),
  'trg_terms_audit is attached — PRD US-H2, rollover is audited with its actor');

select ok((select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'committee_memberships' and t.tgname = 'trg_committee_memberships_audit')),
  'trg_committee_memberships_audit is attached — PRD US-E1');

select ok((select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'department_assignments' and t.tgname = 'trg_department_assignments_audit')),
  'trg_department_assignments_audit is attached — PRD US-E2');

select ok((select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'confidentiality_acknowledgements'
               and t.tgname = 'trg_confidentiality_acknowledgements_audit')),
  'trg_confidentiality_acknowledgements_audit is attached — CBL Art. VIII §7.1, who filed it');

select ok((select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname = 'application_windows' and t.tgname = 'trg_application_windows_audit')),
  'trg_application_windows_audit is attached — PRD US-B4 (beyond DATA_MODEL §8.3; see header)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-18 — one attributed, masked row for one sensitive UPDATE
-- ═══════════════════════════════════════════════════════════════════════════════════

create temporary table _audit_marks (k text primary key, v bigint) on commit drop;

insert into _audit_marks (k, v)
values ('people_update', (select coalesce(max(id), 0) from public.audit_log));

-- Claims only — see the header. The statement runs with session privileges; the ATTRIBUTION
-- comes from request.jwt.claims, which is exactly what audit_row() reads.
select pg_temp.set_claims('00000000-0000-4000-a000-000000000003');   -- crrd_admin

-- P4 is the planted-literal person. contact_number is registered sensitive; given_name is
-- not. One UPDATE, two columns, so the same row proves both halves of the masking rule.
update public.people
   set contact_number = '+639179999999'
 where id = '00000000-0000-4000-b000-000000000004';

select pg_temp.logout();

-- 10 — exactly one. Not "at least one": a trigger fired FOR EACH STATEMENT as well as FOR
-- EACH ROW, or attached twice by a careless re-run of a migration, would double every entry
-- in the log and nothing else in the suite would notice.
select is(
  (select count(*)::int from public.audit_log
    where id > (select v from _audit_marks where k = 'people_update')),
  1,
  'a single-row UPDATE on people writes EXACTLY ONE audit row'
);

-- 11 — the sensitive value is redacted AT WRITE TIME. The marker is read back from
-- mask_sensitive() itself rather than typed as a literal, so this assertion survives a
-- future change to the marker string and still fails if masking stops happening at all.
select is(
  (select new_data ->> 'contact_number' from public.audit_log
    where id > (select v from _audit_marks where k = 'people_update')),
  (select public.mask_sensitive('people', '{"contact_number":"x"}'::jsonb) ->> 'contact_number'),
  'the NEW contact_number is masked — sensitive_column_registry drives the redaction'
);

-- 12 — and a column that is NOT registered passes through intact. Without this pair, a
-- mask_sensitive() that redacted everything would pass assertion 11 and destroy the log's
-- entire usefulness.
select is(
  (select new_data ->> 'given_name' from public.audit_log
    where id > (select v from _audit_marks where k = 'people_update')),
  'Juan',
  'given_name passes through unmasked — the registry is an allowlist, not a blanket'
);

-- 13 — the OLD value is masked too. Masking only the new value would leave the previous
-- contact number sitting in the log forever, which is the exact failure this design exists
-- to prevent: the log records THAT a number changed, never WHAT it was.
select is(
  (select old_data ->> 'contact_number' from public.audit_log
    where id > (select v from _audit_marks where k = 'people_update')),
  (select public.mask_sensitive('people', '{"contact_number":"x"}'::jsonb) ->> 'contact_number'),
  'the OLD contact_number is masked too — the previous value never enters the log'
);

-- 14 — "including the user responsible" (PRD US-I1), verbatim, as a value.
select is(
  (select actor_user_id from public.audit_log
    where id > (select v from _audit_marks where k = 'people_update')),
  '00000000-0000-4000-a000-000000000003'::uuid,
  'actor_user_id is the crrd_admin account that made the change'
);

-- 15 — and the capability it held at that instant, resolved live from user_roles rather than
-- from a JWT claim, so the log records what the account could actually DO and not what a
-- stale token said it could.
select is(
  (select actor_role from public.audit_log
    where id > (select v from _audit_marks where k = 'people_update')),
  'crrd_admin',
  'actor_role is read live from user_roles at write time, never from a JWT claim'
);

select is(
  (select operation from public.audit_log
    where id > (select v from _audit_marks where k = 'people_update')),
  'UPDATE',
  'operation is UPDATE'
);

select is(
  (select table_name from public.audit_log
    where id > (select v from _audit_marks where k = 'people_update')),
  'people',
  'table_name is people'
);

-- 18 — row_id makes "the history of THIS record" one indexed lookup (audit_log_row). It is
-- extracted out of the jsonb rather than off the record, which is what lets the same
-- audit_row() serve both id-keyed and composite-keyed tables — see assertion 23.
select is(
  (select row_id from public.audit_log
    where id > (select v from _audit_marks where k = 'people_update')),
  '00000000-0000-4000-b000-000000000004'::uuid,
  'row_id is the affected person — audit_log_row makes record history one index probe'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19-22 — an unauthenticated write is attributed, not orphaned
-- ═══════════════════════════════════════════════════════════════════════════════════
-- audit_log.actor_role is NOT NULL, so a write with no session (a scheduled job: the nightly
-- backup, the RA 10173 purge, the campaign sweep) has to resolve to something. audit_row()
-- coalesces auth_role() to 'system'. Asserting the exact value rather than merely "not null"
-- is what makes a system action distinguishable from a human one in the log — which is the
-- question the log gets asked after a bad night.
--
-- Inserted as 'draft': the one_active_term partial unique index forbids a second active term,
-- and the CBL Art. V §1 CHECKs require the term to end in May of the succeeding year.

insert into _audit_marks (k, v)
values ('term_insert', (select coalesce(max(id), 0) from public.audit_log));

insert into public.terms (label, starts_on, ends_on, status)
values ('2098-2099', date '2098-06-01', date '2099-05-31', 'draft');

select is(
  (select count(*)::int from public.audit_log
    where id > (select v from _audit_marks where k = 'term_insert')),
  1,
  'inserting a term writes exactly one audit row'
);

select is(
  (select actor_role from public.audit_log
    where id > (select v from _audit_marks where k = 'term_insert')),
  'system',
  'an unauthenticated write is attributed to ''system'' — actor_role is never null'
);

select is(
  (select operation from public.audit_log
    where id > (select v from _audit_marks where k = 'term_insert')),
  'INSERT',
  'operation is INSERT'
);

-- 22 — an INSERT has no previous state, and the trigger must record that as absence rather
-- than as an empty object. `{}` and NULL read very differently to whoever is reconstructing
-- what happened.
select ok(
  (select old_data is null from public.audit_log
    where id > (select v from _audit_marks where k = 'term_insert')),
  'old_data is NULL on an INSERT — absence, not an empty object'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 23-24 — composite-primary-key tables
-- ═══════════════════════════════════════════════════════════════════════════════════
-- committee_memberships and department_assignments have COMPOSITE primary keys and no `id`
-- column at all. DATA_MODEL.md §6/0011 sketches audit_row()'s row_id as coalesce(new.id,
-- old.id), which would raise "record new has no field id" on the first insert into either —
-- a runtime failure in a trigger, i.e. one that takes the whole write down. 0012 resolves it
-- by reading the id out of the jsonb instead, which yields NULL where no id exists.
--
-- These two assertions are what stop that fix from being "simplified" back.

insert into _audit_marks (k, v)
values ('link_insert', (select coalesce(max(id), 0) from public.audit_log));

-- P3's active-term membership joins the fixture committee. Both rows belong to the ACTIVE
-- term, so trg_committee_memberships_freeze_archived permits the write.
insert into public.committee_memberships (membership_id, committee_id)
values ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-e000-000000000001');

select is(
  (select row_id from public.audit_log
    where id > (select v from _audit_marks where k = 'link_insert')),
  null::uuid,
  'row_id is NULL for a composite-key table — audit_row() reads the id out of the jsonb, '
  'so one function serves all nine audited tables without raising on the ones lacking `id`'
);

-- 24 — and the payload is still complete, so the entry is useful despite the NULL row_id:
-- the membership and committee it links are both recoverable from new_data. Neither column
-- is in sensitive_column_registry, so both pass through.
select is(
  (select new_data ->> 'membership_id' from public.audit_log
    where id > (select v from _audit_marks where k = 'link_insert')),
  '00000000-0000-4000-c000-000000000001',
  'new_data carries the full link row — a NULL row_id costs nothing recoverable'
);


select * from finish();

rollback;
