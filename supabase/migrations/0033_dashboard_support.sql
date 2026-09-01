-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0033_dashboard_support.sql
--
-- WHAT:      One statement — an EXPLICIT `grant execute on public.auth_region_ids() to
--            authenticated` — plus two recorded NON-changes that a reader of BUILD_PLAN
--            S6-T2 will come here looking for.
--
-- WHY:       PRD §3 v1.0 item 14 / PRD US-F1. The Regional Representative dashboard
--            (BUILD_PLAN S6-T12) names the rep's own region(s) in its header, and
--            getCallerRegions() resolves them through auth_region_ids(). A rep holding
--            rr_region_grants rows must see all of them, which is exactly what that
--            function unions (0012).
--
--            **This widens nothing.** auth_region_ids() is SECURITY DEFINER and returns
--            ONLY the caller's own binding — their user_roles.region_id UNION their
--            rr_region_grants rows — so it discloses to a caller a fact the caller already
--            supplied. It is also the same function every regional-rep policy in 0014
--            already evaluates on that caller's behalf on every request.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠ TWO THINGS BUILD_PLAN S6-T2 ASKS FOR THAT ARE DELIBERATELY NOT IN THIS FILE
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- 1. THE COMMITTEE INDEX ALREADY EXISTS. S6-T2 provisions
--    `committee_memberships (committee_id)` because v_membership_committee_counts (0032)
--    LEFT JOINs and GROUPs on it while the table's only index is its composite primary key
--    `(membership_id, committee_id)`, which a btree can serve on its LEADING column alone.
--    **0029_member_search_indexes.sql (S5-T3) already shipped it** as
--    `idx_committee_memberships_committee`, citing this very view as one of its two
--    reasons. Re-creating it here — even with `if not exists` — would leave two migrations
--    each claiming ownership of one index, which is how a later cleanup drops it believing
--    the other file still provides it. It is not repeated; it is CITED.
--    Same story for `idx_department_assignments_department`, also 0029.
--
-- 2. NO NEW INDEX FOR THE STATUS OR REGION AGGREGATES. Both group on columns already
--    covered by `memberships_term_status_region (term_id, status, region_id)` from 0006,
--    and the current-term filter every dashboard applies is additionally served by the
--    partial `memberships_current (term_id) where status = 'active'`. Adding a third
--    overlapping index would cost write amplification on the hottest table in the schema to
--    buy nothing measurable at ~4,000 rows (DATA_MODEL.md §10). If the volume seed proves
--    otherwise, 067_dashboard_performance.sql is where that shows up and S7-T20 is where an
--    index gets added — **on the evidence of an EXPLAIN, in its own migration, with an
--    existence assertion so a later migration cannot quietly drop it.** Not speculatively,
--    here, at midnight.
--
-- CITATION:  BUILD_PLAN S6-T2, S6-T12, S6-T16; ADR 0007; DATA_MODEL.md §6/0009, §10;
--            ARCHITECTURE.md §5; PRD §3 v1.0 item 14; PRD US-F1, US-F3.
--
-- ROLLBACK:  Forward-only, and harmless to revert: revoking this grant returns
--            auth_region_ids() to the PUBLIC default it already carries (see below), so the
--            RR dashboard would keep working. That is precisely why the grant is worth
--            making explicit rather than relying on the default.
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- auth_region_ids() — make the dependency explicit
-- ═══════════════════════════════════════════════════════════════════════════════════

-- READ BEFORE CHANGING THIS. The state of play in the two files that own function
-- privileges today:
--
--   · 0012_functions.sql creates auth_region_ids() and revokes EXECUTE from nobody. It
--     states, in a comment, that auth_role() / auth_person_id() / auth_region_id() /
--     auth_region_ids() are "deliberately LEFT executable by anon", because RLS policy
--     expressions are evaluated as the CALLING role and the anon policies on `applications`,
--     `regions` and `terms` sit in bodies that call them.
--   · 0015_grants.sql revokes EXECUTE from anon on get_person_sensitive(), is_admin_reader()
--     and is_user_roles_writer() — and pointedly not on these four.
--
-- So `authenticated` can already call auth_region_ids() TODAY, by way of the PUBLIC default
-- Postgres grants on every new function. This statement is therefore a NO-OP against the
-- current catalog, and it is here for one reason that is not cosmetic:
--
--   the RR dashboard's dependency on this function is currently INVISIBLE. It rests on an
--   absence — nobody having revoked the default. The day someone hardens the function
--   surface with a blanket `revoke execute on all functions in schema public from public`
--   (a reasonable and likely hardening, and the shape S7's security review invites), the
--   PUBLIC grant disappears, `authenticated` loses EXECUTE, and the RR dashboard breaks with
--   a permission error in a route whose own code changed not at all. An explicit grant to
--   `authenticated` SURVIVES that revoke. It converts a silent dependency into a stated one.
--
-- It does NOT grant anon anything, and must not: adding `, anon` here would hand the
-- anonymous surface a function it has no policy path to need (0015 §4 enumerates the whole
-- anon surface as four tables, and its header requires any addition to arrive with a pgTAP
-- assertion in the same PR — 040_anon_surface_grants.sql).
grant execute on function public.auth_region_ids() to authenticated;

comment on function public.auth_region_ids() is
  'Primary region UNION rr_region_grants, as a uuid[]. Returns {} (never NULL) so a policy '
  'comparison against it is safe. Read by every regional_rep branch in 0014 AND by the RR '
  'dashboard header (BUILD_PLAN S6-T12) — 0033 grants EXECUTE to `authenticated` explicitly '
  'so that dependency survives a future blanket revoke from PUBLIC. Discloses only the '
  'caller''s own binding.';
