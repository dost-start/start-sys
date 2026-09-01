-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0032_dashboard_aggregate_views.sql
--
-- WHAT:      The three counted surfaces behind every dashboard in v1.0:
--              v_membership_status_counts      (term_id, status)      -> member_count
--              v_membership_region_counts      (term_id, region_id)   -> member_count
--              v_membership_committee_counts   (term_id, committee_id)-> member_count
--            All three are PLAIN VIEWS declared
--            `with (security_barrier = true, security_invoker = true)`.
--
-- WHY:       PRD §3 v1.0 item 13 (admin dashboard), item 14 (Regional Representative
--            dashboard), item 15 (officer dashboard); PRD US-D4, US-F1, US-F2, US-D2.
--            ADR 0007 is the decision record and this file is its implementation.
--
-- ⚠ THE ONE THING TO UNDERSTAND BEFORE EDITING THIS FILE ⚠
--            `security_invoker = true` IS THE ENTIRE SCOPING STORY. The view executes with
--            the CALLER's privileges, so memberships_read (0014 §4) is evaluated for every
--            row these aggregates touch — exactly as it would be for a hand-written
--            `select count(*) from public.memberships`. A regional rep's totals are correct
--            because THE DATABASE REFUSES TO COMPUTE ANYTHING ELSE, not because a branch in
--            a function remembered to filter. There is not one line about regions below,
--            and there must never be one.
--
--            Written WITHOUT that clause (the Postgres default), or "optimised" into a
--            SECURITY DEFINER RPC that checks auth_role() itself, these views compute as
--            their owner — a BYPASSRLS role — and a regional rep silently sees ORG-WIDE
--            TOTALS on a page whose per-row list below shows one region. No error, no crash,
--            no log entry, and it looks perfectly correct to whoever is testing as an admin.
--            **That failure mode is the reason ADR 0007 exists and the reason
--            065_dashboard_views_rls.sql is verified red-then-green before any UI is built.**
--            066_dashboard_view_columns.sql asserts `security_invoker=true` out of
--            pg_class.reloptions on every CI run, so the clause cannot be dropped quietly.
--
-- WHAT THESE VIEWS DELIBERATELY DO NOT DO:
--
--   · They do not call current_term_id(). Each groups BY term_id and leaves the filter to
--     the caller, so ONE definition serves both the current-term dashboards
--     (`where term_id = public.current_term_id()`) and the admin-only historical read
--     (`where term_id = $1`, which RLS already restricts to the tiers permitted to pass an
--     explicit term — PRD US-H3). Embedding the current term would mean a second view the
--     first time anyone wants last year's numbers.
--
--   · They expose NO COLUMN OF public.people. Not a name, not a member_id, nothing. The
--     column-level GRANT in 0015 and the CBL Art. VIII §7.1 acknowledgement gate in 0012
--     are therefore not in the aggregate path at all and cannot be widened by way of a
--     dashboard. 066 asserts this against sensitive_column_registry rather than a
--     hand-kept list, so a column classified in 2029 is checked against these views on the
--     next run (PRD US-J1, Success Metric 8).
--
--   · They do not zero-fill. A term where nobody is `graduated` yields no `graduated` row.
--     A view cannot invent a row for a status nobody holds; lib/dashboard/status-buckets.ts
--     (BUILD_PLAN S6-T6) fills from the GENERATED enum so a term with no members renders 0
--     for every status rather than an empty panel (PRD US-H2, "dashboards wiped clean" is
--     true of the view, never of the data).
--
-- WHY VIEWS AND NOT MATERIALIZED VIEWS: a matview cannot carry RLS. It is computed once, by
--            its owner, and every caller reads the same pre-computed rows — which would hand
--            a regional rep org-wide totals by construction. See ADR 0007's rejected list.
--
-- CITATION:  BUILD_PLAN S6-T1, S6-T3, S6-T4, S6-T9, S6-T12, S6-T17; ADR 0007; ADR 0006;
--            ARCHITECTURE.md §5 ("Authorization lives in the database, not the app"),
--            §8 (Performance NFR); DATA_MODEL.md §6/0013, §10; PRD §3 v1.0 items 13-15;
--            PRD US-D2, US-D4, US-F1, US-F2, US-H3, US-J1; PRD §6 Success Metrics 4 and 8;
--            CBL Art. III §4 (departments), Art. III §5 (committees are per-term and
--            discretionary, which is why the committee view has a NULL bucket rather than
--            a fixed set).
--
-- ROLLBACK:  Forward-only. Dropping any of these breaks the three dashboards; the
--            corrective action is a new migration that recreates it, never an edit here.
--            **A "correction" that removes `security_invoker = true` is not a correction —
--            it is a scope failure that produces no error. Read ADR 0007 first.**
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — v_membership_status_counts                            (PRD US-D4, "headcount by status")
-- ═══════════════════════════════════════════════════════════════════════════════════

-- The simplest of the three and the one the other two are read against: no join at all, so
-- whatever `memberships` returns to this caller IS the answer, and any discrepancy between
-- this view and the region view is a join problem rather than a policy problem.
--
-- `status` is the enum, not text. The caller's label map is keyed on the same generated
-- union type (BUILD_PLAN S6-T6), so a value added to membership_status is a TypeScript
-- error at the label map rather than a silently missing tile.
--
-- Counts EVERY membership row in the term, whatever its status. That is not laziness — it
-- is PRD US-D4's "every number links through to the filtered list that produced it": the
-- status tile links to /members?status=active&term_id=… and the two must agree exactly. A
-- view that pre-filtered would produce a tile whose number the list beneath it contradicts.
create view public.v_membership_status_counts
with (security_barrier = true, security_invoker = true) as
select
  m.term_id,
  m.status,
  count(*)::bigint as member_count
from public.memberships m
group by m.term_id, m.status;

comment on view public.v_membership_status_counts is
  'Current- and historical-term headcount by membership_status (PRD US-D4). '
  'security_invoker = true: memberships_read (0014 §4) is evaluated for the CALLER, so a '
  'regional rep gets their region and tech_admin gets zero rows WITHOUT this view '
  'containing a line about either. Never make this SECURITY DEFINER — ADR 0007.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — v_membership_region_counts                            (PRD US-D4, "headcount by region")
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Joins `regions` for the render columns because a bar chart needs a NAME and the RR
-- dashboard header needs an ISLAND GROUP, and making every caller re-join for them would
-- guarantee two callers eventually join differently. `regions` is global reference data
-- readable by anon and authenticated alike (0014 §1, 0015), so the join adds no reachable
-- surface: it cannot widen what the caller sees, only label it.
--
-- region_id is carried ALONGSIDE the name because the tile has to link through to
-- /members?region_id=<uuid> (PRD US-D4). v_member_directory exposes region_name only and
-- therefore cannot serve a facet link — the same gap ADR 0006 records for the member grid.
--
-- INNER JOIN, not LEFT: memberships.region_id is NOT NULL with an FK (0006), so a
-- membership without a region cannot exist and a LEFT JOIN would only add a row that the
-- schema forbids while implying the opposite to whoever reads this next.
--
-- A region with no members yields NO ROW. Zero-filling belongs to the caller, which reads
-- the region list from `regions` — an 18-row table (RA 12000 added the Negros Island
-- Region) that must never be hard-coded (DATA_MODEL.md §6/0016).
create view public.v_membership_region_counts
with (security_barrier = true, security_invoker = true) as
select
  m.term_id,
  r.id           as region_id,
  r.code         as region_code,
  r.name         as region_name,
  r.island_group,
  r.sort_order,
  count(*)::bigint as member_count
from public.memberships m
join public.regions r on r.id = m.region_id
group by m.term_id, r.id, r.code, r.name, r.island_group, r.sort_order;

comment on view public.v_membership_region_counts is
  'Headcount by region for a term, with the render columns (code, name, island_group, '
  'sort_order) joined from the global regions table (PRD US-D4, US-F1). region_id is carried '
  'so a tile can link to /members?region_id=… . security_invoker = true — a regional rep '
  'resolves exactly their own region(s) and nothing else. ADR 0007.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — v_membership_committee_counts                      (PRD US-D4, "headcount by committee")
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ⚠ THIS PANEL DOES NOT SUM TO THE HEADCOUNT, AND THAT IS CORRECT.
--   CBL Art. III §5 places no limit on how many committees a member may serve, so a scholar
--   on two committees is counted once under EACH. member_count therefore totals to MORE than
--   the term's headcount whenever anyone holds two seats, and the named buckets plus the
--   unassigned bucket do not reconcile against the status or region views.
--
--   The panel is LABELLED rather than reconciled (ADR 0007 §4, and the caption is part of
--   BUILD_PLAN S6-T9's acceptance). **Do not "fix" this by arbitrarily picking one committee
--   per member.** An arbitrary pick silently understates every roster and — unlike a total
--   that visibly does not add up — nothing about the resulting page looks wrong. A visible
--   non-sum documents itself; a hidden undercount ships.
--
-- LEFT JOIN, twice, so the NULL bucket exists:
--   · a membership with no committee_memberships row yields committee_id = NULL, which is
--     the "unassigned" bucket the dashboard renders as its own bar. Without it, a term where
--     most members sit on no committee would show a panel that accounts for a handful of
--     people and silently omits everyone else.
--   · the second LEFT JOIN to `committees` is defensive rather than necessary
--     (committee_memberships.committee_id is NOT NULL with an FK), but it keeps the NULL
--     bucket's shape identical whichever join produced it.
--
-- ⚠ committee_memberships CARRIES ITS OWN RLS (0014 §5), scoped through the parent
--   membership by exactly the same region and person predicates as memberships_read. The two
--   therefore agree by construction: a rep who cannot see a membership cannot see its
--   committee row either, so a scholar never appears in the unassigned bucket merely because
--   their committee row was filtered away. If those two policies are ever edited apart, THAT
--   is the failure this view would express, and 065 pins the per-rep committee row sets to
--   catch it.
--
-- committee_code is carried for the same reason region_id is: the tile links through to
-- /members?committee_id=<uuid>, and `code` is the stable cross-term identifier while `name`
-- is the render value.
create view public.v_membership_committee_counts
with (security_barrier = true, security_invoker = true) as
select
  m.term_id,
  c.id           as committee_id,
  c.code         as committee_code,
  c.name         as committee_name,
  count(*)::bigint as member_count
from public.memberships m
left join public.committee_memberships cm on cm.membership_id = m.id
left join public.committees            c  on c.id = cm.committee_id
group by m.term_id, c.id, c.code, c.name;

comment on view public.v_membership_committee_counts is
  'Headcount by committee for a term, with committee_id NULL as the UNASSIGNED bucket '
  '(PRD US-D4). DOES NOT SUM to the term headcount: CBL Art. III §5 lets a member serve on '
  'more than one committee, so a two-committee scholar is counted under each. Label the '
  'panel; never "fix" it by picking one committee per member — ADR 0007 §4. '
  'security_invoker = true. ADR 0007.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4 — grants
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Explicit rather than inherited, and revoke-then-grant rather than grant alone, for the
-- same reason 0013 does it: Supabase's default privileges grant ALL on new objects in
-- `public` to anon and authenticated, so an un-revoked aggregate view is an ANONYMOUSLY
-- READABLE HEADCOUNT OF THE ORGANISATION. PRD US-A1 — no organizational record reaches an
-- unauthenticated caller, and a count is a record.
--
-- These are counts of PII-holding rows and nothing else in the system needs them, so anon
-- gets nothing here at either level: no GRANT, and no policy could help it anyway, because
-- there is no anon branch in memberships_read. Both halves are asserted — 066 checks the
-- GRANT with has_table_privilege AND drives the denial behaviourally as anon, because the
-- two can disagree and only one of them is what a request actually hits.
--
-- `grant select to authenticated` is NOT a widening. security_invoker means the caller still
-- needs their own privileges on memberships/regions/committees and still faces every policy
-- on them, so an officer gets org-wide totals, a regional rep gets one region and tech_admin
-- gets nothing — from this one grant.
revoke all    on public.v_membership_status_counts    from anon;
revoke all    on public.v_membership_region_counts    from anon;
revoke all    on public.v_membership_committee_counts from anon;

grant  select on public.v_membership_status_counts    to authenticated;
grant  select on public.v_membership_region_counts    to authenticated;
grant  select on public.v_membership_committee_counts to authenticated;
