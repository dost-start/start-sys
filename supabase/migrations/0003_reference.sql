-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0003_reference.sql
--
-- WHAT:      The four global (not term-scoped) reference tables:
--              regions                    18 Philippine regions with their island group
--              affiliations               named partnerships ("START x DataCamp")
--              officer_positions          the 23 CBL positions + the four-administrator CHECK
--              sensitive_column_registry  the RA 10173 classification, AS DATA
--
-- WHY:       PRD §4 Extensibility NFR — reference data is rows, so a new partnership, a
--            new region, or a constitutional amendment is a seed row or a cited
--            migration, never a grep for string literals across app/.
--
-- WHY sensitive_column_registry IS HERE AND NOT IN 0011: mask_sensitive() is
--            `language sql`, and SQL function bodies ARE validated at CREATE time. It
--            therefore cannot forward-reference a table that does not exist yet, so the
--            registry must land before 0011_audit.sql. This is a hard ordering
--            constraint, not a preference (BUILD_PLAN S1-T12, Sequencing traps).
--
-- POLICIES:  DEFERRED TO 0014_rls.sql, per ADR 0002 — every policy body calls
--            auth_role(), which lands in 0012_functions.sql. Do not "fix" this by adding
--            policies here; they would not be creatable. The creating migration still
--            ships ENABLE + FORCE ROW LEVEL SECURITY, so no table is ever unprotected in
--            between: with RLS forced and no policy, Postgres returns zero rows and
--            refuses the write, which is the correct failure direction.
--
-- CITATION:  DATA_MODEL.md §6/0003 and §8.1; PRD §2 (the seven tiers and who holds them);
--            CBL Art. III §2 (Executive Board), §3 (Deputy Board), §4.6 (Regional
--            Representatives), §5 (Committees); CBL Art. VIII §6 (RA 10173 as a
--            constitutional obligation); RA 12000 (2024) for the 18th region.
--
-- ROLLBACK:  Forward-only. These tables are referenced by FKs from 0004 onward.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── regions ────────────────────────────────────────────────────────────────────────
-- Philippine geography, therefore GLOBAL and never term-scoped (DATA_MODEL.md §2.1: a
-- fact lives outside a term if it would still be true if START-DOST ceased to exist).
-- `sort_order` is what the UI orders on, so the count is not hard-coded anywhere and a
-- future region change is one seed row.
create table public.regions (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                 -- 'NCR','R04A','BARMM','NIR'
  name         text not null unique,
  island_group public.island_group not null,
  sort_order   int not null
);

-- ── affiliations ───────────────────────────────────────────────────────────────────
-- PRD US-G2: "affiliations are managed as data — a new partnership requires no code
-- change." The v1.1 recipient filter reads this table.
create table public.affiliations (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                   -- 'START_X_DATACAMP'
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── officer_positions ──────────────────────────────────────────────────────────────
-- The Constitution as data. Seeded verbatim in 0016_seed.sql with the article cited
-- inline against every row. A position is a TITLE; an org_role is a CAPABILITY;
-- user_roles is the live answer to "what may this account do right now".
create table public.officer_positions (
  code             text primary key,                 -- CBL Art. III §2, §3, §4.6, §5
  title            text not null,                    -- verbatim from the Constitution
  grants_org_role  public.org_role not null,         -- provisioning hint; user_roles is still written explicitly
  is_administrator boolean not null default false,
  sort_order       int not null                      -- CBL listing order, in tens, so an amendment inserts
);

-- The four administrators are a DATABASE constraint, not a comment nobody re-reads.
-- Project heads, 2026-09-01: CEO, COO, CTO, CCDO and nobody else. A fifth administrator
-- now requires a migration with a named author, which is the point. PRD §2; the pgTAP
-- constitutional invariant in DATA_MODEL.md §9 asserts the row count as well as the set.
alter table public.officer_positions add constraint admin_is_c_suite
  check (not is_administrator or code in ('CEO', 'COO', 'CTO', 'CCDO'));

-- ── sensitive_column_registry ──────────────────────────────────────────────────────
-- RA 10173 classification as DATA, not as prose in a doc nobody re-reads in 2031.
-- ONE registry drives BOTH the audit-log masking (mask_sensitive(), 0011) and the
-- five-year purge (redact_expired_pii(), 0012), so the two can never disagree about
-- what "sensitive" means. CBL Art. VIII §6 makes RA 10173 a constitutional obligation
-- of every member, so this table is org policy, not engineering preference.
-- CONVENTIONS.md §13 rule 4: a new sensitive column is registered in the SAME migration
-- that creates it. Forgetting is how PII leaks into the audit log.
create table public.sensitive_column_registry (
  table_name  text not null,
  column_name text not null,
  rationale   text not null,
  primary key (table_name, column_name)
);

-- ── RLS: ENABLE + FORCE on every table, no exceptions ──────────────────────────────
-- FORCE matters and ENABLE alone is not enough: a table owner bypasses non-forced RLS,
-- and the Supabase migration role IS the owner. The 001_meta_force_rls.sql pgTAP
-- meta-test enumerates pg_class and fails CI if either flag is missing.
alter table public.regions                   enable row level security;
alter table public.regions                   force  row level security;
alter table public.affiliations              enable row level security;
alter table public.affiliations              force  row level security;
alter table public.officer_positions         enable row level security;
alter table public.officer_positions         force  row level security;
alter table public.sensitive_column_registry enable row level security;
alter table public.sensitive_column_registry force  row level security;
