-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0053_audit_log_crrd_read.sql
--
-- WHAT:      `audit_log_read` (0014) is dropped and recreated with `crrd_admin` added.
--            The tier that can READ the log becomes exec_admin, tech_admin, crrd_admin.
--            Nothing else about the table changes: still no INSERT, UPDATE or DELETE
--            policy, still `revoke update, delete` at the GRANT level (0011), still
--            append-only, still masked at write time by `mask_sensitive()` (0011), so
--            widening the read does NOT widen what any PII the log can disclose.
--
-- WHY:       Ethan (project head), 2026-09-09, after the reviewer walkthrough: the CRRD
--            tier operates the records surface every day and had a nav link to `/audit`
--            that 404'd for them, because the link set was role-agnostic while this
--            policy was not. Two ways to reconcile that; he chose to widen the policy.
--
-- ⚠ THIS OVERRULES A RECORDED OBJECTION, and the objection is repeated here rather
--   than deleted, because the next maintainer deserves to see the trade that was made:
--   0014's own comment reads "crrd_admin and moderator are the tier whose reads and
--   writes this log records, so giving them the log would let the watched read the
--   watcher." That is still true. What makes it acceptable is that the log stays
--   APPEND-ONLY and UNEDITABLE for every role including this one — a crrd_admin can now
--   see that their own document view was recorded, but cannot remove the record of it,
--   and exec_admin and tech_admin still see the same rows. Read access is not the
--   control that makes an audit log trustworthy; immutability is, and immutability is
--   untouched. See ADR 0015.
--
--            PRD US-I1's sentence ("readable only by Executive and Technical Admins")
--            is amended in the same PR rather than left to contradict the schema.
--
-- ROLLBACK:  Forward-only. To narrow it again, a later migration drops and recreates
--            this policy with the two-role list, and flips the pgTAP expectations back.
-- ═══════════════════════════════════════════════════════════════════════════════════

drop policy if exists audit_log_read on public.audit_log;

-- PRD US-I1 as amended 2026-09-09 (ADR 0015): the log is readable by Executive,
-- Technical and CRRD Admins. Every other tier — officer, regional_rep, and the revoked
-- `member` state — still sees exactly zero rows, which 068_audit_read_matrix asserts.
create policy audit_log_read on public.audit_log
  for select to authenticated
  using (public.auth_role() in ('exec_admin', 'tech_admin', 'crrd_admin'));

-- Deliberately NOT re-stated here and deliberately still absent: any INSERT, UPDATE or
-- DELETE policy on this table. See 0014's block comment. A forgeable or editable audit
-- log is worse than no audit log, and that has not changed.
