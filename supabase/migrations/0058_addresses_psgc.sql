-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0058_addresses_psgc.sql
--
-- WHAT:      Two full addresses on `people`, both PSGC-coded — HOME (permanent) and
--            CURRENT (where the scholar actually lives while studying), with a
--            "same as home" flag. Plus `psgc_resolve()`, the one function that turns a
--            barangay code into the five names an address is made of.
--
-- WHY:       Ethan, 2026-09-09: the address stops being typed. Region → Province →
--            City/Municipality → Barangay are picked from `psgc_locations` (0057); only
--            the street line and the postal code are still typed. And the 2026-09-08
--            meeting put BOTH addresses back on the form — a scholar's home province and
--            the boarding house they live in during term are different facts and CRRD
--            needs both.
--
-- ⚠ WHY BOTH THE CODE AND THE NAMES ARE STORED, which looks like duplication and is not:
--
--   · The CODE is the machine answer. It is what a future filter, export or map join uses,
--     and it is stable across spellings.
--   · The NAMES are what the address WAS when the person gave it. The PSA renames places
--     — "Cotabato City", "Municipality of X" becoming "City of X" — and a member's
--     historical record must not silently re-word itself because a later quarter renamed
--     a municipality. `v_email_merge_fields`, the RR contact view and every export read
--     the names with no join, which is also why they are here and not resolved on read.
--
--   The names are resolved SERVER-SIDE from the code (see `psgc_resolve` below), never
--   taken from the client. A client that sends a code gets the PSA's names for it; a
--   client that sends names gets them ignored.
--
-- ⚠ `region_name` IS NOT `memberships.region_id`, AND THE DIFFERENCE MATTERS. `region_id`
--   is the ORG region — resolved from the applicant's university at approval, frozen, and
--   what drives Regional Rep scoping and the member ID. This column is the region of a
--   postal address. A scholar from Bicol studying in Manila has `region_name = 'Region V
--   (Bicol Region)'` on their home address and is scoped to NCR's rep. Merging the two
--   would put them in the wrong rep's list or give them the wrong member ID.
--
-- SENSITIVITY (RA 10173; CBL Art. VIII §6): every new address column is registered. A
--   barangay code identifies a household as precisely as the barangay's name does, so the
--   codes are registered alongside the names — a registered name beside an unregistered
--   code would mask the audit log and leave the same fact in plain sight next to it.
--   `current_address_same_as_home` is a boolean about a form and is deliberately NOT
--   registered.
--
-- ROLLBACK:  Forward-only, additive. Every new column is nullable, so rows that predate
--            this migration stay valid and the backfill below is best-effort by design.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── 1. The home address gains the levels it was missing ─────────────────────────────
-- `address_line`, `city_municipality`, `province` and `postal_code` already exist (0004,
-- returned to the form by ADR 0013). What was missing is the barangay — which is the level
-- a Philippine address is actually delivered to — the Manila sub-municipality, the region,
-- and the codes.
alter table public.people
  add column barangay                 text,
  add column sub_municipality         text,
  add column address_region           text,
  add column psgc_barangay_code       text references public.psgc_locations(code),
  add column psgc_city_code           text references public.psgc_locations(code);

-- ── 2. The current address, in full ─────────────────────────────────────────────────
alter table public.people
  add column current_address_line       text,
  add column current_barangay           text,
  add column current_sub_municipality   text,
  add column current_city_municipality  text,
  add column current_province           text,
  add column current_address_region     text,
  add column current_postal_code        text,
  add column current_psgc_barangay_code text references public.psgc_locations(code),
  add column current_psgc_city_code     text references public.psgc_locations(code),
  -- Ticked by default because it is true for most applicants, and because the form copies
  -- home into current when it is ticked rather than leaving current empty — an empty
  -- current address and "same as home" are different claims and must not look alike.
  add column current_address_same_as_home boolean not null default true;

comment on column public.people.barangay is
  'SENSITIVE (RA 10173): home barangay NAME as the PSA spelled it when the scholar gave '
  'it. The code beside it is the machine answer; this is the historical one.';
comment on column public.people.sub_municipality is
  'SENSITIVE: only ever set inside the City of Manila, whose fourteen districts (Tondo, '
  'Binondo, Sampaloc …) sit between the city and the barangay. Null everywhere else.';
comment on column public.people.address_region is
  'SENSITIVE: the region of the HOME ADDRESS. NOT memberships.region_id, which is the org '
  'region resolved from the university at approval and drives Regional Rep scoping. Named '
  '`address_region` and not `region_name` because that name is already taken by '
  'v_member_directory''s ORG region, and two different regions under one name in one system '
  'is how somebody eventually reads the wrong one.';
comment on column public.people.psgc_barangay_code is
  'The PSA 10-digit code of the home barangay — the authoritative machine value for the '
  'whole home address, since every level above it is an ancestor of this row.';
comment on column public.people.current_address_same_as_home is
  'The applicant ticked "same as home". The current_* columns are still FILLED when this '
  'is true — a copy, not an absence — so a reader never has to branch to know where '
  'somebody lives.';

-- ── 3. The registry (DATA_MODEL.md §13 rule 4) ──────────────────────────────────────
-- Registered in the SAME migration that creates them, so `mask_sensitive()` redacts them
-- before they reach the audit log and the five-year purge will clear them.
-- 099_security_invariants.sql asserts every pair here names a column that exists.
insert into public.sensitive_column_registry (table_name, column_name, rationale) values
  ('people', 'barangay',                   'Home barangay — the delivery-level component of a home address.'),
  ('people', 'sub_municipality',           'Home sub-municipality (City of Manila only) — an address component.'),
  ('people', 'address_region',             'Home address region — an address component, not the org region.'),
  ('people', 'psgc_barangay_code',         'PSA code of the home barangay; identifies a household as precisely as the name.'),
  ('people', 'psgc_city_code',             'PSA code of the home city or municipality.'),
  ('people', 'current_address_line',       'Current street address — where the scholar actually lives while studying.'),
  ('people', 'current_barangay',           'Current barangay.'),
  ('people', 'current_sub_municipality',   'Current sub-municipality (City of Manila only).'),
  ('people', 'current_city_municipality',  'Current city or municipality.'),
  ('people', 'current_province',           'Current province.'),
  ('people', 'current_address_region',     'Current address region.'),
  ('people', 'current_postal_code',        'Current postal code.'),
  ('people', 'current_psgc_barangay_code', 'PSA code of the current barangay.'),
  ('people', 'current_psgc_city_code',     'PSA code of the current city or municipality.')
on conflict (table_name, column_name) do nothing;

-- ── 4. psgc_resolve() — a barangay code becomes an address ──────────────────────────
-- ONE function, called by every write path (0059), so the five names an address is made of
-- are derived from the PSA's own rows and never from what a client typed.
--
-- SECURITY INVOKER (the default) and STABLE: it reads only `psgc_locations`, which is
-- anon-readable public reference data (0057). There is nothing here to elevate for, and a
-- definer would take the read out of RLS for no benefit.
--
-- ⚠ RAISES on a code that is not a barangay. Every non-barangay node in the PSA
--   publication has children, so a complete address always ends at a barangay — a code
--   that stops short is a truncated address, and storing one silently is how a member ends
--   up with a city and no street.
create or replace function public.psgc_resolve(p_code text)
returns table (
  barangay_name         text,
  sub_municipality_name text,
  city_name             text,
  province_name         text,
  region_name           text,
  city_code             text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_level public.psgc_level;
begin
  if p_code is null then
    return;                                   -- absence is not an error; the caller decides
  end if;

  select l.level into v_level from public.psgc_locations l where l.code = p_code;
  if v_level is null then
    raise exception 'psgc_resolve: % is not a PSGC code in this publication', p_code
      using errcode = '23503';                -- foreign_key_violation: it names nothing
  end if;
  if v_level <> 'barangay' then
    raise exception 'psgc_resolve: % is a %, not a barangay — an address must name the barangay it is delivered to', p_code, v_level
      using errcode = '22023';                -- invalid_parameter_value
  end if;

  return query
  with recursive chain as (
    select l.code, l.name, l.level, l.parent_code
      from public.psgc_locations l
     where l.code = p_code
    union all
    select p.code, p.name, p.level, p.parent_code
      from public.psgc_locations p
      join chain c on c.parent_code = p.code
  )
  select
    max(name) filter (where level = 'barangay'),
    max(name) filter (where level = 'sub_municipality'),
    -- A city and a municipality are the same rung; an address names one or the other.
    max(name) filter (where level in ('city', 'municipality')),
    max(name) filter (where level = 'province'),
    max(name) filter (where level = 'region'),
    max(code) filter (where level in ('city', 'municipality'))
  from chain;
end;
$$;

comment on function public.psgc_resolve(text) is
  'A barangay code -> the five names and the city code that make up an address, read from '
  'the PSA rows in 0057. The single place an address''s names come from; no write path may '
  'take them from a client.';

-- Anon calls it through the public forms; every authenticated tier through the review and
-- edit screens. It discloses only public reference data.
grant execute on function public.psgc_resolve(text) to anon, authenticated;

-- ── 5. Backfill, deliberately timid ─────────────────────────────────────────────────
-- Rows written before today hold a TYPED province and city and no barangay at all, so the
-- most that can ever be recovered is the city code — and only where the typed name matches
-- exactly one PSA row once case, spacing and the "City of X" / "X City" inversion are
-- normalised.
--
-- ⚠ AMBIGUOUS AND UNMATCHED ROWS ARE LEFT NULL, ON PURPOSE. There are duplicate
--   municipality names across provinces (there are four San Isidros in Nueva Ecija alone),
--   and guessing between them writes a WRONG address that looks exactly like a right one.
--   A null is visibly missing; a wrong barangay is not. CRRD re-asks the handful that
--   matter, which for a system with no approved members yet is zero people.
--
--   The names themselves are NOT rewritten either. What the scholar typed stays what the
--   scholar typed, because that is what they attested to.
with normalised as (
  select p.id,
         lower(btrim(p.city_municipality)) as typed_city,
         lower(btrim(p.province))          as typed_province
    from public.people p
   where p.psgc_city_code is null
     and p.city_municipality is not null
     and btrim(p.city_municipality) <> ''
),
-- Each PSA city/municipality, under every spelling a person plausibly types: the PSA's own
-- ("City of Manila"), the inverted one ("Manila City"), and the bare one ("Manila").
psa as (
  select l.code,
         l.parent_code,
         lower(l.name)                                                       as spelling
    from public.psgc_locations l
   where l.level in ('city', 'municipality')
  union
  select l.code, l.parent_code,
         lower(btrim(regexp_replace(l.name, '^City of\s+', '', 'i')))
    from public.psgc_locations l
   where l.level in ('city', 'municipality') and l.name ~* '^City of\s+'
  union
  select l.code, l.parent_code,
         lower(btrim(regexp_replace(l.name, '^City of\s+', '', 'i')) || ' city')
    from public.psgc_locations l
   where l.level in ('city', 'municipality') and l.name ~* '^City of\s+'
),
-- The typed province, where it also resolves, narrows the candidate set. A city name that
-- is ambiguous nationally is usually unique inside its province.
scoped as (
  select n.id, psa.code,
         (select count(*) from public.psgc_locations pr
           where pr.code = psa.parent_code
             and pr.level = 'province'
             and lower(pr.name) = n.typed_province) as province_agrees
    from normalised n
    join psa on psa.spelling = n.typed_city
),
unique_hit as (
  select id, min(code) as code
    from (
      -- Prefer a match whose province also agrees; fall back to a nationally unique name.
      select id, code from scoped where province_agrees = 1
      union all
      select id, code from scoped
       where not exists (select 1 from scoped s2 where s2.id = scoped.id and s2.province_agrees = 1)
    ) candidates
   group by id
  having count(distinct code) = 1
)
update public.people p
   set psgc_city_code = u.code
  from unique_hit u
 where p.id = u.id;

-- Nothing prints from a migration, so the report the plan asked for is a query a
-- maintainer runs after this lands (it is in the PR body and in the implementation
-- report). Deliberately not an exception: an unmatched legacy address is the expected
-- outcome for most rows, not a failure.
