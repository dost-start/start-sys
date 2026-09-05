-- ═══════════════════════════════════════════════════════════════════════════════════
-- 071_rr_contacts_rpc.sql  —  the Regional Representative contact view (0042, ADR 0011)
--
-- WHAT:
--    1-4   rep_a, WITH an acknowledgement, reads exactly its region's current-term
--          scholars — two rows, both NCR, contact details present, region B absent
--    5-6   one VIEW_CONTACTS audit row per call, attributed to the rep
--    7     rep_b, with NO people row and therefore NO acknowledgement, is refused with an
--          ERROR (PRD US-J5) and writes no audit row
--    8-12  officer, exec_admin, crrd_admin, tech_admin and anon each raise 42501 — the
--          widening is for the REP tier and nobody else
--   13-14  the university filter narrows to the one scholar at that university, and to
--          nothing at another
--   15     the TABLE surface is unchanged: a direct `select contact_number from people`
--          from the rep still raises 42501 — the widening lives in the function only
--   16     the function is a definer with search_path pinned
--
-- WHY THE FIXTURE BINDS rep_a TO A PERSON HERE. fixtures.psql leaves both reps with
--   user_roles.person_id NULL, which is what makes "no acknowledgement possible" the
--   default state — correct for every other suite. This file binds rep_a to P6 (a
--   scholar with no account) and records P6's acknowledgement in-transaction, so the
--   positive case exists; rep_b is left as the fixture has it, so the refusal is real.
--
-- CITATION:  0042; ADR 0011; PRD US-F1, US-F2, US-J1, US-J5, OQ-6; CBL Art. III §4.6,
--            Art. VIII §6, §7.1; team decision 2026-09-05.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(16);

-- ── setup: rep_a can sign; P4 (NCR) studies at UP Diliman ─────────────────────────
update public.user_roles
   set person_id = '00000000-0000-4000-b000-000000000006'
 where user_id = '00000000-0000-4000-a000-000000000006';

insert into public.confidentiality_acknowledgements (person_id, term_id, agreement_version, recorded_by)
values ('00000000-0000-4000-b000-000000000006', pg_temp.fx_active_term(),
        'CBL-2026-VIII-7', '00000000-0000-4000-a000-000000000001')
on conflict do nothing;

update public.people
   set university_id = (select id from public.universities where name = 'University of the Philippines Diliman')
 where id = '00000000-0000-4000-b000-000000000004';

create temp table fx_audit_before on commit drop as
  select count(*)::int as n from public.audit_log;
grant select on fx_audit_before to public;

-- ── 1-4 — the positive case ────────────────────────────────────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a (NCR)

create temp table fx_contacts on commit drop as
  select * from public.list_region_member_contacts();
grant select on fx_contacts to public;

select is(
  (select count(*)::int from fx_contacts),
  2,
  'rep_a reads exactly TWO contacts — P3 and P4, the two current-term NCR scholars');

select ok(
  (select bool_and(region_id = pg_temp.fx_region('NCR')) from fx_contacts),
  'every row is in region A — scoped by auth_region_ids(), the same predicate memberships_read uses');

select is(
  (select contact_number from fx_contacts where person_id = '00000000-0000-4000-b000-000000000004'),
  '+639171234567',
  'the contact number IS returned — the deliberate widening (team decision 2026-09-05, ADR 0011)');

select is(
  (select count(*)::int from fx_contacts
    where person_id in ('00000000-0000-4000-b000-000000000005', '00000000-0000-4000-b000-000000000006')),
  0,
  'the two R07 scholars are ABSENT — region B is not rep_a''s to read (PRD US-F1)');

-- ── 5-6 — audited per call ─────────────────────────────────────────────────────────
-- Counted OUTSIDE the rep's session: audit_log_read (0014) is exec_admin/tech_admin only,
-- so a count taken as the rep reads 0 rows and the difference goes negative.
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log) - (select n from fx_audit_before),
  1,
  'ONE audit row for the read — the log answers "who looked, and when" (RA 10173, CBL Art. VIII §6)');

select ok(
  (select actor_user_id = '00000000-0000-4000-a000-000000000006'
      and actor_role = 'regional_rep' and operation = 'VIEW_CONTACTS'
      and old_data is null and new_data is null
     from public.audit_log order by id desc limit 1),
  'the row is attributed to rep_a, operation VIEW_CONTACTS, and carries NO values — the log is not a PII store');

-- ── 7 — no acknowledgement, no read ───────────────────────────────────────────────
create temp table fx_audit_mid on commit drop as
  select count(*)::int as n from public.audit_log;
grant select on fx_audit_mid to public;

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b (R07), no person, no ack
select throws_ok(
  $$ select * from public.list_region_member_contacts() $$,
  '42501'::char(5), null::text,
  'rep_b, with no current-term acknowledgement, is REFUSED WITH AN ERROR, not handed an empty list (PRD US-J5, CBL Art. VIII §7.1)');
select pg_temp.logout();

-- ── 8-12 — every other tier is refused ────────────────────────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok($$ select * from public.list_region_member_contacts() $$, '42501'::char(5), null::text,
  'officer is refused — OQ-6''s default stands: officers see no contact details');
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok($$ select * from public.list_region_member_contacts() $$, '42501'::char(5), null::text,
  'exec_admin is refused — administrators read contact details through get_member_record(), which is audited per person');
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok($$ select * from public.list_region_member_contacts() $$, '42501'::char(5), null::text,
  'crrd_admin is refused for the same reason');
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select throws_ok($$ select * from public.list_region_member_contacts() $$, '42501'::char(5), null::text,
  'tech_admin is refused — PRD OQ-5, the CTO does not read contact details');
select pg_temp.login_anon();
select throws_ok($$ select * from public.list_region_member_contacts() $$, '42501'::char(5), null::text,
  'anon is refused at the EXECUTE grant');
select pg_temp.logout();

select is(
  (select count(*)::int from public.audit_log) - (select n from fx_audit_mid),
  0,
  'none of the refusals wrote an audit row — a denied read must not look like a read');

-- ── 13-14 — the university filter ─────────────────────────────────────────────────
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- rep_a again
select is(
  (select count(*)::int from public.list_region_member_contacts(
     (select id from public.universities where name = 'University of the Philippines Diliman'))),
  1,
  'filtered by UP Diliman, rep_a sees exactly the one NCR scholar recorded there (P4)');

select is(
  (select count(*)::int from public.list_region_member_contacts(
     (select id from public.universities where name = 'Ateneo de Manila University'))),
  0,
  'filtered by a university nobody in the region attends, the list is empty — the filter narrows, never widens');

-- ── 15 — the table surface did not move ───────────────────────────────────────────
select throws_ok(
  $$ select contact_number from public.people $$,
  '42501'::char(5), null::text,
  'a direct SELECT of people.contact_number from the rep session still raises 42501 — the 0015 GRANT is untouched, the widening is the function alone');
select pg_temp.logout();

-- ── 16 — definer hygiene ───────────────────────────────────────────────────────────
select ok(
  (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_region_member_contacts'),
  'list_region_member_contacts() is SECURITY DEFINER with search_path pinned (CONVENTIONS §3.4)');

select * from finish();

rollback;
