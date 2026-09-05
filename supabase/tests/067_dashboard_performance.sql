-- ═══════════════════════════════════════════════════════════════════════════════════
-- 067_dashboard_performance.sql  —  the aggregates at five-year volume
--
-- WHAT:
--    1-3    the volume seed actually landed: ~4,000 memberships, ~800 people, ≥5 terms
--    4-7    it landed in the right SHAPE — 5 status buckets, all 18 regions, 16 committee
--           buckets and 300 pending applications — so the timings below are not measuring
--           an empty or degenerate scan
--    8-10   each aggregate view, filtered to the current term, inside 250 ms
--   11      the pending-application count inside 100 ms
--
-- WHY:  PRD Performance NFR ("common actions and page loads under 3s"), PRD US-D4 ("the
--   dashboard loads within 3 seconds under normal conditions"), PRD §6 Success Metric 4 and
--   Success Metric 6 (≥600 members and 70 officers across ≥5 terms with queries still inside
--   the 3-second budget). DATA_MODEL.md §10 sizes the five-year world at ~4,000 membership
--   rows over ~700 people. BUILD_PLAN S6-T16.
--
-- WHY 250 ms AND 100 ms RATHER THAN 3,000 ms. The PRD's budget is a PAGE budget and the
--   database is one of its four consumers — Manila-to-Singapore round trips (~40 ms each,
--   and an RSC dashboard makes several), the RSC render, and the client hydration take the
--   rest. Four aggregate queries at 250 ms would already be a second of the three before a
--   byte is rendered. The budget here is deliberately the fraction of the whole that the
--   database is entitled to, not the whole.
--
-- ⚠ MEASURED AS crrd_admin, NOT AS THE SESSION ROLE, AND THAT IS THE POINT. The session role
--   is a superuser and carries BYPASSRLS, so a timing taken while logged out would measure
--   the aggregate WITHOUT the policy evaluation that every real request pays for — and it is
--   exactly the policy evaluation (memberships_read, called once per row through a
--   security_invoker view) that this design chose to accept. Timing it without RLS would
--   measure a system nobody runs.
--
-- ⚠ THE PLAN SHAPE IS DELIBERATELY NOT ASSERTED. At ~800 people and ~4,000 memberships the
--   planner may legitimately choose a sequential scan over any index in 0006 or 0029, and it
--   may choose differently on a different machine or after a different ANALYZE. An assertion
--   about index usage here would be a flake, not a guarantee. **Capture
--   `explain (analyze, buffers)` by hand and paste it into the PR's Verified line** — that
--   is BUILD_PLAN S6-T16's acceptance, and S7-T19 records which index the planner actually
--   chose at deployed volume, where the answer is worth something.
--
-- ⚠ IF ONE OF 8-11 GOES RED, THE FIX ORDER IS FIXED (BUILD_PLAN S7-T20) AND IT DOES NOT
--   START WITH CODE: (1) read the plan; (2) add or correct an index in a NEW forward-only
--   migration with an existence assertion beside it; (3) if the cost is N round trips rather
--   than one slow query, collapse the aggregate into ONE definer RPC — and note that doing
--   so means writing the scoping by hand and deleting ADR 0007 first, which is a decision,
--   not an optimisation; (4) only then touch React. **Explicitly forbidden: a cache layer, a
--   client query library, or reaching for the service-role key to skip a policy evaluation.**
--
-- ⚠ NO FIXTURE HELPER BEYOND fixtures.psql. dashboard-fixtures.psql is deliberately NOT
--   included: its eleven rows would be noise against 4,000 and its carefully-derived counts
--   are asserted in 065, where nothing else moves them. This file seeds its own volume and
--   asserts only shape and time.
--
-- CITATION:  BUILD_PLAN S6-T16, S7-T18, S7-T19, S7-T20; ADR 0007; ARCHITECTURE.md §8;
--            DATA_MODEL.md §10; PRD §4 (Performance NFR), US-D4, US-I2;
--            PRD §6 Success Metrics 4 and 6.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(11);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- THE VOLUME SEED  —  in-transaction, rolled back, never near production
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Everything below runs as the SESSION ROLE and dies with the ROLLBACK at the foot of the
-- file. It is not `supabase/seed.sql` (production-safe reference data) and it is not
-- supabase/fixtures/load_600.sql (S7-T18's persistent scratch/preview fixture).
--
-- ★ VOLUME ROWS CARRY NO member_id, AND THAT IS LOAD-BEARING. ★
--   `people.member_id` is nullable and its unique index tolerates any number of NULLs, so
--   800 rows insert cleanly without one. Writing member_ids here would either (a) invent
--   them literally, which desynchronises member_id_counters so the next real
--   approve_application() collides on the unique index — in front of the demo — or (b) call
--   allocate_member_id() 800 times, which is a row-at-a-time definer call that would dominate
--   the runtime of a performance test. **The allocator is left completely untouched**, which
--   is also why 048_member_id_concurrency.sql and this file can never disagree.
--
-- IDs are CONSTRUCTED rather than generated so memberships can be joined back to their
-- person without a RETURNING round trip, and so a failure names a row you can find:
--   people       …b900-<12-digit i>
--   memberships  …c900-<12-digit (term_index * 10000 + i)>
--   committees   …e900-<12-digit k>
--   terms        …d900-<12-digit g>
-- None of those blocks collides with fixtures.psql (…a000/b000/c000/d000/e000),
-- records-fixtures.psql (…b100/c100) or review-fixtures.psql (…8000).

-- ── four more terms, giving five that carry volume ─────────────────────────────────
-- Inserted as 'draft' and archived at the END of the seed. The order is not optional:
-- trg_memberships_freeze_archived (0006) fires BEFORE INSERT and BEFORE UPDATE, so a
-- membership cannot be written into — or corrected inside — an already-archived term. This
-- is the same three-step dance fixtures.psql documents for its single historical term.
--
-- Dates satisfy both CBL Art. V §1 CHECKs: ends_on falls in May, and ends_on is in the year
-- after starts_on. Labels cannot collide with fixtures.psql's 2025-2026 or 0016's 2026-2027.
-- Only one term may be `active` at a time (the one_active_term partial unique index), which
-- is precisely why these are drafts and the volume's "current term" is the seeded one.
insert into public.terms (id, label, starts_on, ends_on, status)
select ('00000000-0000-4000-d900-' || lpad(g::text, 12, '0'))::uuid,
       (2020 + g)::text || '-' || (2021 + g)::text,
       make_date(2020 + g, 6, 1),
       make_date(2021 + g, 5, 31),
       'draft'
from generate_series(1, 4) g;

-- idx 0 is the ACTIVE term — the one every dashboard query filters to. 1..4 are history.
create temp table vol_terms (idx int primary key, term_id uuid not null);

insert into vol_terms (idx, term_id)
select 0, pg_temp.fx_active_term()
union all
select g, ('00000000-0000-4000-d900-' || lpad(g::text, 12, '0'))::uuid
from generate_series(1, 4) g;

-- ── 800 people ─────────────────────────────────────────────────────────────────────
-- Names only. Every sensitive column is left NULL: nothing in this file can reach one (the
-- three aggregate views expose no `people` column at all — 066 asserts it), and 800 rows of
-- synthetic PII would be 800 more strings for the middleware-off crawls to have to reason
-- about. The diacritic and planted-literal duties belong to fixtures.psql's six.
insert into public.people (id, join_year, given_name, family_name)
select ('00000000-0000-4000-b900-' || lpad(i::text, 12, '0'))::uuid,
       2022 + (i % 5),
       'Vol' || i,
       'Loadfixture' || (i % 97)
from generate_series(1, 800) i;

-- ── 4,000 memberships: 800 people × 5 terms ────────────────────────────────────────
-- DATA_MODEL.md §10 sizes the five-year world at "~4,000 memberships, ~700 people". 800 × 5
-- lands the MEMBERSHIP count exactly on that figure, and the membership count is the one the
-- 3-second budget is actually about — every dashboard query scans memberships, none of them
-- scans people at all.
--
-- Regions round-robin over sort_order 1..18, so all eighteen are populated (RA 12000 added
-- the Negros Island Region; 0016 seeds 18, never 17) and the region view has its full width.
-- Joining on sort_order rather than a code list keeps the seed correct if a region is ever
-- renamed.
--
-- status: 'renewal_pending' for one row in twenty of the CURRENT term, 'active' otherwise.
-- Those are the only two states enforce_membership_transition() (0028) admits on INSERT — a
-- membership cannot be BORN graduated — so the other statuses are reached by UPDATE below.
insert into public.memberships (
  id, person_id, term_id, status, region_id, year_level, expected_grad_year
)
select ('00000000-0000-4000-c900-' || lpad((t.idx * 10000 + i)::text, 12, '0'))::uuid,
       ('00000000-0000-4000-b900-' || lpad(i::text, 12, '0'))::uuid,
       t.term_id,
       (case when t.idx = 0 and i % 20 = 0 then 'renewal_pending' else 'active' end)::public.membership_status,
       r.id,
       1 + (i % 8),
       2027 + (i % 4)
from generate_series(1, 800) i
cross join vol_terms t
join public.regions r on r.sort_order = 1 + (i % 18);

-- ── status diversity, CURRENT TERM ONLY ────────────────────────────────────────────
-- The status view is measured against the current term, so the current term is where the
-- buckets have to exist. For t.idx = 0 the constructed membership id reduces to lpad(i), so
-- these three statements can target rows by arithmetic without a join back.
--
-- active -> graduated / resigned / left are all legal edges in 0028's ONE inline VALUES list
-- and NONE of them carries a role guard: only the two `terminated` edges are reserved to
-- exec_admin (CBL Art. VII §3.2.3) and only they demand a written ground. So these succeed as
-- the session role with no JWT claims, which is the state this file runs in. **Do not add a
-- `terminated` bucket here** — it would need an exec_admin session and a ≥10-character
-- ended_reason per row, and it would be testing 0028 rather than the dashboard.
--
-- 40 of each, leaving 640 active + 40 renewal_pending = 680 volume rows in the current term,
-- plus fixtures.psql's 4. Comfortably over PRD Success Metric 6's 600-member bar.
update public.memberships set status = 'graduated'
 where status = 'active'
   and id in (select ('00000000-0000-4000-c900-' || lpad(i::text, 12, '0'))::uuid
                from generate_series(1, 800) i where i % 20 = 1);

update public.memberships set status = 'resigned'
 where status = 'active'
   and id in (select ('00000000-0000-4000-c900-' || lpad(i::text, 12, '0'))::uuid
                from generate_series(1, 800) i where i % 20 = 2);

update public.memberships set status = 'left'
 where status = 'active'
   and id in (select ('00000000-0000-4000-c900-' || lpad(i::text, 12, '0'))::uuid
                from generate_series(1, 800) i where i % 20 = 3);

-- ── 15 committees and 160 seats in the current term ────────────────────────────────
-- CBL Art. III §5: committees are discretionary and per-term, so 0016 seeds none and volume
-- creates its own. department_id is left NULL (it is nullable in 0007) — the committee
-- aggregate never joins departments, and hanging fifteen synthetic committees off the seven
-- constitutional departments would imply a structure the CBL does not describe.
--
-- One membership in five gets exactly one seat, so the view's NULL (unassigned) bucket holds
-- the other four fifths — which is the realistic shape and the one that makes the LEFT JOIN
-- the expensive part of the query rather than a rounding error.
insert into public.committees (id, term_id, department_id, code, name)
select ('00000000-0000-4000-e900-' || lpad(k::text, 12, '0'))::uuid,
       (select term_id from vol_terms where idx = 0),
       null,
       'VOL_CMTE_' || k,
       'Volume Committee ' || k
from generate_series(1, 15) k;

-- `1 + ((i / 5) % 15)`, NOT `1 + (i % 15)`: i is always a multiple of 5, and
-- (multiple-of-5 % 15) cycles only {5, 10, 0} — three committees get every seat and
-- twelve get none, which under-populates the view and breaks assertion 6. Dividing
-- by the stride first walks all fifteen.
insert into public.committee_memberships (membership_id, committee_id)
select ('00000000-0000-4000-c900-' || lpad(i::text, 12, '0'))::uuid,
       ('00000000-0000-4000-e900-' || lpad((1 + ((i / 5) % 15))::text, 12, '0'))::uuid
from generate_series(1, 800) i
where i % 5 = 0;

-- ── 300 pending applications ───────────────────────────────────────────────────────
-- The dashboard's fourth number (PRD US-D4). `pending_has_proof` (0008) requires a document
-- reference on any row that has left `draft`, and `applications_one_live_per_email_per_term`
-- makes the email unique per term for non-draft rows — hence the generated address.
-- trg_applications_status_transition is BEFORE UPDATE only, so inserting `pending` directly
-- is legitimate and is what helpers/review-fixtures.psql already does.
insert into public.applications (
  id, term_id, status,
  applicant_email, applicant_given_name, applicant_family_name,
  proof_drive_file_id, proof_mime_type, proof_size_bytes, proof_verified_at,
  noa_drive_file_id, submitted_at, consented_at
)
select ('00000000-0000-4000-8900-' || lpad(i::text, 12, '0'))::uuid,
       (select term_id from vol_terms where idx = 0),
       'pending',
       'vol.applicant.' || i || '@fixture.start-sys.test',
       'VolApplicant' || i, 'Loadfixture',
       'ref-vol-' || i, 'application/pdf', 524288, now(),
       'noa-vol-' || i,
       now() - (i || ' minutes')::interval, now()
from generate_series(1, 300) i;

-- ── freeze the four historical terms ───────────────────────────────────────────────
-- Must come AFTER every membership write above. This is the same statement roll_over_term()
-- runs, and after it those four terms are genuinely read-only for every role including
-- exec_admin (DATA_MODEL.md §7.3).
update public.terms
   set status = 'archived', archived_at = now()
 where id in (select term_id from vol_terms where idx > 0)
   and status <> 'archived';

-- ── ANALYZE, and it is not optional ────────────────────────────────────────────────
-- Four tables just went from six rows to thousands inside an open transaction. Without fresh
-- statistics the planner is working from the pre-seed catalog — it will believe `memberships`
-- has five rows and pick a plan for five rows, and 8-11 would then be timing a pathological
-- choice rather than the system. ANALYZE is permitted inside a transaction block and its
-- effects roll back with everything else.
analyze public.people;
analyze public.memberships;
analyze public.committee_memberships;
analyze public.committees;
analyze public.applications;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — the seed landed
--
-- cmp_ok('>=') rather than exact equality on purpose: fixtures.psql contributes six people,
-- five memberships and two terms of its own, and pinning a total here would make this
-- performance file fail whenever an unrelated fixture gained a row. The numbers that must be
-- exact are asserted in 065, against data nothing else moves.
-- ═══════════════════════════════════════════════════════════════════════════════════

select cmp_ok(
  (select count(*)::int from public.memberships), '>=', 4000,
  'the volume seed landed ≥4,000 membership rows — DATA_MODEL.md §10''s five-year figure, '
  'and the table every dashboard query scans'
);

select cmp_ok(
  (select count(*)::int from public.people), '>=', 800,
  'the volume seed landed ≥800 people — none of them carrying a member_id, so '
  'member_id_counters and allocate_member_id() are untouched'
);

select cmp_ok(
  (select count(*)::int from public.terms), '>=', 5,
  'at least five terms exist — PRD Success Metric 6 asks for ≥5 years of history'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-7 — the seed landed in the right SHAPE
--
-- A performance assertion over an empty or single-bucket result is a performance assertion
-- about nothing. These four are what make 8-11 mean something: five status buckets, all
-- eighteen regions, fifteen committees plus the unassigned bucket, and a non-zero pending
-- count. Measured as the session role, before impersonation, because they are facts about
-- the seed rather than about a policy.
-- ═══════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.v_membership_status_counts
    where term_id = public.current_term_id()),
  5,
  'the current term carries all five seeded status buckets — active, renewal_pending, '
  'graduated, resigned, left'
);

select is(
  (select count(*)::int from public.v_membership_region_counts
    where term_id = public.current_term_id()),
  18,
  'all 18 regions are populated in the current term, so the region view is measured at its '
  'full width (RA 12000 — it is 18, never 17)'
);

select is(
  (select count(*)::int from public.v_membership_committee_counts
    where term_id = public.current_term_id()),
  17,
  '15 volume committees + the base fixture committee (helpers/fixtures.psql, 2 seats) + '
  'the NULL (unassigned) bucket — the LEFT JOIN is carrying four fifths of the term, '
  'which is the realistic and the expensive shape'
);

select is(
  (select count(*)::int from public.applications
    where term_id = public.current_term_id() and status = 'pending'),
  300,
  '300 pending applications back the dashboard''s pending tile (PRD US-D4)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 8-11 — the budget, measured THROUGH the policies
--
-- crrd_admin, not the session role: a superuser carries BYPASSRLS and would skip the
-- memberships_read evaluation that every real request pays for. See the header.
--
-- Each query is the one the dashboard actually issues (BUILD_PLAN S6-T9): the view filtered
-- to current_term_id(). current_term_id() is a STABLE definer so Postgres evaluates it once
-- per statement, not once per row.
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin (CCDO)

select performs_ok(
  $$ select status, member_count from public.v_membership_status_counts
      where term_id = public.current_term_id() $$,
  250,
  'status counts for the current term inside 250 ms at five-year volume, WITH RLS applied'
);

select performs_ok(
  $$ select region_id, region_code, region_name, island_group, member_count
       from public.v_membership_region_counts
      where term_id = public.current_term_id() $$,
  250,
  'region counts for the current term inside 250 ms at five-year volume'
);

select performs_ok(
  $$ select committee_id, committee_code, committee_name, member_count
       from public.v_membership_committee_counts
      where term_id = public.current_term_id() $$,
  250,
  'committee counts for the current term inside 250 ms — the LEFT JOIN case, and the one '
  'most likely to be the first to need an index if this ever goes red'
);

select performs_ok(
  $$ select count(*) from public.applications
      where term_id = public.current_term_id() and status = 'pending' $$,
  100,
  'the pending-application count inside 100 ms — served by applications_term_status (0008)'
);

select pg_temp.logout();


select * from finish();

rollback;
