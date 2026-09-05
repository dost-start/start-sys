-- ═══════════════════════════════════════════════════════════════════════════════════
-- 076_campaign_audience_picker.sql  —  the composer's people picker (0047)
--
-- WHAT:
--    1     both functions are SECURITY DEFINER with search_path pinned, and EXECUTE is
--          authenticated-only (no anon, no public)
--    2     resolve_recipients: officer is refused BEFORE the selection layer is even
--          consulted — a person_ids-carrying filter is not a way around the role guard
--    3-6   resolve_recipients: each of the four new axes (department, committee,
--          university, year level) narrows the audience on its own
--    7     select_all=false + person_ids returns EXACTLY the picks, nothing from the axes
--    8     excluded_person_ids removes one person from an otherwise select_all=true set
--    9     a hand-picked GRADUATED member is included even though `statuses` defaults to
--          ['active'] — the whole point of a hand-pick is overriding the filter
--   10     a hand-pick with NO personal_email is not included, even via person_ids
--   11     a pre-0047 filter shape (old axes only, no select_all/person_ids/etc. keys)
--          resolves exactly as it did under 0043 — an absent key means select_all=true
--   12     list_audience_candidates: officer is refused (42501)
--   13     crrd_admin, filtered to one region, sees exactly that region's two current-term
--          scholars, and total_count agrees on every row
--   14     list_audience_candidates IGNORES select_all/person_ids/excluded_person_ids —
--          the total is the axis-matched set regardless of what selection state rides
--          along in the same jsonb
--   15-16  p_q matches a family name and a member-ID substring, case-insensitively
--   17-19  p_limit/p_offset page a four-row result deterministically, ordered by
--          family_name, given_name, person_id, with a stable total_count across pages
--   20-21  one row's department_name and position_title match the department_assignments
--          / officer_assignments rows seeded for it — dynamically compared against the
--          seeded rows themselves, never a hardcoded department or position title string
--
-- FIXTURE ADDITIONS ON TOP OF helpers/fixtures.psql (all `on conflict do nothing`, all
--   inside this test's own rolled-back transaction):
--     · P3 (crrd_deputy's person, active NCR membership) gets a department_assignments
--       row into the CRRD department of the active term — P3 already holds the DCCDO_C
--       officer_assignments row from fixtures.psql, so ONE person now carries both a
--       department and a position, which is what makes assertions 19-20 real.
--     · P5 (the CTO's person, active R07 membership) gets people.university_id set to
--       'University of San Carlos' (already seeded by 0037), so the university_ids axis
--       has exactly one match.
--     · Two NEW people, block …b800…, neither touched by any other suite:
--         b800…001  'Grace Alumna'   — inserted active, then transitioned active ->
--                    graduated (a legal, unguarded edge per 0028) — the GRADUATED
--                    hand-pick fixture. Has a personal_email.
--         b800…002  'Neil NoEmail'   — active NCR membership, personal_email left NULL —
--                    the hand-pick-without-an-email fixture.
--       Both carry year_level 5 and no department/committee/university, so neither can
--       accidentally satisfy any axis-based assertion in this file — they exist ONLY to
--       be hand-picked by id.
--
-- WHY NO SUBSELECTS AGAINST ROLE-RESTRICTED TABLES WHILE IMPERSONATING: every id this file
--   needs while logged in as `officer` is a literal already known before login (a
--   hardcoded fixture uuid or '{}'::jsonb) — never a query. Every id resolved by SUBSELECT
--   (the CRRD department, the university, the two committee members) is either captured
--   into a temp table under the SESSION role before any login_as/login_anon call, or
--   read while logged in as crrd_admin, which can see every row these subselects touch
--   (departments/committees/officer_assignments/officer_positions/universities are all
--   `using (true)`-readable, or globally anon+authenticated-readable, per 0014/0037).
--   Neither path can silently return NULL because a restricted role's RLS made the row
--   invisible.
--
-- CITATION: 0047; PRD US-G2 "filter recipients"; SRS Email Sending; Ethan 2026-09-06.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(22);

-- ═══════════════════════════════════════════════════════════════════════════════════
-- setup — as the session role, before any login_as/login_anon call
-- ═══════════════════════════════════════════════════════════════════════════════════

-- P3 -> the CRRD department of the active term (captured so the same id can be reused
-- in both the seeding insert and the filter assertion, and so a query for it never runs
-- while impersonating a restricted role).
create temp table fx076_dept_crrd on commit drop as
  select id from public.departments
   where term_id = pg_temp.fx_active_term() and code = 'CRRD';
grant select on fx076_dept_crrd to public;

insert into public.department_assignments (membership_id, department_id)
select '00000000-0000-4000-c000-000000000001', id from fx076_dept_crrd
on conflict do nothing;

-- P5 -> University of San Carlos (0037's R07 seed). Captured for the same reason.
create temp table fx076_uni_usc on commit drop as
  select id from public.universities where name = 'University of San Carlos';
grant select on fx076_uni_usc to public;

update public.people
   set university_id = (select id from fx076_uni_usc)
 where id = '00000000-0000-4000-b000-000000000005';

-- The graduated hand-pick fixture. Inserted 'active' (0028's INSERT branch permits only
-- active/renewal_pending), then transitioned to 'graduated' — a legal, role-unguarded
-- edge (0028 guards ONLY the two `terminated` edges), so this succeeds under the session
-- role with no claims at all.
insert into public.people (id, join_year, given_name, family_name, personal_email)
values
  ('00000000-0000-4000-b800-000000000001', 2026, 'Grace', 'Alumna',
   'grace.alumna@fixture.start-sys.test'),
  ('00000000-0000-4000-b800-000000000002', 2026, 'Neil',  'NoEmail',
   null)
on conflict (id) do nothing;

insert into public.memberships (id, person_id, term_id, status, region_id, year_level, expected_grad_year)
select v.id, v.person_id, pg_temp.fx_active_term(), 'active'::public.membership_status,
       r.id, v.year_level, v.expected_grad_year
from (values
  ('00000000-0000-4000-c800-000000000001'::uuid, '00000000-0000-4000-b800-000000000001'::uuid, 5, 2022),
  ('00000000-0000-4000-c800-000000000002'::uuid, '00000000-0000-4000-b800-000000000002'::uuid, 5, 2030)
) as v(id, person_id, year_level, expected_grad_year)
join public.regions r on r.code = 'NCR'
on conflict do nothing;

update public.memberships
   set status = 'graduated'
 where id = '00000000-0000-4000-c800-000000000001'
   and status <> 'graduated';

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — hygiene: definer, search_path, grants
-- ═══════════════════════════════════════════════════════════════════════════════════
select ok(
  (select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('resolve_recipients', 'list_audience_candidates'))
  and not has_function_privilege('anon', 'public.list_audience_candidates(jsonb, text, int, int)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_audience_candidates(jsonb, text, int, int)', 'EXECUTE'),
  'resolve_recipients and list_audience_candidates both pin search_path, both are SECURITY DEFINER, '
  'and list_audience_candidates is authenticated-only — no anon, no public');

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — the role guard runs before the selection layer
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select * from public.resolve_recipients(
       jsonb_build_object('person_ids', jsonb_build_array('00000000-0000-4000-b000-000000000004'))) $$,
  '42501'::char(5), null::text,
  'officer is refused even when the filter carries a hand-pick — the guard runs before any selection logic');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3-6 — the four new axes narrow the audience
-- ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.resolve_recipients(
     jsonb_build_object('department_ids', jsonb_build_array((select id from fx076_dept_crrd))))),
  1,
  'department_ids narrows to exactly the one scholar (P3) assigned to the CRRD department');

select is(
  (select count(*)::int from public.resolve_recipients(
     jsonb_build_object('committee_ids', jsonb_build_array('00000000-0000-4000-e000-000000000001')))),
  2,
  'committee_ids narrows to exactly the two members of the fixture ethics committee (P4, P6)');

select is(
  (select count(*)::int from public.resolve_recipients(
     jsonb_build_object('university_ids', jsonb_build_array((select id from fx076_uni_usc))))),
  1,
  'university_ids narrows to exactly the one scholar (P5) at University of San Carlos');

select is(
  (select count(*)::int from public.resolve_recipients(
     jsonb_build_object('year_levels', jsonb_build_array(1, 2)))),
  2,
  'year_levels narrows to exactly the two scholars at year 1 or 2 (P4, P6)');

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7-10 — the selection layer
-- ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select array_agg(person_id order by person_id)::uuid[] from public.resolve_recipients(
     jsonb_build_object('select_all', false,
                        'person_ids', jsonb_build_array('00000000-0000-4000-b000-000000000004')))),
  array['00000000-0000-4000-b000-000000000004']::uuid[],
  'select_all=false + person_ids returns EXACTLY the hand-picks, nothing the axes would otherwise match');

select ok(
  (select count(*)::int from public.resolve_recipients(
     jsonb_build_object('excluded_person_ids', jsonb_build_array('00000000-0000-4000-b000-000000000003')))) = 3
  and not exists (
    select 1 from public.resolve_recipients(
      jsonb_build_object('excluded_person_ids', jsonb_build_array('00000000-0000-4000-b000-000000000003')))
    where person_id = '00000000-0000-4000-b000-000000000003'),
  'excluded_person_ids drops P3 from the otherwise select_all=true set of four, leaving exactly three');

select ok(
  exists (
    select 1 from public.resolve_recipients(
      jsonb_build_object('person_ids', jsonb_build_array('00000000-0000-4000-b800-000000000001')))
    where person_id = '00000000-0000-4000-b800-000000000001'),
  'a hand-picked GRADUATED member is included even though statuses defaults to [active] — '
  'a hand-pick overrides every axis, not just the ones that happen to already match');

select is(
  (select count(*)::int from public.resolve_recipients(
     jsonb_build_object('select_all', false,
                        'person_ids', jsonb_build_array('00000000-0000-4000-b800-000000000002')))),
  0,
  'a hand-pick with no personal_email is NOT included, even via person_ids');

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11 — an absent key means select_all=true (a pre-0047 audience_filter still resolves)
-- ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.resolve_recipients(
     jsonb_build_object('region_ids', jsonb_build_array(pg_temp.fx_region('NCR'))))),
  2,
  'a filter shaped exactly like a pre-0047 campaign (region_ids only — no select_all, no '
  'person_ids, no excluded_person_ids, no new axes) still resolves NCR''s two, unchanged');

select pg_temp.logout();

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12 — list_audience_candidates: the role guard
-- ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select throws_ok(
  $$ select * from public.list_audience_candidates('{}'::jsonb) $$,
  '42501'::char(5), null::text,
  'officer cannot list audience candidates — same tier as resolve_recipients and send_campaign');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin

-- The 1,000-entry ceiling on the selection lists holds in the FUNCTION, not only in the
-- composer's zod schema — the RPC is executable by any sending-tier session directly.
select throws_ok(
  $$ select * from public.resolve_recipients(jsonb_build_object(
       'person_ids', (select jsonb_agg(gen_random_uuid()::text) from generate_series(1, 1001)))) $$,
  '22023'::char(5), null::text,
  'resolve_recipients refuses more than 1,000 hand-picked person_ids (22023)');

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13 — a filtered read, with a consistent total_count
-- ═══════════════════════════════════════════════════════════════════════════════════
create temp table fx076_ncr on commit drop as
  select * from public.list_audience_candidates(
    jsonb_build_object('region_ids', jsonb_build_array(pg_temp.fx_region('NCR'))));
grant select on fx076_ncr to public;

select ok(
  (select count(*)::int from fx076_ncr) = 2
  and (select array_agg(distinct total_count) from fx076_ncr) = array[2]::bigint[],
  'region-filtered to NCR, crrd_admin sees exactly two candidates (P3, P4) and total_count '
  'agrees with the row count on every row');

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14 — selection state is ignored entirely
-- ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select total_count from public.list_audience_candidates(
     jsonb_build_object('select_all', false,
                        'person_ids', jsonb_build_array('00000000-0000-4000-b000-000000000004'),
                        'excluded_person_ids', jsonb_build_array('00000000-0000-4000-b000-000000000003')))
   limit 1),
  4::bigint,
  'select_all/person_ids/excluded_person_ids change nothing here — the total is the plain '
  'axis-matched set of four, because the picker is not the resolver');

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 15-16 — free-text search
-- ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select array_agg(person_id) from public.list_audience_candidates('{}'::jsonb, 'santos')),
  array['00000000-0000-4000-b000-000000000003']::uuid[],
  'p_q="santos" (lower-case) matches P3''s family name "Santos", case-insensitively, and nothing else');

select is(
  (select array_agg(person_id) from public.list_audience_candidates('{}'::jsonb, '2024-001')),
  array['00000000-0000-4000-b000-000000000004']::uuid[],
  'p_q="2024-001" matches P4''s member_id substring and nothing else');

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 17-19 — pagination is deterministic and total_count is page-independent
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The default filter's four candidates, ordered by family_name: Dela Cruz(P4), Peña(P6),
-- Reyes(P5), Santos(P3).
create temp table fx076_page1 on commit drop as
  select * from public.list_audience_candidates('{}'::jsonb, null, 2, 0);
grant select on fx076_page1 to public;
create temp table fx076_page2 on commit drop as
  select * from public.list_audience_candidates('{}'::jsonb, null, 2, 2);
grant select on fx076_page2 to public;

select is(
  (select array_agg(person_id order by family_name, given_name, person_id) from fx076_page1),
  array['00000000-0000-4000-b000-000000000004', '00000000-0000-4000-b000-000000000006']::uuid[],
  'page 1 (limit 2, offset 0) returns P4 then P6, ordered by family_name, given_name, person_id');
select ok(
  (select array_agg(distinct total_count) from fx076_page1) = array[4]::bigint[],
  'total_count on page 1 is 4 (the full filtered set) — independent of the page');

select is(
  (select array_agg(person_id order by family_name, given_name, person_id) from fx076_page2),
  array['00000000-0000-4000-b000-000000000005', '00000000-0000-4000-b000-000000000003']::uuid[],
  'page 2 (limit 2, offset 2) returns P5 then P3, and total_count is still 4');

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20-21 — one candidate's department_name and position_title, compared dynamically
-- ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select department_name from public.list_audience_candidates('{}'::jsonb)
    where person_id = '00000000-0000-4000-b000-000000000003'),
  (select dep.name from fx076_dept_crrd fd join public.departments dep on dep.id = fd.id),
  'P3''s department_name is the CRRD department''s own name, from the department_assignments row seeded above');

select is(
  (select position_title from public.list_audience_candidates('{}'::jsonb)
    where person_id = '00000000-0000-4000-b000-000000000003'),
  (select title from public.officer_positions where code = 'DCCDO_C'),
  'P3''s position_title is DCCDO_C''s own title, from the officer_assignments row fixtures.psql already seeded');

select pg_temp.logout();

select * from finish();

rollback;
