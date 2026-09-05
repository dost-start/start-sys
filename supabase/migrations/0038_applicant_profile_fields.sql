-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0038_applicant_profile_fields.sql  —  the SRS membership-application fields, on people
--
-- WHAT: the CRRD SRS ("Questions Roles and Features", 2026-09-05) redefines the membership
--   application form. The fields that are properties of the HUMAN land on `people`
--   (DATA_MODEL.md §2.1 — "a fact lives on people iff it would still be true of that human
--   if START-DOST ceased to exist"):
--     sex                 male / female / prefer not to say
--     facebook_account    "Facebook Account Link" — a contact channel, like phone and email
--     scholarship_award   RA 7687 / Merit / JLSS RA 7687 / JLSS Merit / JLSS RA 10612
--     award_year          "Year of Award" — the year the DOST scholarship was awarded.
--                         NOT the member-ID year: the member ID carries the year the
--                         person JOINED THE ORG (join_year), so a 2022 scholar who joins
--                         in 2026 is 2026-0001 (Ethan, 2026-09-06)
--     university_id       FK -> universities (0037), replaces free-text `school`
--     program_id          FK -> programs (0037), a closed list (PRD OQ-17 resolved)
--   Age is computed from birthdate at render time and never stored. Island group is
--   derived from the region and never stored.
--
--   memberships.year_level narrows from 1..8 to 1..5 — the SRS offers 1st to 5th only.
--
--   NO LONGER COLLECTED (the SRS form has no such fields): address_line, city_municipality,
--   province, postal_code, school_id_no. The columns stay — forward-only migrations, and
--   existing rows keep what they hold — the form simply stops asking (Ethan, 2026-09-06:
--   "keep columns, stop collecting").
--
-- SENSITIVITY (RA 10173, CBL Art. VIII §6): facebook_account is a contact channel and is
--   registered in sensitive_column_registry, so it is masked in every audit row and cleared
--   by redact_expired_pii() at the five-year mark once 0041 extends that function.
--   sex, scholarship_award, award_year, university_id and program_id are NOT registered:
--   they are the non-identifying skeleton headcounts are built from, and they are not in
--   the six-column GRANT of 0015 either, so officers and RRs still cannot read them
--   directly — every new column on people is ungranted by construction.
--
-- ROLLBACK: forward-only. Additive columns; the year_level narrowing would need the old
--   CHECK restored by a new migration.
-- ═══════════════════════════════════════════════════════════════════════════════════

create type public.sex_option as enum ('male', 'female', 'prefer_not_to_say');

comment on type public.sex_option is
  'SRS membership form: "Sex (male/female/prefer not to say)". Not registered sensitive; '
  'survives the five-year purge as part of the non-identifying skeleton.';

create type public.scholarship_award as enum
  ('ra_7687', 'merit', 'jlss_ra_7687', 'jlss_merit', 'jlss_ra_10612');

comment on type public.scholarship_award is
  'SRS membership form: "DOST Scholarship Award (RA 7687, Merit, JLSS RA 7687, JLSS Merit, '
  'JLSS RA 10612)". The five DOST-SEI undergraduate scholarship programs.';

alter table public.people
  add column sex               public.sex_option,
  add column facebook_account  text,
  add column scholarship_award public.scholarship_award,
  add column award_year        int
    constraint people_award_year_range check (award_year between 2000 and 2100),
  add column university_id     uuid references public.universities(id),
  add column program_id        uuid references public.programs(id);

create index people_university on public.people (university_id);
create index people_program    on public.people (program_id);

comment on column public.people.facebook_account is
  'SENSITIVE (RA 10173): the applicant''s Facebook profile link — a contact channel, treated '
  'like contact_number. Registered in sensitive_column_registry.';
comment on column public.people.award_year is
  'Year the DOST scholarship was awarded ("Year of Award"). NOT the member-ID year — that is '
  'join_year, the year the person joined the org (Ethan, 2026-09-06).';
comment on column public.people.university_id is
  'Replaces free-text `school` as of the SRS (2026-09-05). `school` stays for rows that '
  'predate 0037 and is filled from the university name on approval for continuity.';
comment on column public.people.program_id is
  'Closed list per the SRS / CBL Art. I §4 (PRD OQ-17 resolved: record only, closed list).';

insert into public.sensitive_column_registry (table_name, column_name, rationale) values
  ('people', 'facebook_account',
   'Facebook profile link — a contact channel, directly identifying. SRS 2026-09-05 field.')
on conflict (table_name, column_name) do nothing;

-- ── year level: 1st to 5th (SRS) ───────────────────────────────────────────────────
-- 0006 declared the CHECK inline, so it carries Postgres' auto-generated name.
alter table public.memberships drop constraint memberships_year_level_check;
alter table public.memberships add constraint memberships_year_level_check
  check (year_level between 1 and 5);

comment on column public.memberships.year_level is
  '1..5 per the SRS form ("Year Level (1st, 2nd, 3rd, 4th, 5th)"), narrowed from 1..8 by '
  '0038. Year 5 covers the five-year engineering programs on the CBL Art. I §4 list.';
