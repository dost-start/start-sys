-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0004_identity.sql
--
-- WHAT:      The per-person-forever half of the core split:
--              people             one row per human, forever. Member ID, join year, and
--                                 every sensitive RA 10173 column, deliberately isolated.
--              member_id_counters join_year -> last_seq. Race-safe allocation of 2024-001.
--              user_roles         account -> RBAC role -> person/region binding. The
--                                 table auth_role() reads. NEVER user_metadata.
--
-- WHY:       DATA_MODEL.md §2.1 — "a fact lives on `people` if and only if it would still
--            be true of that human if START-DOST ceased to exist." Everything that
--            changes annually carries a term_id and lives elsewhere (0006, 0007).
--
-- WHY member_id IS HERE AND NOT ON memberships: PRD US-C4 / PRD §5 — "2024-001 will not
--            become 2025-001". Renewal INSERTs a memberships row and never touches
--            `people`, so there is no code path that could renumber a member, because the
--            number is not on the record renewal writes. The placement IS the enforcement
--            (DATA_MODEL.md §4 mechanism 1); the trigger and the counter table are
--            mechanisms 2-4 on top of it.
--
-- WHY user_roles IS NOT TERM-SCOPED: it is the LIVE access-control answer and must revoke
--            instantly on graduation or resignation (PRD US-A2, US-E3). The HISTORY of who
--            held what is officer_assignments (0007) + audit_log. Roles are read from this
--            table per statement, never stamped into the JWT — a demoted officer keeps a
--            stale claim for up to an hour, which is exactly the wrong failure mode
--            (ARCHITECTURE.md §5, "Role storage and revocation").
--
-- DELIBERATELY DEFERRED TO S4 / 0022_member_id_allocation.sql — do not add them here:
--              allocate_member_id()             the counter-table upsert
--              enforce_member_id_immutable()    the BEFORE UPDATE renumber guard
--              trg_people_freeze_member_id      that trigger
--              revoke execute ... from public   the allocator lockdown
--            This migration ships the STRUCTURE (the format CHECK, the unique index, the
--            counter table). 0022 ships the BEHAVIOUR. Splitting them keeps one logical
--            change per migration (CONVENTIONS.md §3.4) and keeps the allocator's deny
--            tests in the slice that owns them (BUILD_PLAN S4-T1, S4-T9).
--
-- ALSO DEFERRED: `updated_at` maintenance. set_updated_at() and trg_people_set_updated_at
--            land in 0012_functions.sql (BUILD_PLAN S2-T8). CONVENTIONS.md §3.3:
--            updated_at is maintained by trigger and NEVER set in application code.
--
-- POLICIES:  DEFERRED TO 0014_rls.sql per ADR 0002 — every policy body calls auth_role(),
--            which lands in 0012_functions.sql, so a policy written here would not be
--            creatable. ENABLE + FORCE ROW LEVEL SECURITY ships here, so no table is ever
--            unprotected in between: RLS forced with no policy returns zero rows and
--            refuses the write, which is the correct failure direction.
--            Column-level GRANTs on `people` — the mechanism that actually protects the
--            sensitive columns, because RLS is row-level and cannot protect a column —
--            land in 0015_grants.sql.
--
-- CITATION:  DATA_MODEL.md §6/0004, §2.2, §4, §8.1; PRD §3 v1.0 items 3, 9, 10;
--            PRD US-A2, US-C3, US-C4, US-E3, US-H5, US-J1; RA 10173 (Data Privacy Act
--            of 2012), made a constitutional obligation by CBL Art. VIII §6.
--
-- ROLLBACK:  Forward-only. `people` is the FK target for memberships (0006),
--            officer_assignments and confidentiality_acknowledgements (0007),
--            applications (0008) and email_recipients (v1.1). Dropping it is not a
--            rollback, it is data loss — and there is no DELETE path anywhere in this
--            schema by design (PRD Reliability NFR).
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── citext ─────────────────────────────────────────────────────────────────────────
-- DATA_MODEL.md §6/0004 types people.personal_email as `citext`, and §6/0008 types
-- applications.applicant_email the same way. That is load-bearing, not cosmetic:
-- approve_application() (0023) resolves a returning applicant by matching
-- people.personal_email against the submitted address, and a case-sensitive match there
-- would mint a SECOND member ID for a scholar who typed Juan@ instead of juan@ — the one
-- outcome PRD US-C4 forbids.
--
-- It is created HERE rather than in 0001_extensions.sql because 0001 belongs to another
-- lane and its header enumerates the extensions it deliberately excludes; citext is not
-- among them, it was simply not anticipated. `if not exists` makes this idempotent, so if
-- citext is later folded into 0001 (where it arguably belongs) nothing breaks and no
-- migration needs editing. Flagged for the 0001 owner rather than silently downgrading
-- the column to `text`, which would have deviated from DATA_MODEL.md.
create extension if not exists citext;

-- ── people ─────────────────────────────────────────────────────────────────────────
create table public.people (
  id              uuid primary key default gen_random_uuid(),

  -- PRD US-C3 / US-C4. NULL until approve_application() allocates one, so an unapproved
  -- person never holds an ID. The {3,} in the regex is load-bearing: the 1000th member of
  -- a join year becomes 2024-1000 rather than colliding with 2024-100. Immutability is a
  -- BEFORE UPDATE trigger in 0022; this constraint is only about shape.
  member_id       text unique
                  constraint member_id_format check (member_id ~ '^\d{4}-\d{3,}$'),

  -- The year they FIRST joined, forever. Also PRD US-G2's "year of membership" email
  -- filter axis, and the partition key of member_id_counters.
  join_year       int  not null check (join_year between 2000 and 2100),

  given_name      text not null check (length(btrim(given_name)) > 0),
  middle_name     text,
  family_name     text not null check (length(btrim(family_name)) > 0),
  suffix          text,

  -- ── SENSITIVE (RA 10173) ─────────────────────────────────────────────────────────
  -- Isolated in one contiguous block on this table ON PURPOSE, for three reasons:
  --   1. redact_expired_pii() (0012) performs the five-year purge as ONE targeted UPDATE
  --      (PRD US-J3, DATA_MODEL.md §8.2).
  --   2. The column-level GRANT in 0015 has exactly one place to apply — officers and
  --      regional reps are granted the six non-sensitive columns and nothing else, so a
  --      hand-written query from an officer session returns 42501, not a birthdate
  --      (PRD US-D2, US-J1).
  --   3. Every one of these columns is registered in sensitive_column_registry (0016),
  --      which drives BOTH the audit-log masking and the purge, so the two can never
  --      disagree. CONVENTIONS.md §13 rule 4: a new sensitive column is registered in the
  --      SAME migration that creates it.
  -- Reads of these columns go through the audited, confidentiality-gated RPCs in 0012 and
  -- 0030 (CBL Art. VIII §7.1) — never by widening the GRANT.
  birthdate         date,
  contact_number    text,
  personal_email    citext,
  address_line      text,
  city_municipality text,
  province          text,
  postal_code       text,
  school            text,
  school_id_no      text,

  redacted_at     timestamptz,                    -- set by redact_expired_pii(); PRD US-J3
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.people is
  'One row per human, forever. Member ID, join year and every RA 10173 sensitive column. '
  'Facts that change annually live on memberships (0006) or carry a term_id. '
  'DATA_MODEL.md §2.1.';

comment on column public.people.member_id is
  'joinYear-sequence, e.g. 2024-001. Written exactly once, by approve_application(). '
  'IMMUTABLE — the BEFORE UPDATE guard is trg_people_freeze_member_id (0022). '
  'PRD US-C3, US-C4, US-H5.';

-- PRD US-I2 / MVP item 12: partial-name search that returns "within 3 seconds at full
-- scale". A trigram GIN index over the concatenated name is what makes an ILIKE '%pena%'
-- an index scan rather than a seq scan. Case tolerance is free — pg_trgm lowercases when
-- it extracts trigrams. ACCENT tolerance is NOT free and is a separate, droppable
-- decision (BUILD_PLAN S5-T4); it is not implemented here.
create index people_name_trgm on public.people
  using gin ((given_name || ' ' || family_name) gin_trgm_ops);

-- PRD US-G2's "year of membership" recipient filter, and the join_year lookup inside
-- allocate_member_id().
create index people_join_year on public.people (join_year);

-- ── member_id_counters ─────────────────────────────────────────────────────────────
-- One row per join year, holding the last sequence issued. allocate_member_id() (0022)
-- increments it with a SINGLE statement:
--     insert ... values (p_year, 1)
--     on conflict (join_year) do update set last_seq = last_seq + 1 returning last_seq
-- which takes a row-level exclusive lock on one row, so concurrent approvals serialize on
-- it and each receives a distinct sequence.
--
-- REJECTED, and both rejections matter (DATA_MODEL.md §4):
--   max(seq) + 1        classic lost-update race — two CRRD deputies approving in the same
--                       instant produce a DUPLICATE member ID.
--   a per-year SEQUENCE needs runtime DDL every January, and sequences are
--                       NON-TRANSACTIONAL, so a failed approval permanently burns 2027-004.
--                       A gap in a member-ID series is a support ticket forever. The
--                       counter ROW rolls back with its transaction.
--
-- No human role holds any privilege on this table: 0015 revokes it, and 0014 deliberately
-- creates NO policy at all, so deny-by-default makes it unreachable except from inside the
-- SECURITY DEFINER allocator.
create table public.member_id_counters (
  join_year int primary key,
  last_seq  int not null default 0 check (last_seq >= 0)
);

comment on table public.member_id_counters is
  'Race-safe member-ID allocation state. Reachable ONLY through allocate_member_id() '
  '(0022) — no RLS policy and no GRANT exists for any human role, by design. '
  'DATA_MODEL.md §4 mechanism 2.';

-- ── user_roles ─────────────────────────────────────────────────────────────────────
-- The live access-control answer, read per statement by auth_role() / auth_person_id() /
-- auth_region_id() (0012). NEVER in user_metadata: raw_user_meta_data is writable by the
-- user themselves, so a role stored there is a one-line privilege escalation and the
-- single most common Supabase security bug (ARCHITECTURE.md §5, CONVENTIONS.md §11).
--
-- person_id is NULLABLE in both directions on purpose: a tech_admin need not be a member,
-- and a member need not have an account (OQ-12 is unresolved either way). It is UNIQUE, so
-- one person never holds two accounts.
create table public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       public.org_role not null,
  person_id  uuid unique references public.people(id),  -- null for a tech_admin who is not a member
  region_id  uuid references public.regions(id),        -- primary scope; required for regional_rep
  created_at timestamptz not null default now(),
  -- PRD US-F1: a regional rep's whole authorization is "their own region". A rep row with
  -- no region would be a rep who can see nothing, or — if a policy were written carelessly
  -- with a NULL comparison — everything. Refuse the row instead.
  constraint rr_needs_region check (role <> 'regional_rep' or region_id is not null)
);

comment on table public.user_roles is
  'Account -> org_role -> person/region binding. THE live access-control answer, read per '
  'statement so revocation takes effect on the next request (PRD US-A2, US-E3). Roles are '
  'never stamped into the JWT and never stored in user_metadata.';

-- auth_person_id() and the member-portal policies look a person up by person_id, and the
-- user_roles.person_id -> people.id direction is walked on every member request.
create index user_roles_person on public.user_roles (person_id);

-- ── RLS: ENABLE + FORCE on every table, no exceptions ──────────────────────────────
-- FORCE matters and ENABLE alone is not enough: a table owner bypasses non-forced RLS, and
-- the Supabase migration role IS the owner. 001_meta_force_rls.sql enumerates pg_class and
-- fails CI if either flag is missing on any table in public.
alter table public.people             enable row level security;
alter table public.people             force  row level security;
alter table public.member_id_counters enable row level security;
alter table public.member_id_counters force  row level security;
alter table public.user_roles         enable row level security;
alter table public.user_roles         force  row level security;
