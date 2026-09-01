# Runbook 01 — Term Rollover

**Owner:** `tech_admin` (the CTO — role is single-occupancy per the
2026-09-01 project-head decision; see PRD.md OQ-13, ARCHITECTURE.md §5).
**Due:** v1.2 (`roll_over_term()` does not exist yet as of this stub —
BUILD_PLAN.md item 28).
**Status:** STUB. Steps 2+ are written once `roll_over_term()` ships.

## When to run this

Once a year, at the end of May, before Deputy Board selection opens (CBL
Art. V §2.2, last week of June) and after Executive Board selection has
begun (Art. V §2.1, first week of May). See ARCHITECTURE.md §4.3.

## Preconditions

- You hold `tech_admin`. Only `tech_admin` may execute
  `roll_over_term()` — not `exec_admin`, not `crrd_admin` (ARCHITECTURE.md
  §5, "Rollover authority: RESOLVED").
- A restore has been drilled recently (runbook 02) — rollover is the
  highest-stakes single operation in the system and should not be the first
  time you have touched a backup this term.

## Steps

1. **If you are the outgoing CTO: grant `tech_admin` to the incoming CTO
   before you vacate the role.** `roll_over_term()` is guarded on
   `tech_admin` alone (ARCHITECTURE.md §5) and that role is
   single-occupancy (PRD.md OQ-13) — a vacant CTO seat at term boundary
   blocks rollover entirely and requires a migration to unblock. Do this
   via `/admin/system/user-roles` (once it ships) or, until then, a
   reviewed migration. Confirm the grant took effect (the incoming CTO's
   next request reaches `/admin/system`) before continuing.
2. *(TODO(cto, 2027-05, before first rollover): write the remaining steps
   once `roll_over_term()` ships — call signature, expected output, how to
   verify the seven departments carried forward, how to verify dashboards
   show zero for the new term, and the `unfreeze_term()` escape hatch if
   something needs correcting after the fact.)*

## How to verify it worked

*(TODO(cto, 2027-05, before first rollover))*

## If it fails

*(TODO(cto, 2027-05, before first rollover) — link this section from runbook
05's incident response if a rollover fails mid-run.)*
