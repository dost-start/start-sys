-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0063_retire_special_advisor.sql
--
-- WHAT:      1. `officer_positions.is_active boolean not null default true` — a position
--               can be retired from recording without deleting its row.
--            2. `SPECIAL_ADVISOR` is set inactive.
--            3. `officer_assignments_insert` / `_update` (last written by 0054) are
--               re-created with one added conjunct: the position being written must be
--               active. That refuses the Special Advisor seat for EVERY tier, exec_admin
--               included. 0054's crrd_admin conjunct is kept, so if the seat is ever
--               reactivated CRRD still cannot record it.
--
-- WHY:       Co-officer QA, 2026-09-11: "special advisor is still defined" on the admin
--            page. The project head (Ethan Baltazar) asked for the position to be removed
--            for everyone, not only hidden from CRRD: the Special Advisor advises the whole
--            organization and is a DOST-SEI employee rather than a scholar (CBL Art. X
--            §3.1), so it is not a seat the officers record in a membership system.
--            ADR 0019.
--
-- ⚠ RETIRED, NOT DELETED. The row stays (23 rows, 22 recordable): nothing in this system
--   is hard-deleted, an older `officer_assignments` row keeps a valid foreign key, and
--   CBL Art. III §2.9 still creates the seat — START-SYS simply stops recording who holds
--   it. `027_constitutional_invariants.sql` (23 positions) is unaffected.
--
-- ⚠ THIS IS THE ENFORCEMENT. `lib/officers/queries.ts` stops listing inactive positions
--   and `lib/officers/positions.ts` refuses the Server Action, but a hidden row is never the
--   permission (CLAUDE.md). `075_officer_assignments_crrd.sql` 21-26 prove it per tier.
--
-- The EXISTS subquery reads `officer_positions` as the caller; `officer_positions_read`
-- (0014) admits every authenticated tier, and only exec_admin / crrd_admin reach the rest of
-- either policy anyway.
--
-- CITATIONS: ADR 0019; ADR 0012; 0054; CBL Art. III §2.9, Art. X §2.4-2.5, §3.1.
--
-- ROLLBACK:  forward-only. Reactivate with `update public.officer_positions set is_active =
--            true where code = 'SPECIAL_ADVISOR'` in a later migration; no policy change is
--            needed for exec_admin to record it again.
-- ═══════════════════════════════════════════════════════════════════════════════════

alter table public.officer_positions
  add column is_active boolean not null default true;

comment on column public.officer_positions.is_active is
  'false = retired from recording: no officer_assignments row may be written for this '
  'position by any tier (officer_assignments_insert / _update, 0063). The row is kept, never '
  'deleted. SPECIAL_ADVISOR retired 2026-09-11, ADR 0019.';

update public.officer_positions
   set is_active = false
 where code = 'SPECIAL_ADVISOR';

drop policy officer_assignments_insert on public.officer_assignments;
drop policy officer_assignments_update on public.officer_assignments;

-- One policy per command, as 0054 explains: PERMISSIVE policies OR together, so a second
-- additive policy could only widen this back out.
create policy officer_assignments_insert on public.officer_assignments
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.officer_positions p
       where p.code = officer_assignments.role
         and p.is_active
    )
    and (
      public.auth_role() = 'exec_admin'
      or (public.auth_role() = 'crrd_admin' and role <> 'SPECIAL_ADVISOR')
    )
  );

-- Both halves carry both conjuncts. `USING` freezes a row that ALREADY seats a retired
-- position (no separation can be recorded on it); `WITH CHECK` stops a row being moved INTO
-- one. Guarding only one half would leave the other open.
create policy officer_assignments_update on public.officer_assignments
  for update to authenticated
  using (
    exists (
      select 1
        from public.officer_positions p
       where p.code = officer_assignments.role
         and p.is_active
    )
    and (
      public.auth_role() = 'exec_admin'
      or (public.auth_role() = 'crrd_admin' and role <> 'SPECIAL_ADVISOR')
    )
  )
  with check (
    exists (
      select 1
        from public.officer_positions p
       where p.code = officer_assignments.role
         and p.is_active
    )
    and (
      public.auth_role() = 'exec_admin'
      or (public.auth_role() = 'crrd_admin' and role <> 'SPECIAL_ADVISOR')
    )
  );

-- Still no DELETE policy on this table, and none may be added. A separation from office is
-- a status change (CBL Art. VI), never a deletion.
