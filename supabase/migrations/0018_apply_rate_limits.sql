-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0018_apply_rate_limits.sql
--
-- WHAT:      Two things that belong together because both exist only to harden the ONE
--            unauthenticated surface this system has:
--              1. The anonymous EXECUTE surface, enumerated in one place.
--              2. rate_limit_buckets + check_rate_limit() — a fixed-window limiter that is
--                 a TABLE, because every other kind of limiter is a banned dependency.
--
-- WHY A TABLE AND NOT REDIS: ARCHITECTURE.md §5 requires IP + email rate limiting on /apply
--            and /login; ARCHITECTURE.md §7 and CLAUDE.md ban Redis, Upstash, BullMQ,
--            Inngest and QStash outright. A limiter that costs a 2029 maintainer a second
--            vendor, a second credential and a second failure mode is not worth what it
--            buys at this volume. Postgres already has the row-level lock this needs.
--
-- WHY THE TABLE HAS NO POLICIES: deny-by-default used as the MECHANISM rather than as a
--            backstop. With FORCE RLS on and no policy for any role, Postgres returns zero
--            rows and refuses every write — so the table is reachable only from inside
--            check_rate_limit(), which is SECURITY DEFINER. It joins member_id_counters and
--            mfa_recovery_codes as the third DECLARED unreachable table, and it is already
--            named in 026_policy_invariants.sql's whitelist against the day it shipped.
--
-- WHY THE KEY IS A HASH: an IP address is personal data under RA 10173 (CBL Art. VIII §6
--            makes that a constitutional obligation, not merely a statutory one). Storing
--            raw client IPs to enforce a rate limit would create a new category of personal
--            data with no retention basis, on the one surface a stranger can reach. The TS
--            wrapper (lib/rate-limit/index.ts) HMACs the key with RATE_LIMIT_HMAC_KEY before
--            it ever reaches this function, so what the database holds is an opaque digest
--            that cannot be reversed into an address without a secret the database does not
--            have. This function takes the digest and never sees the address.
--
-- CITATION:  BUILD_PLAN S3-T2, S3-T7; ARCHITECTURE.md §5 (session hardening), §7 (rejected
--            infrastructure); DATA_MODEL.md §13 rule 8; PRD §3 v1.0 item 5; PRD US-B1;
--            CBL Art. VIII §6 (RA 10173).
--
-- ROLLBACK:  Forward-only. The table holds ephemeral counter state and nothing references it.
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — the anonymous surface, enumerated  (BUILD_PLAN S3-T2)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- **WIDENING THIS LIST IS HOW THE PUBLIC SURFACE LEAKS.** Any addition needs a pgTAP
-- assertion in the same PR (040_anon_surface_grants.sql).
--
-- ALREADY GRANTED IN 0015_grants.sql §4 — VERIFIED BY READING THAT FILE, NOT RE-GRANTED:
--   regions              the application form's region dropdown must render for someone
--                        with no account (PRD US-B1). 18 rows, Philippine geography.
--   officer_positions    the 23 CBL Art. III positions, published in the Constitution itself.
--   terms                narrowed by terms_read_anon to status='active'.
--   application_windows  narrowed by application_windows_read_anon to a window open RIGHT
--                        NOW. This is the pair that makes PRD US-B4 a database fact.
-- Re-granting them here would duplicate the enumeration and create two places to look.
--
-- GRANTED HERE, and it is the only addition S3 makes:
--   current_term_id()    the public form must resolve its own term server-side. The anon
--                        INSERT policy on applications (0008) pins `term_id =
--                        current_term_id()`, and the Server Action sets the column from the
--                        same call rather than accepting a client-supplied term — so the
--                        client never chooses which term it applies to.
--
-- This GRANT is nominally redundant: Postgres grants EXECUTE on a new function to PUBLIC,
-- which includes anon, and 0012 revokes that only for get_person_sensitive(). Stated
-- explicitly anyway, because "anon can call it because nobody remembered to revoke it" and
-- "anon can call it because we decided so" are the same ACL and very different designs, and
-- only one of them survives a reviewer asking why.
--
-- current_term_id() discloses nothing an anonymous visitor cannot already read: terms_read_anon
-- already lets anon see the active term row in full.
grant execute on function public.current_term_id() to anon;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — rate_limit_buckets
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Fixed-window counters. window_started_at is part of the PRIMARY KEY, which is what makes
-- the whole thing one upsert: a new window is a new row rather than a read-modify-write of
-- an old one, so two simultaneous requests serialize on a single row-level lock and neither
-- can lose the other's increment.
--
-- Fixed window rather than sliding window, deliberately. A sliding window needs either a row
-- per request (a log of who tried what and when — which is the personal data this design is
-- trying not to accumulate) or a background decay job (which would need the scheduler, for a
-- control that protects a form). A fixed window permits at worst 2N requests across a window
-- boundary; at N = 10 per hour, on a membership application form, that is not a threat model.
create table public.rate_limit_buckets (
  -- 'apply_ip' | 'apply_email' | ... — free text, so a new limited surface is a new string
  -- rather than an enum migration.
  bucket            text        not null,
  -- The HMAC digest of the subject (see the header). NEVER a raw IP or a raw email address.
  key_hash          text        not null,
  window_started_at timestamptz not null,
  hit_count         int         not null default 0 check (hit_count >= 0),
  primary key (bucket, key_hash, window_started_at)
);

comment on table public.rate_limit_buckets is
  'Fixed-window rate-limit counters for the anonymous surface (ARCHITECTURE.md §5). '
  'DELIBERATELY UNREACHABLE: no policy of any kind, no privilege for anon or authenticated. '
  'Only check_rate_limit() touches it. key_hash is an HMAC digest — a raw IP is personal '
  'data under RA 10173 (CBL Art. VIII §6) and must never be stored here.';

-- ENABLE + FORCE, and then NO POLICIES AT ALL. See the header: the absence is the mechanism.
-- 026_policy_invariants.sql already whitelists this table by name and asserts it carries
-- ZERO policies of any kind, so adding one later fails CI rather than passing review.
alter table public.rate_limit_buckets enable row level security;
alter table public.rate_limit_buckets force  row level security;

-- Supabase's default privileges grant ALL on a new table in public to anon, authenticated
-- and service_role. 0015_grants.sql's DO loop cannot reach this table — it read pg_tables at
-- ITS apply time and this table did not exist then — so the lockdown is done here, in full.
-- The same belt-and-braces member_id_counters gets in 0015 §3: even a policy added by
-- mistake in 2029 would grant nothing, because there is no privilege for it to unlock.
revoke all on public.rate_limit_buckets from anon;
revoke all on public.rate_limit_buckets from authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — check_rate_limit()
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Returns TRUE when the call is within the limit and FALSE when it is not. The call itself
-- COUNTS, so the first p_limit invocations in a window return true and the (p_limit + 1)th
-- returns false.
--
-- ⚠ THE CALLER MUST NOT SURFACE THE FALSE AS A DISTINCT ERROR CODE. BUILD_PLAN S3-T7: a
-- rate-limit refusal on /apply is returned as an ordinary `validation` failure with the
-- generic message, because a distinct code is itself a signal — it tells a prober that they
-- found a real limiter, on a real endpoint, keyed on something they control. The one place a
-- distinct code IS correct on this surface is `window_closed`, and only because the closure
-- of an application period is public information.
--
-- WINDOW ALIGNMENT: windows are aligned to the epoch rather than to first use, so the
-- boundary is a pure function of now() and p_window and two processes computing it agree
-- without coordinating. It is also what lets a test move a row's window_started_at backwards
-- and deterministically land in "the previous window" (044_apply_rate_limit.sql).
--
-- SECURITY DEFINER because the table is unreachable to every caller; SET search_path = '' and
-- fully-qualified names per CONVENTIONS.md §3.4, no exceptions.
create or replace function public.check_rate_limit(
  p_bucket   text,
  p_key_hash text,
  p_limit    int,
  p_window   interval
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_seconds numeric;
  v_window_start   timestamptz;
  v_count          int;
begin
  if p_bucket is null or p_key_hash is null or p_limit is null or p_window is null then
    raise exception 'check_rate_limit: every argument is required'
      using errcode = '22004';   -- null_value_not_allowed
  end if;

  v_window_seconds := extract(epoch from p_window);

  if v_window_seconds is null or v_window_seconds <= 0 then
    raise exception 'check_rate_limit: p_window must be a positive interval'
      using errcode = '22023';   -- invalid_parameter_value
  end if;

  -- A limit of zero means "refuse everything", which is a legitimate configuration (an
  -- emergency switch-off) and must not be mistaken for "unlimited". Recorded as a hit
  -- anyway, so the counter still reflects the attempt.
  if p_limit < 0 then
    raise exception 'check_rate_limit: p_limit must not be negative'
      using errcode = '22023';
  end if;

  -- The explicit ::double precision is not decoration: extract(epoch ...) returns NUMERIC
  -- on PG14+ and to_timestamp() takes double precision. The cast is implicit today and the
  -- call would resolve without it, but relying on an implicit numeric->float8 cast inside a
  -- security-relevant function is the kind of thing that becomes an error message on an
  -- upgrade night.
  v_window_start := to_timestamp(
    ((floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds))::double precision
  );

  -- ONE STATEMENT. The upsert takes a row-level exclusive lock on exactly one row, so
  -- concurrent requests for the same subject serialize on it and each observes a distinct
  -- count. The read-modify-write shape (`select ... then update`) has the classic
  -- lost-update race and would let a burst of parallel requests all see the same low count
  -- — which is precisely the situation a limiter exists for.
  insert into public.rate_limit_buckets (bucket, key_hash, window_started_at, hit_count)
  values (p_bucket, p_key_hash, v_window_start, 1)
  on conflict (bucket, key_hash, window_started_at)
  do update set hit_count = public.rate_limit_buckets.hit_count + 1
  returning hit_count into v_count;

  return v_count <= p_limit;
end;
$$;

comment on function public.check_rate_limit(text, text, int, interval) is
  'Fixed-window rate limiter. TRUE while within p_limit for the current window, FALSE '
  'afterwards; the call itself counts. p_key_hash is an HMAC digest computed by the caller '
  '— never pass a raw IP or email (RA 10173 / CBL Art. VIII §6). The caller must map FALSE '
  'to a GENERIC validation failure, never to a distinct code (BUILD_PLAN S3-T7).';

-- anon needs it: the public application form is rate-limited and the Server Action behind it
-- holds no session, so it calls as `anon`. authenticated needs it for /login and for any
-- later authenticated surface that wants throttling.
grant execute on function public.check_rate_limit(text, text, int, interval) to anon, authenticated;

-- ── ACCEPTED, SIZED, AND NOT PAPERED OVER: this table only grows. ───────────────────
-- Each distinct (bucket, key_hash, window) is one row and nothing prunes it. There is no
-- pruning statement here on purpose: CLAUDE.md's "never hard-delete anything" is a rule
-- about the shape of this schema, and quietly introducing the project's first DELETE inside
-- a rate limiter is not the way to make an exception to it.
--
-- The size: the two configured buckets are apply_ip (10/hour) and apply_email (3/hour), so
-- growth is bounded by distinct applicants per hour during an application period — for ~600
-- applicants concentrated into a few weeks, low thousands of rows a year at roughly 60 bytes
-- each. Against Supabase Pro's 8 GB that is noise, and DATA_MODEL.md §10 sizes the entire
-- system at ~50 MB over five years.
--
-- If it is ever wanted, the right owner is the single scheduler
-- (.github/workflows/scheduled.yml, ARCHITECTURE.md §8) and the right shape is a definer
-- function that drops windows older than a day — one deliberate, reviewed exception with an
-- ADR, not a line added here. Raised for the S7 scheduler owner in the PR.
