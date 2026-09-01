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
