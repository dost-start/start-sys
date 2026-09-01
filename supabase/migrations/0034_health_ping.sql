-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0034_health_ping.sql
--
-- WHAT:      One function — `public.health_ping() returns integer` — that returns 1 and
--            touches nothing. Granted EXECUTE to anon and authenticated.
--
-- WHY:       BUILD_PLAN S7-T3/S7-T4, PRD §IV NFR 7 (Availability). Better Stack pings
--            `/api/health` every three minutes from two regions, and that endpoint must
--            prove POSTGRES ANSWERED — not that Vercel's edge returned a 200. A route
--            handler that returns `{status:'ok'}` without a round trip to the database is
--            green during a total database outage, which is the exact failure the 99.9%
--            target exists to catch. `/api/health` therefore calls this RPC through the
--            **anon** client and reports the measured latency.
--
--            ARCHITECTURE.md §8: "the endpoint runs a real `SELECT 1`, not a bare 200."
--            This is that SELECT 1, given a name so the route handler needs no table.
--
-- CBL/PRD:   PRD §IV NFR 7 (Availability, measured and reported — explicitly NOT a
--            contractual SLA, PRD §4 Non-Goals); PRD Success Metrics, operational targets.
--
-- ROLLBACK:  Forward-only (CONVENTIONS.md §3.4). Reverting is a later migration that
--            drops the function; nothing depends on it but the health route, which would
--            then fail closed — which is the correct direction for a health check.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- FOUR PROPERTIES, EACH DELIBERATE — 090_health_ping.sql asserts all four
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- 1. **NOT `SECURITY DEFINER`.** This is the only function in the schema that anon may
--    call which is *not* a definer, and that is the point: a definer function bypasses RLS
--    by construction, so a definer function reachable by an unauthenticated caller is a
--    hole in the wall regardless of what the policies say (0015 §5). A health check needs
--    no elevated rights, so it takes none. It also therefore needs no `SET search_path`,
--    because its body resolves nothing — see property 3.
--
-- 2. **TOUCHES NO TABLE.** `select 1`, and nothing else. Three consequences: the ping
--    discloses nothing whatever to an anonymous caller; it cannot be turned into an
--    enumeration oracle by a later edit that "just adds a count"; and it needs no RLS
--    reasoning at all. If a future maintainer wants a deeper check — row counts, replica
--    lag — that is a SECOND, authenticated endpoint, not a widening of this one.
--
-- 3. **`language sql`, `stable`.** `stable` rather than `immutable` so the planner cannot
--    fold the call away entirely at plan time; the round trip to Postgres IS the
--    measurement, and an immutable constant-folded call would measure Vercel's own CPU.
--
-- 4. **Returns `integer`, not `boolean` or `void`.** The route asserts the value is 1, so a
--    connection that returns *something else* — a pooler error page, a truncated response —
--    is a failed health check rather than a silent pass on a nullable boolean.
--
-- ⚠ DO NOT "OPTIMISE" THIS INTO THE ROUTE HANDLER. A `select 1` issued by supabase-js
--   against a table would need a table, a policy and a grant; naming it as a function is
--   what keeps the anonymous read surface at the four tables 0015 §4 enumerates.
-- ═══════════════════════════════════════════════════════════════════════════════════

create or replace function public.health_ping() returns integer
language sql
stable
as $$
  select 1;
$$;

comment on function public.health_ping() is
  'Liveness probe for GET /api/health (BUILD_PLAN S7-T3/S7-T4, PRD NFR 7). Returns 1 and '
  'touches no table. Deliberately NOT SECURITY DEFINER: a definer function an anonymous '
  'caller can reach bypasses RLS by construction, and a health check needs no elevated '
  'rights. Deliberately not IMMUTABLE: the round trip is the measurement.';

-- Postgres already grants EXECUTE on a new function to PUBLIC, which includes anon. The
-- grants below are written EXPLICITLY anyway, because the anonymous surface must be
-- enumerable by reading migrations rather than by knowing a platform default (0015 §4-§5).
-- This is the one place where relying on that default would have been harmless, and stating
-- it is still cheaper than making a reviewer prove that to themselves.
grant execute on function public.health_ping() to anon;
grant execute on function public.health_ping() to authenticated;
