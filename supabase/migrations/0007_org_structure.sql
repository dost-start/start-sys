-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0007_org_structure.sql
--
-- WHAT:      The term-scoped org chart, plus the CBL Art. VIII §7 confidentiality record:
--              departments                       the SEVEN standing departments
--              committees                        discretionary, per term
--              department_assignments            membership -> department
--              committee_memberships             membership -> committee
--              officer_assignments               who holds which position THIS term, and
--                                                their standing under CBL Art. VI
--              confidentiality_acknowledgements  person x term; the precondition for every
--                                                sensitive-column read
--
-- WHY:       PRD §3 v1.0 items 3 and 10; PRD US-E1, US-E2, US-E3, US-E4, US-E5, US-E6,
--            US-E7, US-J5. The entire leadership changes annually (CBL Art. V §1), so
--            "who is CCDO" must be a question with a term in it. A `role` column on the
--            account cannot answer "who was CCDO in 2024-2025"; a term-scoped row can.
--
-- THE ASYMMETRY IS THE CONSTITUTION'S, NOT OURS:
--            CBL Art. III §4 fixes SEVEN departments, each headed by a named Chief. They
--            are seeded (0016), carried forward unchanged by roll_over_term(), and a
--            CI-blocking pgTAP invariant asserts every active term has exactly seven. An
--            eighth department therefore costs a migration — and it should, because the
--            list changes only by constitutional amendment (Art. XII), so the migration IS
--            the amendment's paper trail.
--            CBL Art. III §5 makes COMMITTEES discretionary: "may be created, restructured,
--            or dissolved depending on the operational needs of the organization." So
--            committees are NOT seeded, start empty every term, and creating one is one
--            INSERT — no migration, no deploy, no code change (ARCHITECTURE.md §4.4).
--            Art. III §5.4 permits dissolution "only when it has no incumbent member";
--            that is satisfied STRUCTURALLY rather than by a check — there is no DELETE
--            policy anywhere, so a committee is dissolved by not carrying it into the next
--            term, and a new term has no incumbents by construction.
--            Art. III §5.1-5.2's approval chain (co-endorsement -> COO review -> CEO
--            approval) is NOT enforced: the PRD asks for no approvals workflow. The system
--            records the resulting committee and audits who created it.
--
-- SEPARATION FROM OFFICE IS NOT TERMINATION OF MEMBERSHIP:
--            officer_assignments.status is CBL Art. VI ("Separation from Office").
--            memberships.status is CBL Art. VII ("Termination of Membership"). Two
--            Articles, two deciding bodies, two enums, two tables. An impeached CTO is
--            still a member — Art. VI §3.3 disqualifies them from holding A POSITION, not
--            from the organization — and an officer taking a two-week leave must not lose
--            member portal access. Merging them is named in CLAUDE.md and DATA_MODEL.md
--            §13 rule 10 as the single most likely future mistake in this schema.
--
-- VACANCY IS A QUERY, NOT A STATUS: CBL Art. VI §4 defines a vacancy as a person being
--            unable to continue serving, i.e. the ABSENCE of a sitting assignment for a
--            (term, position). That is
--              not exists (select 1 from officer_assignments
--                           where term_id = $1 and role = $2
--                             and status = 'active' and not is_acting)
--            There is no 'vacant' enum value and none may be added: a row claiming someone
--            holds a position nobody holds is a lie the schema must not be able to tell
--            (DATA_MODEL.md §3.4).
--
-- DELIBERATELY NOT HERE — later slices own these; do not add them:
--              every RLS policy    -> 0014 per ADR 0002. NOTE FOR 0014: departments and
--                                  committees are WRITABLE BY crrd_admin ONLY (moderators
--                                  cannot create structure); department_assignments and
--                                  committee_memberships are writable by exec/crrd AND
--                                  moderator ("assign members to EXISTING committees" is
--                                  explicitly a moderator power); officer_assignments is
--                                  writable by exec_admin ONLY, because every value of
--                                  officer_assignment_status is a CBL Art. VI act reserved
--                                  to the Executive Board; confidentiality_acknowledgements
--                                  is INSERTable by exec_admin only.
--              trg_*_audit         -> 0012 (BUILD_PLAN S2-T9). officer_assignments,
--                                  committee_memberships, department_assignments and
--                                  confidentiality_acknowledgements are all on the
--                                  DATA_MODEL.md §8.3 audited list.
--              has_confidentiality_ack() / the sensitive-read RPCs -> 0012, 0030.
--
-- CITATION:  DATA_MODEL.md §6/0007, §2.2, §3.4, §8.4; PRD §3 v1.0 items 3, 10, 15;
--            PRD US-E1..US-E7, US-J5;
--            CBL Art. III §4 (seven departments), §4.6 (Regional Representatives),
--            §5 (committees); Art. IV (powers and duties); Art. V §1 (term of office);
--            Art. VI §1-§4 (LOA, AWOL, resignation, impeachment, vacancy, acting officers);
--            Art. VIII §7.1, §7.1.4, §7.3 (confidentiality agreements and the consequence
--            of breach).
--
-- ROLLBACK:  Forward-only. departments is the FK target of committees and
--            officer_assignments. There is no DELETE path anywhere in this schema.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── departments ────────────────────────────────────────────────────────────────────
-- The seven standing departments of CBL Art. III §4. Term-scoped rows (the membership and
-- the chiefs change annually) with a stable cross-term `code`, so "CRRD" is the same
-- department every year — join on code for history — while its people are per-term.
create table public.departments (
  id            uuid primary key default gen_random_uuid(),
  term_id       uuid not null references public.terms(id),
  code          text not null,                    -- 'CRRD','TECH' — stable across terms; join on this for history
  name          text not null,
  -- CBL Art. III §4: each department is "headed by a Chief Officer". Storing the head as a
  -- POSITION code rather than a person keeps it true across the whole term even while the
  -- seat is vacant (Art. VI §4), and makes "who is the CTO this term" one join instead of
  -- a hard-coded string in a dashboard.
  head_position text not null references public.officer_positions(code),
  created_at    timestamptz not null default now(),
  unique (term_id, code)
);

comment on table public.departments is
  'The SEVEN standing departments of CBL Art. III §4, term-scoped. Seeded in 0016 and '
  'carried forward by roll_over_term(); a pgTAP invariant asserts every active term has '
  'exactly seven. An eighth requires a CBL Art. XII amendment, i.e. a cited migration.';

-- ── committees ─────────────────────────────────────────────────────────────────────
-- CBL Art. III §5: discretionary and per term. `code` is free TEXT and not an enum, and
-- nothing in the application enumerates committee identities — that is what makes
-- "create a committee" one INSERT rather than an ALTER TYPE, a new route and a new
-- mail-merge field (ARCHITECTURE.md §4.4). department_id is nullable: a committee may sit
-- outside any single department.
create table public.committees (
  id            uuid primary key default gen_random_uuid(),
  term_id       uuid not null references public.terms(id),
  department_id uuid references public.departments(id),
  code          text not null,
  name          text not null,
  created_at    timestamptz not null default now(),
  unique (term_id, code)
);

-- ── department_assignments ─────────────────────────────────────────────────────────
-- PRD US-E2's "assign members to departmental roles". Keyed on the MEMBERSHIP, so the
-- assignment is term-scoped by construction and last term's roster is untouched by this
-- term's edits.
create table public.department_assignments (
  membership_id uuid not null references public.memberships(id),
  department_id uuid not null references public.departments(id),
  created_at    timestamptz not null default now(),
  primary key (membership_id, department_id)
);

-- ── committee_memberships ──────────────────────────────────────────────────────────
-- PRD US-E1's "assign and remove committee members", and the operational record of who
-- sits on which committee. Note that COMMITTEE_MEMBER also exists as a seeded
-- officer_positions row (CBL Art. III §5) which grants no elevated capability; this table,
-- not that position, is what the PRD's committee assignment writes.
create table public.committee_memberships (
  membership_id uuid not null references public.memberships(id),
  committee_id  uuid not null references public.committees(id),
  created_at    timestamptz not null default now(),
  primary key (membership_id, committee_id)
);

-- ── officer_assignments ────────────────────────────────────────────────────────────
-- Who holds which CBL position THIS term, and their standing under Art. VI. Roles are rows
-- with a term attached, never a column on the account: user_roles (0004) stays the LIVE
-- access-control answer, and this table is the constitutional record of WHY.
create table public.officer_assignments (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references public.people(id),
  term_id       uuid not null references public.terms(id),
  role          text not null references public.officer_positions(code),

  -- CBL Art. VI, "Separation from Office". The legal-edge transition table is
  -- DATA_MODEL.md §3.4; 'impeached' has NO outbound edge at all, because Art. VI §3.2.8
  -- makes the Executive Board's ruling "final and irrevocable" — the one state the
  -- Constitution itself declares terminal. Contrast memberships, where Art. VII §3.2.5-6
  -- gives an appeal and the schema therefore has exactly one reversal edge.
  status        public.officer_assignment_status not null default 'active',

  -- e.g. the DCOO who issued the AWOL notice (CBL Art. VI §1.6). The DCOO holds the
  -- read-only `officer` tier under the locked role model, so the notice is issued outside
  -- the system and an exec_admin records the resulting dismissal naming them here. That
  -- divergence is OQ-16 and is flagged, not silently resolved.
  status_note   text,

  -- CBL Art. VI §4.1-4.3: the COO assumes the CEO's duties; the CEO designates an acting
  -- officer from the deputies of the concerned department; a Chief absorbs a vacant deputy.
  -- Acting service carries REAL POWERS — an acting CTO must be able to roll the term over
  -- (PRD US-E7, OQ-13) — so it is recorded, not implied.
  is_acting     boolean not null default false,

  department_id uuid references public.departments(id),
  committee_id  uuid references public.committees(id),
  created_at    timestamptz not null default now(),

  -- Transcribed from DATA_MODEL.md §6/0007. NOTE the standard SQL NULLS DISTINCT
  -- semantics: rows whose department_id/committee_id are NULL do not collide under this
  -- constraint. The invariant that actually matters — at most one SITTING holder per
  -- position per term — is the partial unique index below, which does not involve those
  -- nullable columns at all.
  unique (person_id, term_id, role, department_id, committee_id)
);

comment on table public.officer_assignments is
  'Who holds which CBL position this term, and their standing under CBL Art. VI '
  '(Separation from Office). NEVER merge this status with memberships.status (Art. VII): '
  'an impeached officer is still a member. DATA_MODEL.md §3.4, §13 rule 10.';

create index officer_assignments_term on public.officer_assignments (term_id, role);

-- At most one SITTING holder per position per term. CBL Art. VI §4's "vacancy" is then the
-- ABSENCE of a matching row — which is why there is no 'vacant' enum value (§3.4).
-- REGIONAL_REP (Art. III §4.6 — one or more per region across the 18 regions; the CBL sets
-- no headcount) and COMMITTEE_MEMBER (many, Art. III §5) are the only multi-seat positions
-- in the Constitution and are excluded from both indexes.
create unique index one_sitting_officer on public.officer_assignments (term_id, role)
  where status = 'active' and not is_acting
    and role not in ('REGIONAL_REP', 'COMMITTEE_MEMBER');

-- And at most one ACTING holder alongside them, so a sitting CTO and an acting CTO can
-- coexist during a designation (Art. VI §4.2) but two acting CTOs cannot.
create unique index one_acting_officer on public.officer_assignments (term_id, role)
  where status = 'active' and is_acting
    and role not in ('REGIONAL_REP', 'COMMITTEE_MEMBER');

-- ── confidentiality_acknowledgements ───────────────────────────────────────────────
-- CBL Art. VIII §7.1: "All elected and appointed officers, committee members, and advisors
-- shall sign a Confidentiality Agreement" covering, among other things, "sensitive
-- personnel matters, disciplinary proceedings, and private member data" (§7.1.4) — and
-- §7 requires it "UPON ASSUMING THEIR ROLES."
--
-- GRAIN IS PERSON x TERM, and the two rejected alternatives are worth stating:
--   a column on people                a 2024 signature would keep asserting itself in
--                                     2029; roles are assumed per term (Art. V §1), so the
--                                     fact has a term in it (DATA_MODEL.md §2.1).
--   columns on officer_assignments    a person may hold two positions and would then have
--                                     two acknowledgement records that can disagree. One
--                                     signature per term, not per seat.
--
-- IT IS A PRECONDITION, NOT A REPORT (PRD US-J5, DATA_MODEL.md §8.4): the SECURITY DEFINER
-- RPCs that return sensitive columns assert a row here for the caller in current_term_id()
-- BEFORE returning anything, and the refusal is an ERROR, not an empty result. The
-- day-one failure mode is deliberate and belongs in the rollover runbook — a newly
-- appointed CCDO cannot read member contact details until their row exists, and unblocking
-- it is one INSERT by an exec_admin. Who collects the agreements is OQ-18.
--
-- The SIGNED DOCUMENT is out of scope: there is no e-signature in the locked stack and the
-- PRD excludes file storage other than proof of enrollment. Recording the FACT — by whom,
-- when, against which version of the agreement, filed by whom — is the compliance evidence.
create table public.confidentiality_acknowledgements (
  person_id         uuid not null references public.people(id),
  term_id           uuid not null references public.terms(id),
  signed_at         timestamptz not null default now(),
  agreement_version text not null,                -- 'CBL-2026-VIII-7'
  -- auth.users.id of the exec_admin who filed it. Deliberately NOT a foreign key, matching
  -- DATA_MODEL.md §6/0007: the acknowledgement is a permanent compliance record and must
  -- not become undeletable-account-shaped or cascade-shaped because of who typed it in.
  recorded_by       uuid not null,
  primary key (person_id, term_id)
);

comment on table public.confidentiality_acknowledgements is
  'CBL Art. VIII §7.1, one row per person per term. A PRECONDITION for every '
  'sensitive-column read (PRD US-J5, DATA_MODEL.md §8.4), asserted inside the SECURITY '
  'DEFINER read RPCs — not RLS, because this gates COLUMNS and RLS is row-level.';

-- ── freeze triggers ────────────────────────────────────────────────────────────────
-- Archived means read-only for EVERY role, including exec_admin (DATA_MODEL.md §7.3).
-- The list of tables carrying this guard is DATA_MODEL.md §6/0012: memberships,
-- officer_assignments, committee_memberships, department_assignments, committees,
-- departments, applications, renewal_submissions, member_affiliations.
-- applications and renewal_submissions attach it in 0008 (S3's lane).
--
-- confidentiality_acknowledgements is deliberately NOT on that list and gets no freeze
-- trigger: it is a compliance record about a term, and the seven-department invariant is
-- not the only thing a late-filed acknowledgement could be. Following the list rather than
-- extending it.
create trigger trg_departments_freeze_archived
  before insert or update on public.departments
  for each row execute function public.reject_write_to_archived_term();

create trigger trg_committees_freeze_archived
  before insert or update on public.committees
  for each row execute function public.reject_write_to_archived_term();

create trigger trg_officer_assignments_freeze_archived
  before insert or update on public.officer_assignments
  for each row execute function public.reject_write_to_archived_term();

-- department_assignments and committee_memberships carry no term_id of their own, so they
-- use the membership-resolving variant defined in 0006. See that function's comment for
-- why reject_write_to_archived_term() cannot be attached to a table without a term_id.
create trigger trg_department_assignments_freeze_archived
  before insert or update on public.department_assignments
  for each row execute function public.reject_write_to_archived_term_via_membership();

create trigger trg_committee_memberships_freeze_archived
  before insert or update on public.committee_memberships
  for each row execute function public.reject_write_to_archived_term_via_membership();

-- ── RLS: ENABLE + FORCE, policies in 0014 ──────────────────────────────────────────
alter table public.departments                     enable row level security;
alter table public.departments                     force  row level security;
alter table public.committees                      enable row level security;
alter table public.committees                      force  row level security;
alter table public.department_assignments          enable row level security;
alter table public.department_assignments          force  row level security;
alter table public.committee_memberships           enable row level security;
alter table public.committee_memberships           force  row level security;
alter table public.officer_assignments             enable row level security;
alter table public.officer_assignments             force  row level security;
alter table public.confidentiality_acknowledgements enable row level security;
alter table public.confidentiality_acknowledgements force  row level security;
