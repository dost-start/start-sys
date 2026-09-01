-- ═══════════════════════════════════════════════════════════════════════════════════
-- 063_member_search_scope.sql  —  search inherits its scoping, and does not restate it
--
-- WHAT:
--   1-3     positive control, and the exact unfiltered row count for each scoped tier
--   4-5     the two reps' result sets are DISJOINT, and a rep searching for a scholar who
--           exists only in the other region gets exactly ZERO
--   6-9     PRD US-I2 on both axes: partial name, case-insensitivity, partial member ID
-- 10-12     THE DEDUPE: a scholar on two committees is ONE row carrying a two-element array
-- 13-15     term gating — a client-supplied term is honoured for admins and IGNORED for the
--           officer and regional-rep tiers (PRD US-H3)
-- 16-19     each of the four facets, independently (PRD US-I3)
-- 20-21     the member tier sees exactly their own row; anon is refused outright
-- 22-24     the structural facts: NOT a definer, and 0029's two indexes still exist
--
-- WHY:  PRD §3 v1.0 item 12; US-I2 (search by name and member ID); US-I3 (filter by status,
--   region, term, committee and department); US-F1 (a rep sees their own region only).
--
-- ⚠ THE ASSERTION THIS FILE EXISTS FOR IS 22. search_member_directory() is SECURITY INVOKER,
--   and that single word is the entire scoping story: an officer gets every row and a
--   regional rep gets one region WITHOUT the function containing a line about regions,
--   because RLS on `memberships` and `people` applies to it exactly as it applies to a
--   hand-written query. **The obvious "optimisation" — a SECURITY DEFINER RPC that checked
--   auth_role() itself — would be a SECOND authorization model, and a second model drifts
--   from the first silently, in the direction of over-disclosure.** If 22 ever goes red, the
--   scoping assertions above it have stopped measuring anything, and 2-5 will still be
--   green, because a definer function CAN be written to return today's right answer.
--
-- ⚠ THIS FILE MUTATES NOTHING, which is why the exact numbers below can be written down.
--   060 does the mutating, in its own file, against the transition lab in R03 — a region no
--   rep fixture covers, chosen precisely so its mutations cannot move a number here.
--
-- ⚠ ACCENT TOLERANCE IS NOT ASSERTED, AND THAT IS NOT AN OVERSIGHT. PRD US-I2 asks for "case-
--   and accent-tolerant" search. pg_trgm lowercases when it extracts trigrams, so the case
--   half is free and assertion 7 proves it. The accent half needs the `unaccent` extension
--   and was dropped under BUILD_PLAN S5-T4's timebox, so assertion 6 searches 'Peña' with its
--   diacritic intact rather than pretending 'Pena' works. Recorded as an unmet criterion in
--   docs/issues/2026-09-05-accent-tolerant-search.md rather than quietly claimed.
--
-- CITATION:  BUILD_PLAN S5-T3, S5-T4, S5-T5, S5-T10; ADR 0006; DATA_MODEL.md §6/0013, §10;
--            ARCHITECTURE.md §5; PRD §3 v1.0 item 12; PRD US-D2, US-E4, US-F1, US-H3,
--            US-I2, US-I3.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/records-fixtures.psql

select plan(24);

-- Scratchpad for the disjointness proof. CREATED by the session role, WRITTEN while
-- impersonating — auth.psql grants the temp schema USAGE, not CREATE.
create temp table fx_scope (rep text, person_id uuid);
grant insert, select on fx_scope to public;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — exact unfiltered counts, starting with the positive control
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14 = every membership in the ACTIVE term (helpers/records-fixtures.psql arithmetic:
-- 4 from fixtures.psql + 10 here). The archived term's single row is absent because no
-- p_term_id was passed and the function falls back to current_term_id().
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.search_member_directory()), 14,
  'POSITIVE CONTROL: crrd_admin''s unfiltered search returns exactly 14 rows — every '
  'current-term membership, deduped. If this were 0 the deny assertions below would all pass '
  'for the wrong reason'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a (NCR)
select is(
  (select count(*)::int from public.search_member_directory()), 3,
  'regional_rep_a''s IDENTICAL call returns exactly 3 — P3, P4 and R1, the NCR scholars with '
  'a current-term membership. The function contains no region predicate; memberships_read and '
  'people_read do (PRD US-F1)'
);
insert into fx_scope select 'a', person_id from public.search_member_directory();
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000007');   -- regional_rep_b (R07)
select is(
  (select count(*)::int from public.search_member_directory()), 2,
  'regional_rep_b''s identical call returns exactly 2 — P5 and P6. The nine transition-lab '
  'scholars sit in R03, which no rep fixture covers'
);
insert into fx_scope select 'b', person_id from public.search_member_directory();
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-5 — disjointness, and the cross-region search
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Two counts that happen to sum correctly would not catch a predicate that returned the same
-- rows to both reps, so the sets are collected and intersected.
select is(
  (select count(*)::int from (
     select person_id from fx_scope where rep = 'a'
     intersect
     select person_id from fx_scope where rep = 'b'
   ) s), 0,
  'the two reps'' result sets are DISJOINT — PRD US-F1: "two reps of different regions see '
  'disjoint member sets"'
);

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a (NCR)
select is(
  (select count(*)::int from public.search_member_directory(p_q => 'Peña')), 0,
  'regional_rep_a searching for a scholar who exists ONLY in region B gets exactly ZERO — not '
  'a redacted row, not an error. PRD US-F1: "members outside the rep''s region are not '
  'returned, including via search"'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 6-9 — PRD US-I2, both axes
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

select is(
  (select count(*)::int from public.search_member_directory(p_q => 'Peña')), 1,
  'the SAME query an admin runs returns P6 (José Peña) — so assertion 5''s zero was the '
  'region predicate and not a broken search. The diacritic is spelled out: accent FOLDING is '
  'not implemented (see the header)'
);

select is(
  (select count(*)::int from public.search_member_directory(p_q => 'dela cruz')), 1,
  'search is CASE-INSENSITIVE: lowercase "dela cruz" finds "Juan Dela Cruz". Free from '
  'pg_trgm, which lowercases when it extracts trigrams — no citext, no lower() wrapper, and '
  'therefore no expression that would defeat people_name_trgm'
);

select is(
  (select count(*)::int from public.search_member_directory(p_q => 'Dela')), 1,
  'PARTIAL-name search matches mid-name: "Dela" finds "Juan Dela Cruz" (PRD US-I2, '
  '"partial-name search returns matches")'
);

select is(
  (select count(*)::int from public.search_member_directory(p_q => '2024-')), 2,
  'the SECOND axis: partial MEMBER ID. "2024-" finds 2024-001 and 2024-1000 — the query an '
  'officer types with the paper form in front of them. This is the half people_name_trgm '
  'never covered and idx_people_member_id_trgm (0029) exists for'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-12 — THE DEDUPE
-- ═══════════════════════════════════════════════════════════════════════════════════
-- v_member_directory LEFT JOINs committee_memberships and department_assignments, so R1 —
-- who sits on FIXT_ETHICS and FIXT_OUTREACH — yields TWO rows through the view. Anything
-- paginating over that miscounts: page 1 of 25 shows 24 people. GROUP BY + array_agg is what
-- collapses it, and without a member on two committees in the fixtures this clause would
-- never be exercised.
select is(
  (select count(*)::int from public.search_member_directory(p_q => 'Rivera')), 1,
  'a scholar on TWO committees is ONE row. Through v_member_directory the same scholar is two '
  'rows — which is why nothing paginates over the view directly'
);

select is(
  (select array_length(committee_names, 1)
     from public.search_member_directory(p_q => 'Rivera')), 2,
  'and both committees survive, in the array: the fan-out is collapsed, not truncated. A '
  'DISTINCT ON that kept one arbitrary row would pass assertion 10 and silently lose half the '
  'scholar''s committee service'
);

select is(
  (select array_length(department_names, 1)
     from public.search_member_directory(p_q => 'Rivera')), 1,
  'department_names aggregates independently of committee_names. The two LEFT JOINs multiply '
  'each other, so a naive array_agg without DISTINCT would report this as 2'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-15 — term gating (PRD US-H3)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- memberships_read carries NO term predicate at all, so without server-side gating an officer
-- or a rep could page through history by editing a URL. PRD US-H3: "officers and regional
-- representatives do not gain access to prior terms they could not see at the time."
-- The archived term (2025-2026) holds exactly one membership: P1's, in NCR.
select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a
select is(
  (select count(*)::int from public.search_member_directory(
     p_term_id => '00000000-0000-4000-d000-000000000001'::uuid)), 3,
  'a REGIONAL REP passing the archived term''s id gets their CURRENT-term rows anyway — the '
  'argument is discarded server-side, not merely ignored by the UI. P1''s archived NCR '
  'membership is one the rep CAN read through memberships_read, so this is a real refusal '
  'rather than an accident of visibility'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is(
  (select count(*)::int from public.search_member_directory(
     p_term_id => '00000000-0000-4000-d000-000000000001'::uuid)), 14,
  'an OFFICER passing the archived term''s id also gets the current term — 14 rows, not the '
  'archived term''s 1 (PRD US-H3)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.search_member_directory(
     p_term_id => '00000000-0000-4000-d000-000000000001'::uuid)), 1,
  'an ADMIN passing the same id DOES reach the archived term — exactly one row, P1''s. PRD '
  'US-H3: "any archived term is selectable and returns that term''s roster as it was." The '
  'old rows never moved; rollover is a status flip'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 16-19 — the four facets, independently (PRD US-I3)
-- ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.search_member_directory(
     p_statuses => ARRAY['renewal_pending']::public.membership_status[])), 2,
  'STATUS facet: exactly the two renewal_pending rows (L1, L2). A NULL filter array means "no '
  'filter", never "match nothing" — which is what makes the facets independent and combinable'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');
select is(
  (select count(*)::int from public.search_member_directory(
     p_region_ids => ARRAY[pg_temp.fx_region('NCR')])), 3,
  'REGION facet: the three NCR scholars. Filtering by region_id and not by region_name is why '
  'this function reads the base tables rather than v_member_directory, which exposes only the '
  'name — a filter on a renameable string is a filter that breaks on a rename'
);

select is(
  (select count(*)::int from public.search_member_directory(
     p_committee_ids => ARRAY[pg_temp.fx_committee('FIXT_ETHICS')])), 3,
  'COMMITTEE facet: P4, P6 and R1. Note R1 is included and still carries BOTH committees in '
  'the array — the facet is an EXISTS, not a predicate on the joined alias, so filtering to '
  'one committee does not silently rewrite the member''s other committee service'
);

select is(
  (select count(*)::int from public.search_member_directory(
     p_department_ids => ARRAY[pg_temp.fx_department('CRRD')])), 1,
  'DEPARTMENT facet: R1 alone. All five filter dimensions PRD item 12 names — status, region, '
  'term, committee, department — plus search, and each is asserted on its own so a facet that '
  'silently stopped filtering could not hide behind another'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20-21 — the member tier, and anon
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member (P4)
select is(
  (select count(*)::int from public.search_member_directory()), 1,
  'a MEMBER''s search returns exactly their OWN row and nobody else''s. PRD US-E4: "no '
  'organizational roster is reachable from the member view" — and note that this is the same '
  'function every admin screen calls, refusing by policy rather than by a separate endpoint'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ select * from public.search_member_directory() $$,
  '42501'::char(5), null::text,
  'anon is refused OUTRIGHT rather than returned an empty set. RLS alone would give anon zero '
  'rows, which is the correct answer delivered in the wrong shape for a public caller — '
  '0030 revokes EXECUTE from anon so the refusal is unambiguous (PRD US-A1)'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 22-24 — the structural facts
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 22 IS THE ASSERTION THIS WHOLE FILE RESTS ON. See the header.
select ok(
  not (select p.prosecdef from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'search_member_directory'),
  'search_member_directory() is NOT SECURITY DEFINER, and that is load-bearing: every scoping '
  'answer above is INHERITED from memberships_read and people_read rather than restated in a '
  'second permission model. Making this a definer would keep assertions 2-5 green today and '
  'silently decouple them from the policies forever'
);

select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and indexname = 'idx_people_member_id_trgm'),
  'idx_people_member_id_trgm exists (0029). Assertion 9''s partial member-ID search is an '
  'unanchored ILIKE, which no btree can serve — dropping this index breaks NOTHING and '
  'silently costs the 3-second budget (PRD Performance NFR), so its absence has to be an '
  'assertion rather than a symptom'
);

select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and indexname = 'idx_committee_memberships_committee'),
  'idx_committee_memberships_committee exists (0029). The committee facet and the S6 '
  'committee headcount panel both filter on committee_id, which the composite primary key '
  '(leading on membership_id) cannot serve'
);


select * from finish();

rollback;
