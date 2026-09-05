-- ═══════════════════════════════════════════════════════════════════════════════════
-- 064_member_update_rpc_authz.sql  —  the only write path to a member record
--
-- WHAT:
--     1     positive control
--   2-4     an authorized, acknowledged caller writes — and the audit row lands MASKED
--   5-9     the five excluded tiers are refused with 42501, tech_admin among them
-- 10-16     the patch whitelist: member_id, join_year, id, redacted_at, an unknown key, a
--           membership `status` and an empty patch are each refused
--    17     optimistic concurrency — a stale expected_updated_at loses with 40001
--    18     a malformed date RAISES rather than silently NULLing the column
-- 19-20     and after all nine refusals the row is BYTE-IDENTICAL, birthdate included
--    21     an archived term stays read-only
-- 22-24     with every acknowledgement removed, all three permitted tiers are refused
--    25     and the row is byte-identical again
-- 26-28     the function's own shape: definer, pinned search_path, no anon EXECUTE
--
-- WHY:  PRD US-D1 — "every editable field is validated before the record is written", "each
--   update writes an audit entry with the responsible user and the before/after values", and
--   **"concurrent edits do not silently overwrite one another"**, which is the requirement
--   nothing else in this system enforces.
--
-- ⚠ WHY THIS FUNCTION EXISTS AT ALL. 0015_grants.sql runs `revoke all on public.people from
--   authenticated` and grants back a six-column SELECT. **No role holds table UPDATE on
--   `people`.** people_update (0014) names three roles, but a policy cannot grant a privilege
--   that was revoked — it is the second lock on a door whose first lock is a missing GRANT.
--   So an ordinary `supabase.from('people').update(...)` raises 42501 for everyone, and this
--   SECURITY DEFINER function is the only correct response. Widening the 0015 grant to "make
--   the edit form work" is the exact banned move (CLAUDE.md banned patterns).
--
-- ⚠ THE SAME MISSING GRANT SHAPES THIS FILE'S MECHANICS. `people.updated_at` is not granted
--   to `authenticated` either (061 asserts it), so an impersonating session cannot read the
--   value it needs to pass as p_expected_updated_at, and `to_jsonb(people_row)` raises 42501
--   as well. Both are therefore captured by the SESSION role into temp tables and read back
--   from there. That is not a workaround around the boundary — it is the boundary, and the
--   real client gets the same value the same way: through get_member_record().
--
-- ⚠ BYTE-IDENTICAL, NOT "STILL LOOKS RIGHT" (19, 20, 25). Every refusal is checked with a
--   full `to_jsonb(row)` comparison against a snapshot. A whitelist that rejected the
--   forbidden KEY while still applying the rest of the patch would pass a spot-check on the
--   forbidden column and quietly write the others.
--
-- ⚠ `status` IS REFUSED BY THIS FUNCTION ON PURPOSE (15). Membership status is a term-scoped
--   fact on `memberships`, and it moves through a PLAIN TABLE UPDATE so that both
--   memberships_update (0014) and enforce_membership_transition() (0028) stay in the path.
--   Routing it through a SECURITY DEFINER function would take RLS out of that path entirely —
--   and the terminated edge is the narrowest write in the system (CBL Art. VII §3.2.3).
--
-- ⚠ NO SAVEPOINTS. pgTAP keeps its running test number in a temp table; a rollback to a
--   savepoint after plan() rewinds the counter into duplicate test numbers. The
--   acknowledgements are deleted ONCE, after every assertion that needs them.
--
-- CITATION:  BUILD_PLAN S5-T7, S5-T11; ADR 0006; DATA_MODEL.md §7.3, §8.1, §8.3, §8.4;
--            ARCHITECTURE.md §5; PRD US-C4, US-D1, US-D2, US-J1, US-J3, US-J5; PRD OQ-5;
--            CBL Art. VII §3.2.3, Art. VIII §6, §7.1.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/records-fixtures.psql

select plan(28);

-- Scratchpads. CREATED and WRITTEN by the session role; only READ while impersonating.
create temp table fx_audit (k text primary key, v bigint);
create temp table fx_snap  (k text primary key, v jsonb);
create temp table fx_ts    (k text primary key, v timestamptz);
grant select on fx_audit, fx_snap, fx_ts to public;

-- The target throughout is P4, the planted-literal row from helpers/fixtures.psql.
insert into fx_ts (k, v)
select 'p4', p.updated_at from public.people p
 where p.id = '00000000-0000-4000-b000-000000000004';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — positive control
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.people), 17,
  'POSITIVE CONTROL: crrd_admin sees 17 people. Every refusal below is a 42501 or a 22023, '
  'and a malformed claim would make auth_role() NULL and raise for everyone'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2-4 — the write, and the masked audit row
-- ═══════════════════════════════════════════════════════════════════════════════════
insert into fx_audit (k, v)
values ('before_write', (select coalesce(max(id), 0) from public.audit_log));

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin, HAS an ack
select lives_ok(
  $$ select public.update_member_record(
       '00000000-0000-4000-b000-000000000004'::uuid,
       '{"contact_number": "+639998887777"}'::jsonb,
       (select v from fx_ts where k = 'p4')) $$,
  'crrd_admin patches a member''s contact number with a CURRENT expected_updated_at (PRD US-D1)'
);
select pg_temp.logout();

select is(
  (select contact_number from public.people
    where id = '00000000-0000-4000-b000-000000000004'),
  '+639998887777',
  'the value actually changed. The function is SECURITY DEFINER precisely because no session '
  'holds table UPDATE on people — this write is impossible any other way'
);

select is(
  (select new_data ->> 'contact_number' from public.audit_log
    where id > (select v from fx_audit where k = 'before_write')
      and table_name = 'people' and operation = 'UPDATE'
    order by id desc limit 1),
  '«redacted»',
  'the audit row records the ACT and MASKS the value. trg_people_audit fires INSIDE this '
  'function and mask_sensitive() reads sensitive_column_registry at write time, so the log '
  'answers "who changed this scholar''s contact number, and when" WITHOUT STORING THE NUMBER '
  '(DATA_MODEL.md §8.3). No audit row is hand-written here — a trigger cannot be skipped by a '
  'code path, an application-side insert can'
);

-- Re-capture: the successful write bumped updated_at via trg_people_set_updated_at, so every
-- later call must present the NEW value or it would be testing staleness by accident.
insert into fx_ts (k, v)
select 'p4b', p.updated_at from public.people p
 where p.id = '00000000-0000-4000-b000-000000000004';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5-9 — the five excluded tiers
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"contact_number":"+630000000000"}'::jsonb,
       (select v from fx_ts where k = 'p4b')) $$,
  '42501'::char(5), null::text,
  'TECH_ADMIN is refused (PRD OQ-5). The CTO configures the system; the CTO does not edit '
  'scholars'' addresses. Reversing that must be a distinct audited role, never a fourth '
  'literal in the guard'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"contact_number":"+630000000000"}'::jsonb,
       (select v from fx_ts where k = 'p4b')) $$,
  '42501'::char(5), null::text,
  'an OFFICER is refused: "no update, create or delete path exists for the Officer tier on any '
  'record" (PRD US-D2) — including through a definer function, which is exactly where a '
  'view-only tier would otherwise acquire a write'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a (NCR)
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"contact_number":"+630000000000"}'::jsonb,
       (select v from fx_ts where k = 'p4b')) $$,
  '42501'::char(5), null::text,
  'a REGIONAL REP is refused even for a scholar in their OWN region — P4 is NCR and so is '
  'rep_a. PRD US-F2: regional access is not regional editing'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member (P4 is their own person)
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"contact_number":"+630000000000"}'::jsonb,
       (select v from fx_ts where k = 'p4b')) $$,
  '42501'::char(5), null::text,
  'a MEMBER is refused for THEIR OWN record. Member self-service profile editing is deferred '
  'scope (PRD §4) — CRRD owns the record in v1'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"contact_number":"+630000000000"}'::jsonb, now()) $$,
  '42501'::char(5), null::text,
  'anon is refused twice over: EXECUTE is revoked, and auth_role() is NULL so the role guard '
  'would refuse anyway'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-18 — the patch whitelist
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Snapshot taken AFTER the legitimate write, so "byte-identical" means identical to the last
-- good state rather than to the untouched fixture.
insert into fx_snap (k, v)
select 'p4', to_jsonb(p) from public.people p
 where p.id = '00000000-0000-4000-b000-000000000004';

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

-- 22023 (invalid_parameter_value), NOT 42501: this is a malformed request from an AUTHORIZED
-- caller, and conflating the two would render "you may not edit this member" for a typo'd
-- field name.
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"member_id":"9999-999"}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '22023'::char(5), null::text,
  'member_id is NOT PATCHABLE. PRD US-C4 — "2024-001 will not become 2025-001" — is defended '
  'three times over: by enforce_member_id_immutable() (0022), by the format CHECK, and here, '
  'sited where a caller would actually try'
);

select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"join_year":1999}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '22023'::char(5), null::text,
  'join_year is NOT PATCHABLE — it is the year prefix of the member ID and the "year of '
  'membership" email filter axis (PRD US-G2); editing it silently desynchronises both'
);

select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"id":"00000000-0000-4000-b000-0000000000ff"}'::jsonb,
       (select v from fx_ts where k = 'p4b')) $$,
  '22023'::char(5), null::text,
  'the primary key is NOT PATCHABLE'
);

select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"redacted_at":null}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '22023'::char(5), null::text,
  'redacted_at is NOT PATCHABLE — it is the five-year purge marker (PRD US-J3), written only '
  'by redact_expired_pii(). Clearing it by hand would resurrect a record for the next purge '
  'to process again'
);

select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"favourite_colour":"blue"}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '22023'::char(5), null::text,
  'an UNKNOWN key is refused rather than ignored. Silently dropping it would let a renamed '
  'form field save successfully forever while writing nothing'
);

select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"status":"terminated"}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '22023'::char(5), null::text,
  'MEMBERSHIP STATUS IS NOT SETTABLE HERE, and this is the most important entry on the list. '
  'Status is a term-scoped fact on `memberships` and moves through a plain table UPDATE so '
  'that memberships_update (0014) and enforce_membership_transition() (0028) both stay in the '
  'path. A definer shortcut would take RLS out of the narrowest write in the system '
  '(CBL Art. VII §3.2.3)'
);

select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '22023'::char(5), null::text,
  'an EMPTY patch is refused rather than treated as a no-op: it would bump updated_at and '
  'write an audit row describing a change nobody made'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 17 — optimistic concurrency (PRD US-D1)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The scenario: two admins open the same member at the same time, one saves, the other saves
-- ten seconds later from a form populated before the first save. Without this the second write
-- wins silently and the first admin's edit is gone with no trace but an audit diff nobody
-- reads.
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"city_municipality":"Stale Write City"}'::jsonb,
       '2020-01-01T00:00:00Z'::timestamptz) $$,
  '40001'::char(5), null::text,
  'a STALE expected_updated_at loses with 40001 (serialization_failure), which '
  'lib/members/actions.ts maps to `conflict` and the form renders as "the record changed, '
  'reload". It does NOT merge — a merge of two half-informed edits is a third edit nobody '
  'made (PRD US-D1)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 18 — a malformed value raises; it does not silently null the column
-- ═══════════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"birthdate":"not-a-date"}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '22007'::char(5), null::text,
  'a malformed date RAISES from the cast in the UPDATE itself. The patch is deliberately NOT '
  'pre-coerced with a defensive try_cast, which would turn a typo into a silently NULLed '
  'birthdate — data loss disguised as a successful save'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19-20 — nothing above wrote anything
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Read as the SESSION role: `to_jsonb(people_row)` needs SELECT on every column, and
-- `authenticated` holds six (061 asserts the other thirteen are withheld).
select is(
  (select to_jsonb(p) from public.people p
    where p.id = '00000000-0000-4000-b000-000000000004'),
  (select v from fx_snap where k = 'p4'),
  'after SEVEN refused patches, one stale write and one malformed date the row is '
  'BYTE-IDENTICAL. Not one of them partially applied, and not one of them bumped updated_at. '
  'A whitelist that rejected the forbidden key while still applying the rest of the patch '
  'would pass every individual assertion above and fail this one'
);

select is(
  (select birthdate from public.people
    where id = '00000000-0000-4000-b000-000000000004'),
  date '2003-04-15',
  'and the birthdate specifically is untouched — still the planted fixture value, not NULL. '
  'This is the assertion that would catch a defensive cast that swallowed the parse error'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 21 — an archived term stays read-only
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠ THE FREEZE LIVES ON `memberships`, NOT ON `people`. `people` is per-human-forever and
-- carries no term_id, so a name correction on a scholar whose only membership is archived is
-- legitimately still allowed — that is the split in DATA_MODEL.md §2.1 working as designed.
-- What is frozen is the TERM-SCOPED record. Asserted here, beside the write path, so the
-- boundary is not assumed to cover more than it does.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin, the widest role
select throws_ok(
  $$ update public.memberships set year_level = 5
      where id = '00000000-0000-4000-c000-000000000005' $$,
  '42501'::char(5), null::text,
  'the ARCHIVED term''s membership is read-only for exec_admin too (DATA_MODEL.md §7.3). The '
  'documented escape hatch is unfreeze_term(), tech_admin only and audited — never a policy '
  'edit and never a definer shortcut'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 22-25 — the CBL Art. VIII §7.1 gate on the WRITE path
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠ PERMANENT FOR THE REST OF THIS FILE (no savepoints — see the header).
delete from public.confidentiality_acknowledgements
 where term_id = pg_temp.fx_active_term();

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin, ack removed
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"school":"Post-Ack University"}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '42501'::char(5), null::text,
  'EXEC_ADMIN cannot WRITE a member record without a current-term acknowledgement either. The '
  'gate is on the sensitive columns, not on the verb — an edit form is populated by a read'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin, ack removed
select throws_like(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"school":"Post-Ack University"}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '%confidentiality acknowledgement%',
  'the refusal MESSAGE names the missing acknowledgement, distinctly from the plain role '
  'guard, so the edit form can render the one sentence that unblocks a newly appointed CCDO '
  '(CBL Art. VIII §7.1, PRD US-J5)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- crrd_deputy, ack removed
select throws_ok(
  $$ select public.update_member_record('00000000-0000-4000-b000-000000000004'::uuid,
       '{"school":"Post-Ack University"}'::jsonb, (select v from fx_ts where k = 'p4b')) $$,
  '42501'::char(5), null::text,
  'the CRRD_DEPUTY is refused too. All three permitted tiers wrote successfully above and all '
  'three are refused now, so these assertions measure the ACKNOWLEDGEMENT gate rather than a '
  'role guard that would have refused anyway. **This is the deliberate day-one failure mode: '
  'on the morning a term opens nobody has signed and no member record can be edited**'
);
select pg_temp.logout();

select is(
  (select to_jsonb(p) from public.people p
    where p.id = '00000000-0000-4000-b000-000000000004'),
  (select v from fx_snap where k = 'p4'),
  'and the row is STILL byte-identical — thirteen attempted writes across this file, one '
  'legitimate one, and the record sits exactly where the legitimate one left it'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 26-28 — the function's own shape
-- ═══════════════════════════════════════════════════════════════════════════════════
select ok(
  (select p.prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_member_record'),
  'update_member_record() is SECURITY DEFINER — it has to be, because `authenticated` holds no '
  'table UPDATE on public.people at all (0015). That is the fact that makes this function the '
  'only write path rather than a convenience wrapper'
);

select ok(
  (select p.proconfig::text like '%search_path=%' from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_member_record'),
  'update_member_record() pins search_path (CONVENTIONS.md §3.4). Without it a caller can '
  'shadow a referenced object and run their own code with the definer''s privileges — which '
  'here means the privileges that can write every scholar''s PII'
);

select ok(
  not has_function_privilege('anon',
    'public.update_member_record(uuid, jsonb, timestamptz)', 'execute'),
  'anon holds no EXECUTE. SECURITY DEFINER functions are granted to PUBLIC by default, so the '
  'revoke is the belt to the internal role guard''s brace'
);


select * from finish();

rollback;
