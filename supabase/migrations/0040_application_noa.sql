-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0040_application_noa.sql  —  the Notice of Award is a second, required document
--
-- WHAT: the CRRD SRS (2026-09-05) lists TWO files on the membership application:
--   "Latest Registration Form" (= the Certificate of Registration the proof_* columns
--   have held since 0008) and "Notice of Award" (NOA — the DOST-SEI document that proves
--   the applicant is a scholar at all; team meeting: "NOA as proof"). Four `noa_*` columns
--   mirror the four proof_* columns exactly: provider-opaque reference, verified MIME,
--   verified size, verification timestamp. Same contract, same sensitivity, same proxy.
--
--   DELIBERATELY columns, not a documents table. One row per application with exactly two
--   documents is a fixed shape; a documents table would touch the proxy route, the purge,
--   the review page and nine pgTAP files for no gain here. The committee application
--   (up to four files per department, up to three departments) is a genuinely multi-file
--   shape and gets its own table when it lands.
--
--   pending_has_proof is replaced: a row may only leave `draft` once BOTH references exist.
--   Added NOT VALID because rows submitted before this migration have no NOA and must stay
--   readable; every new or updated row is checked.
--
--   finalize_application() gains three parameters for the NOA and validates both documents
--   with the same allowlist and cap; the old five-parameter overload is dropped so there is
--   exactly one finalize path. purge_abandoned_drafts() returns the NOA reference as an
--   additional row for the same application, so the caller deletes both files — the purge
--   destroys data on BOTH sides of the storage boundary (DATA_MODEL.md §8.2).
--
-- ROLLBACK: forward-only. Columns are additive; the NOT VALID CHECK and the new function
--   signature would be reverted by a new migration.
-- ═══════════════════════════════════════════════════════════════════════════════════

alter table public.applications
  add column noa_drive_file_id text,
  add column noa_mime_type     text,
  add column noa_size_bytes    bigint,
  add column noa_verified_at   timestamptz;

comment on column public.applications.noa_drive_file_id is
  'Provider-opaque reference to the applicant''s Notice of Award (SRS 2026-09-05). Same '
  'contract as proof_drive_file_id: a Drive file id OR a Storage object path, interpreted '
  'only by lib/documents/. Never reaches a browser; served through the proof proxy with '
  '?doc=noa, one audit row per view.';

-- ── both documents before leaving draft ────────────────────────────────────────────
alter table public.applications drop constraint pending_has_proof;
alter table public.applications add constraint pending_has_proof
  check (status = 'draft'
         or (proof_drive_file_id is not null and noa_drive_file_id is not null))
  not valid;

comment on constraint pending_has_proof on public.applications is
  'A row may only leave draft with BOTH documents present: the registration form and the '
  'Notice of Award (SRS 2026-09-05). NOT VALID so pre-0040 rows without an NOA stay '
  'readable; enforced on every insert and update.';

-- ── sensitivity: the NOA reference addresses a DOST-SEI document with a scholar number ──
insert into public.sensitive_column_registry (table_name, column_name, rationale) values
  ('applications', 'noa_drive_file_id',
   'Provider-side identifier for the Notice of Award. Addresses a DOST-SEI document carrying the scholar''s award details.')
on conflict (table_name, column_name) do nothing;

-- ── reviewer columns, mirroring 0027 ───────────────────────────────────────────────
-- The reference is granted so the proxy can authorize by selecting it with the caller's
-- own JWT (S4-T17); the MIME decides iframe vs <img> vs the HEIC notice; size and
-- verified_at are the reviewer-facing sanity checks. No web-view link exists for the NOA.
grant select (noa_drive_file_id, noa_mime_type, noa_size_bytes, noa_verified_at)
  on public.applications to authenticated;

-- ── finalize: two documents ────────────────────────────────────────────────────────
drop function if exists public.finalize_application(uuid, text, text, text, bigint);

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
  'The token-gated draft -> pending flip, now with TWO documents (registration form + '
  'Notice of Award, SRS 2026-09-05). Replaces an anon UPDATE policy: unknown id returns '
  'silently, wrong/expired token raises a generic 42501, a retry with the same documents is '
  'a no-op, a closed window is refused at the data layer, both documents are validated '
  'against the allowlist and cap, and a duplicate (term, email) is swallowed so the response '
  'is indistinguishable from a first-time submission. Returns void so it cannot be a read '
  'oracle. PRD US-B1, US-B2, US-B4; BUILD_PLAN S3-T6.';

revoke execute on function public.finalize_application(uuid, text, text, text, bigint, text, text, bigint) from public;
grant  execute on function public.finalize_application(uuid, text, text, text, bigint, text, text, bigint) to anon, authenticated;

-- ── purge: hand back BOTH references ───────────────────────────────────────────────
-- Same signature and return shape as 0020, so the job route and 045 keep working: an
-- application with an NOA reference yields a second row carrying it. A draft that never
-- uploaded an NOA yields exactly one row, as before.
create or replace function public.purge_abandoned_drafts(
  p_age interval default interval '30 days'
) returns table (application_id uuid, storage_ref text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_age is null or p_age <= interval '0' then
    raise exception 'purge_abandoned_drafts: p_age must be a positive interval'
      using errcode = '22023';   -- invalid_parameter_value
  end if;

  return query
  with purged as (
    update public.applications a
       set payload                 = '{}'::jsonb,
           applicant_email         = 'redacted@invalid',
           applicant_given_name    = 'redacted',
           applicant_family_name   = 'redacted',
           proof_web_view_link     = null,
           submit_token_hash       = null,
           submit_token_expires_at = null,
           redacted_at             = now()
     where a.status      = 'draft'
       and a.redacted_at is null
       and a.created_at  < now() - p_age
       and exists (
         select 1
         from public.terms t
         where t.id = a.term_id
           and t.status <> 'archived'
       )
    returning a.id as purged_id, a.proof_drive_file_id as purged_ref, a.noa_drive_file_id as purged_noa
  )
  select p.purged_id, p.purged_ref from purged p
  union all
  select p.purged_id, p.purged_noa from purged p where p.purged_noa is not null;
end;
$$;

comment on function public.purge_abandoned_drafts(interval) is
  'Redacts abandoned drafts older than p_age in place (never DELETE) and returns every '
  'document reference they held — the registration form and, since 0040, the Notice of '
  'Award as a second row — so the caller destroys the files too. Idempotent: a redacted '
  'row is never returned twice. service_role only. BUILD_PLAN S3-T8; DATA_MODEL.md §8.2.';
