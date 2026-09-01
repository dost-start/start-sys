# Data Breach Notification Template — National Privacy Commission

**Purpose:** RA 10173 §20(f) and NPC Circular 16-03 require notification to the National
Privacy Commission **within 72 hours** of knowledge of, or reasonable belief that, a
personal data breach has occurred and is likely to give rise to a real risk of serious
harm. This template exists so that on the day it is needed, the org is filling in blanks
against a form written on a calm day — not drafting legal language while also containing
an incident.

**Trigger:** the 72-hour clock starts at **confirmed or reasonably suspected**
disclosure, not at the end of a full investigation. If the severity ladder in
`docs/runbooks/05-INCIDENT_RESPONSE.md` names this SEV1, start this document immediately
and keep updating it as facts firm up — do not wait for certainty to start the clock.

**Who files it:** the org's designated Data Protection Officer. **None is currently
designated** (`PRD.md` OQ-2) — until one is, the CCDO is the interim contact and should
escalate to the project heads and the faculty adviser immediately on triggering this
template, because filing with the NPC is an act only an authorized org officer can take.

---

## 1. Nature of the breach

- **Date/time the breach occurred** (or best estimate): `___________`
- **Date/time the breach was discovered**: `___________`
- **How it was discovered**: `___________` *(e.g. Better Stack alert, audit log anomaly, a report from a member, the `rr-scope-leak` or middleware-off checks catching a real regression)*
- **Description of what happened**: `___________` *(plain factual account — what failed, e.g. "a policy migration widened the `officer` SELECT policy on `people` to include `birthdate` for 40 minutes between deploy X and rollback Y")*
- **Root cause**, if known: `___________`
- **Whether the breach is ongoing or contained**: `___________`

## 2. Scope

- **Number of data subjects affected** (or best estimate; state the basis for the estimate): `___________`
- **Categories of data subjects**: `[ ] Applicants  [ ] Members  [ ] Officers  [ ] Other: ___________`
- **Categories of personal data involved** (cite `DATA_MODEL.md` §8.1 rows, do not restate column names in this document if it will be attached to a public-facing notice): `___________`
- **Sensitive personal information involved?** `[ ] Yes  [ ] No` — under RA 10173, sensitive personal information (health, government ID numbers, etc.) triggers mandatory notification regardless of risk level; a school ID number likely qualifies. If yes, notification to the NPC is **mandatory**, not discretionary.
- **Was the data encrypted, hashed, or otherwise rendered unintelligible to an unauthorized recipient?** `___________` *(relevant to whether the breach reaches "real risk of serious harm")*

## 3. Measures taken

- **Immediate containment steps** (e.g. Vercel rollback to build `___________`, credential rotated per `docs/runbooks/03-CREDENTIAL_ROTATION.md`, policy migration reverted): `___________`
- **Steps taken to prevent recurrence**: `___________`
- **Whether affected individuals have been or will be notified directly**, and how: `___________` *(RA 10173 generally requires notifying affected data subjects as well as the NPC, unless the Commission determines notification is not required)*

## 4. Contact information

- **Org name**: START-DOST
- **Data Protection Officer** (or interim contact): `___________` — as of this template's authoring, the CCDO (see `PRD.md` OQ-2)
- **Email**: `___________`
- **Phone**: `___________`

## 5. Evidence to attach

- Relevant `audit_log` rows (exported by an Exec Admin or Tech Admin — the only two roles with read access)
- The incident timeline from `docs/runbooks/05-INCIDENT_RESPONSE.md`'s working notes for this incident
- The Vercel deployment history showing the bad build and the rollback, if applicable
- The Better Stack incident record, if the breach coincided with an availability event

---

## Filing

The NPC accepts breach notifications through its official channels (see
[privacy.gov.ph](https://privacy.gov.ph) for the current submission process — this
template does not attempt to mirror the NPC's own form, which may change independently
of this repository). File **within 72 hours of trigger**, even with sections above marked
incomplete; a notification stating "investigation ongoing, updated notification to
follow" is expected and accepted practice, and is better than a late complete one.

## After filing

1. Record the filing (date, who filed, NPC reference number if issued) in
   `docs/issues/` as a dated incident file, cross-referenced from
   `docs/runbooks/05-INCIDENT_RESPONSE.md`.
2. If the breach exposed system data (not just process failure), confirm whether an
   affected-individual notification is also required and, if so, that it happened.
3. Update `docs/privacy/PRIVACY_NOTICE.md` if the incident reveals the notice
   understated a risk or misdescribed a processor.
