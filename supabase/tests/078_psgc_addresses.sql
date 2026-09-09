-- ═══════════════════════════════════════════════════════════════════════════════════
-- 078_psgc_addresses.sql  —  the PSGC cascade and the two addresses it fills
--
-- WHAT:
--    1-3    the publication landed whole, and the hierarchy is intact
--    4-6    OUR eighteen regions map to the PSA's — including the one that would be
--           silently wrong
--    7-9    the two shapes that are NOT four levels deep, asserted by name because they
--           are the reason this is a self-referencing table and not four
--   10-13   psgc_resolve(): the happy path, and the three ways it must refuse
--   14-18   the read boundary — anon reads it, nobody writes it, ever
--   19-21   apply_address_to_person() is not independently callable, and the derived
--           place NAMES are no longer patchable
--   22-24   the address columns are registered sensitive, and RLS is on and forced
--
-- WHY:  PR C2 (2026-09-09). Ethan: "let's make it drop down with drop down filter instead
--   of typing it … the only thing that they will type is their address and postal code."
--   PRD US-B1 (validated fields), US-J1 (sensitive data restricted); CBL Art. VIII §6.
--
-- ⚠ THE ASSERTION THAT WOULD OTHERWISE BE SILENTLY WRONG IS 6. The PSA numbers Caraga
--   `16` and calls it Region XIII; we seed it as `R13`. A mapping written from the numbers
--   alone puts every Caraga address in a region that does not exist, and nothing else in
--   this system would notice — an address is never compared against anything.
--
-- ⚠ WHY 7-9 NAME REAL PLACES rather than counting shapes. "NCR has no provinces" and
--   "Manila has sub-municipalities" are not incidental data — they are the two facts that
--   make a fixed four-step cascade wrong, and Ethan's own example was Binondo. If a later
--   quarter reorganised either, the picker would silently render the wrong number of
--   steps; these three assertions are what would say so.
--
-- CITATION:  PR C2; migrations 0057, 0058, 0059; DATA_MODEL.md §8.1, §13 rules 3, 4, 8;
--            CONVENTIONS.md §8.1; PRD US-B1, US-D1, US-J1.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(24);

create or replace function pg_temp.rows_affected(p_sql text) returns int
language plpgsql
as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — the publication landed whole
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A floor rather than an exact count: a later PSA quarter legitimately adds and merges
-- barangays, and pinning the exact number would turn a routine data refresh into a failing
-- test. What must never happen is a PARTIAL load, which is what this catches.
select cmp_ok(
  (select count(*)::int from public.psgc_locations), '>=', 43000,
  'POSITIVE CONTROL — the PSGC publication loaded whole (43,769 rows as of 2025-Q4); '
  'every assertion below is meaningless against a partial COPY');

select is(
  (select count(*)::int from public.psgc_locations where level = 'region'),
  18,
  'exactly EIGHTEEN regions — the same count DATA_MODEL §6/0016 seeds, incl. RA 12000''s NIR');

-- The FK guarantees a parent EXISTS; this asserts the shape — that only regions are roots.
-- A second root would be an orphaned subtree the cascade could never reach.
select is(
  (select count(*)::int from public.psgc_locations where parent_code is null),
  18,
  'the ONLY rows without a parent are the eighteen regions — no orphaned subtree');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-6 — our regions and the PSA's
-- ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.regions where psgc_code is null),
  0,
  'every one of our regions carries a PSA code — a null here is a region the cascade '
  'cannot start from');

select ok(
  (select bool_and(exists (
      select 1 from public.psgc_locations l
       where l.level = 'region' and left(l.code, 2) = r.psgc_code))
     from public.regions r),
  'every regions.psgc_code names a region the PSA actually publishes');

-- ⚠ THE TRAP. PSA 16 is Region XIII (Caraga); we seed it as R13.
select is(
  (select l.name from public.psgc_locations l
     join public.regions r on r.psgc_code = left(l.code, 2)
    where r.code = 'R13' and l.level = 'region'),
  'Region XIII (Caraga)',
  'our R13 maps to PSA 16 — the ONE mapping the numbers alone would get wrong');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7-9 — the two shapes that are not four levels deep
-- ═══════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.psgc_locations
    where level = 'province' and parent_code = '1300000000'),
  0,
  'NCR HAS NO PROVINCES — its cities hang off the region, which is why the cascade asks '
  'the database for the next level instead of assuming one');

select is(
  (select count(*)::int from public.psgc_locations
    where level = 'sub_municipality' and parent_code = '1380600000'),
  14,
  'the City of Manila has FOURTEEN sub-municipalities — Tondo, Binondo, Sampaloc and the '
  'rest — between the city and the barangay');

select ok(
  (select count(*) > 0 from public.psgc_locations
    where level = 'barangay' and parent_code = '1380602000')
  and exists (select 1 from public.psgc_locations
               where code = '1380500001' and name = 'Addition Hills' and level = 'barangay'),
  'Ethan''s two examples resolve: Binondo (a Manila sub-municipality) has barangays, and '
  'Addition Hills is a barangay directly under the City of Mandaluyong');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-13 — psgc_resolve(): one happy path, three refusals
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1380602001 is "Barangay 287" in Binondo — the DEEPEST chain in the country, so this one
-- call exercises region → city → sub-municipality → barangay.
select is(
  (select r.barangay_name || ' | ' || r.sub_municipality_name || ' | ' || r.city_name
          || ' | ' || coalesce(r.province_name, '(none)') || ' | ' || r.region_name
     from public.psgc_resolve('1380602001') r),
  'Barangay 287 | Binondo | City of Manila | (none) | National Capital Region (NCR)',
  'psgc_resolve walks the deepest chain in the country and reports NO province for NCR');

select throws_ok(
  $$ select * from public.psgc_resolve('1380600000') $$,
  '22023'::char(5), null::text,
  'psgc_resolve REFUSES a city code — an address that stops at the city is truncated, and '
  'storing one silently is how a member ends up with a city and no street');

select throws_ok(
  $$ select * from public.psgc_resolve('9999999999') $$,
  '23503'::char(5), null::text,
  'psgc_resolve refuses a code this publication does not contain');

select is(
  (select count(*)::int from public.psgc_resolve(null)),
  0,
  'a null code returns NO ROWS rather than raising — absence is the caller''s business, '
  'not an error');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14-18 — the read boundary
-- ═══════════════════════════════════════════════════════════════════════════════════
create temp table fx_psgc_total on commit drop as
  select count(*)::int as n from public.psgc_locations;
grant select on fx_psgc_total to public;

-- anon MUST read it: /apply and /renew are anonymous forms and cannot render an address
-- picker they may not read. This is published national reference data about places, not
-- about people.
select pg_temp.login_anon();
select is(
  (select count(*)::int from public.psgc_locations),
  (select n from fx_psgc_total),
  'anon reads the whole PSGC — the public form''s address cascade depends on it');

select throws_ok(
  $$ insert into public.psgc_locations (code, name, level, parent_code)
     values ('9999999998', 'Fictional Barangay', 'barangay', '1380602000') $$,
  '42501'::char(5), null::text,
  'anon CANNOT invent a place — no INSERT policy exists for any role');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin
select is(pg_temp.rows_affected(
  $$ update public.psgc_locations set name = 'Renamed' where code = '1380602000' $$), 0,
  'not even tech_admin can rename a place — a new PSA quarter is a new migration');
select pg_temp.logout();

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'psgc_locations'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'psgc_locations has NO write policy of any kind — read-only to the application by '
  'construction, not by convention');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'psgc_locations' and cmd = 'DELETE'),
  0,
  'and specifically no DELETE policy — CLAUDE.md: none exists anywhere and none may be added');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19-21 — the write helper, and what stopped being patchable
-- ═══════════════════════════════════════════════════════════════════════════════════
-- It writes PII to `people` and performs no role check of its own; the three guarded
-- callers do that. Reachable independently, it would be an unguarded address write.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_address_to_person'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))),
  0,
  'apply_address_to_person is NOT callable by anon or authenticated — it runs only inside '
  'approve_application, approve_renewal and update_member_record');

select ok(
  (select prosecdef and array_to_string(proconfig, ',') like '%search_path=%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_address_to_person'),
  'apply_address_to_person is SECURITY DEFINER with an empty search_path — CONVENTIONS §3.4');

-- 0059 removed the derived name columns from the patch whitelist. A reviewer typing a city
-- next to a code that says otherwise is a member filed under a city they do not live in.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok(
  $$ select public.update_member_record(
       '00000000-0000-4000-b000-000000000001',
       '{"city_municipality":"Somewhere Else"}'::jsonb,
       (select updated_at from public.people where id = '00000000-0000-4000-b000-000000000001')) $$,
  '22023'::char(5), null::text,
  'city_municipality is NO LONGER PATCHABLE — the place names are derived from the '
  'barangay code, never typed beside it (0059)');
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 22-24 — classification and the table's own protections
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Every address column, name AND code. A registered name beside an unregistered code
-- would mask the audit log and leave the same fact in plain sight next to it.
select is(
  (select count(*)::int from public.sensitive_column_registry
    where table_name = 'people'
      and column_name in (
        'barangay', 'sub_municipality', 'region_name',
        'psgc_barangay_code', 'psgc_city_code',
        'current_address_line', 'current_barangay', 'current_sub_municipality',
        'current_city_municipality', 'current_province', 'current_region_name',
        'current_postal_code', 'current_psgc_barangay_code', 'current_psgc_city_code')),
  14,
  'all FOURTEEN new address columns are registered sensitive — codes as well as names '
  '(DATA_MODEL §13 rule 4)');

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'psgc_locations'),
  'psgc_locations has RLS both ENABLED and FORCED — the meta-test in 001 would fail it '
  'otherwise, and this says so at the point of use');

select is(
  (select count(*)::int from public.regions r1
     join public.regions r2 on r1.psgc_code = r2.psgc_code and r1.id <> r2.id),
  0,
  'no two of our regions share a PSA code — a duplicate would double a region in the '
  'cascade and split its members between two identical entries');


select * from finish();

rollback;
