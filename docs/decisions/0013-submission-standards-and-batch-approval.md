# ADR 0013 — Submission-time standards, and approval as one post-period batch

**Date:** 2026-09-06
**Author:** Danielle Quiambao (standards), Ethan Baltazar (decisions), drafted with Claude
**Status:** Accepted
**Affects:** `lib/applications/{schema,actions}.ts`, `lib/applications/renewal-{schema,actions}.ts`
(branch `feat/renewal-form`), a new `approve_all_pending()` definer, the applications and
renewals review queues, `docs/RUNBOOK.md`

---

## Context

The CCDO (Danielle Quiambao), 2026-09-05, on how membership applications should be decided:

> "Automatic sa system basta nameemet nya yung standards (valid noa and hindi pa
> graduate/invalid/terminated), sa committees kami mag approve." — *It's automatic in the
> system as long as it meets the standards (valid NOA, and not yet graduated / invalid /
> terminated); for committees, we approve ourselves.*

Ethan Baltazar (project head) answered the follow-up questions on 2026-09-06; those
answers are what this ADR records.

Two of the four named standards are not machine-checkable: "valid NOA" and "invalid" (DOST
ending a scholarship) both require reading a document or knowing the real-world scholarship
roll, which this system does not do (PRD §4; the Addendum only requires the file be
attached and reviewable, US-B2). "Not yet graduated" and "terminated" are already data the
schema holds. So "automatic" resolves to: **the checkable standards are enforced as
submission-time validation**, refusing a non-qualifying submission before it is ever stored
as `pending` — extending US-B1's "validation of required fields and formats before
submission is accepted" past format checks into eligibility checks — while the two
standards needing a human stay a document CRRD looks at (US-C1).

A standards-only pipeline that minted member IDs the instant a submission passed would
abolish "pending" and the post-period review step the PRD's own flow assumes (submit →
pending → decision **after the application period** → member ID → acceptance emails —
§3 items 7–9, US-C1, US-G7). It would also spread `member_id` allocation across the whole
window instead of one clean sequence (US-C3; ARCHITECTURE §6's counter table assumes bursty
allocation). Ethan's answer keeps the standards as a **gate at submission** and keeps the
**decision** — now one batch click instead of one click per row — where the PRD already
puts it, with CRRD able to pull a row out of the batch by rejecting it first.

---

## Decision

### 1. Standards, enforced server-side at submission, on both forms

A submission failing any check is refused **at submission** — the applicant sees which
check failed and nothing is written as `pending`. Same shape as every server-side
validation in this system (CONVENTIONS §6): one schema, re-checked in the Server Action.

1. **Documents present.** Both files attached: latest registration form (proof of current
   enrolment) and Notice of Award (NOA). "Valid NOA" = file attached + applicant-selected
   award type and year; the system does not read the PDF (see Risks).
2. **Currently enrolled, not graduated.** `expected_grad_year` is later than the year the
   relevant term ends (applied-into term, or renewed-into term). Reuses the predicate
   `DATA_MODEL.md`'s `renewal_eligible_people()` already computes, now also as a
   submission-time gate (see Costs — does not resolve OQ-3 in general).
3. **Eligible program.** `program_id` names one of the thirteen seeded `programs` rows
   (OQ-17, closed list) — enforced structurally by a closed `<select>`, no free text.
4. **Eligible university.** `university_id` names a row in `universities` (starter list;
   CRRD edits — SCRATCH §I.2). Same closed-`<select>` enforcement.
5. **Not a terminated member.** The email does not match a `people` row whose membership
   is `terminated` (CBL Art. VII §3). Refused **generically** — *"this email cannot be
   used to apply — contact CRRD"* — never naming the reason, mirroring the anti-
   enumeration posture `finalize_application()` already takes on a duplicate email.

**Not a standard, by design:** "DOST ended the scholarship" is not machine-checkable. The
control is unchanged — the NOA upload plus a CRRD reviewer looking at the queue.

### 2. Decisions happen once, in a batch, after the period closes

- **"Approve all"**, one click, scoped to `current_term_id()`: approves every still-
  `pending` application **and** renewal submission in the term in one pass, minting member
  IDs through the existing `approve_application()` / `approve_renewal()` machinery
  (US-C3's allocator, US-H5's "renewal never renumbers" — unchanged, only looped).
  *(Renewals inside the same batch is the default reading — to confirm with Ethan.)*
- Guarded to `exec_admin` and `crrd_admin` — the same guard those functions already carry;
  no new role.
- **Idempotent**: an already-`approved` row is skipped, not re-decided (US-C2, US-C3).
  Running the batch twice changes nothing.
- **One audit row per underlying decision**, not one for the batch — `audit_row()` fires
  per `approve_application()`/`approve_renewal()` call exactly as today, so "who decided
  this application" (US-I1) stays answerable per row.
- **Refuses while the application window is still open** — the batch cannot run mid-
  period. *(Default reading of US-C1/US-G7's "after the application period" — flagged for
  CRRD to confirm, per CLAUDE.md's rule on unstated requirements.)*
- **Individual approve/reject stays**, as CRRD's override: rejecting a row before the
  click removes it from the batch (US-C2).
- **The queue shows "meets standards: yes/no" per pending row**, re-running §1's predicate
  against the stored row — informational, since a failing row cannot exist as `pending`
  under the new gate; a second look before the batch commits.
- **No rejection email for a failed standard** — it never becomes a stored `pending` row,
  so there is nothing to notify; the applicant already saw the refusal in the browser.

### 3. Acceptance emails follow the batch (v1.1, unchanged mechanism)

After "Approve all", CRRD sends one campaign on the existing acceptance template,
mail-merging each recipient's new member ID (US-C5). This ADR does not build the
campaign — it records that the batch, not a per-application send, feeds it.

### 4. Renewal carries the same standards, one different gate

Same five standards, with §5 restated: **any membership not currently `terminated` may
renew** while a renewal window is open — no "was active last term" condition. The renewal
form keeps asking name, birthdate, email **and** member ID so CRRD can cross-check against
the record; approval never overwrites those four fields. Member ID is never reissued
(US-H5) — approval only inserts the new term's `memberships` row, as `approve_renewal()`
on `feat/renewal-form` already does.

---

## Consequences

**Good:** "automatic" gets a precise, testable meaning — a non-qualifying submission is
refused the moment it is made, not discovered later in a queue. The PRD's pending →
decide-after-period → member-ID → acceptance-email order is preserved. One batch means one
clean member-ID sequence rather than allocation spread across the window. CRRD keeps a
real override via reject-before-batch.

**Costs, stated plainly:**
- Does **not** resolve OQ-3 in general — reuses the existing predicate for one submission
  gate only. Who is *offered* the renewal form by campaign (US-G7's recipient list, via
  `renewal_eligible_people()`) is untouched and still requires `status='active'` last term.
- The renewal **form's** acceptance ("any non-terminated member") is wider than that
  campaign function's targeting ("active last term"). Flagged, not silently reconciled: a
  member who lapsed but is not terminated can now submit even if never emailed the form.
- Home address (`address_line`, `city_municipality`, `province`, `postal_code`) returns to
  both forms — columns already exist, nullable (SCRATCH §C) — a payload change, not a
  migration. `school_id_no` is removed from every screen now; the column drop is a
  **separate, later cleanup migration**, named here so it is not forgotten or done piecemeal.
- New surface needs its own tests: `approve_all_pending()`'s role guard, idempotency, and
  window-open refusal; the five standards on both schemas; the queue's standards flag. The
  apply and approve smoke flows need updating for the new refusal messages and the batch
  control — no new locked flow file is added.

**Risks:** a typo in `expected_grad_year` (or any standard) is refused with a field-named
error and the applicant resubmits — acceptable, same shape as every other eligibility
check US-B1 already makes. The terminated-email check is a mild probe surface, bounded by
the existing limiter on `startApplication()`/`start_renewal()` (3/hour per email, 10/hour
per IP, BUILD_PLAN S3-T7) — no new limiter introduced. "DOST ended the scholarship" stays
an unverifiable human judgment call — a residual gap, not a regression.

**Everything not listed stays as is:** RLS is still the boundary, no DELETE policy is
added, `audit_row()` covers every new write as it covers every existing one, and the manual
per-row approve/reject path is joined by the batch, not replaced by it.

---

## Verification (to add, not yet built)

- pgTAP: `approve_all_pending()` deny-per-fixture except `exec_admin`/`crrd_admin`;
  idempotent on a second call; refuses with the window open; one audit row per decision.
- pgTAP: each of the five standards, both forms — a violating payload never reaches
  `pending`; a fully-qualifying one is accepted.
- Vitest: the shared standards predicate, used identically by both schemas.
- Playwright: extend the apply and approve smoke flows for the new refusals and the
  one-click, idempotent batch.
