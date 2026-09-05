-- ═══════════════════════════════════════════════════════════════════════════════════
-- 028_role_matrix_rowcounts.sql  —  BUILD_PLAN S2-T22
--
-- ARCHITECTURE.md §5 calls the RLS suite "the most important artifact in the repo" and
-- "an executable specification of who can see what". This is that file: nine role fixtures
-- against seventeen relations, 153 assertions, every one an EXACT EQUALITY.
--
-- ⚠ NEVER `cmp_ok(..., '>', 0, ...)` IN THIS FILE. A `> 0` assertion passes against a
--   policy that returns EVERYTHING, which is the exact regression this suite exists to
--   catch. Equally, a deny assertion written as "sees 0 rows" passes when a malformed JWT
--   claim makes auth.uid() NULL and every policy returns nothing — which is why the two
--   preflight assertions come first and check for SPECIFIC values.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ★ THE ARITHMETIC ★  — expected exact counts. Derived from test-helpers/fixtures.sql's
--   own header table, extended by the five LOCAL rows this file seeds (see below).
-- ═══════════════════════════════════════════════════════════════════════════════════
--
--                     reg  pos  aff  ppl  usr  trm  win  mem  m_aff dept cmte c_mbr d_asg off  ack  audit  reg'y
--   exec_admin         18   23    1    6    8    2    2    5     1    7    1    2     1    4    2   ALL     17
--   tech_admin         18   23    1    0    8    2    2    0     0    7    1    0     0    4    2   ALL     17
--   crrd_admin         18   23    1    6    1    2    2    5     1    7    1    2     1    4    1     0      0
--   crrd_deputy          18   23    1    6    1    2    2    5     1    7    1    2     1    4    0     0      0
--   officer            18   23    1    6    1    2    2    5     1    7    1    2     1    4    0     0      0
--   regional_rep_a     18   23    1    2    1    2    2    3     1    7    1    1     1    4    0     0      0
--   regional_rep_b     18   23    1    2    1    2    2    2     0    7    1    1     0    4    0     0      0
--   member             18   23    1    1    1    2    2    1     1    7    1    1     1    4    0     0      0
--   anon               18   23    0  ERR    0    1    1    0     0    0    0    0     0    0    0     0      0
--
-- READING THE SURPRISES — every one is a real property of 0014_rls.sql, not a fixture
-- accident, and each is the assertion that would catch its own regression:
--
--   • tech_admin sees ZERO people and ZERO memberships, and therefore zero of everything
--     that resolves THROUGH a membership (member_affiliations, committee_memberships,
--     department_assignments). people_read and memberships_read simply do not name
--     tech_admin. That is PRD OQ-5 — "configure the system and control access" is not
--     "read everyone's address" — expressed as a missing role literal. It is also why
--     BUILD_PLAN S6-T13 lands the CTO on /system rather than on an all-zero dashboard.
--
--   • regional_rep_a sees 3 MEMBERSHIPS but only 2 PEOPLE. memberships_read scopes a rep
--     by `region_id = any(auth_region_ids())` with NO term filter, so P1's ARCHIVED NCR
--     membership is visible; people_read scopes a rep through an EXISTS that ALSO requires
--     `m.term_id = current_term_id()`, so P1 the PERSON is not. Both are defensible
--     readings of PRD US-F1 and they disagree. FLAGGED FOR THE 0014 OWNER in the fixtures
--     header; measured here rather than silently reconciled, because narrowing a policy is
--     not a test's call to make.
--
--   • anon RAISES on `people` rather than returning 0. 0015_grants.sql revokes ALL on
--     public.people from anon, and count(*) needs SELECT on at least one column — so the
--     anonymous surface is cut at the GRANT before RLS is even consulted. Asserted with
--     throws_ok, and the difference matters: 0 rows means "a policy considered you", an
--     error means "you were never in the room".
--
--   • anon sees 1 term and 1 window, not 2 and 2. terms_read_anon restricts anon to
--     status='active'; application_windows_read_anon restricts it to a window that is OPEN
--     RIGHT NOW. That second pair is what makes PRD US-B4 a database fact — a closed period
--     is INVISIBLE as well as inert, so a forwarded /apply link is dead.
--
--   • anon still sees 18 regions and 23 officer_positions. Deliberate and narrow: the
--     public application form's region dropdown must render for someone with no account
--     (PRD US-B1), and the 23 titles are published in the Constitution itself. Widening
--     that pair is how the public surface leaks (0015 §4).
--
--   • departments, committees and officer_assignments are `using (true)` for every
--     authenticated tier, so all eight see 7 / 1 / 4. Who holds a CBL seat and what the org
--     chart looks like is org-public; what is on a person's RECORD is not, and that is 029.
--
--   • crrd_admin sees ONE user_roles row — their own. is_admin_reader() names exec_admin
--     and tech_admin only: a crrd_deputy or a CCDO has no business enumerating the org's
--     accounts (PRD US-I1, US-E3).
--
--   • confidentiality_acknowledgements: exec 2, tech 2, crrd 1, everyone else 0. The
--     policy is "your own row, or exec/tech". crrd_admin's person (P2) has signed so they
--     see one; the CRRD_DEPUTY's person (P3) deliberately has NOT, so they see none — PRD
--     US-J5's day-one state, kept as a fixture rather than smoothed away.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- FIVE ROWS SEEDED LOCALLY BY THIS FILE, AND WHY
-- ═══════════════════════════════════════════════════════════════════════════════════
--   test-helpers/fixtures.sql leaves `affiliations`, `member_affiliations`,
--   `department_assignments` and `application_windows` EMPTY. A row of nine zeros over an
--   empty table asserts nothing at all — it passes whether the policy is correct, absent,
--   or wide open. So this file seeds the minimum that makes those four rows discriminating,
--   as the session role, clearly labelled, and touching nothing another test file reads:
--
--     1 affiliation                        -> authenticated 1 / anon 0
--     1 member_affiliation on P4 (NCR)     -> rep_a 1 / rep_b 0 / tech_admin 0 / member 1
--     1 department_assignment on P4 (NCR)  -> same shape, through a different link table
--     1 OPEN application window            -> anon 1
--     1 CLOSED application window          -> authenticated 2 / anon still 1
--
--   All five are inside the test transaction and are rolled back. The fixtures file is not
--   modified: it is shared across eleven test files and belongs to another lane.
--
-- CITATION:  BUILD_PLAN S2-T22, S2-T14; ARCHITECTURE.md §5; CONVENTIONS.md §8.1;
--            DATA_MODEL.md §9; PRD §3 v1.0 items 3, 12, 14, 15, 16;
--            PRD US-A1, US-A2, US-B1, US-B4, US-D1, US-D2, US-E4, US-F1, US-I1, US-J1;
--            PRD OQ-5; PRD §6 Success Metric 8; CBL Art. III §4, §4.6, Art. VIII §7.1.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(155);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- LOCAL SEED — see "FIVE ROWS SEEDED LOCALLY BY THIS FILE" above.
-- Runs as the session role, which holds BYPASSRLS; seeding is a privileged act by
-- construction (people has no INSERT policy for any human role, by design).
-- ═══════════════════════════════════════════════════════════════════════════════════

insert into public.affiliations (id, code, name)
values ('00000000-0000-4000-9000-0000000000a1', 'FIXT_X_DATACAMP', 'Fixture x DataCamp');

-- Attached to the MEMBERSHIP, never to the person: a cohort is a fact about a term
-- (DATA_MODEL.md §2.2). c…002 is P4's active NCR membership — the member fixture's own,
-- which is what makes the member tier's "sees exactly 1" a real scoping assertion.
insert into public.member_affiliations (membership_id, affiliation_id)
values ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-9000-0000000000a1');

insert into public.department_assignments (membership_id, department_id)
select '00000000-0000-4000-c000-000000000002', d.id
from public.departments d
where d.code = 'CRRD' and d.term_id = (select id from public.terms where status = 'active');

-- OPEN right now: the only window anon may see (application_windows_read_anon).
insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
select id, 'membership_application', now() - interval '1 day', now() + interval '30 days'
from public.terms where status = 'active';

-- CLOSED: authenticated tiers read the whole schedule, anon reads only what is open. This
-- pair is what stops the window row from being a nine-zeros no-op.
insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
select id, 'committee_application', now() - interval '10 days', now() - interval '5 days'
from public.terms where status = 'active';

-- audit_log's expected count cannot be a literal: the fixture's own inserts fire nine audit
-- triggers and the seed fires one more, so hardcoding a number would make this file break
-- whenever an unrelated migration adds an audited row. Capturing the true total as the
-- session role and asserting exec/tech see EXACTLY that is the same assertion without the
-- brittleness — "the two admin tiers see the whole log, everyone else sees none of it".
create temp table fx_audit_total as
  select count(*)::int as n from public.audit_log;
grant select on fx_audit_total to public;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- PREFLIGHT — the positive control, before any deny assertion is trusted
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(public.auth_role()::text, 'crrd_admin',
  'POSITIVE CONTROL 1: the claims shape is right — auth_role() resolves to crrd_admin, not NULL');
select is((select count(*) from public.people)::int, 6,
  'POSITIVE CONTROL 2: crrd_admin sees exactly 6 people — every zero below is now a measurement, not an artefact');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- exec_admin — CEO/COO. Oversees all org records across all terms (PRD US-D1, US-I1).
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');

select is((select count(*) from public.regions)::int,                          18, 'exec_admin sees exactly 18 regions');
select is((select count(*) from public.officer_positions)::int,                23, 'exec_admin sees exactly 23 officer_positions');
select is((select count(*) from public.affiliations)::int,                      1, 'exec_admin sees exactly 1 affiliation');
select is((select count(*) from public.people)::int,                            6, 'exec_admin sees exactly 6 people');
select is((select count(*) from public.user_roles)::int,                        8, 'exec_admin sees exactly 8 user_roles — is_admin_reader() (PRD US-I1)');
select is((select count(*) from public.terms)::int,                             2, 'exec_admin sees exactly 2 terms — prior terms stay queryable (PRD US-H3)');
select is((select count(*) from public.application_windows)::int,               2, 'exec_admin sees exactly 2 application_windows — the whole schedule, open and closed');
select is((select count(*) from public.memberships)::int,                       5, 'exec_admin sees exactly 5 memberships');
select is((select count(*) from public.member_affiliations)::int,               1, 'exec_admin sees exactly 1 member_affiliation');
select is((select count(*) from public.departments)::int,                       7, 'exec_admin sees exactly 7 departments — CBL Art. III §4');
select is((select count(*) from public.committees)::int,                        1, 'exec_admin sees exactly 1 committee');
select is((select count(*) from public.committee_memberships)::int,             2, 'exec_admin sees exactly 2 committee_memberships');
select is((select count(*) from public.department_assignments)::int,            1, 'exec_admin sees exactly 1 department_assignment');
select is((select count(*) from public.officer_assignments)::int,               4, 'exec_admin sees exactly 4 officer_assignments');
select is((select count(*) from public.confidentiality_acknowledgements)::int,  2, 'exec_admin sees exactly 2 confidentiality_acknowledgements — they file them (CBL Art. VIII §7.1)');
select is((select count(*) from public.audit_log)::int,
          (select n from fx_audit_total),                                          'exec_admin sees EVERY audit_log row — PRD US-I1');
select is((select count(*) from public.sensitive_column_registry)::int,        20, 'exec_admin sees exactly 20 sensitive_column_registry rows — the map of where the PII is (18 + facebook_account + noa_drive_file_id)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- tech_admin — the CTO. Configures the system; does NOT read the roll (PRD OQ-5).
-- The five zeros below are the least-privilege decision, not a broken fixture.
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');

select is((select count(*) from public.regions)::int,                          18, 'tech_admin sees exactly 18 regions');
select is((select count(*) from public.officer_positions)::int,                23, 'tech_admin sees exactly 23 officer_positions');
select is((select count(*) from public.affiliations)::int,                      1, 'tech_admin sees exactly 1 affiliation');
select is((select count(*) from public.people)::int,                            0, 'tech_admin sees exactly 0 people — PRD OQ-5, "configure the system" is not "read everyone''s address"');
select is((select count(*) from public.user_roles)::int,                        8, 'tech_admin sees exactly 8 user_roles — they administer access (PRD US-E3)');
select is((select count(*) from public.terms)::int,                             2, 'tech_admin sees exactly 2 terms — they define them');
select is((select count(*) from public.application_windows)::int,               2, 'tech_admin sees exactly 2 application_windows');
select is((select count(*) from public.memberships)::int,                       0, 'tech_admin sees exactly 0 memberships — OQ-5 again, and why the CTO lands on /system');
select is((select count(*) from public.member_affiliations)::int,               0, 'tech_admin sees exactly 0 member_affiliations — the read resolves through memberships');
select is((select count(*) from public.departments)::int,                       7, 'tech_admin sees exactly 7 departments — the org chart is not the roll');
select is((select count(*) from public.committees)::int,                        1, 'tech_admin sees exactly 1 committee');
select is((select count(*) from public.committee_memberships)::int,             0, 'tech_admin sees exactly 0 committee_memberships — resolved through memberships');
select is((select count(*) from public.department_assignments)::int,            0, 'tech_admin sees exactly 0 department_assignments — resolved through memberships');
select is((select count(*) from public.officer_assignments)::int,               4, 'tech_admin sees exactly 4 officer_assignments');
select is((select count(*) from public.confidentiality_acknowledgements)::int,  2, 'tech_admin sees exactly 2 confidentiality_acknowledgements — they audit access (PRD US-I1)');
select is((select count(*) from public.audit_log)::int,
          (select n from fx_audit_total),                                          'tech_admin sees EVERY audit_log row — PRD US-I1');
select is((select count(*) from public.sensitive_column_registry)::int,        20, 'tech_admin sees exactly 20 sensitive_column_registry rows');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- crrd_admin — the CCDO. The operational heart, and the ONE user_roles row is theirs.
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');

select is((select count(*) from public.regions)::int,                          18, 'crrd_admin sees exactly 18 regions');
select is((select count(*) from public.officer_positions)::int,                23, 'crrd_admin sees exactly 23 officer_positions');
select is((select count(*) from public.affiliations)::int,                      1, 'crrd_admin sees exactly 1 affiliation — they write them (PRD US-G2)');
select is((select count(*) from public.people)::int,                            6, 'crrd_admin sees exactly 6 people — PRD US-D1');
select is((select count(*) from public.user_roles)::int,                        1, 'crrd_admin sees exactly 1 user_role — their OWN; a CCDO does not enumerate the org''s accounts');
select is((select count(*) from public.terms)::int,                             2, 'crrd_admin sees exactly 2 terms');
select is((select count(*) from public.application_windows)::int,               2, 'crrd_admin sees exactly 2 application_windows — they open and close them (ADR 0003)');
select is((select count(*) from public.memberships)::int,                       5, 'crrd_admin sees exactly 5 memberships');
select is((select count(*) from public.member_affiliations)::int,               1, 'crrd_admin sees exactly 1 member_affiliation');
select is((select count(*) from public.departments)::int,                       7, 'crrd_admin sees exactly 7 departments');
select is((select count(*) from public.committees)::int,                        1, 'crrd_admin sees exactly 1 committee — they create them (CBL Art. III §5)');
select is((select count(*) from public.committee_memberships)::int,             2, 'crrd_admin sees exactly 2 committee_memberships');
select is((select count(*) from public.department_assignments)::int,            1, 'crrd_admin sees exactly 1 department_assignment');
select is((select count(*) from public.officer_assignments)::int,               4, 'crrd_admin sees exactly 4 officer_assignments');
select is((select count(*) from public.confidentiality_acknowledgements)::int,  1, 'crrd_admin sees exactly 1 confidentiality_acknowledgement — their own; they may not enumerate who has NOT signed');
select is((select count(*) from public.audit_log)::int,                         0, 'crrd_admin sees exactly 0 audit_log rows — the watched must not read the watcher (PRD US-I1)');
select is((select count(*) from public.sensitive_column_registry)::int,         0, 'crrd_admin sees exactly 0 registry rows — the map of where the PII is is exec/tech only');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- crrd_deputy — DCCDO-C/D and DCTO-PD. Same operational reach, none of the structure.
-- The single 0 on acknowledgements is PRD US-J5's deliberate day-one state.
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000004');

select is((select count(*) from public.regions)::int,                          18, 'crrd_deputy sees exactly 18 regions');
select is((select count(*) from public.officer_positions)::int,                23, 'crrd_deputy sees exactly 23 officer_positions');
select is((select count(*) from public.affiliations)::int,                      1, 'crrd_deputy sees exactly 1 affiliation');
select is((select count(*) from public.people)::int,                            6, 'crrd_deputy sees exactly 6 people — application review is impossible otherwise');
select is((select count(*) from public.user_roles)::int,                        1, 'crrd_deputy sees exactly 1 user_role — their own');
select is((select count(*) from public.terms)::int,                             2, 'crrd_deputy sees exactly 2 terms');
select is((select count(*) from public.application_windows)::int,               2, 'crrd_deputy sees exactly 2 application_windows — read yes, write no');
select is((select count(*) from public.memberships)::int,                       5, 'crrd_deputy sees exactly 5 memberships');
select is((select count(*) from public.member_affiliations)::int,               1, 'crrd_deputy sees exactly 1 member_affiliation');
select is((select count(*) from public.departments)::int,                       7, 'crrd_deputy sees exactly 7 departments');
select is((select count(*) from public.committees)::int,                        1, 'crrd_deputy sees exactly 1 committee — they staff it, they do not create it');
select is((select count(*) from public.committee_memberships)::int,             2, 'crrd_deputy sees exactly 2 committee_memberships');
select is((select count(*) from public.department_assignments)::int,            1, 'crrd_deputy sees exactly 1 department_assignment');
select is((select count(*) from public.officer_assignments)::int,               4, 'crrd_deputy sees exactly 4 officer_assignments');
select is((select count(*) from public.confidentiality_acknowledgements)::int,  0, 'crrd_deputy sees exactly 0 confidentiality_acknowledgements — P3 deliberately has not signed (PRD US-J5)');
select is((select count(*) from public.audit_log)::int,                         0, 'crrd_deputy sees exactly 0 audit_log rows');
select is((select count(*) from public.sensitive_column_registry)::int,         0, 'crrd_deputy sees exactly 0 registry rows');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- officer — every other chief and deputy, plus the Special Advisor. SELECT only, and the
-- COLUMN half of that boundary is 029; this row is only about which ROWS reach them.
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');

select is((select count(*) from public.regions)::int,                          18, 'officer sees exactly 18 regions');
select is((select count(*) from public.officer_positions)::int,                23, 'officer sees exactly 23 officer_positions');
select is((select count(*) from public.affiliations)::int,                      1, 'officer sees exactly 1 affiliation');
select is((select count(*) from public.people)::int,                            6, 'officer sees exactly 6 people — PRD US-D2, view-only across the roll (columns are cut in 029)');
select is((select count(*) from public.user_roles)::int,                        1, 'officer sees exactly 1 user_role — their own');
select is((select count(*) from public.terms)::int,                             2, 'officer sees exactly 2 terms');
select is((select count(*) from public.application_windows)::int,               2, 'officer sees exactly 2 application_windows');
select is((select count(*) from public.memberships)::int,                       5, 'officer sees exactly 5 memberships');
select is((select count(*) from public.member_affiliations)::int,               1, 'officer sees exactly 1 member_affiliation');
select is((select count(*) from public.departments)::int,                       7, 'officer sees exactly 7 departments');
select is((select count(*) from public.committees)::int,                        1, 'officer sees exactly 1 committee');
select is((select count(*) from public.committee_memberships)::int,             2, 'officer sees exactly 2 committee_memberships');
select is((select count(*) from public.department_assignments)::int,            1, 'officer sees exactly 1 department_assignment');
select is((select count(*) from public.officer_assignments)::int,               4, 'officer sees exactly 4 officer_assignments');
select is((select count(*) from public.confidentiality_acknowledgements)::int,  0, 'officer sees exactly 0 confidentiality_acknowledgements — the officer fixture holds no person_id');
select is((select count(*) from public.audit_log)::int,                         0, 'officer sees exactly 0 audit_log rows — PRD US-I1 restricts it to exec and tech');
select is((select count(*) from public.sensitive_column_registry)::int,         0, 'officer sees exactly 0 registry rows');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- regional_rep_a — NCR. The 3-memberships-but-2-people asymmetry is the flagged
-- policy disagreement described in the header, measured rather than assumed.
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');

select is((select count(*) from public.regions)::int,                          18, 'regional_rep_a sees exactly 18 regions — geography is not scoped');
select is((select count(*) from public.officer_positions)::int,                23, 'regional_rep_a sees exactly 23 officer_positions');
select is((select count(*) from public.affiliations)::int,                      1, 'regional_rep_a sees exactly 1 affiliation');
select is((select count(*) from public.people)::int,                            2, 'regional_rep_a sees exactly 2 people — CURRENT-term NCR only (PRD US-F1)');
select is((select count(*) from public.user_roles)::int,                        1, 'regional_rep_a sees exactly 1 user_role — their own');
select is((select count(*) from public.terms)::int,                             2, 'regional_rep_a sees exactly 2 terms — the term LIST is not a disclosure; its contents are');
select is((select count(*) from public.application_windows)::int,               2, 'regional_rep_a sees exactly 2 application_windows');
select is((select count(*) from public.memberships)::int,                       3, 'regional_rep_a sees exactly 3 memberships — 2 current NCR + 1 ARCHIVED NCR (the flagged asymmetry)');
select is((select count(*) from public.member_affiliations)::int,               1, 'regional_rep_a sees exactly 1 member_affiliation — P4 is in their region');
select is((select count(*) from public.departments)::int,                       7, 'regional_rep_a sees exactly 7 departments');
select is((select count(*) from public.committees)::int,                        1, 'regional_rep_a sees exactly 1 committee');
select is((select count(*) from public.committee_memberships)::int,             1, 'regional_rep_a sees exactly 1 of the cross-region committee''s 2 rows');
select is((select count(*) from public.department_assignments)::int,            1, 'regional_rep_a sees exactly 1 department_assignment — P4''s, in their region');
select is((select count(*) from public.officer_assignments)::int,               4, 'regional_rep_a sees exactly 4 officer_assignments — the org chart is org-public');
select is((select count(*) from public.confidentiality_acknowledgements)::int,  0, 'regional_rep_a sees exactly 0 confidentiality_acknowledgements');
select is((select count(*) from public.audit_log)::int,                         0, 'regional_rep_a sees exactly 0 audit_log rows');
select is((select count(*) from public.sensitive_column_registry)::int,         0, 'regional_rep_a sees exactly 0 registry rows');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- regional_rep_b — R07. Disjoint from rep_a in every scoped relation. The zeros on
-- member_affiliations and department_assignments are the cross-region proof: those rows
-- exist and belong to NCR, so rep_b's zero is a REFUSAL, not an empty table.
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000007');

select is((select count(*) from public.regions)::int,                          18, 'regional_rep_b sees exactly 18 regions');
select is((select count(*) from public.officer_positions)::int,                23, 'regional_rep_b sees exactly 23 officer_positions');
select is((select count(*) from public.affiliations)::int,                      1, 'regional_rep_b sees exactly 1 affiliation');
select is((select count(*) from public.people)::int,                            2, 'regional_rep_b sees exactly 2 people — R07 only, disjoint from rep_a''s two');
select is((select count(*) from public.user_roles)::int,                        1, 'regional_rep_b sees exactly 1 user_role — their own');
select is((select count(*) from public.terms)::int,                             2, 'regional_rep_b sees exactly 2 terms');
select is((select count(*) from public.application_windows)::int,               2, 'regional_rep_b sees exactly 2 application_windows');
select is((select count(*) from public.memberships)::int,                       2, 'regional_rep_b sees exactly 2 memberships — R07 only');
select is((select count(*) from public.member_affiliations)::int,               0, 'regional_rep_b sees exactly 0 member_affiliations — the one that exists is NCR''s (PRD US-F1)');
select is((select count(*) from public.departments)::int,                       7, 'regional_rep_b sees exactly 7 departments');
select is((select count(*) from public.committees)::int,                        1, 'regional_rep_b sees exactly 1 committee');
select is((select count(*) from public.committee_memberships)::int,             1, 'regional_rep_b sees exactly the OTHER row of the cross-region committee');
select is((select count(*) from public.department_assignments)::int,            0, 'regional_rep_b sees exactly 0 department_assignments — the one that exists is NCR''s');
select is((select count(*) from public.officer_assignments)::int,               4, 'regional_rep_b sees exactly 4 officer_assignments');
select is((select count(*) from public.confidentiality_acknowledgements)::int,  0, 'regional_rep_b sees exactly 0 confidentiality_acknowledgements');
select is((select count(*) from public.audit_log)::int,                         0, 'regional_rep_b sees exactly 0 audit_log rows');
select is((select count(*) from public.sensitive_column_registry)::int,         0, 'regional_rep_b sees exactly 0 registry rows');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- member — an ordinary scholar. "Members can only access forms" is a policy, not a route
-- guard (ARCHITECTURE.md §5). Every 1 below is their OWN row and nobody else's (US-E4).
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000008');

select is((select count(*) from public.regions)::int,                          18, 'member sees exactly 18 regions');
select is((select count(*) from public.officer_positions)::int,                23, 'member sees exactly 23 officer_positions');
select is((select count(*) from public.affiliations)::int,                      1, 'member sees exactly 1 affiliation');
select is((select count(*) from public.people)::int,                            1, 'member sees exactly 1 person — themselves (PRD US-E4)');
select is((select count(*) from public.user_roles)::int,                        1, 'member sees exactly 1 user_role — their own');
select is((select count(*) from public.terms)::int,                             2, 'member sees exactly 2 terms');
select is((select count(*) from public.application_windows)::int,               2, 'member sees exactly 2 application_windows — they need to know when a form is open');
select is((select count(*) from public.memberships)::int,                       1, 'member sees exactly 1 membership — their own');
select is((select count(*) from public.member_affiliations)::int,               1, 'member sees exactly 1 member_affiliation — their own cohort');
select is((select count(*) from public.departments)::int,                       7, 'member sees exactly 7 departments — PRD US-E4, they can see where they sit');
select is((select count(*) from public.committees)::int,                        1, 'member sees exactly 1 committee');
select is((select count(*) from public.committee_memberships)::int,             1, 'member sees exactly 1 committee_membership — their own, NOT the roster (PRD US-E4)');
select is((select count(*) from public.department_assignments)::int,            1, 'member sees exactly 1 department_assignment — their own');
select is((select count(*) from public.officer_assignments)::int,               4, 'member sees exactly 4 officer_assignments — who holds a CBL seat is org-public');
select is((select count(*) from public.confidentiality_acknowledgements)::int,  0, 'member sees exactly 0 confidentiality_acknowledgements — P4 has not signed one');
select is((select count(*) from public.audit_log)::int,                         0, 'member sees exactly 0 audit_log rows');
select is((select count(*) from public.sensitive_column_registry)::int,         0, 'member sees exactly 0 registry rows');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- anon — the unauthenticated public surface. PRD US-A1: "no API or data path returns
-- organizational records to an unauthenticated caller, even when called directly."
--
-- The three non-zeros are the whole of the anonymous surface and each is argued for in
-- 0015 §4: 18 regions and 23 positions so the public application form can render, one
-- ACTIVE term and one OPEN window so US-B4's "the period is closed" is a database fact.
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_anon();

select is((select count(*) from public.regions)::int,                          18, 'anon sees exactly 18 regions — the /apply region dropdown must render without an account (PRD US-B1)');
select is((select count(*) from public.officer_positions)::int,                23, 'anon sees exactly 23 officer_positions — published in the Constitution itself');
select is((select count(*) from public.affiliations)::int,                      0, 'anon sees exactly 0 affiliations — the org''s partner list is not part of the public surface');

-- NOT a zero: an ERROR. 0015 revokes ALL on public.people from anon, and count(*) needs
-- SELECT on at least one column — so the anonymous caller is cut at the GRANT before RLS
-- is consulted at all. The distinction is worth asserting: 0 rows means a policy considered
-- you; 42501 means you were never in the room.
select throws_ok(
  $$ select count(*) from public.people $$,
  '42501'::char(5),
  null::text,
  'anon is REFUSED on public.people outright (42501) — 0015 revokes ALL, so this is the GRANT talking, not a policy');

select is((select count(*) from public.user_roles)::int,                        0, 'anon sees exactly 0 user_roles');
select is((select count(*) from public.terms)::int,                             1, 'anon sees exactly 1 term — the ACTIVE one; a draft or archived term is not the visitor''s business');
select is((select count(*) from public.application_windows)::int,               1, 'anon sees exactly 1 application_window — the OPEN one; a closed period is INVISIBLE as well as inert (PRD US-B4)');
select is((select count(*) from public.memberships)::int,                       0, 'anon sees exactly 0 memberships');
select is((select count(*) from public.member_affiliations)::int,               0, 'anon sees exactly 0 member_affiliations');
select is((select count(*) from public.departments)::int,                       0, 'anon sees exactly 0 departments');
select is((select count(*) from public.committees)::int,                        0, 'anon sees exactly 0 committees');
select is((select count(*) from public.committee_memberships)::int,             0, 'anon sees exactly 0 committee_memberships');
select is((select count(*) from public.department_assignments)::int,            0, 'anon sees exactly 0 department_assignments');
select is((select count(*) from public.officer_assignments)::int,               0, 'anon sees exactly 0 officer_assignments — org-public means public to the ORGANIZATION');
select is((select count(*) from public.confidentiality_acknowledgements)::int,  0, 'anon sees exactly 0 confidentiality_acknowledgements');
select is((select count(*) from public.audit_log)::int,                         0, 'anon sees exactly 0 audit_log rows');
select is((select count(*) from public.sensitive_column_registry)::int,         0, 'anon sees exactly 0 registry rows');


select * from finish();

rollback;
