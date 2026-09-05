# ADR 0009 — Access tiers follow the CRRD SRS: seven administrators, no moderator, no member accounts

**Date:** 2026-09-05
**Author:** Ethan Baltazar (project head), from the team meeting of 2026-09-05 and the CCDO's
"Questions Roles and Features" document (the SRS)
**Status:** Accepted
**Supersedes:** the project-head role split of 2026-09-01 recorded in `PRD.md` §2,
`ARCHITECTURE.md` §5 and `DATA_MODEL.md` §3/§6 (four administrators; a `moderator` tier for
the DCCDO-C, DCCDO-D and DCTO-PD; a `member` tier with a portal)
**Implemented by:** migration `0036_srs_role_tiers.sql`

---

## Context

On 2026-09-01 the project heads split the PDF's "Administrators" into four named seats and
carved the three deputies out into a `moderator` tier — operations yes, structure and access
control no. That split was ours; the PRD's source PDF never named it, and the open-question
register carried its cost as OQ-13 (rollover blocked while the single `tech_admin` seat is
vacant), OQ-14 (what a moderator may do) and OQ-16 (the DCOO).

On 2026-09-05 the CCDO supplied the org's own statement of who may do what — the SRS — and the
team met on it. The SRS groups access by **department**, not by seat:

| SRS group | Positions | Capability, verbatim |
|---|---|---|
| Administrators — CEO & COO | CEO, COO | "Oversee the overall records of START-DOST … admin dashboard, member management, member status, committee and department management, term management and lifecycle tracking." |
| Administrators — CTO & DCTO-PD | CTO, DCTO-PD | "Configure the system and control access per role. Create and manage access for Officer/RR/Admin account." |
| Administrators — CRRD Chiefs and Deputies | CCDO, DCCDO-C, DCCDO-D | "Manage members, committees and departments … Manage membership applications. Send out forms through email. Opens and closes the application periods." |
| Officers | every other Chief | "Can view members but cannot edit or manage information about the organization." |
| Regional Representatives | RRs | "Can view members of their region but cannot edit or manage." |
| Members | — | "Members cannot access the system. They can only submit via forms." |

And, in so many words: *"Note: there are no moderator roles listed in the SRS."*

The meeting notes add one thing the SRS does not: that `demo.ceo` is "EL (executive leadership:
CEO, COO, DCOO-AA)". Asked which to follow, the project head answered **follow the PDF** — so
the DCOO-AA stays `officer`, and OQ-16 stays open.

## Decision

1. **Tiers by department, as the SRS says.** `officer_positions.grants_org_role` becomes:
   CEO, COO → `exec_admin`; CTO, **DCTO-PD** → `tech_admin`; CCDO, **DCCDO-C, DCCDO-D** →
   `crrd_admin`; every other Chief and Deputy → `officer`; REGIONAL_REP → `regional_rep`.
   Administrators are therefore **seven**, and the database says so: `admin_is_c_suite` is
   replaced by `admin_is_srs_administrator`, naming exactly those seven codes.

2. **`moderator` is retired, structurally.** Postgres cannot drop an enum label, so the value
   stays in `org_role` and a CHECK on `user_roles.role` (`user_roles_no_retired_tier`) refuses
   it. Every existing `moderator` row is converted to `crrd_admin` in the same migration,
   audited row by row. The ~26 policy clauses and ~8 definer guards that still name
   `'moderator'` now grant nothing to anyone; rewriting them is cleanup and is **not** done here
   — a policy rewrite without a local Postgres to iterate against is exactly how a boundary
   gets widened while every test stays green.

3. **`member` is repurposed as the revoked state, not retired.** Members hold no accounts under
   the SRS, so no live tier needs the label — but `revokeRole` already writes it (no hard
   deletes system-wide), and the alternative (banning the auth user) is a second revocation
   mechanism through the service-role client. So: `member` means "an account whose role was
   taken away". It reaches no route (`canAccess` denies every group; `homeForRole` sends it to
   `/unauthorized`), it needs no second factor (ADR 0004 still applies, to nothing), and the
   policies that name it return only the holder's own rows. The `(member)` route group and
   the portal are deleted; PRD US-E4 is dropped.

4. **The pgTAP fixture set keeps its shape.** Account 4 stays, as `crrd_deputy`: a second
   `crrd_admin` (the DCCDO-C) with **no** confidentiality acknowledgement — still the day-one
   refusal case US-J5 needs. Account 8 stays as the revoked tier. Four assertions that asserted
   moderator-only refusals a `crrd_admin` does not share (open a window; create, rename a
   committee; create a department) are deleted; everything else the old fixture asserted is
   equally true of a `crrd_admin` without an acknowledgement.

## Consequences

- **OQ-13 is mitigated** without a break-glass path: `tech_admin` has two seats again, and the
  CBL Art. VI §4.2 acting-officer route now has someone to hand the role to.
- **OQ-14 is moot.** The CCDO and both deputies are one tier; there is no split to enumerate.
- **OQ-16 stays open.** The SRS keeps CEO & COO as the executive administrators; the DCOO-AA
  remains read-only, and the meeting note that grouped them is recorded here, not applied.
- **Docs carry a dated amendment note** at the top of each tier table (PRD §2, ARCHITECTURE §5,
  DATA_MODEL §3) rather than a rewrite of every sentence that mentions the 2026-09-01 split;
  where the two disagree, the note wins. The hard facts — the CHECK, the seed values, the
  invariant tests, the fixture names — are updated in place.
- **Debt, named:** the dead `'moderator'` clauses in `0014_rls.sql` and the review/record RPCs.
  Remove them in one migration once a local Postgres exists to run the suite against
  (BUILD_PLAN never assumed CI-only iteration for policy work).
- **The demo seeder** replaces `demo.moderator` with `demo.dccdo` (`crrd_admin`) and deletes
  the two pre-0036 accounts (`demo.moderator`, `demo.member`) on its next run — the migration
  would otherwise leave the old moderator login alive as a CCDO-equivalent.
