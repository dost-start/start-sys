-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0060_pdf_only_documents.sql
--
-- WHAT:      The accepted proof-of-enrollment type narrows from four to ONE:
--            `application/pdf`. `finalize_application()` and `finalize_renewal()` are
--            replaced with their 0045 bodies, changed in exactly one respect each — the
--            MIME allowlist — and the storage bucket's `allowed_mime_types` (0021) is
--            narrowed to match.
--
-- WHY:       Ethan (project head), 2026-09-09: "it's not photo, it will be a PDF ...
--            most of the documents right now is online." The Certificate of Registration
--            and the Notice of Award are both issued as PDFs, so accepting camera rolls
--            bought nothing and cost a real failure mode.
--
-- WHAT THIS DELETES, AND WHY IT MATTERS MORE THAN THE ALLOWLIST
--   `image/heic` was accepted because it is what an iPhone produces by default — and NO
--   BROWSER RENDERS IT, so the review screen could not show it and the designed response
--   was to reject the application and ask for a re-upload. Read together with the
--   decision of the same day that REJECTION IS FINAL FOR THE TERM, that combination
--   would have permanently rejected qualified scholars for owning an iPhone. Narrowing
--   to PDF removes the case rather than documenting it.
--
-- THREE MIRRORS, ALL MOVED IN THIS FILE (a gate that trusts its caller is not a gate):
--   1. `lib/documents/types.ts` ALLOWED_MIME          — the Server Action's pre-flight
--   2. these two functions                            — the data layer's own gate
--   3. `storage.buckets.allowed_mime_types`           — the provider's gate on the PUT
--   The client `accept` attribute is a fourth and is UX only; it is not a gate.
--
-- ROLLBACK:  Forward-only. Rows already holding a JPEG/PNG/HEIC ref stay readable — the
--            narrowing applies to NEW submissions, and neither the proxy nor
--            `verifyUpload` re-checks a stored document's type on read. Widening again
--            is a new migration replacing these three mirrors together.
-- ═══════════════════════════════════════════════════════════════════════════════════

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
     or p_mime not in ('application/pdf')
     or p_noa_mime is null
     or p_noa_mime not in ('application/pdf')
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
  if p_mime is null or p_mime not in ('application/pdf')
     or p_noa_mime is null or p_noa_mime not in ('application/pdf')
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

comment on function public.finalize_application(uuid, text, text, text, bigint, text, text, bigint) is
  '0045''s body with ONE change: the MIME allowlist is application/pdf alone (0060). The '
  'token gate, the window re-check, check_submission_standards() and the uniform '
  'anti-enumeration return are all unchanged.';

comment on function public.finalize_renewal(uuid, text, text, text, bigint, text, text, bigint) is
  '0045''s body with ONE change: the MIME allowlist is application/pdf alone (0060). '
  'Everything else unchanged.';

-- ── Mirror 3: the provider's own gate on the direct PUT ─────────────────────────────
-- Guarded exactly as 0021 is: a bare Postgres (a restore drill) has no `storage` schema,
-- and that must be a notice rather than a failed migration. Narrowing this is what stops
-- a client that bypasses our Server Action entirely from PUTting a JPEG into the bucket.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice '0060: storage schema not present; skipping the bucket MIME narrowing. Expected in a bare Postgres, NOT expected in a Supabase project.';
    return;
  end if;

  begin
    update storage.buckets
       set allowed_mime_types = array['application/pdf']
     where id = 'proof-of-enrollment';
  exception when insufficient_privilege then
    raise notice '0060: could not narrow the proof-of-enrollment bucket MIME list (insufficient privilege). Narrow it by hand in the Supabase dashboard; the two finalize_* functions still refuse a non-PDF.';
  end;
end;
$$;
