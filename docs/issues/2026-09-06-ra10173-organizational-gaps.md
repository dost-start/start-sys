# 2026-09-06 — RA 10173: what the system does versus what the organization still owes

**Status:** Open, permanently until the process rows below are closed one by one
**Severity:** High — this is a precondition on collecting real applicant data, not a
cosmetic gap
**Owner:** Project heads (Danielle Quiambao, Ethan Baltazar) for the process table;
`tech_admin` for keeping the mechanism table current
**Raised by:** BUILD_PLAN S7-T24

---

## Why this file exists

RA 10173 compliance is not one thing. Part of it is **mechanism** — does the software
actually restrict access, log reads, encrypt backups, delete data on schedule. Part of
it is **process** — has the organization designated a Data Protection Officer,
registered with the National Privacy Commission, signed data processing agreements
with its vendors, published a notice, and trained its people.

**Engineering can build the first kind in a seven-day sprint. It cannot build the
second kind at all** — those are organizational and legal acts requiring a signature
from an authorized officer of START-DOST, most of them requiring a person (a DPO) who
does not yet exist. Conflating the two — or worse, letting the first stand in for the
second in a submission or a public claim — would be false, and would be exactly the
kind of undocumented risk this whole project exists to eliminate from a spreadsheet-era
workflow.

So: two tables. Read both before claiming this system meets its RA 10173 obligations
in full, anywhere. **No document in this repository may state that claim** (enforced
by a grep check in CI-adjacent tooling and by hand-review — see the README's
Compliance position section).

---

## Table 1 — Mechanisms that ship and are tested

| # | Mechanism | Where it lives |
|---|---|---|
| 1 | Sensitive columns classified as **data**, not prose | `sensitive_column_registry` table, seeded per `DATA_MODEL.md` §8.1 |
| 2 | Column-level GRANTs cutting `people` down to six non-sensitive columns for Officer/RR/Member/Tech Admin | `supabase/migrations/0015_grants.sql` |
| 3 | A directory view (`v_member_directory`) that structurally cannot carry a sensitive column, asserted by intersecting its columns against the registry | `supabase/migrations/0013_views.sql`; `supabase/tests/066_dashboard_view_columns.sql` |
| 4 | Row Level Security **enabled and forced** on every table in `public`, with a CI-blocking meta-test over `pg_class`/`pg_policies` — no exceptions, no exclusion list without a named ADR | `supabase/tests/001_meta_force_rls.sql`, `099_security_invariants.sql` |
| 5 | Zero `DELETE` policies anywhere in the schema — mass deletion is structurally impossible | `supabase/tests/026_policy_invariants.sql`, `099_security_invariants.sql` |
| 6 | An append-only audit log whose sensitive values are **masked before they are written**, so the log is not itself a second PII store | `mask_sensitive()`, `audit_row()` — `supabase/migrations/0011_audit.sql`, `0012_functions.sql`; functional proof in `supabase/tests/017_audit_triggers.sql` |
| 7 | An audit row for **every** proof-of-enrollment document view, fail-closed (the byte stream does not start unless the audit write succeeds) | `GET /api/applications/[id]/proof`, `log_document_view()` — `supabase/migrations/0025_document_view_audit.sql` |
| 8 | The five-year sensitive-data purge, running on **both sides** of the storage boundary (database columns and the Drive/Storage document) | `redact_expired_pii()` — `DATA_MODEL.md` §8.2, `docs/RUNBOOK.md` "Document store swap" cost 3 note |
| 9 | A Sentry `beforeSend` scrub proven against a real client, not just a pure-function unit test, stripping request bodies, cookies, and any `sensitive_column_registry` key before an event leaves the process | `lib/observability/scrub.ts`, `lib/observability/scrub.integration.test.ts` |
| 10 | Encrypted, off-provider nightly backups, **with one restore actually performed and recorded** by someone who did not write the restore script | `.github/workflows/scheduled.yml` job `backup`; `docs/runbooks/02-RESTORE_FROM_BACKUP.md` Drill record |
| 11 | A published, plain-language privacy notice, and consent captured **at collection** against an immutable notice-version record so a client cannot backdate agreement to a superseded notice | `docs/privacy/PRIVACY_NOTICE.md`, `app/(public)/privacy/page.tsx`, `lib/privacy/notice-version.ts` (S7-T22 replaces the constant with a DB-enforced, trigger-owned version table and CHECK constraint) |
| 12 | A pre-drafted 72-hour NPC breach notification, so an incident is filled into a form rather than drafted from nothing under pressure | `docs/privacy/BREACH_NOTIFICATION_TEMPLATE.md`, linked from `docs/runbooks/05-INCIDENT_RESPONSE.md` |
| 13 | A confidentiality-acknowledgement gate (CBL Art. VIII §7.1) that refuses a sensitive-column read outright — not silently, as a distinct error — for anyone without a current-term signed acknowledgement on file | `assert_confidentiality_ack()`, `confidentiality_acknowledgements` table; `supabase/tests/020_confidentiality_gate.sql` |

## Table 2 — Processes that cannot complete in this window

| # | Process | Owner | Blocked on |
|---|---|---|---|
| 1 | **Designate a Data Protection Officer** and register with the National Privacy Commission | Project heads | `PRD.md` OQ-2 — an external filing to a government body, requiring the org to name a specific person to a specific role first. Engineering cannot appoint a DPO. |
| 2 | **Execute the seven data processing agreements** in `docs/privacy/DPA_REGISTER.md` (Supabase, Vercel, Google/Drive, Resend, GitHub, Backblaze, Sentry) | Project heads, once a DPO/signatory exists | Depends on #1 — a DPA needs an authorized org signatory, which needs the DPO decision made first. Two of the seven processors (Resend, Backblaze) are also not yet provisioned at all. |
| 3 | **Settle the retention clock's start date** (five years from what, exactly — term end, record creation, or last active term? Current implementation assumes last active term.) | Project heads | `PRD.md` OQ-8 — a policy decision the privacy notice must state correctly, since the notice and `redact_expired_pii()`'s predicate must describe the same rule. |
| 4 | **Establish the quarterly restore-drill cadence** | `tech_admin` (CTO) | Not a blocker on collecting data, but a demonstrated *cadence* is by definition not provable in a seven-day window — one drill has been (or will be) performed; a cadence is proven only by the second and third instances existing on schedule. See the Drill record table in `docs/runbooks/02-RESTORE_FROM_BACKUP.md`. |
| 5 | **Move every system account to an org-owned identity**, and secure a payment method for the recurring costs those accounts carry (Supabase Pro, Resend Pro during application season, Bitwarden Teams) | Project heads | `PRD.md` OQ-9, OQ-10 — a student's personal card or personal Google/GitHub account is exactly the single-point-of-failure this project exists to remove; see `docs/issues/2026-09-06-launch-debt.md` (S7-T1) for the account-by-account inventory. |

---

## Conclusion — read this before anyone drafts a submission or a public statement

**The compliance mechanisms are built and tested. The compliance paperwork has not
started.** The system must not collect real applicant data until Table 2's rows 1–3
are closed, at minimum — a DPO named, DPAs executed with the processors actually in
use, and the retention clock's start date settled and matching what the published
notice says. Rows 4 and 5 are launch hygiene, not legal blockers, but both belong in
the same handover conversation.

This file stays open. Close a Table 2 row by editing its own row to `DONE — <date>,
<link to evidence>` rather than deleting it — the history of when each was closed is
itself part of the org's compliance record.
