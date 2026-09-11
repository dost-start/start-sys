# ADR 0019 — The Special Advisor position is retired from START-SYS

**Date:** 2026-09-11
**Author:** Ethan Baltazar (project head), with Claude
**Status:** Accepted
**Supersedes:** migration 0054's narrowing (the Special Advisor seat recordable by
`exec_admin` only). The seat is now recordable by nobody.
**Deviates from:** CLAUDE.md orientation item 6 and DATA_MODEL.md §6/0016, which treat all
23 CBL positions as seats the system records. The row stays; recording against it stops.

---

## Context

Co-officer QA on 2026-09-11 listed "special advisor is still defined" under the admin page.
After migration 0054 (finding A9, 2026-09-09) the `/officers` roster still rendered a
Special Advisor row: CRRD saw "Executive Admin only" and the CEO and COO could appoint to
it.

Ethan's instruction: remove it entirely, for everyone — "that's not a position where CRRD
can assign. It is an adviser … of the whole organization." Asked whether the CEO and COO
should keep it, he answered no: nobody should see it.

What the Constitution says about the seat, and why it fits badly in this system:

- Art. III §2.9 seats the Special Advisor with the Executive Board, without voting powers.
- Art. X §3.1 makes the Special Advisor an employee of DOST-SEI, not a scholar.
- Art. X §2.4–2.5 makes them the independent reviewer of appeals against disciplinary
  action.

START-SYS is a membership information system. It records who holds a seat by pointing an
`officer_assignments` row at a `people` row — a scholar the system knows as an applicant or
member. A DOST-SEI employee has no such record, so the seat could only ever sit on the
roster as a permanent "Vacant" row or be filled by inventing a record for a non-member.

## Decision

1. **`officer_positions.is_active`** (migration 0063), `boolean not null default true`.
   `SPECIAL_ADVISOR` is set to `false`. The row is **not deleted**: nothing in this system
   is hard-deleted, an older assignment keeps a valid foreign key, and reversing this is
   one `UPDATE` in a later migration.
2. **`officer_assignments_insert` and `_update` refuse any write whose position is
   inactive**, for every tier including `exec_admin`. 0054's CRRD conjunct is kept, so if
   the seat is ever reactivated CRRD still cannot record it.
3. **Screens list active positions only**: the `/officers` roster and the campaign
   composer's position filter.
4. **The Constitution is not amended by this.** Art. III §2.9 still creates the seat;
   START-SYS simply does not keep the record of who holds it. The table still has 23 rows,
   22 of them recordable.
5. **Unchanged:** a membership-termination appeal still goes to the Special Advisor, outside
   the system (Art. VII §3.2.5–3.2.6), and reinstatement stays an `exec_admin` write
   (US-D6).

## Consequences

**Good:** the roster shows only seats the officers actually record. No dead row, no
"Executive Admin only" control for a seat nobody in the org appoints through this system.

**Costs:**
- "Who is the Special Advisor this term?" is no longer answerable from START-SYS. That
  lives in the org's own records.
- Docs written before today still describe the Special Advisor as a read-only officer seat
  (CLAUDE.md item 6, PRD §2, DATA_MODEL.md §6/0016, ARCHITECTURE.md §5). Each gets a
  one-line pointer to this ADR rather than a rewrite.
- `027_constitutional_invariants.sql` still asserts 23 positions and the Special Advisor's
  `grants_org_role` — both remain true, because the row is retained.

## Verification

`supabase/tests/075_officer_assignments_crrd.sql` assertions 21–26: CRRD and exec_admin
both refused an insert; a pre-existing Special Advisor assignment frozen for both; both
policies name the position and check `is_active`; still 23 rows, exactly one inactive.
