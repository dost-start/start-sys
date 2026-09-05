-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0044_renewal_form.sql  —  the accountless Membership Renewal Form (PRD v1.2 items 27,
-- 31; US-G7, US-H1, US-H5; SRS "Membership Renewal Form"; meeting 2026-09-05 §D)
--
-- WHAT:
--   renewal_submissions gains the same lifecycle columns as applications: a status
--   (draft → pending → approved | rejected), the submit-token capability that replaces an
--   anon UPDATE policy (0019's design), the two document pointers (latest registration form
--   + Notice of Award, 0040's shape), consent stamps (0035's trigger), and the review
--   columns. It keeps `unique (person_id, term_id)` — one renewal per person per term,
--   which is memberships' own rule (PRD US-H1).
--
--   start_renewal()          anon. Identifies the member by MEMBER ID + EMAIL, both matching
--                            one people row (SRS: members have no accounts). Window-gated on
--                            form_kind = 'membership_renewal'. Writes or resets the draft row.
--   finalize_renewal()       anon, token-gated. draft → pending with both documents.
--   get_renewal_detail()     reviewer read of the payload: role + acknowledgement + audit.
--   log_renewal_document_view()  the audit write the proof proxy fails closed on.
--   approve_renewal()        exec_admin / crrd_admin. Inserts the NEW term's membership row,
--                            applies the updated contact/academic fields to `people`, and
--                            NEVER touches member_id — 2024-001 stays 2024-001 (US-H5).
--   reject_renewal()         with a written ground (>= 10 chars, a CHECK).
--   purge_abandoned_renewal_drafts()  the 30-day sweep, mirroring 0020.
--
-- WHY IDENTITY IS AN EXPLICIT MISMATCH ERROR, NOT A UNIFORM RESPONSE. /apply answers a
--   duplicate uniformly because "does this email have an application" is the oracle.
--   Here the caller must present BOTH a member ID and the email on file; a wrong pair
--   returns "no match" so a scholar who mistypes their ID is told at once rather than
--   waiting a term for a renewal that never existed. The probe this allows — confirming
--   that a (member ID, email) pair is on file — sits behind the same 3/hour-per-email and
--   10/hour-per-IP limiter as /apply (lib/applications/renewal-actions.ts), and the pair is
--   information the member already holds. Recorded as a decision here, not discovered.
--
-- WHO: anon starts and finalizes (through the two definers; there is still NO anon policy
--   on the table). exec_admin and crrd_admin review and decide (SRS: "CRRD Chiefs and
--   Deputies"; the CEO/COO oversee records). Nobody deletes.
--
-- CITATIONS: PRD US-G7 (the eligibility rule stays server-side: a terminated member is
--   refused — CBL Art. VII §3 — and an already-active member has nothing to renew);
--   US-H5 (renewal preserves the member ID); DATA_MODEL.md §3.1 (renewal_pending → active
--   is a legal edge, so an existing renewal_pending row is activated rather than duplicated).
--
-- ROLLBACK: forward-only.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── 1. columns ─────────────────────────────────────────────────────────────────────
alter table public.renewal_submissions
  add column status                  public.application_status not null default 'draft',
  add column created_at              timestamptz not null default now(),
  add column submit_token_hash       text,
  add column submit_token_expires_at timestamptz,
  add column proof_drive_file_id     text,
  add column proof_mime_type         text,
  add column proof_size_bytes        bigint,
  add column proof_verified_at       timestamptz,
  add column noa_drive_file_id       text,
  add column noa_mime_type           text,
  add column noa_size_bytes          bigint,
  add column noa_verified_at         timestamptz,
  add column consented_at            timestamptz,
  add column privacy_notice_version  text,
  add column reviewed_by             uuid references auth.users(id),
  add column reviewed_at             timestamptz,
  add column review_note             text,
  add column redacted_at             timestamptz;

-- `submitted_at` now means what it says: the draft → pending instant, null until then.
alter table public.renewal_submissions
  alter column submitted_at drop not null,
  alter column submitted_at drop default;

alter table public.renewal_submissions
  add constraint renewal_pending_has_docs
    check (status = 'draft'
           or (proof_drive_file_id is not null and noa_drive_file_id is not null)),
  add constraint renewal_rejected_has_reason
    check (status <> 'rejected' or length(btrim(review_note)) >= 10),
  add constraint renewal_submitted_has_consent
    check (status = 'draft'
           or (consented_at is not null and privacy_notice_version is not null));

create index renewal_submissions_term_status
  on public.renewal_submissions (term_id, status);

comment on column public.renewal_submissions.status is
  'draft (identity verified, documents not yet in) → pending (submitted) → approved | '
  'rejected. A rejected row may be re-submitted: start_renewal() resets it to draft, and '
  'the audit trigger keeps the earlier decision.';

-- ── 2. triggers: consent stamped by the server, every change audited ────────────────
-- 0035's trigger is table-agnostic: it reads NEW.consented_at / NEW.privacy_notice_version.
create trigger trg_renewal_submissions_consent_server_values
  before insert or update on public.renewal_submissions
  for each row execute function public.enforce_consent_server_values();

-- PRD US-I1 names decisions among the significant actions; DATA_MODEL.md §8.3's audited
-- list predates this table being written to. mask_sensitive() redacts the registered
-- columns before the row is stored.
create trigger trg_renewal_submissions_audit
  after insert or update on public.renewal_submissions
  for each row execute function public.audit_row();

insert into public.sensitive_column_registry (table_name, column_name, rationale) values
  ('renewal_submissions', 'proof_drive_file_id',
   'Pointer to a Certificate of Registration in the document store — the file carries a student number and address.'),
  ('renewal_submissions', 'noa_drive_file_id',
   'Pointer to a DOST-SEI Notice of Award in the document store — names the scholar and their award.'),
  ('renewal_submissions', 'submit_token_hash',
   'Not personal data; a bearer capability over one renewal row, stripped on the same terms.')
on conflict (table_name, column_name) do nothing;

-- ── 3. grants: the payload and the token are unreadable except through the RPC ─────
revoke all on public.renewal_submissions from anon, authenticated;
grant select (
  id, person_id, term_id, status, created_at, submitted_at,
  reviewed_by, reviewed_at, review_note,
  proof_drive_file_id, proof_mime_type, proof_size_bytes, proof_verified_at,
  noa_drive_file_id,   noa_mime_type,   noa_size_bytes,   noa_verified_at,
  consented_at, privacy_notice_version, redacted_at
) on public.renewal_submissions to anon, authenticated;
-- `payload` and `submit_token_hash` are deliberately absent: the body is read only through
-- get_renewal_detail(), which audits; the hash is never read by a session at all. anon holds
-- the same column grant and NO policy, so it reads zero rows — an RLS-empty result, never a
-- privilege error that would tell a caller the table is there (CONVENTIONS §4.3).

-- ── 4. start_renewal ───────────────────────────────────────────────────────────────
create or replace function public.start_renewal(
  p_member_id        text,
  p_email            text,
  p_payload          jsonb,
  p_token_hash       text,
  p_token_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term     uuid := public.current_term_id();
  v_person   uuid;
  v_latest   public.membership_status;
  v_existing public.renewal_submissions;
  v_id       uuid;
begin
  -- 1. The window, at the data layer (PRD US-B4's shape, for the renewal form).
  if v_term is null or not exists (
    select 1 from public.application_windows w
     where w.term_id = v_term
       and w.form_kind = 'membership_renewal'
       and now() between w.opens_at and w.closes_at
  ) then
    raise exception 'the renewal period is not open' using errcode = '42501';
  end if;

  if p_token_hash is null or length(p_token_hash) <> 64
     or p_token_expires_at is null or p_token_expires_at <= now() then
    raise exception 'start_renewal: a submit token is required' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'start_renewal: payload must be an object' using errcode = '22023';
  end if;

  -- 2. Identity: member ID + the email on file, both, one row (citext operators are
  --    invisible under an empty search_path, hence lower(::text)).
  select p.id into v_person
    from public.people p
   where p.member_id = btrim(p_member_id)
     and p.personal_email is not null
     and lower(p.personal_email::text) = lower(btrim(p_email))
     and p.redacted_at is null;
  if v_person is null then
    raise exception 'no member matches that member ID and email' using errcode = 'P0002';
  end if;

  -- 3. Eligibility that is the system's to enforce (PRD US-G7: "computed server-side").
  select m.status into v_latest
    from public.memberships m
    join public.terms t on t.id = m.term_id
   where m.person_id = v_person
   order by t.starts_on desc
   limit 1;
  if v_latest = 'terminated' then
    -- CBL Art. VII §3: removal from the organization. Reinstatement is an Executive Board
    -- act recorded on the existing row (US-D6), never a renewal form.
    raise exception 'membership terminated' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.memberships m
     where m.person_id = v_person and m.term_id = v_term and m.status = 'active'
  ) then
    raise exception 'already an active member this term' using errcode = '55000';
  end if;

  -- 4. One row per person per term. A draft or a rejected row is reset; a pending or an
  --    approved one is not re-opened from the public form.
  select * into v_existing
    from public.renewal_submissions r
   where r.person_id = v_person and r.term_id = v_term
     for update;

  if v_existing.id is not null then
    if v_existing.status in ('pending', 'approved') then
      raise exception 'a renewal for this term has already been submitted' using errcode = '55000';
    end if;
    update public.renewal_submissions
       set payload                 = p_payload,
           status                  = 'draft',
           created_at              = now(),
           submitted_at            = null,
           submit_token_hash       = p_token_hash,
           submit_token_expires_at = p_token_expires_at,
           proof_drive_file_id = null, proof_mime_type = null, proof_size_bytes = null, proof_verified_at = null,
           noa_drive_file_id   = null, noa_mime_type   = null, noa_size_bytes   = null, noa_verified_at   = null,
           reviewed_by = null, reviewed_at = null, review_note = null,
           redacted_at = null
     where id = v_existing.id;
    return v_existing.id;
  end if;

  -- consented_at: sending it AT ALL is the affirmative act; the trigger overwrites the value
  -- with the server clock and stamps the current notice version (0035).
  insert into public.renewal_submissions
    (person_id, term_id, payload, status, submit_token_hash, submit_token_expires_at, consented_at)
  values
    (v_person, v_term, p_payload, 'draft', p_token_hash, p_token_expires_at, now())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.start_renewal(text, text, jsonb, text, timestamptz) is
  'Accountless renewal, step 1: verify member ID + email against people, check the '
  'membership_renewal window and the server-side eligibility (not terminated, not already '
  'active this term), then write or reset the draft row with its submit-token digest. '
  'P0002 = no such pair; 55000 = cannot renew through this form; 42501 = window closed.';

-- ── 5. finalize_renewal ────────────────────────────────────────────────────────────
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
begin
  select * into r from public.renewal_submissions where id = p_id for update;

  -- Unknown id: return silently (0019 step 2 — the endpoint is not an oracle).
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

  -- Idempotent: same row, same two documents, already pending.
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

  -- The SERVER-verified metadata of both documents; the last gate (0040 step 7).
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
         -- the capability is single-use
         submit_token_hash       = null,
         submit_token_expires_at = null
   where id = p_id;
end;
$$;

comment on function public.finalize_renewal(uuid, text, text, text, bigint, text, text, bigint) is
  'Accountless renewal, step 2: token-gated draft → pending with both server-verified '
  'documents. Silent on an unknown id; 42501 on a wrong or expired token; re-asserts the '
  'membership_renewal window. The token is cleared on success (single use).';

-- ── 6. the reviewer reads ──────────────────────────────────────────────────────────
create or replace function public.get_renewal_detail(p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  r      public.renewal_submissions;
  p      public.people;
begin
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to read a renewal in full' using errcode = '42501';
  end if;
  perform public.assert_confidentiality_ack();   -- CBL Art. VIII §7.1

  select * into r from public.renewal_submissions where id = p_id;
  if r.id is null then
    return null;   -- not_found, never "forbidden"; no audit row for a miss (0026)
  end if;
  select * into p from public.people where id = r.person_id;

  insert into public.audit_log
    (actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note)
  values
    ((select auth.uid()), v_role::text, 'renewal_submissions', p_id, 'VIEW', null, null,
     'renewal read in full via get_renewal_detail()');

  return (to_jsonb(r) - 'proof_drive_file_id' - 'noa_drive_file_id' - 'submit_token_hash')
         || jsonb_build_object(
              'member_id',   p.member_id,
              'join_year',   p.join_year,
              'given_name',  p.given_name,
              'family_name', p.family_name,
              'personal_email_on_file', p.personal_email
            );
end;
$$;

create or replace function public.log_renewal_document_view(p_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
begin
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to view a renewal document' using errcode = '42501';
  end if;
  perform public.assert_confidentiality_ack();
  insert into public.audit_log
    (actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note)
  values
    ((select auth.uid()), v_role::text, 'renewal_submissions', p_id, 'VIEW_DOCUMENT', null, null,
     'renewal document streamed through /api/renewals/[id]/proof');
end;
$$;

-- ── 7. the decisions ───────────────────────────────────────────────────────────────
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

  -- The updated contact and academic details. NOT the name, NOT the birthdate, NOT the
  -- email (the email is the identity that just proved the renewal), and NEVER member_id —
  -- the trigger from 0022 would refuse it anyway. Blanks leave the old value.
  update public.people p
     set contact_number    = coalesce(nullif(btrim(r.payload ->> 'contact_number'), ''), p.contact_number),
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
  'CONFLICT safe), the updated contact/academic fields applied to people, member_id '
  'untouched (PRD US-H5). Idempotent on an approved row. exec_admin / crrd_admin only.';

create or replace function public.reject_renewal(p_id uuid, p_note text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  r      public.renewal_submissions;
begin
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to decide a renewal' using errcode = '42501';
  end if;
  select * into r from public.renewal_submissions where id = p_id for update;
  if r.id is null then
    raise exception 'renewal % not found', p_id using errcode = 'P0002';
  end if;
  if r.status = 'rejected' then
    return;   -- idempotent
  end if;
  if r.status <> 'pending' then
    raise exception 'renewal % is %, not pending', p_id, r.status using errcode = '55000';
  end if;
  if p_note is null or length(btrim(p_note)) < 10 then
    raise exception 'a written ground of at least 10 characters is required' using errcode = '23514';
  end if;
  update public.renewal_submissions
     set status = 'rejected', review_note = btrim(p_note),
         reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_id;
end;
$$;

-- ── 8. the sweep (mirrors 0020) ────────────────────────────────────────────────────
create or replace function public.purge_abandoned_renewal_drafts(
  p_age interval default interval '30 days'
) returns table (renewal_id uuid, storage_ref text, noa_ref text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_age is null or p_age <= interval '0' then
    raise exception 'purge_abandoned_renewal_drafts: p_age must be a positive interval'
      using errcode = '22023';
  end if;
  return query
  with purged as (
    update public.renewal_submissions r
       set payload                 = '{}'::jsonb,
           submit_token_hash       = null,
           submit_token_expires_at = null,
           redacted_at             = now()
     where r.status = 'draft'
       and r.redacted_at is null
       and r.created_at < now() - p_age
       and exists (select 1 from public.terms t where t.id = r.term_id and t.status <> 'archived')
    returning r.id, r.proof_drive_file_id, r.noa_drive_file_id
  )
  select p.id, p.proof_drive_file_id, p.noa_drive_file_id from purged p;
end;
$$;

-- ── 9. EXECUTE ─────────────────────────────────────────────────────────────────────
revoke execute on function public.start_renewal(text, text, jsonb, text, timestamptz)                         from public;
revoke execute on function public.finalize_renewal(uuid, text, text, text, bigint, text, text, bigint)       from public;
revoke execute on function public.get_renewal_detail(uuid)                                                   from public, anon;
revoke execute on function public.log_renewal_document_view(uuid)                                            from public, anon;
revoke execute on function public.approve_renewal(uuid)                                                      from public, anon;
revoke execute on function public.reject_renewal(uuid, text)                                                 from public, anon;
revoke execute on function public.purge_abandoned_renewal_drafts(interval)                                   from public, anon, authenticated;

grant execute on function public.start_renewal(text, text, jsonb, text, timestamptz)                          to anon, authenticated;
grant execute on function public.finalize_renewal(uuid, text, text, text, bigint, text, text, bigint)        to anon, authenticated;
grant execute on function public.get_renewal_detail(uuid)                                                    to authenticated;
grant execute on function public.log_renewal_document_view(uuid)                                             to authenticated;
grant execute on function public.approve_renewal(uuid)                                                       to authenticated;
grant execute on function public.reject_renewal(uuid, text)                                                  to authenticated;
grant execute on function public.purge_abandoned_renewal_drafts(interval)                                    to service_role;
