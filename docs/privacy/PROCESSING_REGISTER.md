# START-SYS Processing Register

**Status:** Draft, maintained by engineering as documentation of what the system does.
**Not a substitute for** a Data Protection Officer's formal Records of Processing
Activities under RA 10173 §21 and NPC Circular 16-01 — that registration has not
started (`PRD.md` OQ-2; see `docs/issues/2026-09-06-ra10173-organizational-gaps.md`).
This document exists so that work is not starting from zero once a DPO is named.

Categories below are cited to `DATA_MODEL.md` §8.1 (`sensitive_column_registry`),
which is the single source of truth for which columns are sensitive — this register
does not restate the column list, because a restated list is a list that drifts.

---

## 1. Membership application intake

| | |
|---|---|
| **Purpose** | Assess an applicant's eligibility for START-DOST membership (PRD US-B1, US-C1) |
| **Data subjects** | Applicants (accountless, anonymous until approved) |
| **Data categories** | Identity (name), contact (email, phone, address), academic (school, school ID, program, year level), a proof-of-enrollment document. Full column list: `DATA_MODEL.md` §8.1 row `applications`. |
| **Legal basis** | Consent, captured at submission against a specific notice version (`docs/privacy/PRIVACY_NOTICE.md`, `applications.consented_at` / `privacy_notice_version`) |
| **Recipients inside the org** | CCDO, CEO, COO, and Moderators reviewing that term's applications — column-GRANTed and RLS-scoped, per `ARCHITECTURE.md` §5 |
| **Processors** | Supabase (Singapore) — the application row; Google Drive **or** Supabase Storage — the proof document; Vercel (Singapore) — transiently, while handling the request |
| **Retention** | Unfinished ("draft") submissions: 30 days, then redacted (`purge_abandoned_drafts()`, `DATA_MODEL.md` §6/0008 family). Decided applications: retained as part of the resulting member record (see §2) or, if rejected, per the general application retention below. |
| **System mechanism** | `supabase/migrations/0008_applications.sql` onward; anon INSERT policy gated on an open `application_windows` row |

## 2. Member records

| | |
|---|---|
| **Purpose** | Maintain the organization's membership roll across terms (PRD item 10, item 2 "Centralization") |
| **Data subjects** | Approved members, current and historical, across all terms |
| **Data categories** | Identity, contact, academic, and membership status/history. Sensitive columns: `DATA_MODEL.md` §8.1 row `people`. |
| **Legal basis** | Consent (carried forward from the original application) and the org's legitimate interest in administering an active membership relationship |
| **Recipients inside the org** | Exec Admins and CRRD Admin in full; Moderators for records under review; Officers and Regional Representatives see only non-sensitive columns (`v_member_directory`) |
| **Processors** | Supabase (Singapore) |
| **Retention** | Five years after the member's last active term (`DATA_MODEL.md` §8.2, `redact_expired_pii()`); non-identifying fields (member ID, join year, region, status history) survive indefinitely — OQ-8 (clock start) unresolved, see the gaps issue |
| **System mechanism** | `people`, `memberships` tables; `redact_expired_pii()` |

## 3. Application and member record review

| | |
|---|---|
| **Purpose** | Enable an authorized officer to decide an application or update a member record (PRD Epic C, Epic D) |
| **Data subjects** | Applicants and members, as read by a reviewing officer |
| **Data categories** | As in §1/§2, including a proof-of-enrollment **document view** |
| **Legal basis** | Consent (from the subject) plus the org's obligation under its own Constitution (CBL Art. VIII §7.1) to gate sensitive reads on a signed confidentiality acknowledgement |
| **Recipients** | Exec Admin, CRRD Admin, Moderator only — and only with a current-term `confidentiality_acknowledgements` row |
| **Processors** | Supabase (Singapore) |
| **Retention** | The read itself is not retained; the **fact that a read happened** is retained in `audit_log` indefinitely (append-only, no DELETE policy exists) |
| **System mechanism** | `get_person_sensitive()`, the audited proof-document proxy `GET /api/applications/[id]/proof`, `assert_confidentiality_ack()` |

## 4. Audit logging

| | |
|---|---|
| **Purpose** | Attribute every significant administrative action to a responsible user (PRD item 16, US-I1) |
| **Data subjects** | Members and applicants, indirectly — as the subject of a logged action |
| **Data categories** | **Sensitive values are masked before the row is written** (`mask_sensitive()`, `DATA_MODEL.md` §8.3) — the audit log itself holds no birthdate, contact number, address, or school ID. It holds the fact that such a field changed, not the value. |
| **Legal basis** | The org's legitimate interest in accountable record-keeping, and a direct requirement of its own Constitution (CBL Art. VIII, confidentiality) |
| **Recipients** | Exec Admin and Tech Admin only |
| **Processors** | Supabase (Singapore) |
| **Retention** | Indefinite. Append-only by GRANT (`REVOKE UPDATE, DELETE`); no UPDATE or DELETE policy exists on `audit_log` for any role |
| **System mechanism** | `audit_row()` trigger, `mask_sensitive()`, `sensitive_column_registry` |

## 5. Backups

| | |
|---|---|
| **Purpose** | Business continuity — restore the database after accidental deletion, corruption, or attack (PRD item 17, US-J4) |
| **Data subjects** | Every applicant and member whose record exists at backup time |
| **Data categories** | The entire database, including every sensitive column, **encrypted before it leaves the Supabase project** |
| **Legal basis** | The org's legitimate interest in not losing its own records, and RA 10173's own security-of-processing requirement |
| **Recipients** | `tech_admin` (decryption key custody only — see `docs/runbooks/03-CREDENTIAL_ROTATION.md`) |
| **Processors** | GitHub Actions (United States) — transiently holds the encrypted archive while uploading it; Backblaze B2 (United States/EU) — at-rest storage of the encrypted archive, **not yet provisioned** (see `docs/issues/2026-09-06-supabase-free-tier-backup-gap.md`) |
| **Retention** | 30 dailies + 12 monthlies, pruned automatically (`.github/workflows/scheduled.yml`, job `backup`) |
| **System mechanism** | `age`-encrypted `pg_dump`, public key committed at `keys/backup.age.pub`, private key held offline by the CTO and escrowed with the faculty adviser |

---

## What this register does not yet cover

- **v1.1 email campaigns** (recipient filtering, mail merge, Resend delivery) — no `email_campaigns` table exists yet (`0010_email.sql` is a reserved migration number). Add a row here in the same PR that ships it.
- **v1.2 term rollover and renewal** — no new personal-data processing is introduced by rollover itself (it moves no data between processors), but the renewal form is a new collection point and needs its own row when it ships.
- **A formal legal basis assessment by counsel or a designated DPO.** This register states the basis engineering believes applies; it is not a substitute for that review (OQ-2).
