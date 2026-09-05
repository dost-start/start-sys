-- ═══════════════════════════════════════════════════════════════════════════════════
-- 027_constitutional_invariants.sql  —  BUILD_PLAN S2-T21
--
-- The START-DOST Constitution and By-Laws 2026 is SEEDED, NOT PARAPHRASED (CLAUDE.md;
-- DATA_MODEL.md §13 rule 9). This file is what makes that claim checkable: it asserts the
-- constitutional facts against the catalog and the seed, so an Art. XII amendment cannot
-- be half-applied and a well-meant "fix" to the seed fails CI rather than code review.
--
--    1-3   CBL Art. III §2/§3/§4.6/§5: exactly FOUR administrators, exactly which four,
--          and exactly 23 positions
--    4     exactly one active term
--    5-7   CBL Art. III §4: exactly SEVEN departments, their codes, and their Chiefs
--    8-15  the eight grants_org_role mappings that are NOT obvious, each with its article
--   16     the admin_is_c_suite CHECK refuses a fifth administrator
--   17-18  RA 12000 (2024): eighteen regions, and exactly which eighteen
--   19-20  CBL Art. III §4.6 / §5: the two MULTI-SEAT positions are excluded from the
--          single-occupancy indexes, and only those two
--   21-22  CBL Art. V §1 read with Art. VII §1: the term ends in May and runs 1 Jun-31 May
--
-- ⚠ WHY EACH DESCRIPTION STRING CARRIES A CBL CITATION. When one of these fails at 2am,
--   the reader needs to know immediately whether they have found a bug or a constitutional
--   violation. "expected 7, got 8" is a count mismatch; "every active term has exactly the
--   seven departments of CBL Art. III §4" is a statement about the organization. Assertion
--   5 in particular is the test that catches a future roll_over_term() which forgot to
--   carry departments forward.
--
-- NO FIXTURES ARE LOADED. These are properties of the SEED (0016) and the schema (0003,
-- 0005, 0007), not of a seeded test world, and loading fixtures would add a second term
-- and invite someone to "adjust" assertion 5 for it.
--
-- CITATION:  BUILD_PLAN S2-T21; DATA_MODEL.md §6/0003, §6/0016, §9; ARCHITECTURE.md §5;
--            PRD §2, §3 v1.0 items 3, 4, 11; PRD US-E2, US-H2; PRD OQ-7, OQ-13, OQ-16;
--            CBL Art. III §2, §3, §4.1-4.7, §4.6, §5; Art. V §1, §2.1-2.2; Art. VI §1.6,
--            §3.2.8, §4; Art. VII §1; Art. X §2.4-2.5, §3.1; Art. XII;
--            RA 12000 (2024) creating the Negros Island Region.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(22);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — SEVEN ADMINISTRATORS, AND EXACTLY WHICH SEVEN
--
-- CRRD SRS, 2026-09-05 (0036): CEO, COO (exec_admin); CTO, DCTO-PD (tech_admin); CCDO,
-- DCCDO-C, DCCDO-D (crrd_admin), and nobody else. This is not a convention — the
-- admin_is_srs_administrator CHECK refuses an eighth, and assertion 16 proves the CHECK is
-- doing that work. Asserting the COUNT and the SET separately matters: a seed that
-- promoted the CFO and demoted the COO would keep the count at seven.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.officer_positions where is_administrator),
  7,
  'exactly SEVEN positions are administrators — CRRD SRS 2026-09-05 (0036), CBL Art. III §2-§3');

select bag_eq(
  $$ select code from public.officer_positions where is_administrator $$,
  $$ values ('CEO'), ('COO'), ('CTO'), ('DCTO_PD'), ('CCDO'), ('DCCDO_C'), ('DCCDO_D') $$,
  'the seven administrators are exactly CEO, COO, CTO, DCTO-PD, CCDO, DCCDO-C, DCCDO-D — SRS Roles: '
  '"CEO & COO", "CTO & DCTO-PD", "CRRD Chiefs and Deputies"');

select is(
  (select count(*)::int from public.officer_positions),
  23,
  'exactly 23 officer positions are seeded — CBL Art. III §2 (9), §3 (12), §4.6 (1), §5 (1)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-7 — THE TERM AND THE SEVEN DEPARTMENTS
--
-- Assertion 5 is the CI-blocking invariant DATA_MODEL.md §9 names: "every ACTIVE term has
-- exactly seven departments with the CBL Art. III §4 codes". A rollover that forgets step
-- 5 fails here, in a file whose name says why it matters, rather than showing up in
-- February as a dashboard that lost a department.
--
-- Assertion 7 pins each department to the Chief the Constitution names (Art. III
-- §4.1-§4.7), because head_position stores a POSITION CODE rather than a person — which is
-- what keeps it true across the whole term even while the seat is vacant (Art. VI §4).
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.terms where status = 'active'),
  1,
  'exactly one term is active — the one_active_term partial unique index, enforced not conventional');

select is(
  (select count(*)::int
     from public.departments
    where term_id = (select id from public.terms where status = 'active')),
  7,
  'the active term has exactly SEVEN departments — CBL Art. III §4; an eighth needs an Art. XII amendment');

select bag_eq(
  $$ select code from public.departments
      where term_id = (select id from public.terms where status = 'active') $$,
  $$ values ('EXEC'), ('TECH'), ('FIN'), ('MKTG'), ('COMMS'), ('CRRD'), ('EVENTS') $$,
  'the seven department codes are exactly the CBL Art. III §4.1-§4.7 departments');

select bag_eq(
  $$ select code, head_position from public.departments
      where term_id = (select id from public.terms where status = 'active') $$,
  $$ values ('EXEC','CEO'), ('TECH','CTO'), ('FIN','CFO'), ('MKTG','CMO'),
            ('COMMS','CCO'), ('CRRD','CCDO'), ('EVENTS','CEVO') $$,
  'each department is headed by the Chief the Constitution names — CBL Art. III §4.1-§4.7');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 8-15 — THE EIGHT NON-OBVIOUS ROLE MAPPINGS
--
-- grants_org_role is a PROVISIONING HINT, not an authorization fact — user_roles is the
-- live answer (PRD US-A2). But it is the hint an incoming CTO reads when deciding what to
-- grant a new officer, so a wrong row here becomes a wrong grant there. Each of these
-- eight is counter-intuitive to somebody, and each has a constitutional reason.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select grants_org_role::text from public.officer_positions where code = 'CTO'),
  'tech_admin',
  'CTO -> tech_admin — CBL Art. III §2.3 / Art. IV §2.1.4; with DCTO-PD, one of the two seats that can end a term (PRD OQ-13)');

select is(
  (select grants_org_role::text from public.officer_positions where code = 'DCTO_PD'),
  'tech_admin',
  'DCTO-PD -> tech_admin — SRS Roles: "CTO & DCTO-PD … configure the system and control access per role". The second seat is what mitigates PRD OQ-13');

select is(
  (select grants_org_role::text from public.officer_positions where code = 'DCCDO_C'),
  'crrd_admin',
  'DCCDO-C -> crrd_admin — SRS Roles: "CRRD Chiefs and Deputies"; CBL Art. IV §6.2.2 puts membership recruitment and application in their hands');

select is(
  (select grants_org_role::text from public.officer_positions where code = 'DCCDO_D'),
  'crrd_admin',
  'DCCDO-D -> crrd_admin — SRS Roles: "CRRD Chiefs and Deputies"; CBL Art. III §3.10');

select is(
  (select grants_org_role::text from public.officer_positions where code = 'SPECIAL_ADVISOR'),
  'officer',
  'Special Advisor -> officer (READ-ONLY) despite sitting with the Executive Board — CBL Art. III §2.9 non-voting, Art. X §2.4-2.5 independent reviewer of appeals, Art. X §3.1 a DOST-SEI employee. An adjudicator with write access would review appeals against their own writes');

select is(
  (select grants_org_role::text from public.officer_positions where code = 'DCOO'),
  'officer',
  'DCOO -> officer (READ-ONLY) even though CBL Art. VI §1.6 makes them the officer who ISSUES the AWOL notice — a known divergence, PRD OQ-16, flagged not fixed');

select is(
  (select grants_org_role::text from public.officer_positions where code = 'COMMITTEE_MEMBER'),
  'member',
  'COMMITTEE_MEMBER -> member — CBL Art. III §5 committee service is a real role that confers NO access to anyone else''s record');

select bag_eq(
  $$ select code from public.officer_positions where grants_org_role = 'exec_admin' $$,
  $$ values ('CEO'), ('COO') $$,
  'exactly CEO and COO grant exec_admin — CBL Art. III §2.1-2.2, and only they may terminate a membership (Art. VII §3.2.3) or record a separation from office (Art. VI)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 16 — the CHECK, not the convention
--
-- Run as the session role, so this is the CONSTRAINT refusing and not a policy. A fifth
-- administrator now requires a migration with a named author, which is the point:
-- widening the administrator set is a project-head decision (2026-09-01), not a row edit.
-- ═══════════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ update public.officer_positions set is_administrator = true where code = 'CFO' $$,
  '23514'::char(5),
  null::text,
  'the admin_is_srs_administrator CHECK refuses an EIGHTH administrator — SRS 2026-09-05, enforced by the database not by a comment');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 17-18 — EIGHTEEN regions, not seventeen
--
-- Republic Act 12000 (2024) created the Negros Island Region by carving Negros Occidental
-- out of Western Visayas and Negros Oriental and Siquijor out of Central Visayas.
-- Confirmed with the project heads, 2026-09-01. The count is asserted AND the set is, so a
-- seed that dropped NIR and added something else would still fail.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.regions),
  18,
  'exactly 18 Philippine regions are seeded — RA 12000 (2024) created the Negros Island Region, so it is 18 and not 17');

select bag_eq(
  $$ select code from public.regions $$,
  $$ values ('NCR'), ('CAR'), ('R01'), ('R02'), ('R03'), ('R04A'), ('MIMAROPA'), ('R05'),
            ('R06'), ('NIR'), ('R07'), ('R08'), ('R09'), ('R10'), ('R11'), ('R12'),
            ('R13'), ('BARMM') $$,
  'the 18 region codes are exactly the post-RA-12000 set, NIR included');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19-20 — THE TWO MULTI-SEAT POSITIONS
--
-- CBL Art. VI §4 defines a vacancy as the ABSENCE of a sitting assignment, which is why
-- there is no 'vacant' enum value and why one_sitting_officer / one_acting_officer exist
-- at all. But two positions are genuinely multi-seat and MUST be excluded: REGIONAL_REP
-- (Art. III §4.6 — the CBL sets no headcount per region, across 18 regions) and
-- COMMITTEE_MEMBER (Art. III §5 — many per committee).
--
-- Asserted against pg_get_indexdef rather than by behaviour, because the failure mode is
-- one-directional and quiet: an index that excluded a THIRD position would silently permit
-- two sitting CTOs, and no fixture would notice until a rollover ran twice.
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(
  (select pg_get_indexdef(c.oid) ~ 'REGIONAL_REP' and pg_get_indexdef(c.oid) ~ 'COMMITTEE_MEMBER'
     and pg_get_indexdef(c.oid) !~ 'SPECIAL_ADVISOR'
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'one_sitting_officer'),
  'one_sitting_officer excludes exactly REGIONAL_REP and COMMITTEE_MEMBER — the only multi-seat positions in the CBL (Art. III §4.6, §5)');

select ok(
  (select pg_get_indexdef(c.oid) ~ 'REGIONAL_REP' and pg_get_indexdef(c.oid) ~ 'COMMITTEE_MEMBER'
     and pg_get_indexdef(c.oid) !~ 'SPECIAL_ADVISOR'
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'one_acting_officer'),
  'one_acting_officer excludes the same two — an ACTING officer gets the powers, so the seat is equally single-occupancy (CBL Art. VI §4.1-4.3)');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 21-22 — THE TERM BOUNDARY (PRD OQ-7, resolved by the Constitution)
--
-- CBL Art. V §1: officers "shall serve a term until MAY of the succeeding year by which
-- they were appointed." CBL Art. VII §1 defines membership validity by pointing at that
-- same clause, so ONE term serves both and there is no second academic term to model.
--
-- It is NOT the school year — the CBL never mentions the academic calendar, and academic
-- timing rides on memberships.expected_grad_year instead. 1 June is the only start that
-- puts Executive Board selection (Art. V §2.1, first week of May) inside the OUTGOING term
-- and Deputy Board selection (§2.2, last week of June) inside the NEW one, which is what
-- makes end-of-May the right moment to run rollover (PRD US-H2).
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select extract(month from ends_on)::int from public.terms where status = 'active'),
  5,
  'the active term ends in MAY — CBL Art. V §1, enforced by the term_ends_in_may CHECK; a term ending in July is unconstitutional, not a typo found at 2am');

select ok(
  (select extract(month from starts_on) = 6 and extract(day from starts_on) = 1
      and extract(day from ends_on) = 31
      and extract(year from ends_on) = extract(year from starts_on) + 1
     from public.terms where status = 'active'),
  'the active term runs 1 June to 31 May of the succeeding year — CBL Art. V §1 with Art. VII §1 (the exact DAY in May is the residual half of OQ-7)');


select * from finish();

rollback;
