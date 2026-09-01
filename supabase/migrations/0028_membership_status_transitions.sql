-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0028_membership_status_transitions.sql
--
-- WHAT:      The CBL Art. VII membership state machine, enforced where no code path can
--            miss it:
--              · memberships_terminated_has_ground   a table CHECK — a row that IS
--                                                    `terminated` must carry a written
--                                                    ground of at least 10 characters
--              · enforce_membership_transition()     a BEFORE INSERT OR UPDATE trigger
--                                                    function holding the ONE inline
--                                                    VALUES list of legal edges
--              · trg_memberships_enforce_transition  the trigger itself
--
-- WHY:       PRD §3 v1.0 item 11 and PRD US-D3/US-D5/US-D6. `memberships.status` stopped
--            being a free column the moment the Constitution gave two of its values a
--            deciding body. DATA_MODEL.md §3.1 draws the machine; this file IS that
--            drawing, in one place, so the TypeScript mirror in lib/members/transitions.ts
--            has exactly one thing to agree with (BUILD_PLAN S5-T15 parses the VALUES list
--            below from disk and asserts set equality — see the sentinel comments).
--
-- THE THREE THINGS THIS FILE ENFORCES, AND THEY ARE DIFFERENT REQUIREMENTS:
--
--   1. WHICH EDGES EXIST AT ALL.  graduated -> active is not a permission question; it is
--      not a thing that can happen to a term-scoped membership record. A member who
--      returns gets a NEW ROW IN A NEW TERM and keeps their original member_id
--      (PRD US-H5). Illegal edges raise `check_violation` (23514) naming both statuses.
--
--   2. WHO MAY CROSS THE TWO TERMINATED EDGES.  CBL Art. VII §3.2.3 reserves removal from
--      the organization to "a simple majority vote (50% + 1) of the Executive Board", and
--      Art. VII §3.2.5-3.2.6 gives the member an appeal to the Special Advisor, whose
--      success is recorded as the ONE reversal edge in this schema. Both are exec_admin's
--      alone and raise 42501 for anybody else.
--
--      ⚠ THIS DUPLICATES memberships_update (0014) ON PURPOSE, AND THE DUPLICATION IS THE
--      POINT. That policy's WITH CHECK half already refuses a moderator moving a row INTO
--      `terminated`, and its USING half already hides an already-terminated row from
--      everyone but exec_admin. But RLS does not apply to a SECURITY DEFINER function
--      whose owner holds BYPASSRLS, and approve_application(), roll_over_term() and every
--      future definer that touches this table are exactly such callers. The policy is the
--      boundary for request traffic; this trigger is the boundary for everything else.
--      ARCHITECTURE.md §5: "if withRole is wrong, RLS still refuses" — one layer down,
--      if a definer function is wrong, this trigger still refuses.
--
--   3. THAT A TERMINATION NAMES ITS GROUND.  PRD US-D5: "recording a termination requires
--      a written ground; the audit entry names the deciding officer, the ground, and the
--      timestamp." Nothing enforced that. `updateMembershipStatus` is a plain table UPDATE
--      (BUILD_PLAN S5-T18), so a direct PostgREST call bypasses the zod superRefine that
--      was carrying the requirement, and the audit row would then name a deciding officer
--      and no reason at all. Two mechanisms, because they answer different questions:
--        · the table CHECK  — a terminated row always HAS a ground (true of every row,
--                             forever, including rows written before this migration)
--        · the trigger      — a transition INTO or OUT OF terminated must supply a FRESH
--                             ground, so this decision's reason is not last decision's
--                             reason left lying in the column. A reinstatement that
--                             silently inherits the termination's ground is a record that
--                             reads as if the Executive Board terminated someone in order
--                             to reinstate them.
--      `ended_reason` already exists (DATA_MODEL.md §6/0006). No column is added.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO:
--   · It does not touch officer_assignments.status. CBL Art. VI is a SEPARATE régime on a
--     SEPARATE table with a separate enum — an impeached CTO is still a member (Art. VI
--     §3.3 disqualifies them from holding a POSITION, not from the organization).
--     DATA_MODEL.md §13 rule 10 calls merging the two the single most likely future
--     mistake in this schema. The Art. VI transition table has no trigger yet and that is
--     a scope decision, not an oversight (BUILD_PLAN "Scope honesty").
--   · It does not re-implement the archived-term freeze. trg_memberships_freeze_archived
--     (0006) already fires on this table. TRIGGER ORDER IS ALPHABETICAL BY NAME for the
--     same timing, so `trg_memberships_enforce_transition` runs BEFORE
--     `trg_memberships_freeze_archived` (e < f): an ILLEGAL edge on an ARCHIVED term
--     raises 23514 rather than 42501, and a LEGAL edge on an archived term raises 42501
--     from the freeze. Both refusals are correct; the code differs by which guard is
--     nearer. 060_membership_transitions.sql asserts the archived case with a legal edge
--     for exactly this reason.
--   · It does not enforce a sign-out on a terminal status. PRD US-H4 / v1.2 item 30 —
--     deferred, see docs/issues/2026-09-05-session-revocation-deferred.md.
--
-- CITATION:  BUILD_PLAN S5-T1, S5-T2, S5-T15; DATA_MODEL.md §3.1, §6/0006, §13 rule 10;
--            ARCHITECTURE.md §4.3, §5; PRD §3 v1.0 item 11; PRD US-D3, US-D5, US-D6,
--            US-H1, US-H5; CBL Art. VII §1, §3.1, §3.2.3, §3.2.5-3.2.6.
--
-- ROLLBACK:  Forward-only. Dropping the trigger silently re-opens graduated -> active for
--            every role that can update a membership; dropping the CHECK leaves already-
--            terminated rows with a ground and permits the next one without. A genuine
--            correction is a NEW migration plus the pgTAP assertion that proves the new
--            boundary (060_membership_transitions.sql).
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — a terminated membership always carries a written ground
-- ═══════════════════════════════════════════════════════════════════════════════════

-- PRD US-D5. Mirrors 0024's `rejected_has_reason` on `applications` deliberately: the same
-- shape for the same reason, so a maintainer who has met one recognises the other.
--
-- ⚠ coalesce() IS LOAD-BEARING. Written as `length(btrim(ended_reason)) >= 10`, a NULL
-- ended_reason makes the right operand NULL, `false or null` evaluates to NULL, and a
-- CHECK constraint treats NULL as SATISFIED. The constraint would then permit exactly the
-- case it exists to refuse — a termination with no recorded ground — while looking correct
-- in the schema dump. coalesce(..., 0) collapses NULL to a failing length.
--
-- Ten characters is not a magic number; it is the same floor 0024 puts on a rejection
-- reason. It refuses "ok", "n/a" and "-" without pretending to judge prose.
alter table public.memberships
  add constraint memberships_terminated_has_ground
  check (
    status <> 'terminated'
    or coalesce(length(btrim(ended_reason)), 0) >= 10
  );

comment on constraint memberships_terminated_has_ground on public.memberships is
  'CBL Art. VII §3.1 / PRD US-D5: a membership removed by the Executive Board must name the '
  'ground. coalesce() is required — a bare length() comparison evaluates to NULL for a NULL '
  'ended_reason and a NULL CHECK is a SATISFIED check.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — enforce_membership_transition()
-- ═══════════════════════════════════════════════════════════════════════════════════

-- SECURITY INVOKER (the default, stated by the absence of SECURITY DEFINER), because it
-- must read the CALLER's auth_role() to decide the two terminated edges. A definer marking
-- would not change what auth_role() returns — it reads request.jwt.claims, not the DB role
-- — but it would make the function's privileges differ from the statement it is guarding,
-- which is a difference nobody should have to reason about in a trigger.
--
-- `set search_path = ''` and fully-qualified names throughout: CONVENTIONS.md §3.4 applies
-- it to SECURITY DEFINER functions, but a trigger fires under whatever search_path the
-- writing session happens to carry, so pinning it here removes the same class of surprise.
create or replace function public.enforce_membership_transition() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role public.org_role;
begin
  -- ── INSERT ───────────────────────────────────────────────────────────────────────
  -- A membership is BORN either active (approve_application(), PRD US-C2) or
  -- renewal_pending (the renewal form, PRD US-G7 / DATA_MODEL.md §3.1). Nothing else is a
  -- starting state: a person cannot be inserted already graduated, and a `terminated`
  -- insert would be a removal with no membership to remove — an Executive Board decision
  -- fabricated rather than recorded.
  --
  -- helpers/fixtures.psql seeds every membership as 'active' precisely so this branch does
  -- not start failing a file nobody would think to look at.
  if tg_op = 'INSERT' then
    if new.status not in ('active', 'renewal_pending') then
      raise exception
        'a membership may only be created as active or renewal_pending, not % (DATA_MODEL.md §3.1)',
        new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── UPDATE, status unchanged ─────────────────────────────────────────────────────
  -- Not a transition. Region corrections, year-level bumps and expected_grad_year edits
  -- (PRD US-D1) all land here and must pass untouched — including on a row that is already
  -- terminated, where amending the recorded ground is a legitimate exec_admin act and RLS
  -- has already decided who may attempt it.
  --
  -- `is not distinct from` rather than `=`: status is NOT NULL today, but a comparison that
  -- silently yields NULL if that ever changes would fall through to the edge lookup and
  -- refuse an innocent update with a confusing message.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- ── UPDATE, a real transition ────────────────────────────────────────────────────
  -- STEP 1: does this edge exist at all?
  --
  -- ⚠ THE SINGLE SOURCE OF TRUTH FOR THE MEMBERSHIP STATE MACHINE. lib/members/transitions.ts
  -- mirrors this list in TypeScript so the status editor can offer only legal next statuses,
  -- and its test READS THIS FILE FROM DISK, extracts the pairs between the sentinel comments
  -- below and asserts set equality (BUILD_PLAN S5-T15). Adding an edge in one place and not
  -- the other turns that test red, which is the entire reason the list is inline and
  -- machine-readable rather than spread across branches.
  --
  -- Every terminal state — graduated, resigned, left — is terminal by ABSENCE: it appears
  -- on no left-hand side. `terminated` is the sole exception and the reason is constitutional
  -- (CBL Art. VII §3.2.5-3.2.6, the appeal to the Special Advisor).
  if not exists (
    select 1
    from (values
      -- ── BEGIN LEGAL EDGE LIST — DATA_MODEL.md §3.1 ──
      ('renewal_pending', 'active'),      -- CRRD approves the renewal
      ('renewal_pending', 'left'),        -- declined, or swept by roll_over_term()
      ('active',          'graduated'),   -- PRD US-D3
      ('active',          'resigned'),    -- PRD US-D3
      ('active',          'left'),        -- PRD US-D3 — the quiet, non-adjudicated exit
      ('active',          'terminated'),  -- CBL Art. VII §3.2.3 — exec_admin only, below
      ('terminated',      'active')       -- CBL Art. VII §3.2.5-3.2.6 — PRD US-D6, the ONLY
                                          -- reversal edge anywhere in this schema
      -- ── END LEGAL EDGE LIST ──
    ) as legal(from_status, to_status)
    where legal.from_status = old.status::text
      and legal.to_status   = new.status::text
  ) then
    raise exception
      'membership status % -> % is not a legal transition (DATA_MODEL.md §3.1); a returning member gets a NEW row in a NEW term and keeps their member_id (PRD US-H5)',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- STEP 2: the two terminated edges belong to the Executive Board, and to nobody else.
  --
  -- CBL Art. VII §3.2.3 for the forward edge (PRD US-D5) and §3.2.5-3.2.6 for the reversal
  -- (PRD US-D6). crrd_admin and moderator are narrowed out even though the locked role model
  -- gives them "update member status" for every OTHER transition — `left` is legitimately a
  -- moderator's act, `terminated` never is. Collapsing the two would make an Executive Board
  -- ruling indistinguishable from an unreturned renewal form in the audit log.
  --
  -- auth_role() is NULL for a job or a migration running without claims, so a system caller
  -- is refused here as firmly as a moderator. That is deliberate: a termination is an
  -- attributable human decision and there is no unattributed path to one.
  if new.status = 'terminated' or old.status = 'terminated' then
    v_role := public.auth_role();

    if v_role is distinct from 'exec_admin'::public.org_role then
      raise exception
        'only an Executive Admin may record or reverse a termination of membership (CBL Art. VII §3.2.3, §3.2.5-3.2.6)'
        using errcode = '42501';
    end if;

    -- STEP 3: this decision's ground, not the previous decision's.
    --
    -- The table CHECK above guarantees a terminated ROW has a ground; it says nothing about
    -- whether that ground was written for THIS decision. A reinstatement leaves status
    -- 'active', where the CHECK is inert, so without this a successful appeal would be
    -- recorded with the termination's own reason still in the column and the audit diff
    -- would show a status change with no explanation attached to it.
    if new.ended_reason is not distinct from old.ended_reason then
      raise exception
        'recording or reversing a termination requires a written ground in ended_reason for THIS decision (PRD US-D5; CBL Art. VII §3.1)'
        using errcode = 'check_violation';
    end if;

    if coalesce(length(btrim(new.ended_reason)), 0) < 10 then
      raise exception
        'the written ground for a termination decision must be at least 10 characters (PRD US-D5)'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_membership_transition() is
  'BEFORE INSERT OR UPDATE on memberships. Holds the ONE inline VALUES list of legal '
  'membership_status edges (DATA_MODEL.md §3.1) — lib/members/transitions.ts mirrors it and '
  'its test parses this file. Illegal edge => 23514. Either terminated edge by anyone but '
  'exec_admin => 42501 (CBL Art. VII §3.2.3, §3.2.5-3.2.6). A terminated decision without a '
  'FRESH >=10-character ended_reason => 23514 (PRD US-D5). Duplicates memberships_update '
  '(0014) on purpose: that policy guards request traffic, this trigger guards SECURITY '
  'DEFINER callers, which RLS does not reach.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — the trigger
-- ═══════════════════════════════════════════════════════════════════════════════════

-- BEFORE, not AFTER: an AFTER trigger cannot prevent the write, only undo it, and undoing
-- it by raising leaves the same error at a point where every other AFTER trigger on the
-- table (including trg_memberships_audit) has already fired.
--
-- Coexists with trg_memberships_freeze_archived (0006). See the header note on alphabetical
-- trigger ordering — this one runs first, which is why an illegal edge on an archived term
-- reports the illegal edge rather than the freeze.
create trigger trg_memberships_enforce_transition
  before insert or update on public.memberships
  for each row execute function public.enforce_membership_transition();
