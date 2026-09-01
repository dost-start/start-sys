-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0005_terms.sql
--
-- WHAT:      The term substrate every other table hangs off:
--              terms               1 June – 31 May, exactly one active, ever
--              term_summaries      frozen headcount snapshot per term
--              application_windows the DB fact behind "the application period is closed"
--              current_term_id()   what every dashboard filters on
--              reject_write_to_archived_term()  the freeze trigger function
--
-- WHY:       PRD MVP item 4 — "records are scoped to a term from day one, so no later
--            migration is required to introduce history". Archival is a status flip, not
--            a data migration: there are no _archive tables and no annual ETL job, and
--            "dashboards are wiped clean" is free because the new active term genuinely
--            has zero memberships on day one (ARCHITECTURE.md §4.3, DATA_MODEL.md §7).
--
-- CITATION:  CBL Art. V §1 — "All elected and appointed officers shall serve a term until
--            MAY of the succeeding year by which they were appointed." CBL Art. VII §1 —
--            membership "shall remain valid ... until the end of term AS DEFINED IN
--            ARTICLE V, SECTION 1", so ONE term serves both officers and members and
--            there is no second academic term to model (OQ-7, resolved). The term is NOT
--            the school year: academic timing rides on memberships.expected_grad_year.
--            PRD §3 v1.0 items 4 and 5; PRD US-B4, US-H1, US-H2, US-H3.
--
-- WHY 1 JUNE: CBL Art. V §2.1 starts Executive Board selection "no later than the first
--            week of May" (inside the OUTGOING term) and Art. V §2.2 starts Deputy Board
--            selection "no later than the last week of June" (inside the NEW one). A
--            1 June boundary is the only one that puts each on the correct side, so
--            rollover runs at the end of May (DATA_MODEL.md §7.5).
--
-- POLICIES:  Deferred to 0014_rls.sql per ADR 0002. ENABLE + FORCE ship here.
--
-- ROLLBACK:  Forward-only. `terms` is the FK target for every term-scoped table.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── terms ──────────────────────────────────────────────────────────────────────────
-- TERM BOUNDARIES — CBL Art. V §1.
--   ends_on   = 31 May. The MONTH is constitutional; the DAY is not stated, so the last
--               day of the month is our reading. Nothing is derived from the day except
--               when rollover is run, so changing it is one UPDATE (residual OQ-7).
--   starts_on = 1 June, the day after the outgoing ends_on. Consecutive, no gap.
create table public.terms (
  id          uuid primary key default gen_random_uuid(),
  label       text not null unique,                 -- '2026-2027' — the idempotency key for roll_over_term()
  starts_on   date not null,                        -- 2026-06-01
  ends_on     date not null,                        -- 2027-05-31
  status      public.term_status not null default 'draft',
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint term_dates_ordered check (ends_on > starts_on),
  -- CBL Art. V §1, enforced. A term that ends in July is unconstitutional, not a typo to
  -- discover in the rollover runbook at 2am.
  constraint term_ends_in_may check (extract(month from ends_on) = 5),
  constraint term_spans_succeeding_year
    check (extract(year from ends_on) = extract(year from starts_on) + 1)
);

-- Exactly one active term is a DATABASE invariant, not an application convention.
create unique index one_active_term on public.terms (status) where status = 'active';

-- ── term_summaries ─────────────────────────────────────────────────────────────────
-- Written by roll_over_term() so historical dashboards never re-scan archived rows.
create table public.term_summaries (
  term_id        uuid primary key references public.terms(id),
  counts         jsonb not null,   -- {"total":612,"by_status":{...},"by_region":{...}}
  snapshotted_at timestamptz not null default now()
);

-- ── application_windows ────────────────────────────────────────────────────────────
-- PRD US-B4: enforcement is at the data layer, not by hiding a link. The anon INSERT
-- policy on `applications` (0008) reads this table from inside its own policy
-- expression, so "the application period is closed" is a database fact and a forwarded
-- or bookmarked /apply link is inert.
create table public.application_windows (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid not null references public.terms(id),
  form_kind  public.form_kind not null,
  opens_at   timestamptz not null,
  closes_at  timestamptz not null,
  created_at timestamptz not null default now(),
  unique (term_id, form_kind),
  constraint window_ordered check (closes_at > opens_at)
);

-- ── current_term_id() ──────────────────────────────────────────────────────────────
-- STABLE => Postgres caches the result per statement, so this is one index probe per
-- QUERY, not per row. SECURITY DEFINER + SET search_path = '' + fully-qualified names is
-- mandatory for every definer function in this schema (CONVENTIONS.md §3.4).
create or replace function public.current_term_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.terms where status = 'active' limit 1;
$$;

comment on function public.current_term_id() is
  'The single active term. Every dashboard filters on this; nothing hardcodes a year. '
  'Returns NULL when no term is active. PRD MVP item 4.';

-- ── reject_write_to_archived_term() ────────────────────────────────────────────────
-- Archived means read-only for EVERY role, including exec_admin (DATA_MODEL.md §7.3).
-- The documented escape hatch is unfreeze_term() — tech_admin only, audited, temporary.
--
-- NOTE ON THE TG_OP BRANCH: DATA_MODEL.md §6/0012 sketches this as
--   `coalesce(new.term_id, old.term_id)` / `return coalesce(new, old)`.
-- Referencing a field of the unassigned record (OLD on INSERT) and COALESCEing two
-- record variables are both fragile in plpgsql, so this branches on TG_OP instead.
-- Identical semantics, no runtime surprise on the first INSERT.
create or replace function public.reject_write_to_archived_term() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_term uuid;
begin
  if tg_op = 'DELETE' then
    v_term := old.term_id;
  else
    v_term := new.term_id;
  end if;

  if (select status from public.terms where id = v_term) = 'archived' then
    raise exception 'term % is archived and read-only', v_term using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.reject_write_to_archived_term() is
  'BEFORE INSERT OR UPDATE guard on every term-scoped table. Raises 42501 when the row''s '
  'term is archived. DELIBERATELY NOT ATTACHED TO `terms` ITSELF: roll_over_term() must be '
  'able to flip terms.status to archived. DATA_MODEL.md §7.3.';

-- Attached here to the two term-scoped tables this migration creates. Every later
-- term-scoped table (memberships, officer_assignments, committees, departments,
-- applications, renewal_submissions, ...) attaches the same function in its own
-- migration — DATA_MODEL.md §6/0012.
create trigger trg_term_summaries_freeze_archived
  before insert or update on public.term_summaries
  for each row execute function public.reject_write_to_archived_term();

create trigger trg_application_windows_freeze_archived
  before insert or update on public.application_windows
  for each row execute function public.reject_write_to_archived_term();

-- ── RLS: ENABLE + FORCE, policies in 0014 ──────────────────────────────────────────
alter table public.terms               enable row level security;
alter table public.terms               force  row level security;
alter table public.term_summaries      enable row level security;
alter table public.term_summaries      force  row level security;
alter table public.application_windows enable row level security;
alter table public.application_windows force  row level security;
