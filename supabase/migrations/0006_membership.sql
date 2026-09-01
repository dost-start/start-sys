-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0006_membership.sql
--
-- WHAT:      The per-term half of the core split:
--              memberships          ONE row per person per term. Status, region, year
--                                   level, expected graduation year.
--              member_affiliations  membership <-> affiliation ("START x DataCamp").
--            Plus reject_write_to_archived_term_via_membership(), the freeze guard for
--            link tables that hang off a membership and therefore carry no term_id of
--            their own.
--
-- WHY:       PRD §3 v1.0 item 4 and PRD US-H1 — "the system creates a membership record
--            per term", so a member's history is a SEQUENCE rather than an overwrite. The
--            `unique (person_id, term_id)` constraint below is literally that sentence.
--            Creating this term's row does not modify last term's, and last term's rows
--            never move (DATA_MODEL.md §2.3, §7).
--
-- WHY member_id IS NOT HERE: PRD US-C4 / US-H5. Renewal inserts a row into THIS table and
--            never touches `people`, so 2024-001 structurally cannot become 2025-001 —
--            the number is not on the record renewal writes (DATA_MODEL.md §4 mech. 1).
--
-- WHY region_id IS HERE AND NOT ON people: scholars relocate. The regional rep who could
--            see them in 2025 must not automatically see them in 2027, so region is a fact
--            about a TERM membership and PRD US-F1 scoping reads it from this table.
--
-- WHY member_affiliations KEYS ON THE MEMBERSHIP: a cohort is a fact about a term, not a
--            permanent label on a human (DATA_MODEL.md §2.2). OQ-11 is unresolved — if
--            CRRD confirms affiliations are person-permanent, this becomes one migration
--            re-pointing membership_id -> person_id, and it must land before the first
--            campaign filters on it (DATA_MODEL.md §12 row 2).
--
-- DELIBERATELY NOT HERE — later slices own these; do not add them:
--              enforce_membership_transition()  the CBL Art. VII §3 status state machine,
--                                               incl. the exec_admin-only `terminated`
--                                               edges  -> 0028 (BUILD_PLAN S5-T1)
--              trg_memberships_set_updated_at   -> 0012 (BUILD_PLAN S2-T8); CONVENTIONS
--                                               §3.3, updated_at is never set in app code
--              trg_memberships_audit            -> 0012 (BUILD_PLAN S2-T9)
--              every RLS policy                 -> 0014 per ADR 0002
--
-- POLICIES:  DEFERRED TO 0014_rls.sql per ADR 0002 — policy bodies call auth_role(), which
--            lands in 0012. ENABLE + FORCE ships here, so the tables are unreadable and
--            unwritable in the interval, which is the correct failure direction.
--            NOTE FOR 0014: the memberships UPDATE policy carries
--            `(status <> 'terminated' or auth_role() = 'exec_admin')` in BOTH `using` and
--            `with check` — CBL Art. VII §3.2.3 reserves removal from the organization to
--            a majority vote of the Executive Board, narrower than every other status.
--
-- CITATION:  DATA_MODEL.md §6/0006, §2.2, §2.3, §3.1; PRD §3 v1.0 items 4, 10, 11;
--            PRD US-D1, US-D3, US-D5, US-D6, US-F1, US-H1, US-H5;
--            CBL Art. VII §1 (membership validity runs to the end of term as defined in
--            Art. V §1), CBL Art. VII §3 (termination).
--
-- ROLLBACK:  Forward-only. `memberships` is the FK target for member_affiliations,
--            department_assignments and committee_memberships (0007). There is no DELETE
--            path anywhere in this schema by design — membership end is a status change
--            (PRD Reliability NFR, CLAUDE.md banned patterns).
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── memberships ────────────────────────────────────────────────────────────────────
create table public.memberships (
  id                 uuid primary key default gen_random_uuid(),
  person_id          uuid not null references public.people(id),
  term_id            uuid not null references public.terms(id),

  -- CBL Art. VII. The legal-edge state machine (and the exec_admin-only 'terminated'
  -- transitions) is enforced by a trigger in 0028, not by this column's type alone.
  status             public.membership_status not null default 'active',

  region_id          uuid not null references public.regions(id),
  year_level         int  check (year_level between 1 and 8),

  -- The SOLE input to the renewal-eligibility predicate the PRD states as "if and only if"
  -- (PRD US-G7, renewal_eligible_people() in 0012). Deliberately an int and not a date, so
  -- the academic calendar and the CBL term calendar never have to agree (DATA_MODEL §7.5).
  -- Where this value comes from and who maintains it is OQ-3, still open.
  expected_grad_year int  check (expected_grad_year between 2000 and 2100),

  -- CRRD's free-text note alongside status. NOT a substitute for the status distinction:
  -- you cannot write an RLS policy against free text, which is exactly why 'terminated'
  -- and 'left' are separate enum values (DATA_MODEL.md §3.1).
  ended_reason       text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- PRD US-H1 / MVP item 4, as a database constraint: "a person has at most one membership
  -- record per term". The SAME person in two DIFFERENT terms is the renewal case and must
  -- succeed — that is what makes a member's history a sequence.
  unique (person_id, term_id)
);

comment on table public.memberships is
  'One row per person per term (PRD US-H1). Status, region, year level and expected '
  'graduation year all live here because all four change annually. member_id does NOT — '
  'it is on people, which is why renewal cannot renumber anyone (PRD US-C4).';

-- The RR dashboard and the faceted member grid (PRD US-F1, US-I3).
create index memberships_term_status_region on public.memberships (term_id, status, region_id);

-- Every current-term dashboard. Partial, because the dashboards only ever ask for the
-- active term's active members and "dashboards are wiped clean" at rollover is then free:
-- the new active term genuinely has zero rows here (ARCHITECTURE.md §4.3).
create index memberships_current on public.memberships (term_id) where status = 'active';

-- "Show me this person's whole history": select ... where person_id = $1 order by
-- term.starts_on. PRD US-H3, and the member-detail term history (BUILD_PLAN S5-T26).
create index memberships_person on public.memberships (person_id);

-- ── member_affiliations ────────────────────────────────────────────────────────────
-- PRD US-G2: "affiliations are managed as data — a new partnership requires no code
-- change." Composite PK, so a membership cannot be added to the same affiliation twice.
create table public.member_affiliations (
  membership_id  uuid not null references public.memberships(id),
  affiliation_id uuid not null references public.affiliations(id),
  created_at     timestamptz not null default now(),
  primary key (membership_id, affiliation_id)
);

-- ── reject_write_to_archived_term_via_membership() ─────────────────────────────────
-- DATA_MODEL.md §6/0012 lists member_affiliations, department_assignments and
-- committee_memberships among the tables that carry the archived-term freeze. All three
-- are LINK tables keyed on membership_id and none of them has a term_id column, so
-- reject_write_to_archived_term() (0005) cannot be attached to them: its body reads
-- `new.term_id` and plpgsql would raise "record new has no field term_id" on the first
-- insert. This is the same guard, resolving the term through the parent membership.
--
-- One function serves all three because all three key on membership_id. Attached to
-- member_affiliations here and to the other two in 0007.
--
-- SECURITY DEFINER, unlike its 0005 sibling, and the difference is deliberate: a freeze
-- guard must not be able to FAIL OPEN. As SECURITY INVOKER the lookup is subject to RLS on
-- memberships and terms, and a caller who cannot read the parent row gets NULL, which is
-- not 'archived', which permits the write. Definer + `set search_path = ''` +
-- fully-qualified names makes the guard independent of whatever 0014 grants.
-- FLAGGED, NOT SILENTLY FIXED: reject_write_to_archived_term() in 0005 has the same
-- fail-open shape and is another lane's file. Raised in the PR rather than edited here.
create or replace function public.reject_write_to_archived_term_via_membership() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership uuid;
  v_term       uuid;
begin
  if tg_op = 'DELETE' then
    v_membership := old.membership_id;
  else
    v_membership := new.membership_id;
  end if;

  select m.term_id into v_term
    from public.memberships m
   where m.id = v_membership;

  if (select t.status from public.terms t where t.id = v_term) = 'archived' then
    raise exception 'term % is archived and read-only', v_term using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.reject_write_to_archived_term_via_membership() is
  'BEFORE INSERT OR UPDATE freeze guard for link tables keyed on membership_id '
  '(member_affiliations, department_assignments, committee_memberships), which carry no '
  'term_id of their own. Raises 42501 when the parent membership belongs to an archived '
  'term. DATA_MODEL.md §7.3.';

-- ── freeze triggers ────────────────────────────────────────────────────────────────
-- Archived means read-only for EVERY role, including exec_admin (DATA_MODEL.md §7.3). The
-- documented escape hatch is unfreeze_term() — tech_admin only, audited, temporary.
create trigger trg_memberships_freeze_archived
  before insert or update on public.memberships
  for each row execute function public.reject_write_to_archived_term();

create trigger trg_member_affiliations_freeze_archived
  before insert or update on public.member_affiliations
  for each row execute function public.reject_write_to_archived_term_via_membership();

-- ── RLS: ENABLE + FORCE, policies in 0014 ──────────────────────────────────────────
alter table public.memberships         enable row level security;
alter table public.memberships         force  row level security;
alter table public.member_affiliations enable row level security;
alter table public.member_affiliations force  row level security;
