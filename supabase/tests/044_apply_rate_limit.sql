-- ═══════════════════════════════════════════════════════════════════════════════════
-- 044_apply_rate_limit.sql  —  the limiter that is a table
--
-- WHAT:
--    1-3   POSITIVE CONTROL and the boundary: the first N calls are permitted, N+1 is not,
--          and N+2 is still not
--    4     a NEW window permits again — the counter is per window, not per key forever
--    5-6   independence: a different key_hash and a different bucket do not interfere
--    7-8   argument validation
--    9-11  the table is unreachable: anon raises, crrd_admin raises, zero policies
--   12     ENABLE + FORCE
--
-- WHY A TABLE AT ALL: ARCHITECTURE.md §5 requires IP + email rate limiting on /apply, and
--   ARCHITECTURE.md §7 / CLAUDE.md ban Redis, Upstash, BullMQ, Inngest and QStash outright.
--   A limiter that costs the 2029 maintainer a second vendor, a second credential and a
--   second failure mode is not worth what it buys on a membership application form. Postgres
--   already has the one row-level lock this needs.
--
-- ⚠ key_hash IS AN HMAC DIGEST AND NEVER A RAW IP OR EMAIL. A raw client IP is personal data
--   under RA 10173, which CBL Art. VIII §6 makes a CONSTITUTIONAL obligation and not merely
--   the applicable statute. lib/rate-limit/index.ts HMACs the subject with
--   RATE_LIMIT_HMAC_KEY before it reaches the database, so what is stored is opaque without a
--   secret the database does not hold. The literals below look like digests for that reason —
--   a test that passed a raw IP would be modelling the wrong thing and would read as
--   permission to do it in the application.
--
-- ⚠ THE CALLER MUST NOT SURFACE `false` AS A DISTINCT ERROR CODE. BUILD_PLAN S3-T7: a
--   rate-limit refusal on /apply comes back as an ordinary `validation` failure with the
--   generic message, because a distinct code is itself a signal — it tells a prober they
--   found a real limiter, on a real endpoint, keyed on something they control. That mapping
--   lives in the Server Action and is asserted by its own unit test; this file asserts the
--   database half.
--
-- ⚠ WHY ASSERTION 4 MOVES A ROW BACKWARDS INSTEAD OF SLEEPING. Windows are aligned to the
--   epoch (`floor(now()/w)*w`), so "the previous window" is computable rather than waitable.
--   Rewinding the row by exactly one window length leaves the CURRENT window with no row at
--   all, and the next call inserts a fresh one. A pg_sleep would make this suite take an hour.
--
-- CITATION:  BUILD_PLAN S3-T7; 0018_apply_rate_limits.sql; ARCHITECTURE.md §5, §7;
--            DATA_MODEL.md §13 rule 8; PRD §3 v1.0 item 5; CBL Art. VIII §6 (RA 10173).
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(12);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- probe: eleven calls, each in ITS OWN STATEMENT
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠ WHY A TABLE OF RESULTS AND NOT `a and b and not c` IN ONE EXPRESSION. check_rate_limit()
--   is VOLATILE and has a side effect — each call increments a counter — so the ORDER of
--   evaluation is the thing under test. Postgres evaluates a boolean expression's operands
--   left to right with short-circuiting, which would work, but "works because of an
--   evaluation-order detail" is exactly the kind of load-bearing coincidence that gets tidied
--   away later. Separate INSERT statements are strictly ordered by definition, and the step
--   number makes a failure say WHICH call went wrong rather than that the conjunction did.
--
-- Limit 3 in a 1-hour window, matching the configured `apply_email` bucket. The CALL ITSELF
-- COUNTS, so steps 1-3 are permitted and step 4 is the first refusal.
create temp table rl_probe (step int primary key, allowed boolean not null) on commit drop;

insert into rl_probe values (1, public.check_rate_limit('apply_email', 'hmac-digest-subject-alpha', 3, interval '1 hour'));
insert into rl_probe values (2, public.check_rate_limit('apply_email', 'hmac-digest-subject-alpha', 3, interval '1 hour'));
insert into rl_probe values (3, public.check_rate_limit('apply_email', 'hmac-digest-subject-alpha', 3, interval '1 hour'));
insert into rl_probe values (4, public.check_rate_limit('apply_email', 'hmac-digest-subject-alpha', 3, interval '1 hour'));
insert into rl_probe values (5, public.check_rate_limit('apply_email', 'hmac-digest-subject-alpha', 3, interval '1 hour'));

-- A NEW WINDOW. Rewinding the exhausted row by exactly one window length: window_started_at
-- is part of the PRIMARY KEY, so after this UPDATE the CURRENT window genuinely has no row
-- and step 6 inserts a fresh one with hit_count 1. See the ⚠ note in the header on why this
-- is a rewind and not a pg_sleep.
update public.rate_limit_buckets
   set window_started_at = window_started_at - interval '1 hour'
 where bucket = 'apply_email'
   and key_hash = 'hmac-digest-subject-alpha';

insert into rl_probe values (6, public.check_rate_limit('apply_email', 'hmac-digest-subject-alpha', 3, interval '1 hour'));

-- Steps 7-9 exhaust alpha again (it is on hit 1 after step 6), so step 10 measures a
-- different subject against a genuinely exhausted neighbour rather than an idle one.
insert into rl_probe values (7, public.check_rate_limit('apply_email', 'hmac-digest-subject-alpha', 3, interval '1 hour'));
insert into rl_probe values (8, public.check_rate_limit('apply_email', 'hmac-digest-subject-alpha', 3, interval '1 hour'));
insert into rl_probe values (9, public.check_rate_limit('apply_email', 'hmac-digest-subject-alpha', 3, interval '1 hour'));
insert into rl_probe values (10, public.check_rate_limit('apply_email', 'hmac-digest-subject-bravo', 3, interval '1 hour'));

-- Same subject, different bucket. apply_ip and apply_email are two limits on one request.
insert into rl_probe values (11, public.check_rate_limit('apply_ip', 'hmac-digest-subject-alpha', 10, interval '1 hour'));


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — the boundary
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 1 — POSITIVE CONTROL. If check_rate_limit() were broken in the deny direction, every
-- assertion below would pass for the wrong reason.
select ok(
  (select allowed from rl_probe where step = 1),
  'POSITIVE CONTROL: the first call within the limit returns TRUE'
);

select ok(
  (select allowed from rl_probe where step = 2)
  and (select allowed from rl_probe where step = 3)
  and not (select allowed from rl_probe where step = 4),
  'calls 2 and 3 are permitted and call 4 is REFUSED — the call itself counts, so N is the '
  'number of permitted attempts and not the number of prior ones'
);

-- 3 — and it stays refused. A limiter that resets on the attempt after the refusal is not a
-- limiter; this is the assertion that catches an increment written inside the wrong branch.
select ok(
  not (select allowed from rl_probe where step = 5),
  'call 5 is still refused — the counter keeps climbing past the limit rather than resetting '
  'on refusal'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4 — a new window permits again
-- ═══════════════════════════════════════════════════════════════════════════════════

select ok(
  (select allowed from rl_probe where step = 6),
  'the SAME subject is permitted again in a NEW window — a fixed window is per (bucket, key, '
  'window), so an exhausted applicant is not locked out forever'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5-6 — independence
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The failure this catches is a limiter keyed too coarsely — one applicant exhausting the
-- bucket and taking every other applicant down with them during application week.

select ok(
  not (select allowed from rl_probe where step = 9)
  and (select allowed from rl_probe where step = 10),
  'a DIFFERENT key_hash is unaffected by an exhausted neighbour — step 9 shows alpha is '
  'genuinely refused at that moment, step 10 shows bravo is not'
);

select ok(
  (select allowed from rl_probe where step = 11),
  'the SAME key_hash in a DIFFERENT bucket has its own budget — apply_ip and apply_email are '
  'two limits on one request, not one limit counted twice'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7-8 — argument validation
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A misconfigured limiter that fails OPEN is worse than no limiter, because it looks like
-- protection. Both of these raise rather than defaulting to something permissive.

select throws_ok(
  $$ select public.check_rate_limit('apply_email', 'hmac-digest-x', -1, interval '1 hour') $$,
  '22023'::char(5), null::text,
  'a negative p_limit RAISES — a misconfigured limiter must not silently become permissive. '
  '(p_limit = 0 is legitimate: it means refuse everything, an emergency switch-off)'
);

select throws_ok(
  $$ select public.check_rate_limit('apply_email', 'hmac-digest-x', 3, interval '0 seconds') $$,
  '22023'::char(5), null::text,
  'a zero-length window RAISES rather than dividing by zero — the window alignment is a '
  'division and the guard is in front of it'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-12 — the table is unreachable
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The third DECLARED unreachable table, alongside member_id_counters and mfa_recovery_codes
-- (026_policy_invariants.sql whitelists all three by name). Deny-by-default used as the
-- MECHANISM rather than as a backstop: 0018 revoked ALL from anon and authenticated, so even
-- a policy added by mistake in 2029 would grant nothing.
--
-- It is not a secret table so much as an unnecessary one: "who tried to apply, and when",
-- even hashed, is a record nobody needs to read to do their job.

-- 9 — positive control for 10 and 11: rows genuinely exist by now, so the refusals below are
-- refusals and not an empty table.
select cmp_ok(
  (select count(*)::int from public.rate_limit_buckets), '>', 0,
  'ANTI-VACUITY CONTROL: rate_limit_buckets has rows when read as the session role, so the '
  'two refusals below are measuring a boundary'
);

select pg_temp.login_anon();
select throws_ok(
  $$ select count(*) from public.rate_limit_buckets $$,
  '42501'::char(5), null::text,
  'anon selecting from rate_limit_buckets RAISES 42501 — 0018 revoked ALL, so this is a '
  'missing privilege and not merely a missing policy'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok(
  $$ select count(*) from public.rate_limit_buckets $$,
  '42501'::char(5), null::text,
  'crrd_admin — the widest operational tier in the system — also RAISES. Unreachable means '
  'unreachable, not "unreachable by strangers"'
);
select pg_temp.logout();

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.rate_limit_buckets'::regclass)
  and (select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'rate_limit_buckets') = 0,
  'rate_limit_buckets has ENABLE + FORCE row level security AND zero policies of any kind — '
  'the absence is the mechanism (026_policy_invariants.sql whitelists it by name)'
);


select * from finish();

rollback;
