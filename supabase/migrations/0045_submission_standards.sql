-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0045_submission_standards.sql  —  submission-time standards + one-click batch approval
--
-- WHAT:
--   check_submission_standards(p_email, p_payload) returns text[]
--     The checkable half of ADR 0013 §1's four named standards, plus the term precondition
--     they are evaluated against. Returns the FAILING field keys; an empty array means the
--     submission qualifies. Deliberately NOT a role-guarded function — it is called by
--     `anon` while a form is being filled in (the submission-time gate ADR 0013 §1
--     describes) and again, informationally, by a reviewer re-checking a stored `pending`
--     row (ADR 0013 §2, "the queue shows meets standards: yes/no per pending row"). Neither
--     caller needs PII back and none is returned — only field-key strings.
--
--     'term'                no active term at all. Nothing else below is evaluable without
--                            one (US-C3's join_year, US-G7's eligibility window and the
--                            application_windows row this whole pipeline sits behind are
--                            all term-relative), so this check SHORT-CIRCUITS: if there is
--                            no active term, the only failure reported is 'term'.
--     'expected_grad_year'   ADR 0013 §1.2 / PRD US-G7's "not yet graduated": missing,
--                            non-numeric, or not LATER than the year the active term ends
--                            — the same `> extract(year from ends_on)` shape US-G7's
--                            `renewal_eligible_people()` already uses, now also as a
--                            submission-time gate (ADR 0013 explicitly: this does not
--                            resolve OQ-3 in general, only for this one gate).
--     'program_id'           ADR 0013 §1.3 / PRD OQ-17: a uuid of an ACTIVE public.programs
--                            row — the closed, seeded list (0037), never free text.
--     'university_id'        ADR 0013 §1.4: a uuid of an ACTIVE public.universities row
--                            (0037's starter list).
--     'scholarship_award'    ADR 0013 §1.1's "valid NOA" resolves to: the applicant named
--                            one of the five DOST-SEI award types (0038's enum values, kept
--                            here as plain text comparison — this function never casts to
--                            public.scholarship_award, so a stray value fails the check
--                            instead of raising an invalid-input-value-for-enum error).
--     'award_year'           a 4-digit year, mirroring 0041's own award_year cast guard.
--     'applicant_email'      ADR 0013 §1.5 / CBL Art. VII §3: the email matches a
--                            public.people row whose LATEST membership (by term starts_on)
--                            is 'terminated'. Refused the same way finalize_application()
--                            already refuses a duplicate email — a boolean fact, never the
--                            person's name or member ID — so this stays as quiet a probe
--                            surface as the one that already exists (ADR 0013 "Risks").
--                            citext under an empty search_path exposes no operators, hence
--                            lower(::text) on both sides (0041's own note, restated here).
--
--   list_pending_standards(p_term_id default null) returns table (application_id, failures)
--     exec_admin / crrd_admin only (42501 otherwise — the same guard `approve_application()`
--     carries; tech_admin refused, PRD OQ-5). One row per `status = 'pending'` application
--     in the term (default current_term_id()), re-running the check above per row. Under
--     ADR 0013 a failing row should not exist as `pending` at all — this is the "second
--     look before the batch commits", not the enforcement.
--
--   approve_all_pending() returns jsonb
--     ADR 0013 §2: one click, after the period closes, scoped to current_term_id().
--     exec_admin / crrd_admin only, guarded FIRST — before the window check and before the
--     loop — so a caller without the role never reaches either, and the per-row EXCEPTION
--     block below can never mask that 42501 as a per-row `failed` entry. Refuses (55000)
--     while a membership_application window is still open on the current term — the batch
--     is a POST-period operation (PRD US-C1, US-G7). For every `pending` application,
--     ordered by submitted_at: a non-empty check_submission_standards() result is a `skip`
--     (collected, not decided — CRRD's existing reject-before-batch override still removes
--     a row from contention, ADR 0013 §2); a passing one is approve_application()'d inside
--     its own BEGIN/EXCEPTION so one bad row cannot abort the batch. Same shape, immediately
--     after, for every pending renewal_submissions row via approve_renewal() — ADR 0013 §2's
--     "(renewals inside the same batch is the default reading)". ONE audit_log row summarizes
--     the whole call; audit_row() still fires once per underlying approve_application() /
--     approve_renewal() UPDATE exactly as it does outside the batch (PRD US-I1) — the batch
--     audit row is additional, not a replacement. Idempotent in the sense PRD US-C3 / US-C2
--     already require: approve_application() and approve_renewal() both early-return on an
--     already-approved row, so a second call mints nothing twice; a row that fails the
--     standards check is skipped on every call until CRRD edits or rejects it, which is the
--     documented shape of the gate (ADR 0013 §2 — "meets standards: yes/no" is informational,
--     not self-healing).
--
--   approve_renewal() (0044) is RE-CREATED (CONVENTIONS §3.4 — a new migration, never an
--     edit) to also coalesce address_line, city_municipality, province and postal_code from
--     the renewal payload onto people, in the same style as its existing contact_number
--     line — the SRS renewal form still asks for a mailing address (0041's comment: "home
--     address … returns to both forms") and 0044 shipped the university/program/etc. fields
--     but missed the address block. Everything else in the function is byte-identical to
--     0044's body.
--
-- CITATIONS: docs/decisions/0013-submission-standards-and-batch-approval.md; PRD US-B1
--   (submission-time validation extended to eligibility), US-C2 (an already-decided
--   application is not silently re-decided), US-C3 (member ID allocation, idempotent),
--   US-C5 (acceptance emails follow the batch — unbuilt here, this ADR only feeds it),
--   US-G7 ("if and only if" — the eligibility predicate), US-H5 (renewal never renumbers);
--   CBL Art. VII §3 (termination bars re-application), Art. I §4 / Art. VII §2.4 (the
--   closed, amendment-paced program list).
--
-- ROLLBACK: forward-only. All three functions are new; approve_renewal() may be
--   `create or replace`d again by a later migration.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── check_submission_standards ──────────────────────────────────────────────────────
create or replace function public.check_submission_standards(
  p_email   text,
  p_payload jsonb
) returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term       public.terms;
  v_failures   text[] := '{}'::text[];
  v_grad_year  int;
  v_program    uuid;
  v_university uuid;
  v_award      text;
begin
  select * into v_term from public.terms where status = 'active' limit 1;

  -- Nothing below is evaluable without a term to evaluate it against (see header).
  if v_term.id is null then
    return array['term'];
  end if;

  -- expected_grad_year: present, a 4-digit year, and LATER than the active term's end year.
  --
  -- ⚠ `x !~ pattern` on a NULL x yields NULL, and plpgsql's IF treats a NULL condition as
  -- FALSE (it takes the ELSE branch), not as "missing". A bare `if val !~ pattern` would
  -- therefore let a MISSING key fall through to the else branch, where `NULL::int` and
  -- every comparison against it is again NULL — silently passing. Every branch below
  -- checks `IS NULL` explicitly, first, so "absent" and "malformed" are both caught.
  if (p_payload ->> 'expected_grad_year') is null
     or (p_payload ->> 'expected_grad_year') !~ '^\d{4}$' then
    v_failures := array_append(v_failures, 'expected_grad_year');
  else
    v_grad_year := (p_payload ->> 'expected_grad_year')::int;
    if v_grad_year <= extract(year from v_term.ends_on)::int then
      v_failures := array_append(v_failures, 'expected_grad_year');
    end if;
  end if;

  -- program_id: a uuid naming an ACTIVE public.programs row (0037; PRD OQ-17 closed list).
  if (p_payload ->> 'program_id') is null
     or (p_payload ->> 'program_id') !~ '^[0-9a-f-]{36}$' then
    v_failures := array_append(v_failures, 'program_id');
  else
    v_program := (p_payload ->> 'program_id')::uuid;
    if not exists (
      select 1 from public.programs where id = v_program and is_active
    ) then
      v_failures := array_append(v_failures, 'program_id');
    end if;
  end if;

  -- university_id: a uuid naming an ACTIVE public.universities row (0037).
  if (p_payload ->> 'university_id') is null
     or (p_payload ->> 'university_id') !~ '^[0-9a-f-]{36}$' then
    v_failures := array_append(v_failures, 'university_id');
  else
    v_university := (p_payload ->> 'university_id')::uuid;
    if not exists (
      select 1 from public.universities where id = v_university and is_active
    ) then
      v_failures := array_append(v_failures, 'university_id');
    end if;
  end if;

  -- scholarship_award: one of the five DOST-SEI programs (0038). Compared as plain text —
  -- never cast to public.scholarship_award — so a stray value fails the CHECK rather than
  -- raising an invalid-enum-input error out of a function anon is allowed to call.
  v_award := p_payload ->> 'scholarship_award';
  if v_award is null
     or v_award not in ('ra_7687', 'merit', 'jlss_ra_7687', 'jlss_merit', 'jlss_ra_10612')
  then
    v_failures := array_append(v_failures, 'scholarship_award');
  end if;

  -- award_year: a 4-digit year (mirrors 0041's own award_year guard). `is null or` first,
  -- for the same three-valued-logic reason as above — a bare `!~` on a missing key is
  -- NULL, which an IF with no ELSE silently treats as "nothing to append".
  if (p_payload ->> 'award_year') is null
     or (p_payload ->> 'award_year') !~ '^\d{4}$' then
    v_failures := array_append(v_failures, 'award_year');
  end if;

  -- applicant_email: not the email of a person whose LATEST membership (by term
  -- starts_on) is 'terminated' (CBL Art. VII §3). citext operators are invisible under an
  -- empty search_path (0041's note), hence lower(::text) on both sides.
  if p_email is not null and exists (
    select 1
      from public.people p
     where lower(p.personal_email::text) = lower(btrim(p_email))
       and (
         select m.status
           from public.memberships m
           join public.terms t on t.id = m.term_id
          where m.person_id = p.id
          order by t.starts_on desc
          limit 1
       ) = 'terminated'
  ) then
    v_failures := array_append(v_failures, 'applicant_email');
  end if;

  return v_failures;
end;
$$;

comment on function public.check_submission_standards(text, jsonb) is
  'ADR 0013 §1: the checkable submission-time standards, as failing field keys (empty = '
  'passes). No role guard — called by anon at submission and by the reviewer queue '
  'informationally; returns only field-key strings, never PII. term / expected_grad_year / '
  'program_id / university_id / scholarship_award / award_year / applicant_email. PRD '
  'US-B1, US-G7; CBL Art. VII §3, Art. I §4.';

revoke execute on function public.check_submission_standards(text, jsonb) from public;
grant  execute on function public.check_submission_standards(text, jsonb) to   anon, authenticated;


-- ── list_pending_standards ──────────────────────────────────────────────────────────
create or replace function public.list_pending_standards(p_term_id uuid default null)
returns table (application_id uuid, failures text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  v_term uuid := coalesce(p_term_id, public.current_term_id());
begin
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to read the pending-standards queue'
      using errcode = '42501';
  end if;

  return query
    select a.id, public.check_submission_standards(a.applicant_email::text, a.payload)
      from public.applications a
     where a.term_id = v_term
       and a.status = 'pending';
end;
$$;

comment on function public.list_pending_standards(uuid) is
  'ADR 0013 §2: "the queue shows meets standards: yes/no per pending row" — one row per '
  'pending application in the term (default current_term_id()), re-running '
  'check_submission_standards(). exec_admin / crrd_admin only (42501 otherwise; tech_admin '
  'refused, PRD OQ-5) — informational only, a failing row should not exist as pending under '
  'the submission-time gate.';

revoke execute on function public.list_pending_standards(uuid) from public;
revoke execute on function public.list_pending_standards(uuid) from anon;
grant  execute on function public.list_pending_standards(uuid) to   authenticated;


-- ── approve_all_pending ──────────────────────────────────────────────────────────────
create or replace function public.approve_all_pending() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role        public.org_role := public.auth_role();
  v_term        uuid := public.current_term_id();
  v_apps_ok     int := 0;
  v_renewals_ok int := 0;
  v_skipped     jsonb := '[]'::jsonb;
  v_failed      jsonb := '[]'::jsonb;
  v_app         record;
  v_renewal     record;
  v_failures    text[];
begin
  -- Guard FIRST, before the window check and before either loop — so a caller without the
  -- role never reaches the per-row EXCEPTION blocks below, and this 42501 can never be
  -- caught and re-reported as a per-row `failed` entry.
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to run the post-period approval batch'
      using errcode = '42501';
  end if;

  -- ADR 0013 §2: the batch is a POST-period operation. Refuse while the membership
  -- application window is still open on the current term.
  if v_term is not null and exists (
    select 1
      from public.application_windows w
     where w.term_id   = v_term
       and w.form_kind = 'membership_application'
       and now() between w.opens_at and w.closes_at
  ) then
    raise exception 'the application period is still open'
      using errcode = '55000';
  end if;

  -- Every pending application in the current term, oldest first.
  for v_app in
    select a.id, a.applicant_email, a.payload
      from public.applications a
     where a.term_id = v_term
       and a.status  = 'pending'
     order by a.submitted_at
  loop
    v_failures := public.check_submission_standards(v_app.applicant_email::text, v_app.payload);
    if cardinality(v_failures) > 0 then
      v_skipped := v_skipped
        || jsonb_build_object('id', v_app.id, 'failures', to_jsonb(v_failures));
      continue;
    end if;

    begin
      perform public.approve_application(v_app.id);
      v_apps_ok := v_apps_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_app.id, 'error', sqlerrm);
    end;
  end loop;

  -- Every pending renewal in the current term, oldest first. The same standards apply
  -- (ADR 0013 §4): a row that fails is skipped with its failure keys, never activated. The
  -- email is the record's own — start_renewal() already refused a terminated member.
  for v_renewal in
    select r.id, r.payload, p.personal_email
      from public.renewal_submissions r
      join public.people p on p.id = r.person_id
     where r.term_id = v_term
       and r.status  = 'pending'
     order by r.submitted_at
  loop
    v_failures := public.check_submission_standards(v_renewal.personal_email::text, v_renewal.payload);
    if cardinality(v_failures) > 0 then
      v_skipped := v_skipped
        || jsonb_build_object('id', v_renewal.id, 'failures', to_jsonb(v_failures));
      continue;
    end if;

    begin
      perform public.approve_renewal(v_renewal.id);
      v_renewals_ok := v_renewals_ok + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('id', v_renewal.id, 'error', sqlerrm);
    end;
  end loop;

  -- ONE row summarizing the batch. audit_row() has already fired once per underlying
  -- approve_application()/approve_renewal() UPDATE (PRD US-I1) — this is additional, not a
  -- replacement, per ADR 0013 §2: "one audit row per underlying decision, not one for the
  -- batch" for the per-row trail, plus this one for the batch itself.
  insert into public.audit_log (
    actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note
  )
  values (
    (select auth.uid()), v_role::text, 'applications', null, 'APPROVE_ALL', null, null,
    format(
      'applications_approved=%s renewals_approved=%s skipped=%s failed=%s',
      v_apps_ok, v_renewals_ok, jsonb_array_length(v_skipped), jsonb_array_length(v_failed)
    )
  );

  return jsonb_build_object(
    'applications_approved', v_apps_ok,
    'renewals_approved',     v_renewals_ok,
    'skipped',               v_skipped,
    'failed',                v_failed
  );
end;
$$;

comment on function public.approve_all_pending() is
  'ADR 0013 §2: one click, after the application period closes, approves every still- '
  'pending application AND renewal submission in current_term_id() that passes '
  'check_submission_standards(), minting member IDs through the existing '
  'approve_application()/approve_renewal() machinery. exec_admin / crrd_admin only, guarded '
  'before the window check and before the loop. Raises 55000 while a membership_application '
  'window is still open. A failing row is skipped (collected with its failure keys), not '
  'decided; a per-row error is caught and collected rather than aborting the batch. Writes '
  'ONE APPROVE_ALL audit row summarizing the call, in addition to the per-decision audit '
  'rows audit_row() already writes. PRD US-C1, US-C2, US-C3, US-C5, US-G7, US-H5.';

revoke execute on function public.approve_all_pending() from public;
revoke execute on function public.approve_all_pending() from anon;
grant  execute on function public.approve_all_pending() to   authenticated;


-- ── approve_renewal: re-created to also carry the mailing address (0044 gap) ───────
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

comment on function public.approve_renewal(uuid) is
  'Approve a pending renewal: one active membership row in the renewed-into term (ON '
  'CONFLICT safe), the updated contact/academic/address fields applied to people, member_id '
  'untouched (PRD US-H5). 0045 adds address_line/city_municipality/province/postal_code to '
  'the fields 0044 already copied. Idempotent on an approved row. exec_admin / crrd_admin '
  'only.';

-- No revoke/grant here: CREATE OR REPLACE preserves the privileges 0044 already set
-- (revoked from public/anon, granted to authenticated) for the same signature.

-- ── finalize_application / finalize_renewal: the standards gate at the data layer ────
-- ADR 0013 §1 says a violating payload never reaches `pending`. The Server Actions check
-- first so the applicant gets a field-level message, but a caller who reaches PostgREST
-- directly (both functions are anon-callable by design) must be refused HERE — RLS and
-- the definers are the boundary, the Next.js action is UX (ARCHITECTURE.md §5). Both bodies
-- are 0040's and 0044's verbatim, with one step added after the window re-assert.
create or replace function public.finalize_application(
  p_app_id   uuid,
  p_token    text,
  p_file_ref text,
  p_mime     text,
  p_size     bigint,
  p_noa_ref  text,
  p_noa_mime text,
  p_noa_size bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a          public.applications;
  v_expected text;
  v_failures text[];
begin
  -- 1. Load and lock — a double-clicked submit serializes here (0019 step 1).
  select * into a
    from public.applications
   where id = p_app_id
     for update;

  -- 2. Unknown id: RETURN SILENTLY (anti-enumeration point 1, 0019 step 2).
  if a.id is null then
    return;
  end if;

  -- 3. The capability check. All four failure modes raise the SAME error (0019 step 3).
  v_expected := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  if a.submit_token_hash is null
     or a.submit_token_expires_at is null
     or a.submit_token_expires_at <= now()
     or v_expected <> a.submit_token_hash
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- 4. Idempotent success: same row, same two documents, already pending (0019 step 4).
  if a.status = 'pending'
     and a.proof_drive_file_id is not distinct from p_file_ref
     and a.noa_drive_file_id   is not distinct from p_noa_ref
  then
    return;
  end if;

  -- 5. State machine: draft -> pending is the only edge here (0019 step 5).
  if a.status <> 'draft' then
    raise exception 'application % is %, not draft', p_app_id, a.status
      using errcode = '55000';
  end if;

  -- 6. Re-assert the window at the data layer (PRD US-B4; 0019 step 6).
  if not exists (
    select 1
    from public.application_windows w
    where w.term_id   = a.term_id
      and w.form_kind = 'membership_application'
      and now() between w.opens_at and w.closes_at
  ) then
    raise exception 'the application period is not open'
      using errcode = '42501';
  end if;

  -- 6b. ADR 0013 §1 — the membership standards, enforced where a row becomes pending.
  v_failures := public.check_submission_standards(a.applicant_email::text, a.payload);
  if cardinality(v_failures) > 0 then
    raise exception 'submission does not meet the membership standards: %',
      array_to_string(v_failures, ', ')
      using errcode = '23514';
  end if;

  -- 7. Validate the SERVER-verified metadata of BOTH documents. The allowlist and the
  --    10 MiB cap are restated from lib/documents/types.ts because this is the last gate.
  if p_file_ref is null or length(btrim(p_file_ref)) = 0 then
    raise exception 'the latest registration form is required'
      using errcode = '23514';
  end if;
  if p_noa_ref is null or length(btrim(p_noa_ref)) = 0 then
    raise exception 'the notice of award is required'
      using errcode = '23514';
  end if;
  if p_file_ref = p_noa_ref then
    raise exception 'the registration form and the notice of award must be two different files'
      using errcode = '23514';
  end if;
  if p_mime is null
     or p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')
     or p_noa_mime is null
     or p_noa_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')
  then
    raise exception 'unsupported document type'
      using errcode = '23514';
  end if;
  if p_size is null or p_size <= 0 or p_size > 10485760
     or p_noa_size is null or p_noa_size <= 0 or p_noa_size > 10485760
  then
    raise exception 'a document exceeds the maximum size'
      using errcode = '23514';
  end if;

  -- 8. The flip, with the duplicate swallowed (anti-enumeration point 2, 0019 step 8).
  --    The token is deliberately left in place so a retry reaches the idempotent branch.
  begin
    update public.applications
       set status              = 'pending',
           proof_drive_file_id = p_file_ref,
           proof_mime_type     = p_mime,
           proof_size_bytes    = p_size,
           proof_verified_at   = now(),
           noa_drive_file_id   = p_noa_ref,
           noa_mime_type       = p_noa_mime,
           noa_size_bytes      = p_noa_size,
           noa_verified_at     = now(),
           submitted_at        = now()
     where id = p_app_id;
  exception
    when unique_violation then
      -- A live application already exists for this (term, email). Stay silent, stay draft.
      return;
  end;

  return;
end;
$$;

comment on function public.finalize_application(uuid, text, text, text, bigint, text, text, bigint) is
  '0040''s token-gated draft -> pending flip, plus ADR 0013 §1: check_submission_standards() '
  'is asserted after the window re-check, so a violating payload never becomes pending even '
  'when the Server Action is bypassed. Everything else unchanged.';

create or replace function public.finalize_renewal(
  p_id       uuid,
  p_token    text,
  p_file_ref text,
  p_mime     text,
  p_size     bigint,
  p_noa_ref  text,
  p_noa_mime text,
  p_noa_size bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.renewal_submissions;
  v_expected text;
  v_failures text[];
  v_email    text;
begin
  select * into r from public.renewal_submissions where id = p_id for update;

  if r.id is null then
    return;
  end if;

  v_expected := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  if r.submit_token_hash is null
     or r.submit_token_expires_at is null
     or r.submit_token_expires_at <= now()
     or v_expected <> r.submit_token_hash
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if r.status = 'pending'
     and r.proof_drive_file_id is not distinct from p_file_ref
     and r.noa_drive_file_id   is not distinct from p_noa_ref
  then
    return;
  end if;

  if r.status <> 'draft' then
    raise exception 'renewal % is %, not draft', p_id, r.status using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.application_windows w
     where w.term_id = r.term_id
       and w.form_kind = 'membership_renewal'
       and now() between w.opens_at and w.closes_at
  ) then
    raise exception 'the renewal period is not open' using errcode = '42501';
  end if;

  -- ADR 0013 §4 — the same standards, where the renewal becomes pending.
  select p.personal_email::text into v_email from public.people p where p.id = r.person_id;
  v_failures := public.check_submission_standards(v_email, r.payload);
  if cardinality(v_failures) > 0 then
    raise exception 'renewal does not meet the membership standards: %',
      array_to_string(v_failures, ', ')
      using errcode = '23514';
  end if;

  if p_file_ref is null or length(btrim(p_file_ref)) = 0 then
    raise exception 'the latest registration form is required' using errcode = '23514';
  end if;
  if p_noa_ref is null or length(btrim(p_noa_ref)) = 0 then
    raise exception 'the notice of award is required' using errcode = '23514';
  end if;
  if p_file_ref = p_noa_ref then
    raise exception 'the registration form and the notice of award must be two different files'
      using errcode = '23514';
  end if;
  if p_mime is null or p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')
     or p_noa_mime is null or p_noa_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')
  then
    raise exception 'unsupported document type' using errcode = '23514';
  end if;
  if p_size is null or p_size <= 0 or p_size > 10 * 1024 * 1024
     or p_noa_size is null or p_noa_size <= 0 or p_noa_size > 10 * 1024 * 1024
  then
    raise exception 'document size out of range' using errcode = '23514';
  end if;

  update public.renewal_submissions
     set status              = 'pending',
         submitted_at        = now(),
         proof_drive_file_id = p_file_ref,
         proof_mime_type     = p_mime,
         proof_size_bytes    = p_size,
         proof_verified_at   = now(),
         noa_drive_file_id   = p_noa_ref,
         noa_mime_type       = p_noa_mime,
         noa_size_bytes      = p_noa_size,
         noa_verified_at     = now(),
         submit_token_hash       = null,
         submit_token_expires_at = null
   where id = p_id;
end;
$$;

comment on function public.finalize_renewal(uuid, text, text, text, bigint, text, text, bigint) is
  '0044''s token-gated draft -> pending flip, plus ADR 0013 §4: check_submission_standards() '
  'is asserted after the window re-check with the record''s own email, so a violating '
  'renewal never becomes pending even when the Server Action is bypassed.';
