-- ═══════════════════════════════════════════════════════════════════════════════════
-- 048_member_id_concurrency.sql  —  the member-ID allocator: contention, shape, immutability
--
-- ⚠⚠ READ THIS BEFORE JUDGING WHAT THIS FILE ASSERTS ⚠⚠
--
--   **THIS FILE DOES NOT PROVE CONCURRENCY, AND IT CANNOT.** `supabase test db` wraps every
--   test file in a single transaction that is rolled back at the end, so the fixtures below
--   are invisible to any second connection and true 50-way parallelism is unreachable from
--   here. A test that opened a second connection would see an empty database; a test that
--   used dblink would be testing dblink.
--
--   **THE REAL 50-WAY PROOF IS `lib/applications/approve-application.test.ts`**
--   (BUILD_PLAN S4-T12): fifty CONCURRENT PostgREST connections calling
--   approve_application(), asserting fifty distinct gapless ids, on three consecutive runs
--   from a fresh `pnpm db:reset`. That is the shape the race actually takes during
--   application week, and it is the file to look at if a duplicate member ID is ever
--   reported.
--
--   ⚠ DO NOT WEAKEN THAT VITEST FILE TO LOOK LIKE THIS ONE, AND DO NOT INFLATE THIS ONE TO
--   LOOK LIKE THAT ONE. ARCHITECTURE.md §5 and CONVENTIONS.md §8.2 both describe a "pgTAP
--   concurrency test"; BUILD_PLAN S4-T23 records the divergence deliberately. What pgTAP
--   genuinely can assert is everything below: the allocator's behaviour under repeated
--   contention on ONE connection, the STRUCTURE of the statement that makes it safe, the
--   {3,} rollover, and the immutability trigger.
--
-- WHAT:
--    1     positive control — a fresh person gets a well-formed id
--    2-4   fifty sequential allocations: fifty DISTINCT, CONTIGUOUS ids and last_seq = 50
--    5-6   the STRUCTURE that makes it race-safe: `on conflict` present, `max(` absent
--    7-8   the {3,} rollover — 2098-999 becomes 2098-1000, not a collision
--    9-11  the immutability trigger: it exists, it refuses a renumber, it permits allocation
--   12-13  a membership insert leaves member_id untouched; a second allocate is idempotent
--   14-15  the definer hygiene and the EXECUTE revoke
--
-- WHY 5-6 ARE STRUCTURAL AND NOT BEHAVIOURAL. The lost-update race that `max(seq) + 1`
--   introduces is by definition invisible on one connection: a single session reading and
--   then writing always sees its own write. So the assertion has to be about the SHAPE of the
--   statement rather than its outcome — `on conflict … do update set last_seq = last_seq + 1`
--   is one statement holding one row lock, and `max(` is the signature of the thing it
--   replaced. A future maintainer "simplifying" the upsert fails assertion 5 or 6 here, and
--   the expensive proof in Vitest is the backstop.
--
-- DEDICATED JOIN YEARS. 2099 for the fifty-allocation loop and 2098 for the rollover, so
--   neither collides with the 2022-2025 member_id literals in helpers/fixtures.psql or with
--   the (2024, 7) counter row in helpers/review-fixtures.psql. helpers/review-fixtures.psql is
--   deliberately NOT included: this file seeds its own people and would only inherit an
--   irrelevant counter.
--
-- CITATION:  BUILD_PLAN S4-T1, S4-T10, S4-T12, S4-T23; DATA_MODEL.md §4, §6/0004, §6/0012;
--            ARCHITECTURE.md §6; PRD §3 v1.0 item 9; PRD US-C3, US-C4, US-H5;
--            CONVENTIONS.md §0 rule 5, §8.2.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(15);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- fixture: a bulk allocator, run on the SESSION role
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Each iteration inserts a person and immediately allocates, which is the shape
-- approve_application() produces. Materialised into a temp table so the fifty ids can be
-- asserted from several angles without allocating another fifty each time a set-returning
-- function is referenced.
--
-- The session role is the function owner, so the EXECUTE revoke in 0022 does not apply here
-- — assertion 15 covers that boundary from the other side.
create or replace function pg_temp.fx_alloc_many(p_year int, p_n int)
returns setof text
language plpgsql as $$
declare
  v_pid uuid;
  i     int;
begin
  for i in 1..p_n loop
    insert into public.people (join_year, given_name, family_name)
    values (p_year, 'Seq', 'Person ' || lpad(i::text, 3, '0'))
    returning id into v_pid;

    return next public.allocate_member_id(v_pid);
  end loop;
end;
$$;

create temp table fx_alloc (member_id text);
insert into fx_alloc select * from pg_temp.fx_alloc_many(2099, 50);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-4 — repeated allocation
-- ═══════════════════════════════════════════════════════════════════════════════════

select matches(
  (select member_id from fx_alloc limit 1),
  '^\d{4}-\d{3,}$',
  'POSITIVE CONTROL — an allocated member_id matches the PRD''s joinYear-sequence shape. '
  'Nothing below is trusted until this does'
);

select is(
  (select count(distinct member_id)::int from fx_alloc), 50,
  'fifty allocations produce fifty DISTINCT member IDs — zero duplicates. Asserted as a '
  'distinct count, so two identical ids would show as 49 rather than hiding in a total'
);

-- CONTIGUITY, not merely distinctness. A gap means somebody reached for a SEQUENCE, which is
-- non-transactional: a failed approval would permanently burn 2027-004 and the series would
-- acquire a hole that is a support question forever (DATA_MODEL.md §4).
select is(
  (select array_agg(split_part(member_id, '-', 2)::int order by split_part(member_id, '-', 2)::int)
     from fx_alloc),
  (select array_agg(g) from generate_series(1, 50) g),
  'the fifty sequences are exactly 1..50 — CONTIGUOUS, no gaps. A gap is the signature of a '
  'SEQUENCE, whose non-transactional counter burns a number on every failed approval'
);

select is(
  (select last_seq from public.member_id_counters where join_year = 2099), 50,
  'the counter row agrees with what was handed out: last_seq = 50. A seed or a fixture that '
  'writes member_id literals WITHOUT advancing this row is how the first real approval '
  'collides on the unique index, in front of the demo (BUILD_PLAN S5-T12)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5-6 — the structure that makes it race-safe
-- ═══════════════════════════════════════════════════════════════════════════════════
-- See the header: the lost-update race is invisible on one connection, so what is asserted
-- is the statement's SHAPE. These two assertions are the entire pgTAP-side defence against a
-- future "simplification" of the allocator.

select ok(
  (select p.prosrc ~* 'on\s+conflict'
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'allocate_member_id'),
  'allocate_member_id() allocates with `on conflict … do update` — ONE statement taking ONE '
  'row-level exclusive lock on ONE counter row. Concurrent approvals serialize on it and '
  'each receives a distinct sequence'
);

select ok(
  (select p.prosrc !~* 'max\s*\('
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'allocate_member_id'),
  'allocate_member_id() contains NO `max(` — `max(seq) + 1` is the classic lost-update race: '
  'two concurrent approvals read the same max, write the same successor, and one fails at '
  'random on the unique index in front of an applicant'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7-8 — the {3,} rollover
-- ═══════════════════════════════════════════════════════════════════════════════════
-- people.member_id_format is `^\d{4}-\d{3,}$` — three OR MORE. lpad(seq, 3, '0') pads the
-- first 999 and leaves the 1000th alone, so the thousandth member of a year becomes
-- 2098-1000 rather than colliding with 2098-100 or being truncated. 600 members a year makes
-- this unlikely and not impossible, and the failure it prevents is a duplicate primary
-- identifier.
insert into public.member_id_counters (join_year, last_seq) values (2098, 999);

insert into public.people (id, join_year, given_name, family_name)
values ('00000000-0000-4000-b000-0000000009ff', 2098, 'Thousandth', 'Member');

select is(
  public.allocate_member_id('00000000-0000-4000-b000-0000000009ff'),
  '2098-1000',
  'the 1000th member of a year gets 2098-1000, not 2098-100 and not a truncation — the `{3,}` '
  'in member_id_format is load-bearing and lpad only pads, never trims'
);

select is(
  (select member_id from public.people where id = '00000000-0000-4000-b000-0000000009ff'),
  '2098-1000',
  'and the four-digit sequence was actually ACCEPTED by member_id_format and stored — a CHECK '
  'written `{3}` would have refused this insert instead'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-11 — the immutability trigger  (PRD US-C4)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- "Any attempt to change an existing member ID is refused AT THE DATA LAYER, INCLUDING BY AN
-- ADMINISTRATOR." Everything in this block runs as the SESSION ROLE — the migration owner,
-- with BYPASSRLS and every privilege — because that is the caller a policy cannot see and a
-- trigger can.

select has_trigger(
  'public', 'people', 'trg_people_freeze_member_id',
  'trg_people_freeze_member_id exists on public.people — CONVENTIONS.md §3.1 names it, and '
  'without it PRD US-C4 is a UI convention rather than a property of the database'
);

select throws_ok(
  $$ update public.people set member_id = '2026-999'
      where id = '00000000-0000-4000-b000-000000000004' $$,
  '23514'::char(5), null::text,
  'RENUMBERING AN EXISTING MEMBER RAISES — 2024-001 cannot become 2026-999, not from the app, '
  'not from a Server Action, not from a panicked psql session at 2am (PRD US-C4)'
);

-- ⚠ AND THE EDGE THAT MUST LIVE. A trigger that refused every member_id write would pass the
-- assertion above and break allocate_member_id() entirely. NULL -> value is the allocation.
insert into public.people (id, join_year, given_name, family_name)
values ('00000000-0000-4000-b000-0000000009fe', 2097, 'Fresh', 'Allocation');

select lives_ok(
  $$ update public.people set member_id = '2097-001'
      where id = '00000000-0000-4000-b000-0000000009fe' $$,
  'NULL -> value LIVES — the trigger freezes an ISSUED id, not the act of issuing one. '
  'Asserted so a trigger that refuses everything cannot pass this file'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12-13 — the structural guarantee, and idempotency
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ★ DATA_MODEL.md §4 mechanism 1: THE ID IS NOT ON THE THING THAT CHANGES. ★
-- member_id lives on `people`; renewal inserts a `memberships` row. There is no code path
-- that could renumber anyone because the number is not on the record renewal writes. P2 has
-- no membership in helpers/fixtures.psql, so this insert is exactly the renewal shape.
insert into public.memberships (person_id, term_id, status, region_id, year_level, expected_grad_year)
values ('00000000-0000-4000-b000-000000000002', pg_temp.fx_active_term(), 'active',
        pg_temp.fx_region('NCR'), 4, 2027);

select is(
  (select member_id from public.people where id = '00000000-0000-4000-b000-000000000002'),
  '2022-002',
  'inserting a NEW TERM''S MEMBERSHIP leaves member_id untouched at 2022-002 — PRD US-H5, and '
  'the reason it is true is structural rather than careful: the number is not on the row that '
  'renewal writes'
);

select is(
  public.allocate_member_id('00000000-0000-4000-b000-000000000002'),
  '2022-002',
  'allocate_member_id() is IDEMPOTENT — it early-returns an existing id rather than minting a '
  'second one, which is what makes a retried approval safe (PRD US-C3) and a renewal keep its '
  'number (PRD US-C4)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14-15 — definer hygiene and the EXECUTE revoke
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(
  (select p.prosecdef and array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path=%'
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'allocate_member_id'),
  'allocate_member_id() is SECURITY DEFINER **and** pins search_path — CONVENTIONS.md §3.4. '
  'A definer without a pinned search_path can be handed a different `people` table by a '
  'caller-controlled schema'
);

-- The footgun BUILD_PLAN S4-T1 names: definer functions are granted to PUBLIC by default.
-- Asserted from the catalog here; 047 asserts the same boundary behaviourally across all
-- nine fixtures.
select ok(
  not has_function_privilege('authenticated', 'public.allocate_member_id(uuid)', 'EXECUTE'),
  'authenticated holds NO EXECUTE on allocate_member_id() — the privilege IS the boundary '
  'here, because member_id_counters deliberately has no policy at all and there is nothing '
  'behind the revoke to catch a miss'
);


select * from finish();

rollback;
