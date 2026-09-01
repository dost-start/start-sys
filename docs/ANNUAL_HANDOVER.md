# ANNUAL_HANDOVER — checklist

Signed by the outgoing CTO at the end of each term (PRD US-K1, Success
Metric 7). This is a checklist skeleton — each line is completed and dated
as the corresponding runbook is executed.

## Checklist

- [ ] **Credential rotation completed.** Every credential in
      `docs/runbooks/03-CREDENTIAL_ROTATION.md`'s inventory rotated, dated,
      and confirmed working post-rotation.
- [ ] **`tech_admin` granted to the incoming CTO before the outgoing CTO
      vacates the role.** Rollover is guarded on `tech_admin` alone and
      that role is single-occupancy (PRD.md OQ-13) — a vacant seat at term
      boundary blocks rollover until a migration unblocks it. Confirmed by
      the incoming CTO successfully reaching `/admin/system`.
- [ ] **Restore drilled** within the last quarter per
      `docs/runbooks/02-RESTORE_FROM_BACKUP.md`, with a dated entry in that
      runbook's Drill record table, performed by someone other than the
      outgoing CTO if possible (US-K1: "executed once by someone who did
      not write it").
- [ ] All five runbooks reviewed by the incoming CTO and confirmed
      executable with no questions to the outgoing officer (Success Metric
      7).
- [ ] All system accounts confirmed org-owned, never a student's personal
      identity (ARCHITECTURE.md §10).

## Sign-off

Outgoing CTO signature / date: ______________________

Incoming CTO signature / date: ______________________
