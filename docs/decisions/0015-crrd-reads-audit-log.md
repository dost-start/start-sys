# ADR 0015 — CRRD Admin reads the audit log

**Date:** 2026-09-09
**Author:** Ethan Baltazar (project head), recorded by the implementation pass
**Status:** Accepted. Supersedes the read half of the `audit_log_read` policy shipped in `0014_rls.sql`.

## Context

`audit_log_read` (migration `0014`) admitted `exec_admin` and `tech_admin` only, implementing
PRD US-I1 as literally worded: *"The log is readable only by Executive and Technical Admins."*

Two things collided in the 2026-09-09 reviewer walkthrough.

1. `ADMIN_NAV_LINKS` is role-agnostic and is rendered for both `exec_admin` and `crrd_admin`,
   so the CCDO was shown an "Audit log" link that always 404'd. The route reads through the
   caller's own client, so the policy — correctly — returned nothing and the page rendered
   `notFound()`. A link to a page that cannot exist for you is a defect either way.
2. The CRRD tier is the one that runs the records surface every day: application decisions,
   member status changes, document views, campaign sends. They are the people most likely to
   need to answer *"who changed this, and when"* about their own department's work, and the
   only tiers who could answer it were the CEO/COO and the CTO.

Either the link goes, or the policy widens. This is an organizational call, not a technical
one, and it was made by the project head.

## Decision

**`audit_log_read` widens to `crrd_admin`.** Migration `0053_audit_log_crrd_read.sql` drops
and recreates the policy with the three-role list. `canReadAuditLog()` in
`lib/audit/queries.ts` mirrors it. `TECH_ADMIN_NAV_LINKS` also gains the Audit link, because
`tech_admin` has held this read since `0014` and had no way to reach the page.

PRD US-I1's sentence and `ARCHITECTURE.md` §5/§8 are amended in the same PR rather than left
to contradict the schema.

## The objection, recorded rather than deleted

`0014`'s own comment argued against exactly this:

> crrd_admin and moderator are the tier whose reads and writes this log records, so giving
> them the log would let the watched read the watcher.

That remains true and it is not dismissed. Two things bound the damage:

- **Immutability is untouched, and immutability — not secrecy — is what makes an audit log
  trustworthy.** There is still no INSERT, UPDATE or DELETE policy on `audit_log` for any
  role; `revoke update, delete … from authenticated, anon, service_role` (`0011`) still
  stands; `026_policy_invariants` and `099_security_invariants` still assert both. A
  `crrd_admin` can now see the record of their own document view. They cannot remove it, edit
  it, or stop the next one being written. `exec_admin` and `tech_admin` see the same rows.
- **The log holds no PII.** `audit_row()` calls `mask_sensitive()` before the insert, so every
  value whose column is named in `sensitive_column_registry` is stored as a redaction marker
  (`DATA_MODEL.md` §8.3). Widening the read does not widen what personal data is disclosed —
  it discloses *actions*, not *values*. This is also why the CBL Art. VIII §7.1
  confidentiality-acknowledgement gate is deliberately **not** applied here: there is nothing
  to acknowledge for. `068` asserts that explicitly, using the `crrd_deputy` fixture, which is
  a second `crrd_admin` seeded without an acknowledgement.

## Consequences

- A CRRD officer can see which member records another officer has been opening. That is the
  real cost, it was named before the decision, and it was accepted.
- The tier that can be *investigated* using this log can now see what the investigation would
  see. Where that matters, `exec_admin` and `tech_admin` remain the tiers with reads that
  `crrd_admin` cannot observe — notably `sensitive_column_registry`, which did **not** move.
- pgTAP expectations flip in three files: `021_reference_rls`, `028_role_matrix_rowcounts`,
  `068_audit_read_matrix`. The last of those asserts both CRRD fixtures against the captured
  total, so a future narrowing turns CI red rather than passing quietly.
- Narrowing it again is one migration plus these same three test edits. Nothing in the app
  branches on the tier list beyond `canReadAuditLog()`.
