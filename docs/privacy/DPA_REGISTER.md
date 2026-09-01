# START-SYS Data Processing Agreement Register

**Status: every row below is `NOT EXECUTED`.** RA 10173 §14 and NPC guidance require a
written agreement with any third party processing personal data on the org's behalf.
None has been signed. This is not an oversight to quietly fix — it is a real
organizational gap, gated on decisions engineering cannot make (see
`docs/issues/2026-09-06-ra10173-organizational-gaps.md`, which this register links
back to).

**Why none is executed yet:**

1. A DPA needs a signature from an **authorized org signatory** on the START-DOST side.
   No Data Protection Officer is designated and no signatory authority has been
   confirmed (`PRD.md` OQ-2).
2. Several processors below (Resend, Backblaze B2) are not yet provisioned at all —
   there is nothing to sign a DPA *about* until an account exists.
3. Executing seven DPAs is a legal and administrative task, not an engineering one. It
   cannot be completed inside a seven-day build window by the people who wrote this
   register.

**What this register is for anyway:** so that once a DPO is named, the first task is
"sign these seven, most of which have a standard template already," not "figure out
which processors exist."

---

| # | Processor | Role | What it processes | Location | DPA / standard terms available | Status |
|---|---|---|---|---|---|---|
| 1 | Supabase | Database hosting; **the system of record** for every application and member row | All personal data in the system, including sensitive columns | Singapore (`ap-southeast-1`) | Yes — Supabase publishes a standard DPA at supabase.com/legal/dpa | **NOT EXECUTED** |
| 2 | Vercel | Application hosting; runs the Next.js app that reads and writes the above | Transiently, every field the app touches while serving a request; retains nothing itself | Singapore (function region `sin1`), edge network is global | Yes — Vercel publishes a standard DPA | **NOT EXECUTED** |
| 3 | Google (Drive) | Proof-of-enrollment document storage, `drive.file` scope only | The uploaded Certificate of Registration / scholar ID; never the database record | Google-managed, not disclosed per-file | Yes — Google Workspace/Cloud DPA, part of the Workspace terms | **NOT EXECUTED** — also contingent on OQ-1 (does the org have a Workspace tenant at all) |
| 3b | Supabase Storage *(fallback, ADR 0005)* | Alternative proof-of-enrollment storage if Drive is unavailable | Same as row 3 | Singapore, same project as row 1 | Covered by the same Supabase DPA as row 1 if that is executed | **NOT EXECUTED — not currently active** (see `/api/health/drive` for the live driver) |
| 4 | Resend | Outbound email — Supabase Auth SMTP today (invitations, password resets); campaign sends in v1.1 | Recipient email address, and in v1.1, mail-merge fields from `v_email_merge_fields` (non-sensitive only) | United States | Yes — Resend publishes a standard DPA | **NOT EXECUTED — not yet provisioned** |
| 5 | GitHub (Actions) | CI/CD runner; produces the nightly encrypted backup and runs scheduled jobs | Transiently holds the **encrypted** database archive during the backup job; the plaintext dump is deleted within the same job step before upload | United States | Yes — GitHub publishes a standard DPA as part of its Enterprise/organization terms | **NOT EXECUTED** |
| 6 | Backblaze (B2) | Off-provider encrypted backup storage | The **encrypted** nightly/monthly database archive only — Backblaze never holds a decryption key | United States / European Union (bucket region choice) | Yes — Backblaze publishes a standard DPA | **NOT EXECUTED — not yet provisioned**, see `docs/issues/2026-09-06-supabase-free-tier-backup-gap.md` |
| 7 | Sentry | Error tracking | Scrubbed error events only — `beforeSend` strips request bodies, cookies, and any field named in `sensitive_column_registry` before an event leaves the process (`docs/runbooks/05-INCIDENT_RESPONSE.md`) | Configurable at signup; not yet chosen | Yes — Sentry publishes a standard DPA | **NOT EXECUTED** |

## What "not executed" means operationally

None of this blocks the system from functioning technically — RLS, column GRANTs, the
audit log, and the encryption-before-upload backup design are all real controls that do
not depend on a signed piece of paper. What it blocks is **collecting real applicant
data in good conscience under RA 10173**, which requires the org to have its
processing relationships on a documented legal footing, not just a technically sound
one. `docs/issues/2026-09-06-ra10173-organizational-gaps.md` states this as the
conclusion: mechanisms are built and tested; this paperwork has not started; do not
collect real applicant data until it has.

## Update discipline

Add a row here in the same PR that provisions a new processor. A processor with no row
in this table and no row in `PROCESSING_REGISTER.md` is a processor nobody has
accounted for.
