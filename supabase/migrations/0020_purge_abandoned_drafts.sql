-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0020_purge_abandoned_drafts.sql
--
-- WHAT:      purge_abandoned_drafts(p_age) — redacts application drafts that were never
--            submitted, and RETURNS the document reference of each so the caller can delete
--            the uploaded file on the other side of the storage boundary.
--
-- WHY:       **A DRAFT ROW HOLDS A REAL PERSON'S BIRTHDATE, ADDRESS, CONTACT NUMBER AND
--            SCHOOL ID NUMBER FOR SOMEONE WHO NEVER COMPLETED A SUBMISSION.** It has the
--            weakest retention basis of anything in this schema: the applicant filled in a
--            form, their upload failed or their browser died, and they walked away. There is
--            no membership, no decision, no relationship — and under RA 10173 (a
--            CONSTITUTIONAL obligation here, CBL Art. VIII §6) personal data may not be kept
--            longer than the purpose it was collected for. Thirty days is the boring
--            default: long enough that a genuine retry still finds their draft, short enough
--            that abandoned PII does not accumulate across an application period.
--
-- IT REDACTS, IT NEVER DELETES. CLAUDE.md and the PRD Reliability NFR: no hard delete
--            anywhere, no DELETE policy anywhere, none may be added. What survives is a
--            SKELETON — id, term_id, status, created_at and redacted_at — and that skeleton
--            is the evidence the sweep actually ran. A row that vanished proves nothing.
--
-- IT DESTROYS DATA ON BOTH SIDES OF THE STORAGE BOUNDARY, which is the half that is usually
--            missed. Clearing the database columns while leaving the Certificate of
--            Registration sitting in Drive or in a bucket forever is the most common way this
--            kind of requirement is quietly failed — the audit looks clean and the PDFs are
--            still there. So the function RETURNS (application_id, storage_ref) and the
--            calling job (app/api/jobs/purge-abandoned-drafts, S3-T22) issues one delete per
--            reference and reconciles orphans. Deliberately mirrors the shape of
--            redact_expired_pii() (0012) so a maintainer who has read one understands the
--            other.
--
-- WHY proof_drive_file_id IS *NOT* NULLED: two reasons, and the first is mechanical. UPDATE
--            ... RETURNING returns the NEW value, so nulling the column in the same statement
--            would return NULL and the caller would have nothing to delete. The second is
--            deliberate and matches redact_expired_pii(): the reference is the record that a
--            document once existed here. It becomes a dangling pointer the moment the caller
--            deletes the object, which is the correct end state — the pointer is not the PII,
--            the file was.
--
-- CITATION:  BUILD_PLAN S3-T8; DATA_MODEL.md §8.1, §8.2, §6/0012; ARCHITECTURE.md §8 (the
--            single scheduler); PRD §3 v1.0 item 5; PRD US-J2, US-J3; PRD §4 Non-Goals
--            ("Data deletion of any kind by any user"); CBL Art. VIII §6 (RA 10173).
--
-- ROLLBACK:  Forward-only. Redaction is irreversible by design — that is the point.
-- ═══════════════════════════════════════════════════════════════════════════════════

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

  -- The data-modifying CTE mirrors redact_expired_pii() (DATA_MODEL.md §6/0012) exactly, so
  -- a maintainer who has read one recognises the other on sight. The UPDATE runs because the
  -- outer SELECT draws from it.
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
   where a.status      = 'draft'          -- never a submitted, approved or rejected row
     and a.redacted_at is null            -- idempotent: a redacted row is never returned twice
     and a.created_at  < now() - p_age
     -- ⚠ ARCHIVED-TERM CARVE-OUT — READ THIS BEFORE "SIMPLIFYING" IT.
     -- trg_applications_freeze_archived (0008) fires BEFORE UPDATE and raises 42501 when the
     -- row's term is archived (DATA_MODEL.md §7.3). Without this predicate a single draft
     -- left behind in a term that has since been rolled over would abort the ENTIRE nightly
     -- sweep with a permissions error, every night, for every other row too. Filtering keeps
     -- the job green.
     --
     -- The residual, stated rather than hidden: a draft created in the last ~30 days before
     -- a term is archived is never redacted by this function and its PII persists. The window
     -- is narrow — rollover runs at the end of May (CBL Art. V §1) and application periods
     -- run well before it, so anything older than 30 days at rollover has already been swept
     -- — but it is not zero. **The correct owner is the rollover runbook: sweep drafts
     -- BEFORE archiving the term** (docs/runbooks/01-TERM_ROLLOVER.md, v1.2), or redact them
     -- through the audited unfreeze_term() path. Raised for the v1.2 rollover owner in the
     -- PR; do not close this gap by weakening the freeze trigger.
     and exists (
       select 1
       from public.terms t
       where t.id = a.term_id
         and t.status <> 'archived'
     )
  returning a.id as purged_id, a.proof_drive_file_id as purged_ref
  )
  select p.purged_id, p.purged_ref from purged p;

  -- The audit trail is the trg_applications_audit AFTER UPDATE trigger, which fires once per
  -- redacted row. Called from the scheduled job there is no auth.uid(), so audit_row()
  -- records actor_role 'system' — and mask_sensitive() redacts the four sensitive columns
  -- before writing, so the audit rows proving the purge ran do not themselves become the
  -- copy of the data the purge just destroyed (DATA_MODEL.md §8.3). No hand-written audit
  -- insert here: SECURITY INVARIANT 6, the trigger is the record precisely so no code path
  -- can skip it.
end;
$$;

comment on function public.purge_abandoned_drafts(interval) is
  'Redacts application drafts older than p_age that were never submitted, and returns each '
  'one''s document reference so the caller can delete the file from the document store. '
  'Never deletes a row — the redacted skeleton is the evidence the sweep ran. Skips archived '
  'terms so the freeze trigger cannot abort the whole job; see the carve-out note in the '
  'body. service_role only. BUILD_PLAN S3-T8; PRD US-J2, US-J3; RA 10173 / CBL Art. VIII §6.';

-- ── privileges ─────────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE on a new function to PUBLIC, and PUBLIC includes anon and
-- authenticated. A SECURITY DEFINER function that redacts applications must not be callable
-- by a human role at all: this is a JOB, invoked by .github/workflows/scheduled.yml through
-- /api/jobs/purge-abandoned-drafts behind JOB_SHARED_SECRET, and that endpoint is the one
-- legitimate consumer of lib/server/admin-client.ts in this slice.
--
-- REVOKE FROM PUBLIC FIRST. Revoking from anon and authenticated alone would leave the
-- PUBLIC grant in place and both roles would still inherit it — the classic way a lockdown
-- silently does nothing.
revoke execute on function public.purge_abandoned_drafts(interval) from public;
revoke execute on function public.purge_abandoned_drafts(interval) from anon, authenticated;
grant  execute on function public.purge_abandoned_drafts(interval) to service_role;
