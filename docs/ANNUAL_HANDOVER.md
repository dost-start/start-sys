# ANNUAL_HANDOVER — checklist

Signed by the outgoing CTO at the end of each term (PRD US-K1, Success
Metric 7). This is a checklist skeleton — each line is completed and dated
as the corresponding runbook is executed.

## Checklist

- [ ] **All ten secrets rotated.** Every row of the inventory table in
      `docs/runbooks/03-CREDENTIAL_ROTATION.md` — the Supabase service-role
      key, `SUPABASE_DB_URL`, the Google service account key, the Resend API
      key, `JOB_SHARED_SECRET`, the Backblaze B2 application key, the `age`
      backup keypair, the Sentry DSN, the Better Stack API key, and the
      Cloudflare/domain registrar credentials — rotated, dated, and each
      confirmed working post-rotation before the old value is revoked.
- [ ] **Every console confirmed org-owned**, cross-checked against
      `docs/issues/2026-09-06-launch-debt.md`'s account inventory. Any
      console still on a personal identity is migrated before handover
      completes, not left as a note for next year.
- [ ] **Data-privacy training given to incoming officers and committee
      members**, per CBL Art. VIII §6 — the Constitution obliges the
      organization to *"provide training on data privacy best practices to
      all members,"* and the confidentiality-acknowledgement gate
      (CBL Art. VIII §7.1, `DATA_MODEL.md` §8.4) is a hard precondition for
      any sensitive-column read, not a formality: an incoming CCDO who has
      not been trained and has not acknowledged will find every sensitive
      read refused on day one, correctly. Confirm this line **before** the
      new term's first sensitive read is needed, not after someone reports
      it as a bug.
- [ ] **`tech_admin` granted to the incoming CTO before the outgoing CTO
      vacates the role.** Rollover is guarded on `tech_admin` alone and
      that role is single-occupancy (PRD.md OQ-13) — a vacant seat at term
      boundary blocks rollover until a migration unblocks it. Confirmed by
      the incoming CTO successfully reaching `/admin/system`.
- [ ] **Restore drilled by the incoming CTO**, following only
      `docs/runbooks/02-RESTORE_FROM_BACKUP.md` with no questions to the
      outgoing officer, with a dated entry recorded in that runbook's Drill
      record table naming the incoming CTO as operator (US-K1: "executed
      once by someone who did not write it"; PRD Success Metric 7).
- [ ] All five runbooks reviewed by the incoming CTO and confirmed
      executable with no questions to the outgoing officer (Success Metric
      7).
- [ ] All system accounts confirmed org-owned, never a student's personal
      identity (ARCHITECTURE.md §10).

## Sign-off

Outgoing CTO signature / date: ______________________

Incoming CTO signature / date: ______________________
