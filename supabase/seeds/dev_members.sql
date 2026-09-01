-- ═══════════════════════════════════════════════════════════════════════════════════
-- supabase/seeds/dev_members.sql  —  a deterministic development member roster
--
-- ⚠⚠ SCRATCH AND PREVIEW DATABASES ONLY. NEVER PRODUCTION, NEVER THE PRODUCTION SUPABASE
--    PROJECT, NEVER A BRANCH POINTED AT ONE. ⚠⚠
--    Every person below is fabricated, but they occupy the same tables, counters and member
--    ID series as real scholars — and there is no DELETE policy anywhere in this schema, so
--    a mistaken run against production cannot be undone from the application. It would have
--    to be corrected by a restore.
--
-- ⚠ THIS IS NOT `supabase/seed.sql`. That file is production-safe REFERENCE data (the 18
--   regions, the 23 CBL positions, the seven departments) and is applied by every
--   `supabase db reset`. This one is run BY HAND, is never referenced from config.toml, and
--   never runs in CI.
--
-- USAGE:     psql "$SUPABASE_DB_URL" -f supabase/seeds/dev_members.sql
--            (after `supabase db reset`, so migrations 0001-0030 and seed.sql have run)
--
-- WHAT IT IS FOR:  giving /members, its facets and its pagination something real to be wrong
--   about. A grid tested against six fixture rows looks correct with a broken GROUP BY, a
--   broken page-2 offset and an unused index.
--
-- ⚠ 120 PEOPLE, NOT 600, AND THAT IS A DELIBERATE CUT. BUILD_PLAN S5-T12's risk row
--   pre-agreed it: **exact counts matter more than volume for every test in this slice
--   except the timing measurement.** 120 rows exercise every shape (multi-committee members,
--   diacritics, near-duplicates, alumni with no current membership, five terms of history)
--   while staying small enough to reason about by hand. The 5-year, 600-member, ~4,000-row
--   VOLUME fixture is S7-T18's `supabase/fixtures/load_600.sql`, which exists to make the
--   3-second budget measurable (PRD Success Metric 6). Two fixtures, two jobs; conflating
--   them gives a slow one that nobody can hand-verify.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ★ EXACT COUNTS THIS FILE PRODUCES ★
--   Deterministic — no random(), no now()-derived branching. A second machine running it
--   against a fresh reset gets identical numbers, which is what makes it usable as the
--   baseline for a hand-checked screenshot.
--
--     terms created here ......................... 4    (2022-2023 … 2025-2026, all archived)
--     people .................................... 120
--       per join year (2022, 2023, 2024, 2025, 2026)  24 each
--     member_id_counters: last_seq per join year . 24   (ALLOCATED, never written literally)
--     memberships ............................... 140
--       current term (2026-2027) ................ 100
--           active .............................. 70
--           renewal_pending ..................... 10
--           graduated ........................... 10
--           resigned ............................  5
--           left ................................  5
--           terminated ..........................  0    ← deliberately absent, see below
--       2025-2026 (archived, "history") .........  20   (the first 20 people, status active)
--       2024-2025 (archived, "alumni") ..........  20   (people 101-120, status graduated)
--     committees created here ....................  2   (DEV_OUTREACH, DEV_RESEARCH)
--     committee_memberships ......................  14  (2 people on BOTH, 10 on one)
--     department_assignments .....................  10  (all to CRRD)
--     regions represented ........................  18  (round-robin, so every facet has rows)
--
--   ⚠ NO `terminated` MEMBERSHIPS ARE SEEDED, AND THAT IS THE POINT. CBL Art. VII §3.2.3
--     makes termination an act of the Executive Board, and 0028 enforces it: the transition
--     requires auth_role() = 'exec_admin' AND a fresh written ground. A seed has no acting
--     officer, so fabricating one would mean either impersonating a CEO in a data file or
--     weakening the trigger. A dev database with no terminated members is honest; one with
--     invented Executive Board rulings is not. Exercise that path through the UI, or through
--     060_membership_transitions.sql, which is where it belongs.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠ MEMBER IDs ARE **ALLOCATED**, NEVER WRITTEN. Every id comes from
--   public.allocate_member_id(), the same single-statement counter-table upsert
--   approve_application() uses (DATA_MODEL.md §4 mechanism 2). Writing '2024-001' literally
--   would leave member_id_counters empty while the ids exist, and **the very first real
--   approval would then mint 2024-001 again and collide on the unique index — in front of a
--   demo, in the one code path the whole system is judged on.** This is the trap
--   BUILD_PLAN S5-T12 names, and the acceptance criterion is arithmetic: max(last_seq) for
--   each join year must equal the number of people seeded for that year.
--
-- ⚠ ARCHIVED TERMS ARE FILLED BEFORE THEY ARE FROZEN. reject_write_to_archived_term() (0005)
--   refuses every write to a term whose status is 'archived', for every role including
--   exec_admin. So each historical term is created as 'draft', populated, and archived at the
--   end — the same three-step shape helpers/fixtures.psql uses, and the same shape
--   roll_over_term() produces going forward.
--
-- ⚠ NON-ACTIVE STATUSES ARE REACHED BY TRANSITION, NOT BY INSERT.
--   enforce_membership_transition() (0028) permits only `active` and `renewal_pending` as
--   starting states, so a graduated member is inserted active and then transitioned. That is
--   not a workaround: it means this seed produces only states the application itself could
--   have produced, which is the difference between a fixture and a fiction.
--
-- CITATION:  BUILD_PLAN S5-T12; DATA_MODEL.md §3.1, §4, §6/0005, §7.1, §10;
--            PRD §3 v1.0 items 10, 11, 12; PRD US-C3, US-C4, US-D3, US-H1, US-I2, US-I3.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0 — preconditions and the re-run guard
-- ═══════════════════════════════════════════════════════════════════════════════════
-- There is no DELETE path in this schema, so a second run cannot be cleaned up — it would
-- silently double every count this file's header promises and desynchronise nothing visibly.
-- The guard is a RAISE rather than an `on conflict do nothing`, because a partially-applied
-- second run is worse than a refused one.
do $$
declare
  v_term uuid;
begin
  if exists (
    select 1 from public.people
     where personal_email = 'dev.seed.sentinel@start-sys.invalid'
  ) then
    raise exception
      'dev_members.sql has already been applied to this database (sentinel person found). It is NOT idempotent and there is no DELETE path to undo it — reset the database with `supabase db reset` and run it once.';
  end if;

  select id into v_term from public.terms where status = 'active';
  if v_term is null then
    raise exception
      'no ACTIVE term exists. Run `supabase db reset` first so migrations 0001-0030 and supabase/seed.sql have created the bootstrap term.';
  end if;

  if (select count(*) from public.regions) < 18 then
    raise exception
      'fewer than 18 regions are seeded. supabase/seed.sql has not run — this file round-robins across all 18 so every region facet has rows.';
  end if;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — four historical terms, created as `draft` so they can be populated
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Both CBL Art. V §1 CHECKs are satisfied: ends_on falls in May, and ends_on is in the year
-- after starts_on. Consecutive, no gaps — the shape roll_over_term() produces.
insert into public.terms (label, starts_on, ends_on, status)
values
  ('2022-2023', date '2022-06-01', date '2023-05-31', 'draft'),
  ('2023-2024', date '2023-06-01', date '2024-05-31', 'draft'),
  ('2024-2025', date '2024-06-01', date '2025-05-31', 'draft'),
  ('2025-2026', date '2025-06-01', date '2026-05-31', 'draft')
on conflict (label) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — 120 people, 140 memberships, and every member ID allocated
-- ═══════════════════════════════════════════════════════════════════════════════════
do $$
declare
  -- Deterministic name pools. Coprime-ish lengths (12 and 15) so given/family pairs do not
  -- repeat until person 60, which keeps name search meaningful without random().
  v_given  text[] := array[
    'Ana','Bianca','Carlo','Diego','Elena','Francis','Grace','Hannah',
    'Ivan','Jasmine','Kier','Luis'];
  v_family text[] := array[
    'Aquino','Bautista','Castro','Domingo','Espiritu','Flores','Garcia','Hernandez',
    'Ilagan','Jimenez','Lim','Mendoza','Navarro','Ocampo','Ramos'];
  v_regions uuid[];
  v_term_now  uuid;
  v_term_hist uuid;   -- 2025-2026, for the first 20 people's prior-term row
  v_term_alum uuid;   -- 2024-2025, for the 20 alumni
  v_dept_crrd uuid;
  v_cmte_out  uuid;
  v_cmte_res  uuid;
  v_person    uuid;
  v_membership uuid;
  v_join_year int;
  v_status    text;
  i int;
begin
  select array_agg(id order by sort_order) into v_regions from public.regions;
  select id into v_term_now  from public.terms where status = 'active';
  select id into v_term_hist from public.terms where label = '2025-2026';
  select id into v_term_alum from public.terms where label = '2024-2025';
  select id into v_dept_crrd from public.departments
   where term_id = v_term_now and code = 'CRRD';

  -- ── two committees. CBL Art. III §5 makes committees discretionary and per-term, so none
  -- is seeded by supabase/seed.sql and both are created here at runtime — which is also the
  -- proof that creating one needs no migration (ARCHITECTURE.md §4.4).
  insert into public.committees (term_id, department_id, code, name)
  values (v_term_now, v_dept_crrd, 'DEV_OUTREACH', 'Dev Outreach Committee')
  returning id into v_cmte_out;

  insert into public.committees (term_id, department_id, code, name)
  values (v_term_now, v_dept_crrd, 'DEV_RESEARCH', 'Dev Research Committee')
  returning id into v_cmte_res;

  for i in 0..119 loop
    v_join_year := 2022 + (i % 5);

    insert into public.people (
      join_year, given_name, middle_name, family_name,
      birthdate, contact_number, personal_email,
      address_line, city_municipality, province, postal_code,
      school, school_id_no
    )
    values (
      v_join_year,
      -- Three deliberate overrides on top of the pools, each buying a specific test:
      --   i=5  a diacritic surname, so pg_trgm's accent behaviour is exercised by real data
      --        rather than assumed (PRD US-I2 — and note accent FOLDING is not implemented,
      --        see docs/issues/2026-09-05-accent-tolerant-search.md)
      --   i=6/7 a NEAR-DUPLICATE pair sharing a surname and a first name, so a search UI that
      --        silently collapses similar rows, or a de-dupe that keys on name, is visible
      case i when 6 then 'Juan' when 7 then 'Juan Miguel'
             else v_given[1 + (i % array_length(v_given, 1))] end,
      'Dev',
      case i when 5 then 'Peña' when 6 then 'Dela Cruz' when 7 then 'Dela Cruz'
             else v_family[1 + (i % array_length(v_family, 1))] end,
      date '2001-01-01' + (i * 11),
      '+63917' || lpad((1000000 + i)::text, 7, '0'),
      -- Person 0 carries the sentinel this file's re-run guard looks for.
      case i when 0 then 'dev.seed.sentinel@start-sys.invalid'
             else 'dev.seed.' || lpad(i::text, 3, '0') || '@start-sys.invalid' end,
      'Dev Seed Street ' || i,
      'Quezon City', 'Metro Manila', '1100',
      'Dev Seed University',
      'DEV-SCH-' || lpad(i::text, 3, '0')
    )
    returning id into v_person;

    -- ⚠ ALLOCATED, NEVER WRITTEN. See the header. member_id_counters is advanced by the same
    -- function approve_application() calls, so the series this seed hands out and the series
    -- the first real approval continues are one series.
    perform public.allocate_member_id(v_person);

    if i < 100 then
      -- ── the current term ──
      -- i % 20 gives a stable status mix: residues 0-13 active, 14-15 renewal_pending,
      -- 16-17 graduated, 18 resigned, 19 left. Over i = 0..99 each residue occurs five times,
      -- which is where the 70/10/10/5/5 split in the header comes from.
      v_status := case
        when (i % 20) < 14 then 'active'
        when (i % 20) < 16 then 'renewal_pending'
        when (i % 20) < 18 then 'graduated'
        when (i % 20) = 18 then 'resigned'
        else                    'left'
      end;

      insert into public.memberships (
        person_id, term_id, status, region_id, year_level, expected_grad_year
      )
      values (
        v_person, v_term_now,
        -- Only the two legal STARTING states are inserted (0028's INSERT branch); the rest
        -- are reached by transition immediately below.
        case when v_status = 'renewal_pending' then 'renewal_pending'::public.membership_status
             else 'active'::public.membership_status end,
        v_regions[1 + (i % 18)],
        1 + (i % 5),
        2027 + (i % 4)
      )
      returning id into v_membership;

      if v_status in ('graduated', 'resigned', 'left') then
        update public.memberships
           set status = v_status::public.membership_status,
               ended_reason = 'dev seed: ' || v_status
         where id = v_membership;
      end if;

      -- ── committee service, for the first twelve ──
      -- TWO people on TWO committees each. Without them search_member_directory()'s GROUP BY
      -- and array_agg are never exercised, and a build that dropped the dedupe would look
      -- correct on every screen.
      if i < 12 then
        insert into public.committee_memberships (membership_id, committee_id)
        values (v_membership, v_cmte_out);
      end if;
      if i < 2 then
        insert into public.committee_memberships (membership_id, committee_id)
        values (v_membership, v_cmte_res);
      end if;

      -- ── department assignment, for the first ten ──
      if i < 10 then
        insert into public.department_assignments (membership_id, department_id)
        values (v_membership, v_dept_crrd);
      end if;

      -- ── a prior-term row for the first twenty, so the member detail page has a real
      -- history to render and PRD US-H5 (the member ID does NOT change across terms) is
      -- visible rather than asserted. Same person, different term — DATA_MODEL.md §2.3.
      if i < 20 then
        insert into public.memberships (
          person_id, term_id, status, region_id, year_level, expected_grad_year
        )
        values (v_person, v_term_hist, 'active', v_regions[1 + (i % 18)],
                1 + (i % 5), 2027 + (i % 4));
      end if;

    else
      -- ── the twenty alumni: history and nothing current ──
      -- No current-term membership at all, so the dashboards' "wiped clean" behaviour and the
      -- renewal-eligibility predicate both have a population that is NOT simply everyone.
      insert into public.memberships (
        person_id, term_id, status, region_id, year_level, expected_grad_year
      )
      values (v_person, v_term_alum, 'active', v_regions[1 + (i % 18)], 4, 2025)
      returning id into v_membership;

      update public.memberships
         set status = 'graduated', ended_reason = 'dev seed: graduated alumnus'
       where id = v_membership;
    end if;
  end loop;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — freeze the historical terms
-- ═══════════════════════════════════════════════════════════════════════════════════
-- LAST, because reject_write_to_archived_term() (0005) refuses every write to an archived
-- term for every role including exec_admin. After this statement the two populated
-- historical terms are genuinely read-only and the member detail page's term history is
-- rendering real archived data rather than draft rows that happen to be old.
update public.terms
   set status = 'archived', archived_at = now()
 where label in ('2022-2023', '2023-2024', '2024-2025', '2025-2026')
   and status <> 'archived';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4 — self-check: fail loudly rather than leave a half-seeded database
-- ═══════════════════════════════════════════════════════════════════════════════════
-- These are the same numbers the header promises. A seed that silently produced 118 people
-- would send someone debugging a filter that is working correctly.
--
-- The counter assertion is the one that matters most: if last_seq for a join year does not
-- equal the number of people seeded for that year, member_id_counters and the issued ids have
-- diverged and the next real approval will collide (DATA_MODEL.md §4).
do $$
declare
  v_people int;
  v_members int;
  v_bad_year int;
  v_no_id int;
begin
  select count(*) into v_people  from public.people;
  select count(*) into v_members from public.memberships;

  if v_people < 120 then
    raise exception 'dev seed self-check: expected at least 120 people, found %', v_people;
  end if;
  if v_members < 140 then
    raise exception 'dev seed self-check: expected at least 140 memberships, found %', v_members;
  end if;

  select count(*) into v_no_id from public.people where member_id is null;
  if v_no_id > 0 then
    raise exception
      'dev seed self-check: % people have no member_id — allocate_member_id() did not run for every row', v_no_id;
  end if;

  select count(*) into v_bad_year
  from (
    select p.join_year, count(*) as n
    from public.people p
    group by p.join_year
  ) s
  join public.member_id_counters c on c.join_year = s.join_year
  -- `<` rather than `<>`: the counter must be AT LEAST as high as the number of people in
  -- that join year. A lower counter means ids were written literally somewhere and the next
  -- allocation will re-issue one. A HIGHER counter is legitimate — a real approval that was
  -- rolled back burns a sequence number by design (DATA_MODEL.md §4), which is exactly the
  -- gap a per-year SEQUENCE would have made permanent.
  where c.last_seq < s.n;

  if v_bad_year > 0 then
    raise exception
      'dev seed self-check: member_id_counters is OUT OF SYNC for % join year(s). The ids handed out and the counter disagree, so the next real approval will collide on people.member_id (DATA_MODEL.md §4).', v_bad_year;
  end if;
end;
$$;

commit;
