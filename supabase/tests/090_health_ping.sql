-- ═══════════════════════════════════════════════════════════════════════════════════
-- 090_health_ping.sql  —  the liveness probe behind the 99.9% number
--
-- WHAT:
--    1     the function exists with the expected signature and return type
--    2     it is `language sql`
--    3     it is STABLE — not IMMUTABLE, so the planner cannot fold the round trip away
--    4     it is NOT SECURITY DEFINER  ⟵ THE ONE THAT MATTERS
--    5     it touches no object in `public` — asserted against the body, not by trust
--    6-7   anon and authenticated both hold EXECUTE
--    8     called AS ANON it returns exactly 1
--
-- WHY:  BUILD_PLAN S7-T3/S7-T4; PRD §IV NFR 7 (Availability). Better Stack pings
--       /api/health every three minutes from two regions and the monitor expects a body
--       containing "status":"ok". A 200 that did not reach Postgres is a green monitor
--       during a total database outage — precisely the failure the availability target
--       exists to catch — so the route calls this RPC through the ANON client and reports
--       the measured latency. This file is what keeps that call honest.
--
-- ⚠ ASSERTION 4 IS THE LOAD-BEARING ONE. `health_ping()` is the only function an
--   unauthenticated caller may execute that is not SECURITY DEFINER, and it must stay that
--   way: a definer function bypasses RLS by construction, so a definer function reachable
--   by anon is a hole in the wall regardless of what the policies say (0015 §5). If a
--   future maintainer "deepens" this check into something that reads a table, they will
--   reach for SECURITY DEFINER to make it work — and this assertion is what stops that from
--   merging silently. The correct answer is a SECOND, authenticated endpoint.
--
-- ⚠ AND ASSERTION 5 IS ITS PAIR. A ping that counts rows is an enumeration oracle an
--   anonymous caller can poll every three seconds. `select 1` discloses nothing, needs no
--   RLS reasoning, and cannot be turned into one by an edit that "just adds a count".
--
-- CITATION: BUILD_PLAN S7-T3, S7-T4; ARCHITECTURE.md §8 ("the endpoint runs a real
--           SELECT 1, not a bare 200"); PRD §IV NFR 7; PRD §4 Non-Goals (99.9% is measured
--           and reported, explicitly NOT a contractual SLA).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(8);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — shape
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 1 — integer, not boolean and not void: the route asserts the value IS 1, so a connection
-- that returns something else (a pooler error page, a truncated response) fails the health
-- check rather than passing silently on a nullable boolean.
-- pg_get_function_result rather than pgTAP's function_returns(), whose `args` overloads are
-- easy to get subtly wrong for a zero-argument function — and a shape assertion that passed
-- for the wrong reason would be worse than none.
select is(
  (select pg_get_function_result(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'health_ping'),
  'integer',
  'health_ping() returns integer — the route asserts the VALUE is 1, so a malformed '
  'response fails the check instead of passing on a nullable boolean'
);

-- 2 — plain SQL. No plpgsql frame, nothing to grow into.
select is(
  (select l.lanname
     from pg_proc p
     join pg_language l on l.oid = p.prolang
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'health_ping'),
  'sql',
  'health_ping() is `language sql` — the smallest thing that can prove Postgres answered'
);

-- 3 — STABLE ('s'), deliberately not IMMUTABLE ('i'). An immutable constant-folded call
-- would be answered by the planner and would measure Vercel's own CPU rather than the round
-- trip to ap-southeast-1, which IS the measurement.
select is(
  (select p.provolatile::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'health_ping'),
  's',
  'health_ping() is STABLE, not IMMUTABLE — the round trip is the measurement, and an '
  'immutable call could be folded away at plan time'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-5 — the two properties that keep an anonymous-reachable function harmless
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 4 — see the ⚠ note in the header.
select ok(
  not (select p.prosecdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'health_ping'),
  'health_ping() is NOT SECURITY DEFINER — the only anon-executable function in the schema '
  'that is not one, and it must stay that way: a definer function anon can call bypasses '
  'RLS by construction (0015 §5)'
);

-- 5 — the body names nothing in `public`. Asserted against prosrc rather than assumed,
-- because "it only returns 1" is a claim that survives exactly until someone adds a count.
select ok(
  (select p.prosrc !~ 'public\.'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'health_ping'),
  'health_ping() references no object in `public` — a ping that counted rows would be an '
  'enumeration oracle an anonymous caller could poll every three seconds'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 6-7 — the grants, explicitly
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Postgres grants EXECUTE to PUBLIC by default, so these would pass without 0034's explicit
-- grants. They are asserted anyway: the anonymous surface must be enumerable by reading
-- migrations and tests, not by knowing a platform default (0015 §4).

select ok(
  has_function_privilege('anon', 'public.health_ping()', 'execute'),
  'anon holds EXECUTE on health_ping() — /api/health calls it through the ANON client, '
  'never the service role, so the probe carries no privilege of its own'
);

select ok(
  has_function_privilege('authenticated', 'public.health_ping()', 'execute'),
  'authenticated holds EXECUTE on health_ping() too — a logged-in probe is the same probe'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 8 — the behaviour, as the role that actually calls it
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Every assertion above reads the catalog. This one executes the function through the
-- anonymous path, which is what a green monitor actually depends on.

select pg_temp.login_anon();

select is(
  (select public.health_ping()),
  1,
  'AS ANON, health_ping() returns exactly 1 — the whole of what a green /api/health means'
);

select pg_temp.logout();


select * from finish();

rollback;
