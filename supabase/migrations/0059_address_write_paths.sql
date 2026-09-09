-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0059_address_write_paths.sql
--
-- WHAT:      `apply_address_to_person()` — the ONE place an address is written to
--            `people` — and the three write paths rewired through it:
--            `approve_application()`, `approve_renewal()`, `update_member_record()`.
--
-- WHY:       0058 gave `people` two PSGC-coded addresses. This is what fills them, and it
--            exists as one function rather than three copies because the rule it enforces
--            has to be identical on every path: THE CLIENT SUPPLIES A BARANGAY CODE AND
--            NOTHING ELSE ABOUT THE ADDRESS. The five names come from `psgc_resolve()`,
--            which reads the PSA's own rows.
--
--            A client that sends `city_municipality: "Q.C."` alongside a Quezon City code
--            gets "Quezon City", because it never gets to say. That is the whole point of
--            replacing three free-text boxes with a cascade — if the names could still
--            arrive from the browser, the codes would be decoration.
--
-- ⚠ THE TYPED NAME COLUMNS ARE NO LONGER PATCHABLE. `city_municipality` and `province`
--   leave `update_member_record()`'s whitelist and `psgc_barangay_code` takes their place.
--   Patching a name directly would let the stored city disagree with the stored city code
--   with nothing downstream to notice — a member filed under a city they do not live in,
--   and an export that says so. The admin edit screen gets the same cascade the public
--   form has.
--
-- ⚠ APPROVAL NOW WRITES THE ADDRESS FOR A RETURNING SCHOLAR TOO, which
--   `approve_application()` did not do before. It only ever touched `people` for a
--   brand-new person. But a returning scholar has just submitted a current address —
--   they moved, that is usually WHY it changed — and dropping it on the floor because the
--   person row already existed is the bug, not the fix. The helper coalesces, so a blank
--   field leaves the stored value alone; it cannot erase an address by omission.
--
-- ROLLBACK:  Forward-only; every function is a `create or replace` and a later migration
--            may replace it again.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── apply_address_to_person ─────────────────────────────────────────────────────────
-- SECURITY DEFINER with `set search_path = ''`, because `update_member_record()` and
-- `approve_application()` are themselves definers writing to `people`, on which no human
-- role holds an UPDATE grant (0015). It is NOT independently reachable: the grant below is
-- revoked from every caller, so it can only run inside one of the three guarded functions
-- that already checked the role and the confidentiality acknowledgement.
create or replace function public.apply_address_to_person(
  p_person_id uuid,
  p_payload   jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ⚠ SCALARS, NOT `record`. A plpgsql RECORD that was never assigned raises "record is
  -- not assigned yet" the moment a field is read — so the null-code path (an applicant who
  -- gave no address, or a patch that touches nothing else) blew up on the first
  -- `v_home_city_code`. Scalars are NULL until assigned, which is exactly the semantics
  -- the coalesces below want. Found in CI, 2026-09-09.
  v_home_barangay    text;
  v_home_submun      text;
  v_home_city        text;
  v_home_province    text;
  v_home_region      text;
  v_home_city_code   text;
  v_cur_barangay     text;
  v_cur_submun       text;
  v_cur_city         text;
  v_cur_province     text;
  v_cur_region       text;
  v_cur_city_code    text;
  v_home_code    text := nullif(btrim(p_payload ->> 'psgc_barangay_code'), '');
  v_current_code text := nullif(btrim(p_payload ->> 'current_psgc_barangay_code'), '');
  v_same    boolean := coalesce((p_payload ->> 'current_address_same_as_home')::boolean, false);
begin
  -- "Same as home" is resolved HERE, not in the browser. A client that ticks the box and
  -- sends nothing for the current address gets home copied into it; a client that ticks it
  -- and sends a DIFFERENT current address is ignored, because the tick is the claim.
  if v_same then
    v_current_code := v_home_code;
  end if;

  -- `psgc_resolve` raises on a code that is not a barangay, so a truncated address is
  -- refused here rather than stored half-formed.
  if v_home_code is not null then
    select r.barangay_name, r.sub_municipality_name, r.city_name,
           r.province_name, r.region_name, r.city_code
      into v_home_barangay, v_home_submun, v_home_city,
           v_home_province, v_home_region, v_home_city_code
      from public.psgc_resolve(v_home_code) r;
  end if;
  if v_current_code is not null then
    select r.barangay_name, r.sub_municipality_name, r.city_name,
           r.province_name, r.region_name, r.city_code
      into v_cur_barangay, v_cur_submun, v_cur_city,
           v_cur_province, v_cur_region, v_cur_city_code
      from public.psgc_resolve(v_current_code) r;
  end if;

  update public.people p set
    -- Home. The typed lines come from the payload; every name comes from the PSA.
    address_line      = coalesce(nullif(btrim(p_payload ->> 'address_line'), ''), p.address_line),
    postal_code       = coalesce(nullif(btrim(p_payload ->> 'postal_code'), ''), p.postal_code),
    psgc_barangay_code = coalesce(v_home_code, p.psgc_barangay_code),
    psgc_city_code     = coalesce(v_home_city_code, p.psgc_city_code),
    barangay          = coalesce(v_home_barangay, p.barangay),
    sub_municipality  = coalesce(v_home_submun, p.sub_municipality),
    city_municipality = coalesce(v_home_city, p.city_municipality),
    province          = coalesce(v_home_province, p.province),
    address_region    = coalesce(v_home_region, p.address_region),

    -- Current. When "same as home" is ticked the typed lines are copied too, so the
    -- current address is a complete, readable address rather than a pointer.
    current_address_line = coalesce(
      nullif(btrim(p_payload ->> (case when v_same then 'address_line' else 'current_address_line' end)), ''),
      p.current_address_line),
    current_postal_code = coalesce(
      nullif(btrim(p_payload ->> (case when v_same then 'postal_code' else 'current_postal_code' end)), ''),
      p.current_postal_code),
    current_psgc_barangay_code = coalesce(v_current_code, p.current_psgc_barangay_code),
    current_psgc_city_code     = coalesce(v_cur_city_code, p.current_psgc_city_code),
    current_barangay           = coalesce(v_cur_barangay, p.current_barangay),
    current_sub_municipality   = coalesce(v_cur_submun, p.current_sub_municipality),
    current_city_municipality  = coalesce(v_cur_city, p.current_city_municipality),
    current_province           = coalesce(v_cur_province, p.current_province),
    current_address_region     = coalesce(v_cur_region, p.current_address_region),
    current_address_same_as_home = case
      when p_payload ? 'current_address_same_as_home' then v_same
      else p.current_address_same_as_home end,

    updated_at = now()
  where p.id = p_person_id;
end;
$$;

comment on function public.apply_address_to_person(uuid, jsonb) is
  'The only path an address reaches `people` by. The client supplies barangay codes, the '
  'street lines and the postal codes; every place NAME is resolved from psgc_locations. '
  'Called by approve_application, approve_renewal and update_member_record only.';

-- Not independently callable. It writes PII to `people` and performs no role check of its
-- own — the three callers do that, and each is already guarded.
revoke execute on function public.apply_address_to_person(uuid, jsonb) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════════
-- The three write paths, each the body it had in 0055 with the address handling replaced
-- and nothing else touched — extracted verbatim and patched, so a diff against 0055 shows
-- exactly the address lines.
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
      school_id_no
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
      a.payload ->> 'school_id_no'
    )
    returning id into v_person;
  end if;

  -- 0058/0059: the address, from the PSGC codes the applicant picked. Runs for a
  -- returning scholar too — they just submitted a current address and the freshest one is
  -- the right one. `apply_address_to_person` coalesces, so a blank leaves the old value.
  perform public.apply_address_to_person(v_person, a.payload);

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
    'address_line', 'postal_code',
    'psgc_barangay_code',
    'current_address_line', 'current_postal_code',
    'current_psgc_barangay_code', 'current_address_same_as_home',
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
    postal_code       = case when p_patch ? 'postal_code'       then  p_patch->>'postal_code'                         else p.postal_code       end,
    current_address_line = case when p_patch ? 'current_address_line' then p_patch->>'current_address_line'           else p.current_address_line end,
    current_postal_code  = case when p_patch ? 'current_postal_code'  then p_patch->>'current_postal_code'            else p.current_postal_code  end,
    current_address_same_as_home = case when p_patch ? 'current_address_same_as_home'
                                        then (p_patch->>'current_address_same_as_home')::boolean
                                        else p.current_address_same_as_home end,
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

  -- 0059: the address NAMES are never patched directly — they are derived from the codes,
  -- by the same helper the two public forms go through. Patching a name would let the
  -- stored city disagree with the stored city code, and nothing downstream would notice.
  perform public.apply_address_to_person(
    p_person_id,
    jsonb_strip_nulls(jsonb_build_object(
      'psgc_barangay_code',         p_patch ->> 'psgc_barangay_code',
      'current_psgc_barangay_code', p_patch ->> 'current_psgc_barangay_code'
    ))
  );
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

  -- 0058/0059: the address, from the PSGC codes, through the same helper /apply uses — so
  -- a renewal cannot record an address in a shape an application could not.
  perform public.apply_address_to_person(r.person_id, r.payload);

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
