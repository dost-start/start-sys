# 2026-09-10 — Pre-intake data reset

**Run by:** Ethan Baltazar (CTO), via `scripts/reset-scholar-data.mjs`
**Project:** `rxtzeoodrdzpcyfkgenr` (scratch)
**Authorised by:** project head, same day, ahead of the first real intake.

---

## Symptom

Not a fault. A deliberate clear-down: the scratch project had accumulated 31 seeded demo
members, 42 applications from testing, and a handful of real submissions made while the
document store was broken. Real intake was about to start against the same project.

## What was deleted

Every person-shaped row, in FK order: `email_recipients`, `email_campaigns`,
`committee_memberships`, `department_assignments`, `member_affiliations`,
`officer_assignments`, `confidentiality_acknowledgements`, `renewal_submissions`,
`applications`, `memberships`, `people`. Every object in the `proof-of-enrollment` Supabase
Storage bucket, and every file in the Google Drive proof folder. `member_id_counters` was
cleared so the next approval issues `2026-0001`.

## What was kept, deliberately

- **All six demo logins** and their `user_roles`. An earlier plan deleted them; that was
  reversed before running, because only a `tech_admin` can grant roles and deleting every
  account is a lock-out with no in-app recovery.
- Every reference table: `regions`, `programs`, `universities`, `psgc_locations` (43,769
  rows), `officer_positions`, `departments`, `terms`, `application_windows`,
  `privacy_notice_versions`.
- **`audit_log`.** It could not have been deleted even deliberately: `0011_audit.sql`
  revokes DELETE from `service_role` itself. 315 masked rows survive, including the record
  of this reset. That is the correct outcome.

## Impact — and the part that was not anticipated

**Deleting `people` renders every admin account inoperable, silently.**

`user_roles.person_id` is nulled when the person row goes. `auth_person_id()` reads
exactly that column, and a confidentiality acknowledgement is keyed `(person_id, term_id)`
— so an account with no person row **can never hold one**, and every sensitive-column read
and every document view is refused for good (CBL Art. VIII §7.1, PRD US-J5).

It surfaced as a `500` on `GET /api/applications/[id]/proof` with no explanation, three
layers away from its cause. A CRRD reviewer would have signed in, seen the queue, clicked
a Certificate of Registration, and hit a blank error.

**This is the same hole a term rollover opens** on the morning of a new term — the "known
day-one failure mode" US-J5 describes and OQ-18 leaves unassigned to anyone. It is now
closed inside the operation that opens it: step 5 of the reset script creates a minimal
person row per account, links `user_roles.person_id`, and records a current-term
acknowledgement for the tiers that read sensitive columns (`exec_admin`, `crrd_admin`,
`regional_rep`; `tech_admin` is excluded by OQ-5, `officer` does not need one).

## Prevention

1. **`docs/runbooks/01-TERM_ROLLOVER.md` needs the same step.** `roll_over_term()` creates
   a new term, and acknowledgements are per term — so on the morning after every rollover,
   every sensitive read fails until somebody records them. The runbook currently does not
   say who does that or how. This reset is the first time the failure has actually been
   observed rather than described.
2. **No backup was taken.** Offered and declined. Recorded here because
   `docs/runbooks/02-RESTORE_FROM_BACKUP.md` has still never been drilled, and this was
   the one operation in the system with no undo.
3. The five applicants blocked by the Drive outage were deleted with everything else.
   Their addresses survive only in `.gstack/qa-reports/qa-report-start-sys-2026-09-10.md`
   (gitignored). Contacting them is a human step and is not done.

## Related

- ADR 0018 — the Drive credential change made in the same session
- `docs/issues/2026-09-06-launch-debt.md` items 9 (`DEV_DISABLE_MFA` on Production) and 3
  (no Tier-1 backups), both still open and both relevant to the paragraph above
