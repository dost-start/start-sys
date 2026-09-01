-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0022_member_id_allocation.sql
--
-- WHAT:      allocate_member_id(p_person_id uuid) returns text
--            enforce_member_id_immutable() + trg_people_freeze_member_id
--            and the EXECUTE lockdown that makes the allocator unreachable from a session.
--
-- WHY:       PRD §3 v1.0 item 9 and PRD US-C3 / US-C4 / US-H5:
--              "Members will have a specific ID number containing the year they joined
--               (e.g. 2024-001) … those with existing IDs will not be assigned new ones
--               (e.g. 2024-001 will not become 2025-001)."
--            DATA_MODEL.md §4 names FOUR independent mechanisms and says of all of them:
--            **none of them is application code.** This migration is mechanisms 2, 3 and 4.
--            Mechanism 1 — the structural one — needs no code at all and already shipped:
--            `member_id` is a column on `people` (0004) and renewal writes `memberships`,
--            so there is no code path that could renumber anyone because the number is not
--            on the record renewal touches.
--
-- ROLLBACK:  Forward-only. There is no down migration and there must not be: dropping the
--            immutability trigger would make PRD US-C4 unenforced for as long as the drop
--            stood, and dropping the allocator would strand approve_application(). A defect
--            here is corrected by a NEW migration with `create or replace`
--            (CONVENTIONS.md §3.4).
--
-- CITATION:  BUILD_PLAN S4-T1; DATA_MODEL.md §4, §6/0012; ARCHITECTURE.md §6;
--            CONVENTIONS.md §0 rule 5, §3.1 (trigger naming), §3.4;
--            PRD §3 v1.0 item 9, PRD US-C3, US-C4, US-H5.
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — allocate_member_id()  (DATA_MODEL.md §4 mechanism 2 and 3)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- THE ALLOCATION STATEMENT IS ONE STATEMENT, AND THAT IS THE WHOLE CONCURRENCY DESIGN.
--
--   insert into member_id_counters (join_year, last_seq) values (p_year, 1)
--   on conflict (join_year) do update set last_seq = last_seq + 1
--   returning last_seq
--
-- takes a ROW-LEVEL EXCLUSIVE LOCK on exactly one counter row. Two DCCDOs clicking Approve
-- in the same second serialize on it and each receives a distinct sequence. There is no
-- read-then-write window, therefore no lost update, therefore no duplicate member ID.
--
-- TWO REJECTED ALTERNATIVES, restated here because both look obviously fine and both are
-- wrong in ways that only show up during application week (DATA_MODEL.md §4):
--
--   max(seq) + 1        The classic lost-update race. Two concurrent approvals both read
--                       the same max and both write the same successor. The duplicate is
--                       refused by the unique index on people.member_id — so one approval
--                       fails at random, in front of an applicant, with a constraint error
--                       nobody can explain. 048_member_id_concurrency.sql asserts
--                       structurally that `max(` does not appear in this body.
--
--   a per-year SEQUENCE Needs runtime DDL every January, and sequences are NON-TRANSACTIONAL:
--                       a failed approval permanently burns 2027-004 and the series gains a
--                       gap that is a support question forever. The counter ROW rolls back
--                       with its transaction, so a failed approval consumes nothing.
--
-- IDEMPOTENT BY EARLY RETURN. A retried or double-submitted approval returns the EXISTING
-- id rather than issuing a second one (PRD US-C3, final criterion). This is also the
-- mechanism behind PRD US-H5: a renewing member is resolved to their existing `people` row
-- by approve_application() (0023), lands here, and gets their original number back —
-- 2024-001 does not become 2025-001 because this function refuses to mint a second one.
--
-- `for update` on the people row serializes two concurrent allocations for the SAME person,
-- so the early return cannot be evaluated stale.
--
-- SECURITY DEFINER because no human role holds INSERT or UPDATE on `people` (0015 revokes
-- ALL and grants back a six-column SELECT) and nobody at all holds any privilege on
-- `member_id_counters` (0015 §, revoke all from anon and authenticated). Both of those are
-- deliberate: the ONLY way to get a member ID is through approve_application(), in the same
-- transaction that creates the membership, so you can never get an ID without a membership
-- or a membership without an ID (ARCHITECTURE.md §6 mechanism 3).
--
-- `set search_path = ''` per CONVENTIONS.md §3.4 — every object name below is fully
-- qualified, so a hostile or accidental schema on the caller's search_path cannot shadow
-- `people` or `member_id_counters` and hand a definer function a different table.
create or replace function public.allocate_member_id(p_person_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int;
  v_seq  int;
  v_id   text;
begin
  select p.member_id, p.join_year
    into v_id, v_year
    from public.people p
   where p.id = p_person_id
     for update;

  -- ADDITION TO THE DATA_MODEL.md §6/0012 BODY, and the only one. Without it a bad person
  -- id falls through to the counter insert with a NULL join_year and surfaces as a
  -- not-null violation on member_id_counters.join_year — a confusing error naming a table
  -- the caller never heard of. Behaviour for every person that exists is unchanged.
  if not found then
    raise exception 'allocate_member_id: no person %', p_person_id
      using errcode = 'P0002';   -- no_data_found
  end if;

  -- Idempotent on retry, and the load-bearing half of PRD US-H5.
  if v_id is not null then
    return v_id;
  end if;

  insert into public.member_id_counters (join_year, last_seq)
  values (v_year, 1)
  on conflict (join_year)
  do update set last_seq = public.member_id_counters.last_seq + 1
  returning last_seq into v_seq;

  -- lpad to THREE, with the CHECK in 0004 written as ^\d{4}-\d{3,}$ — "three OR MORE".
  -- The 1000th member of a year becomes 2024-1000 rather than colliding with 2024-100 or
  -- being silently truncated. 600 members a year makes this unlikely and not impossible,
  -- and the failure it prevents is a duplicate primary identifier.
  v_id := v_year::text || '-' || lpad(v_seq::text, 3, '0');

  update public.people
     set member_id = v_id
   where id = p_person_id;

  return v_id;
end;
$$;

comment on function public.allocate_member_id(uuid) is
  'Allocates people.member_id as joinYear-sequence (2024-001). Race-safe via a '
  'single-statement counter-table upsert; idempotent — returns any existing id unchanged, '
  'which is what makes renewal keep 2024-001 (PRD US-C3, US-C4, US-H5). Reachable ONLY from '
  'approve_application(); EXECUTE is revoked from every session role. DATA_MODEL.md §4.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — the immutability trigger  (DATA_MODEL.md §4 mechanism 4)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-C4: "any attempt to change an existing member ID is refused AT THE DATA LAYER,
-- INCLUDING BY AN ADMINISTRATOR." A trigger is what makes that sentence true of a panicked
-- psql session at 2am, not merely of the UI.
--
-- The predicate freezes a NON-NULL id only. NULL -> value is the allocation above and must
-- live; value -> different value is the renumber and must raise; value -> NULL is a
-- renumber to nothing and is caught by the same `is distinct from` test.
--
-- check_violation (23514) rather than a bespoke code, so it maps through lib/action-result's
-- mapDbError() to `validation` alongside the member_id_format CHECK that guards the same
-- column. One column, one class of refusal.
create or replace function public.enforce_member_id_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.member_id is not null
     and new.member_id is distinct from old.member_id then
    raise exception 'member_id is immutable (% -> %)', old.member_id, new.member_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.enforce_member_id_immutable() is
  'Refuses any UPDATE that changes an already-issued people.member_id. PRD US-C4: refused at '
  'the data layer, including by an administrator. NULL -> value (allocation) is permitted.';

-- NAMING: CONVENTIONS.md §3.1 fixes triggers as trg_<table>_<what> and its own example row
-- is literally `trg_people_freeze_member_id`. DATA_MODEL.md §6/0012 sketches it as
-- `people_member_id_immutable`; CONVENTIONS.md is the authority on how a thing is spelled
-- (its stated authority order), so the convention name ships and the DATA_MODEL sketch is
-- read as prose. Noted here so the discrepancy is a decision rather than a discovery.
drop trigger if exists trg_people_freeze_member_id on public.people;
create trigger trg_people_freeze_member_id
  before update on public.people
  for each row execute function public.enforce_member_id_immutable();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — the EXECUTE lockdown  (the footgun BUILD_PLAN S4-T1 names)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠ **A SECURITY DEFINER FUNCTION IS GRANTED TO `PUBLIC` BY DEFAULT.** Created and left
-- alone, `allocate_member_id()` would be callable by anon and by every authenticated
-- session — as its owner, with BYPASSRLS — which is a hand-written `select
-- allocate_member_id('<any person uuid>')` away from minting a member ID for a person who
-- was never approved, or burning a sequence number on demand.
--
-- The internal `for update` and the counter give no protection against that: the function
-- is perfectly happy to do exactly what it says. The privilege IS the boundary here, and
-- there is no policy behind it to catch a miss, because `member_id_counters` deliberately
-- has NO POLICY AT ALL (0014) — deny-by-default is the whole design and this revoke is what
-- keeps the definer from being the way around it.
--
-- Revoking from PUBLIC already removes the inherited grant from every role; anon and
-- authenticated are named as well so that `\df+` and a `has_function_privilege` assertion
-- both read unambiguously, and so a future `grant execute … to public` cannot half-restore
-- it unnoticed. approve_application() (0023) is unaffected: it is SECURITY DEFINER owned by
-- the same role, and a definer function's body does not re-check EXECUTE on what it calls.
revoke execute on function public.allocate_member_id(uuid) from public;
revoke execute on function public.allocate_member_id(uuid) from anon;
revoke execute on function public.allocate_member_id(uuid) from authenticated;
