-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0054_special_advisor_exec_only.sql
--
-- WHAT:      `officer_assignments_insert` / `_update` (0046) keep admitting exec_admin and
--            crrd_admin for every CBL position EXCEPT `SPECIAL_ADVISOR`, which narrows
--            back to exec_admin alone.
--
-- WHY:       Reviewer walkthrough 2026-09-09 (finding A9): the CRRD officers screen
--            offered an "Appoint" control on the Special Advisor row, and Ethan's note
--            was simply "CRRD cannot assign that". The Constitution agrees, twice over:
--
--              · CBL Art. X §3.1 — the Special Advisor is an EMPLOYEE OF DOST-SEI, not a
--                scholar and not a member. Seating them is not an org HR record of the
--                kind ADR 0012 handed CRRD; it is an external appointment.
--              · CBL Art. X §2.4–2.5 — the Special Advisor is the INDEPENDENT reviewer of
--                appeals against disciplinary action, including the membership
--                terminations and separations from office that CRRD records. A tier that
--                could seat its own appeal reviewer is not being reviewed independently.
--
--            ADR 0012 widened officer-standing writes to CRRD as a second RECORDER of a
--            decision the CEO or Executive Board still MAKES. That reasoning holds for the
--            21 elected and appointed seats. It does not reach this one, because there is
--            no Executive Board decision for CRRD to be recording — and this migration is
--            the narrowing ADR 0012 would have carried had the seat been considered then.
--
-- ⚠ THE ROW STAYS VISIBLE AND THE SEAT STAYS RECORDABLE. `SPECIAL_ADVISOR` is not
--   removed from `officer_positions`, is not hidden from any read, and exec_admin can
--   still appoint and separate it exactly as before. Deleting the position outright would
--   make a seat the Constitution creates (Art. III §2.9) unrecordable, which is worse
--   than the defect being fixed.
--
-- ⚠ THIS IS THE ENFORCEMENT. `app/(admin)/officers/page.tsx` also stops rendering the
--   control for crrd_admin and `lib/officers/actions.ts` refuses the call, but per
--   CLAUDE.md's banned patterns a hidden button is never the permission — these two
--   predicates are, and 075_officer_assignments_crrd.sql proves it per role.
--
-- ROLLBACK:  Forward-only. To restore ADR 0012's flat list, a later migration drops and
--            recreates both policies without the `role <> 'SPECIAL_ADVISOR'` conjunct.
-- ═══════════════════════════════════════════════════════════════════════════════════

drop policy officer_assignments_insert on public.officer_assignments;
drop policy officer_assignments_update on public.officer_assignments;

-- exec_admin: unchanged, every position including SPECIAL_ADVISOR.
-- crrd_admin: every position EXCEPT SPECIAL_ADVISOR (CBL Art. X §2.4-2.5, §3.1).
--
-- Written as one policy per command rather than a second additive policy: PERMISSIVE
-- policies OR together, so an extra policy could only ever widen this back out, and the
-- narrowing would be invisible in `pg_policies` to whoever read only one of the two rows.
create policy officer_assignments_insert on public.officer_assignments
  for insert to authenticated
  with check (
    public.auth_role() = 'exec_admin'
    or (public.auth_role() = 'crrd_admin' and role <> 'SPECIAL_ADVISOR')
  );

-- Both halves carry the conjunct. `USING` stops crrd_admin touching a row that ALREADY
-- seats the Special Advisor (recording a separation); `WITH CHECK` stops them writing a
-- row INTO that seat. Guarding only one would leave the other open.
create policy officer_assignments_update on public.officer_assignments
  for update to authenticated
  using (
    public.auth_role() = 'exec_admin'
    or (public.auth_role() = 'crrd_admin' and role <> 'SPECIAL_ADVISOR')
  )
  with check (
    public.auth_role() = 'exec_admin'
    or (public.auth_role() = 'crrd_admin' and role <> 'SPECIAL_ADVISOR')
  );

-- Still no DELETE policy on this table, and none may be added. A separation from office is
-- a status change (CBL Art. VI), never a deletion.
