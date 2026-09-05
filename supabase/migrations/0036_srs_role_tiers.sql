-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0036_srs_role_tiers.sql  —  role tiers revert to the CRRD SRS
--
-- WHAT:
--   1. Administrators are now SEVEN, not four. officer_positions: DCTO_PD -> tech_admin,
--      DCCDO_C and DCCDO_D -> crrd_admin, all three is_administrator = true. The
--      admin_is_c_suite CHECK (0003) is replaced by admin_is_srs_administrator, which
--      names exactly CEO, COO, CTO, DCTO_PD, CCDO, DCCDO_C, DCCDO_D.
--   2. `moderator` is retired. Postgres cannot drop an enum label, so the value stays in
--      org_role and a CHECK on user_roles.role refuses it. Every existing moderator row is
--      converted to crrd_admin first (audited row by row by trg_user_roles_audit, actor
--      'system'). The policies and definer guards that still name 'moderator' grant
--      nothing to anyone from here on; rewriting them is cleanup, not security (ADR 0009).
--   3. `member` is REPURPOSED, not retired. Members hold no accounts — SRS Roles:
--      "Members cannot access the system. They can only submit via forms." — so the label
--      now means exactly one thing: an account whose role has been REVOKED (what
--      revoke_role writes, CLAUDE.md: never a hard delete). Such an account reaches no
--      route; the policies that name it return the holder's own rows and nothing else.
--
-- WHY: the CCDO's "Questions Roles and Features" SRS (2026-09-05) and the team meeting
--      of the same day. The SRS groups access by department: CEO & COO; CTO & DCTO-PD;
--      CRRD Chiefs and Deputies; every other Chief read-only; RRs region-scoped; members
--      forms-only; and states "there are no moderator roles listed in the SRS". This
--      reverses the project-head split of 2026-09-01 (four administrators, a moderator
--      tier). Side effects on the open-question register: OQ-13 is mitigated (tech_admin
--      has two seats, so a vacant CTO chair no longer blocks rollover); OQ-14 is moot;
--      OQ-16 stays open (the SRS keeps the DCOO at officer — CEO & COO only).
--
-- PRD: §2 tiers (as amended by the SRS), US-A2, US-E3.  CBL: Art. III §2, §3 (the
--      positions themselves are unchanged — only which capability each grants).
--
-- ROLLBACK: forward-only. Reversal is a new migration that restores the four-code CHECK
--      and the moderator grants; the user_roles conversion is in audit_log.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── 1. seven administrators ────────────────────────────────────────────────────────
alter table public.officer_positions drop constraint admin_is_c_suite;

alter table public.officer_positions add constraint admin_is_srs_administrator
  check (not is_administrator
         or code in ('CEO', 'COO', 'CTO', 'DCTO_PD', 'CCDO', 'DCCDO_C', 'DCCDO_D'));

comment on constraint admin_is_srs_administrator on public.officer_positions is
  'The seven administrators of the CRRD SRS (2026-09-05): CEO & COO (exec_admin), CTO & '
  'DCTO-PD (tech_admin), CCDO, DCCDO-C & DCCDO-D (crrd_admin). An eighth needs a migration '
  'with a named author, which is the point. Supersedes admin_is_c_suite (0003).';

update public.officer_positions
   set grants_org_role = 'tech_admin', is_administrator = true
 where code = 'DCTO_PD';

update public.officer_positions
   set grants_org_role = 'crrd_admin', is_administrator = true
 where code in ('DCCDO_C', 'DCCDO_D');

-- ── 2. retire moderator ────────────────────────────────────────────────────────────
-- Convert before constraining, so the CHECK is valid from the moment it exists. The
-- three positions that held moderator are crrd_admin or tech_admin under the SRS, and
-- every moderator power was a strict subset of crrd_admin's, so nobody loses a capability
-- they legitimately had; the DCTO-PD gains tech_admin through the seed hint above and a
-- deliberate re-grant by the CTO, never silently here.
update public.user_roles
   set role = 'crrd_admin'
 where role = 'moderator';

alter table public.user_roles add constraint user_roles_no_retired_tier
  check (role <> 'moderator');

comment on constraint user_roles_no_retired_tier on public.user_roles is
  'SRS 2026-09-05: "there are no moderator roles listed in the SRS". The enum label cannot '
  'be dropped, so it is made unassignable instead. Policies that still name it are dead code.';

-- ── 3. member = revoked ────────────────────────────────────────────────────────────
comment on type public.org_role is
  'Access tiers. exec_admin: CEO, COO. tech_admin: CTO, DCTO-PD. crrd_admin: CCDO, DCCDO-C, '
  'DCCDO-D. officer: every other Chief and Deputy, read-only. regional_rep: region-scoped '
  'read. member: an account whose role was REVOKED — members hold no accounts (SRS '
  '2026-09-05), so this label reaches no route and is written only by revoke_role. '
  'moderator: RETIRED, unassignable (user_roles_no_retired_tier).';
