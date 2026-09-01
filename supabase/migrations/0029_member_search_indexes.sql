-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0029_member_search_indexes.sql
--
-- WHAT:      Three indexes that make the member grid and its facets index-backed rather
--            than sequential:
--              idx_people_member_id_trgm              GIN trigram on people.member_id
--              idx_committee_memberships_committee    btree on committee_memberships(committee_id)
--              idx_department_assignments_department   btree on department_assignments(department_id)
--
-- WHY:       PRD §3 v1.0 item 12 / PRD US-I2 ("search by name AND member ID") and the
--            Performance NFR's 3-second budget at 600 members across 5 terms
--            (PRD Success Metric 4 and 6).
--
--            0004_identity.sql already ships `people_name_trgm`, a GIN trigram index on
--            `(given_name || ' ' || family_name)`. That covers exactly half of US-I2. A
--            partial member-ID search — the way an officer actually finds "2024-0…" when
--            they have the paper form in front of them — is an unanchored ILIKE, which no
--            btree index can serve and which therefore seq-scans `people` today.
--            search_member_directory() (0030) writes its member_id predicate to match this
--            index's operator class exactly.
--
--            The two link-table indexes are not about search at all; they are about the
--            JOINs underneath it. v_member_directory LEFT JOINs committee_memberships and
--            department_assignments, and BOTH tables today carry only their composite
--            primary key `(membership_id, committee_id)` / `(membership_id, department_id)`.
--            A composite btree serves a lookup on its LEADING column only, so
--            `where committee_id = $1` — the committee facet (PRD US-I3) and the committee
--            headcount panel (BUILD_PLAN S6-T1) — has no usable index at all. Confirmed by
--            reading 0007_org_structure.sql, which creates indexes on officer_assignments
--            and on nothing else.
--
-- ⚠ NOT HERE, AND IT IS A DECISION RATHER THAN AN OMISSION: `unaccent`. BUILD_PLAN S5-T4
--   scoped accent-folding as droppable behind a 45-minute timebox, and it is dropped.
--   pg_trgm already lowercases when it extracts trigrams, so search is case-tolerant for
--   free; accent tolerance additionally needs the `unaccent` extension (absent from
--   0001_extensions.sql, a file this lane must not edit), an IMMUTABLE wrapper because
--   unaccent() is only STABLE and therefore not directly indexable, and a second functional
--   GIN index. PRD US-I2's "case- and accent-tolerant" is therefore HALF MET, stated rather
--   than quietly claimed — docs/issues/2026-09-05-accent-tolerant-search.md.
--
-- CITATION:  BUILD_PLAN S5-T3, S5-T4; DATA_MODEL.md §10; PRD §3 v1.0 item 12;
--            PRD US-I2, US-I3; PRD Success Metrics 4 and 6.
--
-- ROLLBACK:  Forward-only. Dropping any of these degrades performance silently — a
--            sequential scan returns the RIGHT answer, so nothing fails, the 3-second
--            budget just quietly stops being met. 063_member_search_scope.sql asserts two
--            of the three exist so a later migration cannot drop them unnoticed.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── member ID search ───────────────────────────────────────────────────────────────
-- `member_id` is nullable on `people` (a person row exists only via approve_application(),
-- which allocates in the same transaction, but the column permits NULL and pg_trgm indexes
-- skip NULLs at no cost), so no partial predicate is needed.
--
-- gin_trgm_ops on the bare column, so `member_id ilike '%2024-0%'` is an index scan. The
-- matching predicate lives in search_member_directory() (0030) — if that predicate is ever
-- rewritten to wrap the column in a function, this index stops being used and nothing
-- fails, it just gets slow. BUILD_PLAN S5-T31 measures it; S7-T19 records which index the
-- planner actually chose, because at fixture volume a seq scan is legitimately faster and
-- an EXPLAIN taken against six rows proves nothing.
create index if not exists idx_people_member_id_trgm
  on public.people using gin (member_id gin_trgm_ops);

comment on index public.idx_people_member_id_trgm is
  'Partial/unanchored member-ID search (PRD US-I2). people_name_trgm (0004) covers the name '
  'half; this covers the ID half. Keep search_member_directory()''s member_id predicate a '
  'bare ILIKE on this column or the index stops being used.';

-- ── the two link-table JOINs ───────────────────────────────────────────────────────
-- `if not exists` on all three: this lane cannot see the live catalog while authoring, and
-- a duplicate index is a wasted write amplification rather than an error worth failing a
-- migration over. If 0007 gains these later, this file becomes a no-op instead of a
-- conflict.
create index if not exists idx_committee_memberships_committee
  on public.committee_memberships (committee_id);

comment on index public.idx_committee_memberships_committee is
  'The committee facet (PRD US-I3) and the committee headcount panel (BUILD_PLAN S6-T1) '
  'filter and GROUP BY committee_id. The composite PK leads on membership_id and cannot '
  'serve that.';

create index if not exists idx_department_assignments_department
  on public.department_assignments (department_id);

comment on index public.idx_department_assignments_department is
  'The department facet (PRD US-I3). Same reasoning as the committee index — the composite '
  'PK leads on membership_id.';
