-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0025_document_view_audit.sql
--
-- WHAT:      log_document_view(p_app_id uuid) returns void — writes the one audit row that
--            GET /api/applications/[id]/proof must produce before it streams a byte.
--
-- WHY:       PRD US-C1 ("each document view is recorded in the audit log with viewer and
--            timestamp"), PRD US-J2 ("viewing a document requires an authorized session and
--            IS AUDITED") and PRD §3 v1.0 item 16, which names document views explicitly.
--            Under RA 10173 — a CONSTITUTIONAL obligation here, CBL Art. VIII §6 — **"who
--            looked at this scholar's Certificate of Registration, and when" is a question
--            the organization must be able to answer.** A Certificate of Registration
--            carries a student number, an address and a signature; a view of it is an access
--            to sensitive personal data whether or not anything was changed.
--
-- ROLLBACK:  Forward-only. Without this function the proxy route has no way to write an
--            audit row at all — see §1.
--
-- CITATION:  BUILD_PLAN S4-T5, S4-T17; ARCHITECTURE.md §4.1 step 7, §8 (History NFR);
--            DATA_MODEL.md §8.3, §8.4; PRD US-C1, US-J2, US-J5, US-I1; CBL Art. VIII §6, §7.1.
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — why this is a function at all, and not an INSERT in the route handler
-- ═══════════════════════════════════════════════════════════════════════════════════
-- `audit_log` has FORCE ROW LEVEL SECURITY, exactly one policy (audit_log_read, for
-- exec_admin and tech_admin — 0014) and NO INSERT POLICY FOR ANY ROLE. That is not an
-- oversight to be worked around: every other row in the table is written by the audit_row()
-- trigger running as the definer owner, which is what makes "including the user responsible"
-- true rather than aspirational (ARCHITECTURE.md §8).
--
-- ⚠ **DO NOT ADD AN INSERT POLICY ON audit_log TO MAKE A ROUTE HANDLER WORK.** A session
-- that can insert audit rows can insert FALSE ones — a forgeable audit log is worse than no
-- audit log, because it is trusted. A document view is the one auditable event with no row
-- change behind it to hang a trigger on, so it comes through a narrow definer that writes
-- exactly one row with exactly the caller's identity and nothing the caller supplies.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — what this function does and does not authorize
-- ═══════════════════════════════════════════════════════════════════════════════════
-- IT DOES NOT DECIDE WHICH APPLICATION. The route (S4-T17) does an ordinary supabase-js
-- SELECT for the proof pointer FIRST, carrying the caller's own JWT — a row means
-- authorized, null means 404, and document authorization is thereby delegated to the same
-- applications_read policy that guards everything else (ARCHITECTURE.md §4.1 step 7). There
-- is no second permission model here and there must not be one.
--
-- IT AUTHORIZES THE ACT OF VIEWING, and records it. Hence: no existence check, no row read,
-- no join. Calling it for an id the caller cannot read writes an audit row that says a
-- reviewer tried — which is information the log should hold — and gets them no bytes,
-- because the route already returned 404 before reaching this line.
--
-- THE CONFIDENTIALITY GATE IS REAL HERE. CBL Art. VIII §7.1 requires a signed agreement
-- "upon assuming their roles", per term (Art. V §1), and DATA_MODEL.md §8.4 makes it a
-- PRECONDITION rather than a report. A proof document is the densest sensitive object an
-- application carries, so a reviewer with no current-term acknowledgement is refused with
-- assert_confidentiality_ack()'s own distinct, actionable message (PRD US-J5: the refusal is
-- an ERROR, never an empty result). **The day-one failure mode is deliberate: on the morning
-- a term opens, nobody has acknowledged and no document opens** — unblocking it is one
-- INSERT by an exec_admin, which is what makes signing part of onboarding.
--
-- ⚠ **THE NOTE NEVER CARRIES THE DOCUMENT REFERENCE.** proof_drive_file_id and
-- proof_web_view_link are both registered in sensitive_column_registry (0008), which makes
-- mask_sensitive() redact them out of every triggered audit row — writing either into `note`
-- here would smuggle past that masking and turn the append-only log into the PII store it
-- exists not to be (DATA_MODEL.md §8.3). row_id already says WHICH application; that is the
-- whole of what the log needs.
--
-- VOLATILE (the plpgsql default, stated by the omission of STABLE) because it WRITES. A
-- STABLE marking would let the planner elide or reorder calls, and the audit row could go
-- missing under a query the author never thought about.
create or replace function public.log_document_view(p_app_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
begin
  -- 1. role guard — the same three as the decision RPCs. tech_admin refused (PRD OQ-5);
  --    officer refused (PRD US-D2/US-J1, and the Special Advisor sits in that tier —
  --    CBL Art. III §2.9, Art. X §2.4-2.5); regional_rep, member and anon refused.
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin', 'moderator') then
    raise exception 'not authorized to view a proof-of-enrollment document'
      using errcode = '42501';
  end if;

  -- 2. CBL Art. VIII §7.1 — raises 42501 with its own distinct, actionable message.
  perform public.assert_confidentiality_ack();

  -- 3. exactly one row. old_data and new_data are NULL ON PURPOSE: this is a READ, so there
  --    is no diff, and putting anything here would be storing PII about the access rather
  --    than recording it (DATA_MODEL.md §8.3, mirroring get_person_sensitive() in 0012).
  insert into public.audit_log (
    actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note
  )
  values (
    (select auth.uid()),
    v_role::text,
    'applications',
    p_app_id,
    'VIEW_DOCUMENT',
    null,
    null,
    'proof-of-enrollment document streamed via GET /api/applications/[id]/proof'
  );
end;
$$;

comment on function public.log_document_view(uuid) is
  'Records ONE VIEW_DOCUMENT audit row for a proof-of-enrollment view. Guards on role '
  '(exec_admin/crrd_admin/moderator) and on a current-term confidentiality acknowledgement '
  '(CBL Art. VIII §7.1), then writes. Called by the proof proxy BEFORE it streams; the route '
  'must fail closed if this raises. Never records the document reference. PRD US-C1, US-J2.';

-- Definer functions default-grant to PUBLIC (see 0022 §3). anon has no business reaching a
-- function whose only effect is to append to the audit log.
revoke execute on function public.log_document_view(uuid) from public;
revoke execute on function public.log_document_view(uuid) from anon;
grant  execute on function public.log_document_view(uuid) to   authenticated;
