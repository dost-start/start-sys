# ADR 0012 — CRRD admins record officer appointments and separations, for any position

**Date:** 2026-09-06
**Author:** Ethan Baltazar (decision), drafted with Claude
**Status:** Accepted
**Affects:** the `officer_assignments` write policy (a NEW migration — 0014 is applied and is
never edited); a new `/officers` surface (route groups are URL-invisible); DATA_MODEL.md §3.4;
ARCHITECTURE.md §5; PRD.md §2.

---

## Context

Today, per DATA_MODEL.md §3.4 and ARCHITECTURE.md §5, **every** write to
`officer_assignments.status` — appointment, acting designation, leave, suspension,
resignation, dismissal, impeachment, end — is `exec_admin` only (CEO/COO). DATA_MODEL §3.4
states this in as many words: *"Every transition is `exec_admin`. This follows from the
locked role model, not from a reading of the CBL... It happens to line up with Art. VI,
where the CEO or the Executive Board decides every one of these."* No screen exists for it
at all — BUILD_PLAN's coverage matrix defers the officer-standing editing UI, so the only
way to record a separation today is a hand-run `UPDATE` by an `exec_admin`.

At the 2026-09-05 team meeting, CRRD asked for a "special appointment" capability. Ethan
clarified on 2026-09-06 what it is for: a special appointment happens **when an officer
leaves a post** — AWOL, retirement, any Art. VI separation — and the replacement should be
appointed **through CRRD**, because "it's an HRM system that will be used by CRRD... it'll
be the centralized system for everyone to base upon." The request is for CRRD to be the
org's HR-records desk for every position, not only for its own department's.

This is not a new pattern in the schema — it already exists once, narrower. ARCHITECTURE §5
flags that CBL Art. VI §1.6 makes the **DCOO** the officer who issues the AWOL notice, yet
the DCOO holds `officer` (read-only); *"the notice is issued by the DCOO outside the system
and the resulting `dismissed` flip is recorded by an `exec_admin`, with the DCOO named in
`status_note`."* The system has never required the person typing the row to be the
constitutional decider — it only required the row to say who was. This decision generalizes
that same recorder/decider split across all of Art. VI, and adds a second recorder.

**What this decision does not touch.** CBL Art. VII §3 — termination of *membership*, on
`memberships.status`, decided by a majority vote of the Executive Board (§3.2.3) — is a
different Article, a different table, and DATA_MODEL §3.1 already treats it as narrower than
every other membership transition. It stays `exec_admin` only. Conflating Art. VI (office)
with Art. VII (membership) is, per DATA_MODEL §3.1/§3.4, *"the single most likely future
mistake in this schema"* — this ADR is careful not to make it.

## Decision

**CRRD admins (`crrd_admin`) may INSERT and UPDATE `officer_assignments`, for any position,
on the same terms `exec_admin` already can — no DELETE, none exists anywhere and none is
added here.**

The Art. VI decider stays who Art. VI says it is: the CEO approves leave (§1.2) and
resignation (§2.2); the Executive Board votes to impeach (§3.2.7); the DCOO issues the AWOL
notice (§1.6) that leads to dismissal (§1.7). **CRRD's write is a record of a decision made
outside the system**, exactly the shape already in use for the DCOO/AWOL case — this ADR
just makes `crrd_admin` a second holder of that same recorder role, so the DCOO's dismissal
can now be entered by crrd_admin as readily as by exec_admin. `status_note` stays mandatory
and must name the constitutional basis and, when the person keying the row is not the
decider, who the decider was — the existing convention, applied consistently rather than
only to the one flagged case.

**Defaults below, each to confirm with Ethan — none of them widens beyond what is stated:**

- **(a) Access follows separately.** Creating or changing the person's login account and
  `org_role` stays `tech_admin`-only (CTO/DCTO-PD) — ARCHITECTURE §5: *"Only role that can
  write `user_roles`."* An appointment recorded here does not, by itself, grant a system
  account or a capability; `officer_assignments` is the constitutional record of *who holds
  a position*, `user_roles` is the live *what may this account do*, and this ADR only
  touches the former. Appointing someone CTO through this screen does not make them
  `tech_admin` until the CTO/DCTO-PD separately grants that role.
- **(b) Acting designations record the same way.** Art. VI §4.1–4.3 (COO assuming CEO
  duties, the CEO designating an acting officer, a Chief absorbing a vacant deputy) are
  recorded through the same write, flagged `is_acting`, per DATA_MODEL §3.4's *"Acting
  officers get a column, because they get powers."*
- **(c) The existing structural guards are untouched.** The one-sitting/one-acting-officer
  partial unique indexes and `reject_write_to_archived_term()` still apply; vacancy stays a
  query (`NOT EXISTS`), never a stored status.
- **(d) The constitutional invariants are untouched.** The administrator CHECK and the
  seven-departments invariant do not change. Recording an appointment is not the same act as
  granting the tier that appointment might imply — see (a).

**Membership termination (Art. VII §3.2.3) is explicitly not widened** and stays
`exec_admin` only; this ADR touches `officer_assignments`, never `memberships.status`.

## Consequences

**Good**

- CRRD gets the records-desk power it asked for, for any of the 23 seeded positions, without
  a per-department carve-out — matching Ethan's "any position, it's the centralized system"
  framing directly.
- It resolves the operational half of PRD OQ-16 (the DCOO/AWOL divergence) without granting
  the DCOO write access and without a quiet fifth administrator tier — the outcome
  ARCHITECTURE §5 already said that divergence needed a project-head decision to move, and
  this is that decision, generalized rather than special-cased to the DCOO alone.
- The audit trail is the accountability mechanism: `officer_assignments` already carries the
  `audit_row()` trigger (DATA_MODEL §8.3), so every appointment or separation is attributable
  to the acting user regardless of which of the two tiers recorded it.

**Costs, accepted**

- A migration widens the `officer_assignments` write policy from `('exec_admin')` to
  `('exec_admin','crrd_admin')` for INSERT and UPDATE (no DELETE policy exists or is added).
- pgTAP's constitutional invariant in DATA_MODEL §9 — *"only `exec_admin` fixtures can write
  ... any `officer_assignments.status`"* — becomes *"`exec_admin` and `crrd_admin`; `officer`,
  `regional_rep` and `tech_admin` still refused"*, with a deny assertion added per role.
- A new `/officers` screen, for `exec_admin` and `crrd_admin` only: this term's
  positions and holders, vacancies (computed, per §3.4(c)), an appoint action (substantive or
  acting) with a mandatory note, and a record-separation action naming the Art. VI ground.
- DATA_MODEL.md §3.4 ("Every transition is `exec_admin`"), ARCHITECTURE.md §5 (the `exec_admin`
  row's "sole writer of ... every `officer_assignments.status` transition", and the DCOO
  divergence callout), and PRD.md §2 (the Executive Admin / CRRD Admin CAN/CANNOT columns) are
  updated in the same PR that ships the migration — not deferred.

**Risk, named rather than hidden**

- This makes CRRD the operational HR desk for powers the CBL vests in the CEO or the
  Executive Board (LOA approval §1.2, resignation approval §2.2, the impeachment vote
  §3.2.7). A row in `officer_assignments` no longer implies its writer was the constitutional
  decider — it implies someone with `crrd_admin` or `exec_admin` recorded that a decider,
  elsewhere, made the call. **Mitigation:** the audit trigger plus the mandatory
  constitutional-basis note make every entry attributable and checkable after the fact,
  which is the same mitigation the DCOO/AWOL divergence already relied on. If the project
  heads later prefer exec-only recording, narrowing back is one policy migration — the exact
  mirror of this one.
- Who holds `crrd_admin` — the CCDO, DCCDO-C and DCCDO-D (ADR 0009, migration 0036) — is
  **not** decided by this ADR. The grant here follows the tier, whatever it is, and needs no
  second migration when that tier's membership changes.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Widen only for positions outside CRRD's own department | Ethan's stated intent is "any position" — a departmental carve-out invents a second boundary nobody asked for and one the CBL does not draw. |
| Give `crrd_admin` the Art. VI *decision* itself (e.g. approve leave directly) | Art. VI names the CEO or the Executive Board as decider. Moving the decision, not just the record of it, is a materially different change and needs its own project-head sign-off, not a records-desk feature. |
| Route this through `officer_positions.grants_org_role` | That column is a provisioning hint for `user_roles` (DATA_MODEL §6/0016), not a records-write gate. Reusing it would conflate "may hold this position" with "may write this table" — exactly the kind of drift §2.1's naming rule exists to prevent. |
