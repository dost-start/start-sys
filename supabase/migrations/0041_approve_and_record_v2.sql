-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0041_approve_and_record_v2.sql  —  approval and record editing carry the SRS fields
--
-- WHAT:
--   approve_application()   copies the six 0038 fields from payload into the new people
--                           row (sex, facebook_account, scholarship_award, award_year,
--                           university_id, program_id) and fills the legacy `school` text
--                           from the university name for continuity. The address and
--                           school-ID keys are still copied WHEN PRESENT — a pre-0038
--                           payload approved after this migration loses nothing — and are
--                           simply null for SRS-era submissions. Role guard drops the
--                           retired `moderator` (0036).
--   update_member_record()  whitelist gains the six new keys; the role guard drops
--                           `moderator`. Everything else — the acknowledgement gate, the
--                           optimistic-concurrency check, the never-patchable set — is as
--                           0030 wrote it.
--
-- THE PAYLOAD CONTRACT. approve_application() reads these payload->> keys, spelled
--   identically in lib/applications/schema.ts (APPLICATION_PAYLOAD_KEYS, asserted by a
--   Vitest test — BUILD_PLAN S3-T13): birthdate, contact_number, region_id, year_level,
--   expected_grad_year, middle_name, suffix, sex, facebook_account, scholarship_award,
--   award_year, university_id, program_id; legacy and optional: address_line,
--   city_municipality, province, postal_code, school, school_id_no.
--
-- ROLLBACK: forward-only; a new migration may `create or replace` either body again.
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

comment on function public.approve_application(uuid) is
  'Approves an application in ONE transaction: resolves or creates the person (reusing an '
  'existing people row matched on personal_email, so a returning scholar keeps their member '
  'ID), copies the SRS profile fields (0038), allocates the four-digit member ID (0039), '
  'inserts the current-term membership and stamps the row. Idempotent — a retry returns the '
  'existing member_id. exec_admin/crrd_admin only; tech_admin refused (PRD OQ-5). '
  'PRD US-C2, US-C3, US-C4, US-H1, US-H5.';

-- ── get_application_detail: strip the NOA pointer too; drop the retired tier ───────
-- Body as 0026 wrote it, with two changes: the role guard no longer names `moderator`
-- (0036), and the returned document omits noa_drive_file_id alongside the two proof
-- pointers — a document reference is served only through the audited proxy (S4-T17).
create or replace function public.get_application_detail(p_app_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  a      public.applications;
begin
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to read an application in full'
      using errcode = '42501';
  end if;

  -- CBL Art. VIII §7.1 — no sensitive read without a current-term acknowledgement.
  perform public.assert_confidentiality_ack();

  select * into a from public.applications where id = p_app_id;

  -- RLS-shaped: an id the caller may not see and an id that does not exist are the same
  -- null (CONVENTIONS §4.3 — never a 403 that confirms the row).
  if a.id is null then
    return null;
  end if;

  -- The audit row is written BEFORE the return value is built (S4-T6).
  insert into public.audit_log (
    actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note
  )
  values (
    (select auth.uid()),
    v_role::text,
    'applications',
    p_app_id,
    'VIEW',
    null,
    null,
    'application detail read in full via get_application_detail()'
  );

  return to_jsonb(a)
           - 'proof_web_view_link'
           - 'proof_drive_file_id'
           - 'noa_drive_file_id'
           - 'submit_token_hash'
           - 'submit_token_expires_at';
end;
$$;

comment on function public.get_application_detail(uuid) is
  'The ONLY read of applicant_email and payload in the codebase (S4-T14). Guards on role '
  '(exec_admin, crrd_admin) and on a current-term confidentiality acknowledgement (CBL '
  'Art. VIII §7.1), writes ONE VIEW audit row, then returns the row minus the three '
  'document pointers and the submit-token pair. A Drive URL structurally cannot reach the '
  'browser through this path (PRD US-J2). PRD US-C1, US-J5; DATA_MODEL.md §8.4.';

-- ── update_member_record: the six new keys are patchable ───────────────────────────
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
    scholarship_award = case when p_patch ? 'scholarship_award' then (p_patch->>'scholarship_award')::public.scholarship_award else p.scholarship_award end,
    award_year        = case when p_patch ? 'award_year'        then (p_patch->>'award_year')::int                    else p.award_year        end,
    university_id     = case when p_patch ? 'university_id'     then (p_patch->>'university_id')::uuid                else p.university_id     end,
    program_id        = case when p_patch ? 'program_id'        then (p_patch->>'program_id')::uuid                   else p.program_id        end
  where p.id = p_person_id;
end;
$$;

comment on function public.update_member_record(uuid, jsonb, timestamptz) is
  'The ONLY write path to a member record: `authenticated` holds no table UPDATE on people '
  'at all (0015 revokes it), so this is not a convenience. Guards on role (exec_admin, '
  'crrd_admin) and on a current-term confidentiality acknowledgement, refuses any key '
  'outside an explicit whitelist (member_id, join_year, id, redacted_at and status are never '
  'patchable), and raises 40001 when the caller''s expected updated_at is stale so a '
  'concurrent edit loses instead of clobbering (PRD US-D1). Whitelist extended by 0041 with '
  'the SRS profile fields. Audit rows come from trg_people_audit, never from here. '
  'PRD US-C4, US-D1, US-J5; DATA_MODEL.md §8.4.';
