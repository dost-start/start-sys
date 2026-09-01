-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0026_application_detail_rpc.sql
--
-- WHAT:      get_application_detail(p_app_id uuid) returns jsonb — the ONE audited path to
--            the two columns 0027 withholds from every session: applicant_email and payload.
--
-- WHY:       PRD US-C1: "the detail view shows EVERY SUBMITTED FIELD." Those fields live in
--            `applications.payload` and `applications.applicant_email`, both registered
--            sensitive (0008 §7) and both deliberately absent from the column GRANT in
--            0027 — so there is exactly one way to read them, and coming through it writes
--            an audit row. This is get_person_sensitive() (0012) applied to the intake
--            queue: same guards, same ordering, same reasoning, so a maintainer who has read
--            one has read both.
--
-- ROLLBACK:  Forward-only. Without this function the application detail page cannot render
--            the submitted fields at all, and the tempting "fix" — widening 0027's GRANT to
--            include payload — is the banned move (CLAUDE.md; ARCHITECTURE.md §5).
--
-- CITATION:  BUILD_PLAN S4-T6; ARCHITECTURE.md §5 (column protection), §4.1 step 7;
--            DATA_MODEL.md §8.1, §8.3, §8.4; PRD US-C1, US-J1, US-J2, US-J5, US-I1;
--            PRD OQ-5; CBL Art. VIII §6, §7.1.
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- ORDER OF OPERATIONS IS THE SECURITY PROPERTY
-- ═══════════════════════════════════════════════════════════════════════════════════
--   1. role guard        exec_admin / crrd_admin / moderator, else 42501
--   2. acknowledgement   CBL Art. VIII §7.1, else a DISTINCT 42501
--   3. audit write       BEFORE the return value is built, so there is no window in which
--                        the data has been read and the read has not been recorded — a
--                        caller cannot get the row and dodge the record by disconnecting
--   4. return, minus the pointers
--
-- WHAT IS STRIPPED FROM THE RETURN, AND WHY EACH:
--
--   proof_web_view_link      PRD US-J2. A provider URL must never reach a browser: it is one
--                            forwarded link away from a Certificate of Registration on the
--                            public internet, and it would route around the audited proxy
--                            entirely. 0027 withholds it from the GRANT as well — belt and
--                            braces on the single most likely breach vector in this system
--                            (ARCHITECTURE.md §7, rejected alternatives).
--
--   proof_drive_file_id      Stripped even though 0027 DOES grant it, and that asymmetry is
--                            deliberate. The grant exists for one caller: the proxy route's
--                            ordinary RLS-checked SELECT, which uses the id server-side and
--                            never renders it. This function's output goes to a SCREEN, and a
--                            provider file id in the DOM is a durable handle to a document
--                            in someone's Drive. The viewer component takes an applicationId
--                            and a mime type — never a URL, never a file id (S4-T20).
--
--   submit_token_hash        A live authorization secret, not a record field:
--                            finalize_application() (0019) compares against it and nothing
--                            else may see it. Registered sensitive in 0008 for exactly this
--                            reason.
--
--   submit_token_expires_at  Stripped alongside its hash. It is meaningless without the
--                            digest and belongs to a one-time capability rather than to the
--                            application record; a reviewer screen showing a token expiry is
--                            noise that invites someone to ask for the token. Stated here so
--                            the fourth removal is a decision rather than a surprise.
--
-- WHAT IS DELIBERATELY **NOT** STRIPPED: applicant_email and payload. This function exists to
-- return them. mask_sensitive() is for the AUDIT LOG, which must never store PII; it is not
-- for an authorized caller who has just passed two guards and been recorded. Masking here
-- would defeat the entire purpose.
--
-- SECURITY DEFINER, so the read bypasses the column GRANT — which is the only way to read a
-- withheld column, and is exactly why the guards above are not optional. It does NOT widen
-- ROW access: the three roles admitted here are precisely the three named by
-- applications_read (0008), so no row becomes visible to anyone it was not already visible
-- to. tech_admin is refused (PRD OQ-5) even though it could otherwise reach nothing here
-- anyway — the exclusion is stated in the guard so removing the policy later does not
-- silently open this door.
--
-- VOLATILE (plpgsql default) because it WRITES. See 0025.
create or replace function public.get_application_detail(p_app_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  a      public.applications;
begin
  -- 1.
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin', 'moderator') then
    raise exception 'not authorized to read an application in full'
      using errcode = '42501';
  end if;

  -- 2. CBL Art. VIII §7.1 — its own distinct, actionable message (PRD US-J5).
  perform public.assert_confidentiality_ack();

  select * into a from public.applications where id = p_app_id;

  -- CONVENTIONS.md §4.3: an absent row is not_found, never unauthorized — saying "forbidden"
  -- would confirm that an application with this id exists, which is itself the disclosure.
  -- NO AUDIT ROW IS WRITTEN HERE: nothing was viewed, and a log entry for a miss would let
  -- the audit log be used as the very enumeration oracle 0008 refuses to build. Mirrors
  -- get_person_sensitive() (0012) exactly.
  if a.id is null then
    return null;
  end if;

  -- 3. RA 10173 / CBL Art. VIII §6. One row per call, written before the value is built.
  --    old_data / new_data NULL: this is a read, and the log records the ACT, never the
  --    values (DATA_MODEL.md §8.3).
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

  -- 4.
  return to_jsonb(a)
           - 'proof_web_view_link'
           - 'proof_drive_file_id'
           - 'submit_token_hash'
           - 'submit_token_expires_at';
end;
$$;

comment on function public.get_application_detail(uuid) is
  'The ONLY path to applications.applicant_email and applications.payload, which 0027 '
  'withholds from every session role. Guards on role (exec_admin/crrd_admin/moderator; '
  'tech_admin refused per OQ-5), then on a current-term confidentiality acknowledgement '
  '(CBL Art. VIII §7.1), then writes ONE VIEW audit row, then returns the row minus both '
  'proof pointers and both submit-token columns. Returns NULL for an application that does '
  'not exist, and writes no audit row for it. PRD US-C1, US-J2, US-J5.';

revoke execute on function public.get_application_detail(uuid) from public;
revoke execute on function public.get_application_detail(uuid) from anon;
grant  execute on function public.get_application_detail(uuid) to   authenticated;
