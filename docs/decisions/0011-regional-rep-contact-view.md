# ADR 0011 — Regional Representatives read their region's contact details, through one audited function

**Date:** 2026-09-06
**Author:** Ethan Baltazar (project head), recording the team decision of 2026-09-05
**Status:** Accepted
**Deviates from:** `PRD.md` US-J1 ("contact numbers … are not returned to Officer or
Regional Representative tiers"), US-F1, OQ-6's default; `ARCHITECTURE.md` §5 (the
`regional_rep` row: "SELECT where region_id = auth_region_id()", six columns);
`DATA_MODEL.md` §8.1 ("officer and regional_rep do not"); `CLAUDE.md` banned pattern
"Officers and regional reps see name, member ID, region, status, committee — nothing else".
**Implemented by:** migration `0042_rr_member_contacts.sql`, pgTAP `071`, `/region`.

---

## Context

The Regional Representative dashboard shipped read-only and column-poor by design:
name, member ID, region, status, committee. The 2026-09-05 team meeting reversed half of
that for a stated operational reason — *"for rr … remove committee and department, add
email, school, fb account, and contact number"* — because an RR's job under CBL Art. IV
§6.4 is to reach the scholars in their region, and a roster with no way to contact anyone
is a roster the RR re-creates in a spreadsheet, which is the exact failure mode the PRD's
problem statement describes.

The privacy model has to absorb that without becoming a different model. Three facts
decide the shape:

1. **RLS is row-level and the column boundary is a GRANT.** Widening the `people` GRANT
   or `v_member_directory` would widen it for *officers* too, and OQ-6's answer for
   officers is still no.
2. **CBL Art. VIII §7.1 binds RRs.** They are appointed officers (Art. III §4.6), so the
   Confidentiality Agreement precondition (`DATA_MODEL.md` §8.4) applies to them exactly
   as it does to the CCDO — it would be incoherent to gate the CCDO's reads and not the
   RR's.
3. **RA 10173 asks "who looked, and when."** A contact list read must be attributable.

## Decision

1. **One `SECURITY DEFINER` function, `list_region_member_contacts(p_university_id)`.**
   `regional_rep` only. Returns name, member ID, status, region, university, personal
   email, contact number and Facebook link for the caller's own region(s)
   (`auth_region_ids()`, primary plus grants) and the **current term** only. Scoping is
   restated inside the function because a definer bypasses RLS; the predicate is the
   same one `memberships_read` uses for a rep.
2. **Gated on the acknowledgement**, via `assert_confidentiality_ack()`. A rep with no
   current-term acknowledgement — or no `people` row to attach one to — gets an error,
   not an empty list (PRD US-J5). The `/region` page renders that refusal as an
   actionable panel naming the CBL article, exactly as `/members/[id]` does for a CCDO.
3. **Audited per call**: one `VIEW_CONTACTS` row in `audit_log`, attributed, value-free.
4. **The table surface does not move.** The 0015 GRANT and `v_member_directory` are
   untouched; pgTAP `071` asserts a direct `select contact_number from people` from a rep
   session still raises. `029`/`030`/`061`/`066` are unchanged and still pass.
5. **What is not returned**: birthdate, address, school ID, documents, committee,
   department. The meeting named a contact set; this is that set and nothing more.
6. **Officers are unchanged.** OQ-6 keeps its default.
7. **University filter.** A `universities` row (0037) per scholar makes "filter students
   per university" one parameter. The "point person per university" idea is deferred.

## Consequences

- Every RR must have a `people` row and a current-term acknowledgement before the view
  works. The demo seeder now binds `demo.rep` to a person and records the acknowledgement;
  the Playwright scope seed does the same for `scope_rep_a` and deliberately not for
  `scope_rep_b`, so both branches are exercised. Runbook 01's day-one note ("nobody has
  acknowledged, every sensitive read fails") now covers RRs too — OQ-18 grows by 18
  regions' worth of signatures.
- `e2e/rr-scope-leak.spec.ts` no longer treats a contact number on `/region` as a leak
  for the rep's own region; it still treats the address, the school ID and any region-B
  name as one. The region-B *contact* scoping is proven in pgTAP `071`, where the two
  regions carry distinguishable people.
- The docs that said "RRs see no contact data" are amended in place with a dated note
  pointing here (`PRD.md` US-J1/US-F1/OQ-6, `ARCHITECTURE.md` §5, `DATA_MODEL.md` §8.1,
  `CLAUDE.md`). The sentence they now state is: *officers* see none; *RRs* see their own
  region's contact set through one audited, acknowledgement-gated function.
- Revoking the decision is `drop function` plus a page change. No policy, grant or view
  would need to move back.
