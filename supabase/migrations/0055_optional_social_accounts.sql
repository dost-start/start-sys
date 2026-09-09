-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0055_optional_social_accounts.sql
--
-- WHAT:      `people` gains three OPTIONAL contact channels beside the required
--            `facebook_account` (0038): `instagram_account`, `github_account`,
--            `linkedin_account`. All three are registered SENSITIVE, and the three
--            functions that carry profile fields — `approve_application()`,
--            `update_member_record()` and `approve_renewal()` — are replaced so the
--            fields survive approval, an admin edit and a renewal.
--
-- WHY:       Ethan (project head), 2026-09-09: "Facebook as required, then Instagram,
--            GitHub, and LinkedIn as optional."
--
-- ⚠ REJECTED ALTERNATIVE, recorded so it is not proposed again: a generic
--   `member_links (person_id, kind, url)` repeater — "add a link, pick a type". Ethan
--   turned it down as inefficient, and he is right for this schema:
--     · four fixed networks are FOUR COLUMNS, not an unbounded set. A child table buys
--       extensibility nobody asked for and costs a join on every member read, the RR
--       contact RPC and every export.
--     · `sensitive_column_registry` is keyed `(table_name, column_name)`. Rows in a
--       `member_links` table would be sensitive by VALUE, not by column, so the audit
--       masking and the five-year purge would both need a second, bespoke mechanism —
--       and DATA_MODEL.md §13 rule 4's "register the column in the same migration" would
--       stop meaning anything for this data.
--     · a `kind` chosen by the client is a validation surface; four named columns are not.
--
-- SENSITIVITY (RA 10173; CBL Art. VIII §6): each is a contact channel that identifies a
--   named person, exactly like `facebook_account`. All three are therefore registered,
--   which is what makes `mask_sensitive()` redact them before they reach `audit_log`
--   (0011) and what will make the five-year purge clear them. They are also ungranted by
--   construction — 0015 grants six named columns on `people` and nothing else — so an
--   officer or a regional rep cannot read them, and `v_member_directory` does not carry
--   them either.
--
--   The RR contact view (`list_region_member_contacts()`, 0042) is deliberately NOT
--   widened. ADR 0011 scoped that function to email, contact number, Facebook and
--   university; adding to it is a privacy decision for the team, not a side effect of
--   adding a column.
--
-- ROLLBACK:  Forward-only, additive. The columns are nullable and every function change
--            is a `create or replace`; a later migration can replace them again.
-- ═══════════════════════════════════════════════════════════════════════════════════

alter table public.people
  add column instagram_account text,
  add column github_account    text,
  add column linkedin_account  text;

comment on column public.people.instagram_account is
  'SENSITIVE (RA 10173): optional Instagram profile link — a contact channel, treated like '
  'facebook_account. Registered in sensitive_column_registry. Ethan 2026-09-09.';
comment on column public.people.github_account is
  'SENSITIVE (RA 10173): optional GitHub profile link — a contact channel. Registered.';
comment on column public.people.linkedin_account is
  'SENSITIVE (RA 10173): optional LinkedIn profile link — a contact channel. Registered.';

-- DATA_MODEL.md §13 rule 4: a new sensitive column is registered in the SAME migration
-- that creates it. `099_security_invariants.sql` asserts every registered pair names a
-- column that actually exists, so a later rename that skipped this table fails CI.
insert into public.sensitive_column_registry (table_name, column_name, rationale) values
  ('people', 'instagram_account',
   'Optional Instagram profile link — a contact channel, directly identifying (Ethan 2026-09-09).'),
  ('people', 'github_account',
   'Optional GitHub profile link — a contact channel, directly identifying (Ethan 2026-09-09).'),
  ('people', 'linkedin_account',
   'Optional LinkedIn profile link — a contact channel, directly identifying (Ethan 2026-09-09).')
on conflict (table_name, column_name) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════════════
-- The three functions that move profile fields. Each is the body it had before, with the
-- three new keys added in the same shape as `facebook_account` and nothing else changed —
-- extracted from 0041 / 0045 verbatim rather than retyped, so a diff against those files
-- shows exactly the added lines and nothing accidental.
-- ═══════════════════════════════════════════════════════════════════════════════════

create or replace function public.approve_application(p_app_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      public.org_role := public.auth_role();
  a           public.applications;
  v_person    uuid;
  v_join_year int;
  v_member_id text;
  v_univ      uuid;
  v_prog      uuid;
begin
  -- SRS 2026-09-05: "CRRD Chiefs and Deputies … manage membership applications"; the CEO and
  -- COO oversee records. tech_admin refused (PRD OQ-5). moderator retired (0036).
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to decide an application'
      using errcode = '42501';
  end if;

  select * into a from public.applications where id = p_app_id for update;
  if not found then
    raise exception 'application % not found', p_app_id
      using errcode = 'P0002';   -- no_data_found
  end if;

  -- Idempotent: a retried or double-submitted approval returns the existing ID (PRD US-C3).
  if a.status = 'approved' then
    return (select p.member_id from public.people p where p.id = a.person_id);
  end if;
  if a.status <> 'pending' then
    raise exception 'application % is %, not pending', p_app_id, a.status
      using errcode = '55000';
  end if;

  -- Person resolution: the row already linked, else a returning scholar matched on email
  -- (citext operators are invisible under an empty search_path, hence lower(::text)),
  -- else a brand-new person. A returning scholar keeps their original member ID (US-H5).
  v_person := a.person_id;
  if v_person is null then
    select p.id into v_person
      from public.people p
     where lower(p.personal_email::text) = lower(a.applicant_email::text)
     limit 1;
  end if;

  -- The FK columns are cast only when present and well-formed; a payload that predates
  -- 0038 has neither and gets null, which the columns allow.
  v_univ := case when (a.payload ->> 'university_id') ~ '^[0-9a-f-]{36}$'
                 then (a.payload ->> 'university_id')::uuid end;
  v_prog := case when (a.payload ->> 'program_id') ~ '^[0-9a-f-]{36}$'
                 then (a.payload ->> 'program_id')::uuid end;

  if v_person is null then
    select extract(year from t.starts_on)::int
      into v_join_year
      from public.terms t
     where t.id = a.term_id;

    insert into public.people (
      join_year,
      given_name, middle_name, family_name, suffix,
      personal_email,
      birthdate, contact_number,
      sex, facebook_account, scholarship_award, award_year,
      instagram_account, github_account, linkedin_account,
      university_id, program_id,
      school,
      address_line, city_municipality, province, postal_code, school_id_no
    )
    values (
      v_join_year,
      a.applicant_given_name,
      nullif(btrim(a.payload ->> 'middle_name'), ''),
      a.applicant_family_name,
      nullif(btrim(a.payload ->> 'suffix'), ''),
      a.applicant_email,
      (a.payload ->> 'birthdate')::date,
      a.payload ->> 'contact_number',
      case when a.payload ->> 'sex' in ('male', 'female', 'prefer_not_to_say')
           then (a.payload ->> 'sex')::public.sex_option end,
      nullif(btrim(a.payload ->> 'facebook_account'), ''),
      case when a.payload ->> 'scholarship_award'
                in ('ra_7687', 'merit', 'jlss_ra_7687', 'jlss_merit', 'jlss_ra_10612')
           then (a.payload ->> 'scholarship_award')::public.scholarship_award end,
      case when (a.payload ->> 'award_year') ~ '^\d{4}$'
           then (a.payload ->> 'award_year')::int end,
      -- PR C1 (2026-09-09): the three OPTIONAL networks. Blank is absence, exactly as
      -- middle_name and suffix are treated three lines up.
      nullif(btrim(a.payload ->> 'instagram_account'), ''),
      nullif(btrim(a.payload ->> 'github_account'), ''),
      nullif(btrim(a.payload ->> 'linkedin_account'), ''),
      v_univ,
      v_prog,
      -- legacy free-text school: the university name when one was chosen, else whatever
      -- a pre-0038 payload carried, else null.
      coalesce((select u.name from public.universities u where u.id = v_univ),
               a.payload ->> 'school'),
      a.payload ->> 'address_line',
      a.payload ->> 'city_municipality',
      a.payload ->> 'province',
      a.payload ->> 'postal_code',
      a.payload ->> 'school_id_no'
    )
    returning id into v_person;
  end if;

  -- ID + membership + stamp, one transaction; the audit trigger records the decision.
  v_member_id := public.allocate_member_id(v_person);

  insert into public.memberships (
    person_id, term_id, status, region_id, year_level, expected_grad_year
  )
  values (
    v_person,
    a.term_id,
    'active',
    (a.payload ->> 'region_id')::uuid,
    (a.payload ->> 'year_level')::int,
    (a.payload ->> 'expected_grad_year')::int
  )
  on conflict (person_id, term_id) do nothing;

  update public.applications
     set status      = 'approved',
         person_id   = v_person,
         reviewed_by = (select auth.uid()),
         reviewed_at = now()
   where id = p_app_id;

  return v_member_id;
end;
$$;

create or replace function public.update_member_record(
  p_person_id           uuid,
  p_patch               jsonb,
  p_expected_updated_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  v_row  public.people;
  v_bad  text[];
begin
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to update a member record'
      using errcode = '42501';
  end if;

  -- CBL Art. VIII §7.1 — a current-term confidentiality acknowledgement, or nothing.
  perform public.assert_confidentiality_ack();

  if p_patch is null or p_patch = '{}'::jsonb then
    raise exception 'update_member_record: the patch is empty; nothing to change'
      using errcode = '22023';
  end if;

  select array_agg(k order by k) into v_bad
  from jsonb_object_keys(p_patch) as k
  where k not in (
    'given_name', 'middle_name', 'family_name', 'suffix',
    'birthdate', 'contact_number', 'personal_email',
    'address_line', 'city_municipality', 'province', 'postal_code',
    'school', 'school_id_no',
    'sex', 'facebook_account', 'scholarship_award', 'award_year',
    'instagram_account', 'github_account', 'linkedin_account',
    'university_id', 'program_id'
  );

  if v_bad is not null then
    raise exception
      'update_member_record: % is not a patchable column. member_id, join_year, id and redacted_at are never patchable (PRD US-C4), and membership status moves through memberships so that its RLS policy and transition trigger stay in the path',
      array_to_string(v_bad, ', ')
      using errcode = '22023';
  end if;

  select * into v_row from public.people p where p.id = p_person_id for update;
  if v_row.id is null then
    raise exception 'member record % not found', p_person_id
      using errcode = 'no_data_found';
  end if;

  -- Optimistic concurrency (PRD US-D1): a stale form loses instead of clobbering.
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception
      'this member record was changed by someone else since it was loaded; reload and reapply the edit'
      using errcode = 'serialization_failure';
  end if;

  -- Casts raise on malformed input rather than coercing to null (S5-T7 acceptance).
  update public.people p set
    given_name        = case when p_patch ? 'given_name'        then  p_patch->>'given_name'                          else p.given_name        end,
    middle_name       = case when p_patch ? 'middle_name'       then  p_patch->>'middle_name'                         else p.middle_name       end,
    family_name       = case when p_patch ? 'family_name'       then  p_patch->>'family_name'                         else p.family_name       end,
    suffix            = case when p_patch ? 'suffix'            then  p_patch->>'suffix'                              else p.suffix            end,
    birthdate         = case when p_patch ? 'birthdate'         then (p_patch->>'birthdate')::date                    else p.birthdate         end,
    contact_number    = case when p_patch ? 'contact_number'    then  p_patch->>'contact_number'                      else p.contact_number    end,
    personal_email    = case when p_patch ? 'personal_email'    then  p_patch->>'personal_email'                      else p.personal_email::text end,
    address_line      = case when p_patch ? 'address_line'      then  p_patch->>'address_line'                        else p.address_line      end,
    city_municipality = case when p_patch ? 'city_municipality' then  p_patch->>'city_municipality'                   else p.city_municipality end,
    province          = case when p_patch ? 'province'          then  p_patch->>'province'                            else p.province          end,
    postal_code       = case when p_patch ? 'postal_code'       then  p_patch->>'postal_code'                         else p.postal_code       end,
    school            = case when p_patch ? 'school'            then  p_patch->>'school'                              else p.school            end,
    school_id_no      = case when p_patch ? 'school_id_no'      then  p_patch->>'school_id_no'                        else p.school_id_no      end,
    sex               = case when p_patch ? 'sex'               then (p_patch->>'sex')::public.sex_option             else p.sex               end,
    facebook_account  = case when p_patch ? 'facebook_account'  then  p_patch->>'facebook_account'                    else p.facebook_account  end,
    instagram_account = case when p_patch ? 'instagram_account' then  p_patch->>'instagram_account'                   else p.instagram_account end,
    github_account    = case when p_patch ? 'github_account'    then  p_patch->>'github_account'                      else p.github_account    end,
    linkedin_account  = case when p_patch ? 'linkedin_account'  then  p_patch->>'linkedin_account'                    else p.linkedin_account  end,
    scholarship_award = case when p_patch ? 'scholarship_award' then (p_patch->>'scholarship_award')::public.scholarship_award else p.scholarship_award end,
    award_year        = case when p_patch ? 'award_year'        then (p_patch->>'award_year')::int                    else p.award_year        end,
    university_id     = case when p_patch ? 'university_id'     then (p_patch->>'university_id')::uuid                else p.university_id     end,
    program_id        = case when p_patch ? 'program_id'        then (p_patch->>'program_id')::uuid                   else p.program_id        end
  where p.id = p_person_id;
end;
$$;

create or replace function public.approve_renewal(p_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   public.org_role := public.auth_role();
  r        public.renewal_submissions;
  v_region uuid;
  v_univ   uuid;
  v_prog   uuid;
begin
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to decide a renewal' using errcode = '42501';
  end if;

  select * into r from public.renewal_submissions where id = p_id for update;
  if r.id is null then
    raise exception 'renewal % not found', p_id using errcode = 'P0002';
  end if;
  if r.status = 'approved' then
    return (select p.member_id from public.people p where p.id = r.person_id);   -- idempotent
  end if;
  if r.status <> 'pending' then
    raise exception 'renewal % is %, not pending', p_id, r.status using errcode = '55000';
  end if;

  v_region := case when (r.payload ->> 'region_id') ~ '^[0-9a-f-]{36}$'
                   then (r.payload ->> 'region_id')::uuid end;
  if v_region is null then
    raise exception 'the renewal carries no region' using errcode = '23514';
  end if;
  v_univ := case when (r.payload ->> 'university_id') ~ '^[0-9a-f-]{36}$'
                 then (r.payload ->> 'university_id')::uuid end;
  v_prog := case when (r.payload ->> 'program_id') ~ '^[0-9a-f-]{36}$'
                 then (r.payload ->> 'program_id')::uuid end;

  -- The updated contact and academic details, INCLUDING the mailing address (0045 — the
  -- SRS renewal form still asks for one; 0044 shipped every other field but this one).
  -- NOT the name, NOT the birthdate, NOT the email (the email is the identity that just
  -- proved the renewal), and NEVER member_id — the trigger from 0022 would refuse it
  -- anyway. Blanks leave the old value.
  update public.people p
     set contact_number    = coalesce(nullif(btrim(r.payload ->> 'contact_number'), ''), p.contact_number),
         address_line      = coalesce(nullif(btrim(r.payload ->> 'address_line'), ''), p.address_line),
         city_municipality = coalesce(nullif(btrim(r.payload ->> 'city_municipality'), ''), p.city_municipality),
         province          = coalesce(nullif(btrim(r.payload ->> 'province'), ''), p.province),
         postal_code       = coalesce(nullif(btrim(r.payload ->> 'postal_code'), ''), p.postal_code),
         facebook_account  = coalesce(nullif(btrim(r.payload ->> 'facebook_account'), ''), p.facebook_account),
         instagram_account = coalesce(nullif(btrim(r.payload ->> 'instagram_account'), ''), p.instagram_account),
         github_account    = coalesce(nullif(btrim(r.payload ->> 'github_account'), ''), p.github_account),
         linkedin_account  = coalesce(nullif(btrim(r.payload ->> 'linkedin_account'), ''), p.linkedin_account),
         sex               = coalesce(case when r.payload ->> 'sex' in ('male', 'female', 'prefer_not_to_say')
                                           then (r.payload ->> 'sex')::public.sex_option end, p.sex),
         scholarship_award = coalesce(case when r.payload ->> 'scholarship_award'
                                                in ('ra_7687', 'merit', 'jlss_ra_7687', 'jlss_merit', 'jlss_ra_10612')
                                           then (r.payload ->> 'scholarship_award')::public.scholarship_award end,
                                      p.scholarship_award),
         award_year        = coalesce(case when (r.payload ->> 'award_year') ~ '^\d{4}$'
                                           then (r.payload ->> 'award_year')::int end, p.award_year),
         university_id     = coalesce(v_univ, p.university_id),
         program_id        = coalesce(v_prog, p.program_id),
         updated_at        = now()
   where p.id = r.person_id;

  -- The new term's row. ON CONFLICT DO NOTHING keeps a retry safe; a renewal_pending row
  -- (DATA_MODEL.md §3.1) is activated through its one legal edge.
  insert into public.memberships (person_id, term_id, status, region_id, year_level, expected_grad_year)
  values (
    r.person_id, r.term_id, 'active', v_region,
    case when (r.payload ->> 'year_level') ~ '^\d$' then (r.payload ->> 'year_level')::int end,
    case when (r.payload ->> 'expected_grad_year') ~ '^\d{4}$' then (r.payload ->> 'expected_grad_year')::int end
  )
  on conflict (person_id, term_id) do nothing;

  update public.memberships m
     set status = 'active', region_id = v_region
   where m.person_id = r.person_id and m.term_id = r.term_id and m.status = 'renewal_pending';

  update public.renewal_submissions
     set status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_id;

  return (select p.member_id from public.people p where p.id = r.person_id);
end;
$$;
