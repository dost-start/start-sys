# RUNBOOK — index

Five numbered runbooks. Each is written for someone with no prior context and
must be executable by someone who did not write it (PRD Success Metric 7,
US-K1). Link here, not scattered across other docs.

| # | Runbook | Owning role | When |
|---|---|---|---|
| 01 | [Term Rollover](runbooks/01-TERM_ROLLOVER.md) | `tech_admin` (CTO) | Once a year, end of May |
| 02 | [Restore From Backup](runbooks/02-RESTORE_FROM_BACKUP.md) | `tech_admin` (CTO) | Drilled quarterly; on real data loss |
| 03 | [Credential Rotation](runbooks/03-CREDENTIAL_ROTATION.md) | `tech_admin` (CTO) | On handover, on suspected compromise, on schedule |
| 04 | [MFA Recovery](runbooks/04-MFA_RECOVERY.md) | `tech_admin` | On a lost second-factor device |
| 05 | [Incident Response](runbooks/05-INCIDENT_RESPONSE.md) | `tech_admin` (CTO) | On any suspected security incident or outage |

See also [ANNUAL_HANDOVER.md](ANNUAL_HANDOVER.md), the checklist the outgoing
CTO signs at the end of each term.

---

## Document store swap — Google Drive ⇄ Supabase Storage

**Owning role:** `tech_admin` (CTO). **When:** OQ-1 resolves against us (no Workspace tenant
with Shared Drives), Drive credentials are lost, or the org later moves back to Drive.
**Elapsed:** about ten minutes. No code change, no migration, no schema change.

Full reasoning and the five costs are in
[ADR 0005](decisions/0005-document-store-fallback.md). Read cost 3 before you swap **to**
Storage — it is the one that keeps working while being wrong.

### Swapping to Supabase Storage

1. Set `DOCUMENT_STORE=supabase_storage` in the **Vercel Production** scope (and Preview, if
   Preview points anywhere real). Nothing else changes; `proof-of-enrollment` already exists
   from migration `0021`.
2. Redeploy. Verify with `GET /api/health/drive` — it reports the **active driver**, so the
   response must read `supabase_storage`.
3. Submit one real application end to end with a >4.5MB phone photo. Confirm
   `applications.proof_size_bytes` matches the real file size, and that the reviewer can open
   the document through `/api/applications/[id]/proof`.
4. **Blocker, not a follow-up:** add the object-sync step to
   `.github/workflows/scheduled.yml`. `supabase db dump` does **not** include storage objects,
   so until this exists the proof documents are outside the Backup & Recovery NFR entirely,
   with nothing failing to tell you (ADR 0005, cost 3).
5. Update `docs/privacy/PRIVACY_NOTICE.md`, `docs/privacy/PROCESSING_REGISTER.md` and
   `docs/privacy/DPA_REGISTER.md` to name **Supabase Storage** rather than Google Drive. A
   notice that misstates where personal data lives is worse than no notice.
6. Confirm the Supabase plan has room: ~600 applicants at ~2MB is ~1.2GB, over the Free tier's
   1GB (ADR 0005, cost 2).

### Swapping back to Drive

Order matters, and getting it wrong strands every document — there is no DELETE path anywhere
in this schema to un-strand them.

1. Provision the Shared Drive and the service account (`drive.file` scope **only** — never
   `drive` or `drive.readonly`). Set `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`,
   `GOOGLE_DRIVE_PROOF_FOLDER_ID`.
2. Run the one-time copy job: every object to Drive, then rewrite each
   `applications.proof_drive_file_id` in one audited transaction.
3. Flip `DOCUMENT_STORE=drive`, redeploy, and check `/api/health/drive` reports `drive`.
4. Spot-check that documents from **before** the swap still open through the proof proxy.
5. Only now tear down the bucket. Never before step 4.
6. If the Drive path uses an org-owned `files@` account with one-time OAuth consent rather
   than a Shared Drive: **move the consent screen from Testing to In production.** Refresh
   tokens issued in Testing expire after seven days, and a Drive integration that dies every
   Monday after handover is the most likely way this feature breaks post-handover
   (ARCHITECTURE.md §4.1).

### What must never change during a swap

The `applications` table. `proof_drive_file_id` is provider-opaque by contract — a Drive file
id under one driver, an object path under the other — and nothing outside `lib/documents/`
interprets it (DATA_MODEL.md §6/0008). If a swap looks like it needs a migration, something
outside `lib/documents/` has started reading that column's contents, and that is the bug.

## Send a campaign (email or a form link)

**Who:** the CCDO or a CRRD deputy (`crrd_admin`), or the CEO/COO (`exec_admin`). Nobody else sees `/campaigns`; the database refuses everyone else independently of the screen (migration `0043`).

**Before the first real send:** `MAIL_TRANSPORT=gmail_smtp` with `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`, `MAIL_FROM_NAME` and `MAIL_REPLY_TO` set in the Vercel Production scope (runbook 03, row 11). With `MAIL_TRANSPORT=fake` the whole flow runs but nothing leaves the server — that is the setting for previews and local work.

1. `/campaigns` → **New campaign**. Pick a template (the three form sends carry the link to this site's public form) or Freeform.
2. Edit the subject and message. Formatting is Telegram-style (`**bold**`, `_italic_`, `[label](https://…)`, `- ` lists). Merge fields are `{{given_name}}`, `{{family_name}}`, `{{member_id}}`, `{{join_year}}`, `{{region_name}}`, `{{island_group}}`, `{{term_label}}`, `{{year_level}}`, `{{committee_name}}`, `{{department_name}}` — nothing else can be merged, and an unknown token blocks saving.
3. Choose the audience: status, year of membership, island group, region, role, affiliation, department, committee, university, year level. The people the filters match appear below as a tick list — name, member ID, region, department, committee, position, **never an email address** — so you can untick anyone the filters over-caught, or search by name or member ID to tick in someone the filters missed. The count shown is the count the send uses — same database function — and past **~400 people** a note explains that Gmail's daily limit means the send will run into a second day and resume on its own (see below).
4. **Save draft** → the campaign page. **Freeze the recipient list** writes one row per recipient; nothing is sent yet.
5. **Send now.** Leave the page open; it sends 25 at a time and shows progress. Closing the page mid-way is safe: **Send** again later resumes and never re-sends anyone (each recipient row is marked in the database).
6. The delivery report at the bottom lists every recipient as sent or failed with the reason.

**If it stops with "sending limit reached":** the Gmail account's daily cap (~500 messages on a consumer account) was hit. The remainder stays queued; come back the next day and click **Resume sending** (the same button, now relabelled, on the same campaign page) and it picks up where it left off without re-sending anyone. A 600-person blast therefore takes two days on Gmail — plan acceptance emails accordingly, or move to Workspace/Resend (env flip, ADR 0010).

**What "Sent" means:** the mail server accepted the message. Gmail SMTP has no bounce reporting; a bounced address shows up as a bounce email in the sending inbox, not in the report.

**Audit:** freezing a campaign writes one `CAMPAIGN_QUEUED` row to the audit log naming the officer. The frozen filter is stored on the campaign so the recipient list can be reproduced.
## Open the renewal period and review renewals

**Who:** the CCDO or the CTO opens the period (ADR 0003); the CCDO or a CRRD deputy (`crrd_admin`), or the CEO/COO (`exec_admin`), reviews. Members have no accounts — the form is public and the scholar proves who they are with their member ID and the email on file.

1. `/applications/window` → **Schedule the renewal period**. Set the opening and closing times (Asia/Manila) and click **Open the period**. Closing takes effect on the next submission: the check is in the database, not a cache.
2. Send the renewal announcement: `/campaigns` → **New campaign** → template *Membership Renewal Form*. It links to `/renew` and merges each scholar's member ID into the message.
3. Scholars submit at `/renew`: member ID + email (both must match the record), updated details, the latest registration form and the Notice of Award. A wrong pair is told so at once; the form is rate-limited exactly like `/apply`.
4. `/renewals` lists pending renewals for the term. Open one — that read is recorded in the audit log — check the two documents, then **Approve renewal** or **Reject** with a written reason (10+ characters).
5. Approval creates the scholar's **active membership for the current term** and applies the updated contact and academic details to their record. **The member ID does not change** — `2024-0012` renews as `2024-0012`. A rejected scholar may submit again while the period is open.

**Not eligible through the form:** a member whose latest membership is `terminated` (CBL Art. VII §3 — reinstatement is an Executive Board act on the existing record), and anyone already active this term. Both get a generic "cannot be renewed through this form" message and are told to contact CRRD.

**Abandoned drafts** (identity verified, documents never uploaded) are redacted after 30 days by the same nightly job that sweeps application drafts.

## Close the period, then Approve all

**Who:** `exec_admin` or `crrd_admin`. Decisions on membership applications and renewals happen **once, in a batch, after the period ends** (ADR 0013 §2) — not per row throughout the window. Rejecting an individual application or renewal before the batch runs still works exactly as before; it is CRRD's override.

1. Close the application period first: `/applications/window` → close the `membership_application` window (close `membership_renewal` too if renewals are being decided in the same pass). **Approve all pending refuses outright while a `membership_application` window for the current term is still open** — this is not a mid-period auto-approve, and the refusal names the reason.
2. Go to `/applications`. Every `pending` row now carries a **Standards** column: `✓ meets` means the submission already cleared the standards below; `✗` lists which ones it failed. A row cannot normally reach `pending` and fail a standard at all — the identical check already ran at submission on both the application and renewal forms — so a `✗` here almost always means something changed *after* the applicant submitted: a program or university was deactivated, the active term changed, or the applicant's own membership was terminated in the meantime. Use this to look before the batch commits, not as a reason to distrust the queue.
3. Click **Approve all pending**. In one pass this approves every still-`pending` application and renewal in the current term that meets the standards, minting member IDs through the existing allocator (US-C3) and, for a renewal, keeping the member's original ID unchanged (US-H5). A row that fails a standard is **skipped**, not approved. A row that errors for any other reason (a race with something else touching it, a data problem the standards check does not catch) is reported **failed** so it can be looked at individually rather than silently disappearing from the queue.
4. Read the skipped and failed lists the dialog shows — by id, never by name, because the dialog is a batch receipt, not a review screen. For a skipped row, either reject it with a written reason if CRRD has decided against it, or leave it as `pending` for the applicant to correct and resubmit. For a failed row, open it at `/applications/[id]` (or `/renewals/[id]`) and decide it individually the way every application was decided before this feature existed.
5. Send the acceptance campaign: `/campaigns` → the acceptance template, which mail-merges each recipient's new member ID (US-C5). The batch, not a per-application send, is what feeds this — nobody is emailed a member ID until "Approve all pending" has actually run.

**What "meets standards" checks** (`check_submission_standards()`; the same six checks run at submission on both forms, and are only re-run here informationally): `expected_grad_year` is later than the current term's end (not yet graduated); the chosen program is an active seeded row, never free text; the chosen university is an active seeded row; the declared DOST scholarship award is one of the five recognized award types; the award year is a real four-digit year; and the applicant's email does not belong to a `people` row whose latest membership is `terminated` (CBL Art. VII §3) — refused generically, without saying why, the same posture `finalize_application()` already takes on a duplicate email. A seventh precondition gates the whole batch rather than any one row: there must be an active term at all.

**Not a standard, and never will be:** whether the uploaded Notice of Award is genuine, or whether DOST has separately ended someone's scholarship. Both need a human to read a document CRRD can already see on the application — that control is unchanged by this feature.

**A second click is a no-op.** `approve_all_pending()` only ever acts on rows still `pending` in the current term. Once everyone eligible has been decided, running the batch again approves nothing and reports zero counts for every field — it does not error, and it does not re-decide anything already approved or rejected.

## Appoint or separate an officer

At **/officers** (Executive Admin and CRRD Admin only), the roster lists every CBL position for the current term with its holder(s). A position with no holder is vacant — CBL Art. VI §4: a vacancy is the absence of a row, never a stored status.

- **Appoint** (a vacant seat, or an acting seat under Art. VI §4.1–4.3): open *Appoint* on the position, enter the person's member ID and confirm the match, tick *Acting appointment* if it is one, and write a note naming the constitutional basis and — when you are not the decider — who decided. The CEO or the Executive Board still makes every Art. VI decision; this screen records that one happened (ADR 0012).
- **Record a change of standing** — leave, return from leave, suspension, acquittal, resignation, dismissal, impeachment, or end of service: open *Record separation* on the holder's row and choose from the statuses the Constitution allows from their current standing. A status the Constitution does not allow (an impeached officer moving anywhere) does not appear.
- Neither action grants a login or an access tier. That stays with the CTO at System → User roles.
- Every appointment and change of standing lands in the audit log under the recording officer's identity, whichever of the two tiers recorded it.
