-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0017_mfa_recovery_codes.sql
--
-- WHAT:      One-time TOTP recovery codes:
--              mfa_recovery_codes       hashed, salted, single-use, per account
--              issue_recovery_codes()   ten codes, plaintext returned EXACTLY ONCE
--              consume_recovery_code()  redeem one, boolean, false on reuse
--
-- WHY:       PRD §3 v1.0 item 2 and PRD US-A3: "Enrolment issues one-time recovery codes,
--            displayed exactly once." Supabase Auth's native TOTP has no recovery-code
--            feature, so this one requirement is ours to build. Without it the ONLY path
--            back into a privileged account after a lost phone is tech_admin-mediated
--            re-enrolment (PRD US-A3, third criterion) — which is a real fallback, but it
--            is a single point of failure at exactly the moment the CTO seat is most
--            likely to be vacant (OQ-13).
--
-- ⚠️ THIS IS A 30th TABLE THAT DATA_MODEL.md §1 DOES NOT LIST. Flagged, not silently
--            fixed. DATA_MODEL.md is owned by another lane and is under concurrent edit;
--            editing it from here is how two agents overwrite each other. The addition is
--            raised in the PR description instead (BUILD_PLAN S2-T35, and the S2 risk
--            table's "flag, do not silently resolve"). It is auth-credential state, not
--            an org record, which is arguably why §1 does not carry it — but that is the
--            doc owner's call to make, not this migration's.
--
-- CITATION:  PRD §3 v1.0 item 2; PRD US-A3, US-A4, US-A5; ARCHITECTURE.md §5
--            ("Recovery codes are generated at enrolment and shown once"); BUILD_PLAN
--            S2-T35. Not a CBL matter — the Constitution says nothing about second
--            factors.
--
-- ROLLBACK:  Forward-only. Dropping this table invalidates every issued recovery code and
--            strands anyone mid-recovery; the corrective action is to re-issue, which
--            issue_recovery_codes() already does idempotently.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── mfa_recovery_codes ─────────────────────────────────────────────────────────────
-- Codes are stored as a SALTED SHA-256 HASH, never plaintext, for the same reason
-- passwords are (PRD US-A5): a recovery code IS a credential, and a database disclosure
-- that hands an attacker ten working second factors for every privileged account is the
-- whole breach. The per-row salt means two accounts issued the same code — possible, the
-- space is small — produce different hashes, so the table cannot be attacked as a single
-- rainbow lookup.
--
-- on delete cascade: when an auth.users row goes, its recovery codes go with it. This is
-- the one cascade in the schema and it is correct — a credential for a deleted account is
-- not a record worth keeping, and PRD §4's "no data deletion" rule is about MEMBERSHIP
-- RECORDS, not about auth material.
create table public.mfa_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_salt   text not null,
  code_hash   text not null,
  consumed_at timestamptz,                       -- null => still redeemable
  created_at  timestamptz not null default now()
);

comment on table public.mfa_recovery_codes is
  'One-time TOTP recovery codes, salted-SHA256 hashed. PRD US-A3. Reachable ONLY through '
  'issue_recovery_codes() and consume_recovery_code(): the table carries FORCE RLS and '
  'ZERO POLICIES, deliberately. Not listed in DATA_MODEL.md §1 — flagged in the PR.';

-- consume_recovery_code() scans the caller's live codes to recompute per-row hashes; at
-- ten rows per account the index is about intent as much as speed.
create index mfa_recovery_codes_live on public.mfa_recovery_codes (user_id)
  where consumed_at is null;

-- ── RLS: ENABLE + FORCE, and DELIBERATELY ZERO POLICIES ────────────────────────────
-- This is deny-by-default used as the primary mechanism rather than as a backstop, and it
-- is the correct shape here. With RLS forced and no policy of any kind, Postgres returns
-- zero rows and refuses every write for EVERY role including the table owner — so no
-- session, at any tier, can read a hash, list another account's codes, mark one consumed,
-- or plant one. The only way in is a SECURITY DEFINER function owned by the migration
-- role, and there are exactly two of them below, both of which scope everything they touch
-- to `auth.uid()`.
--
-- **Do not add a policy to this table.** A SELECT policy would expose hashes to hash
-- cracking; an INSERT or UPDATE policy would let a session forge or burn its own second
-- factor. 026_policy_invariants.sql (S2-T20) carries an explicit whitelist of
-- intentionally-unreachable tables — member_id_counters, rate_limit_buckets and this one —
-- so the exception is DECLARED rather than discovered by someone who assumes a table with
-- no SELECT policy is a bug.
alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_recovery_codes force  row level security;

-- ── issue_recovery_codes() ─────────────────────────────────────────────────────────
-- Returns ten plaintext codes ONCE, at enrolment. There is no second call that returns
-- them, no column that stores them, and no route that re-renders them (BUILD_PLAN S2-T36:
-- "navigating back to enroll after enrolment does not show codes again"). Calling this
-- again ISSUES A FRESH SET and invalidates the old one — which is the correct behaviour
-- for "I lost my printout", and is why the acceptance test asserts a second call does not
-- return the first call's values.
--
-- ON THE DELETE: superseded, never-redeemed codes are removed rather than tombstoned.
-- CLAUDE.md's "never hard-delete anything" governs MEMBERSHIP AND ORG RECORDS — membership
-- end is a status change, term end is a flag — and is enforced by the schema-wide absence
-- of DELETE POLICIES, which this migration does not touch. A dead credential is not a
-- record of anything: keeping ten stale hashes per re-enrolment grows an attack surface
-- and records nothing the audit log will not already carry when the re-enrolment itself is
-- audited (PRD US-A3: "lost-device re-enrolment ... is itself written to the audit log").
-- The DELETE is a statement inside a definer function, not a policy, so the no-DELETE-
-- policy invariant in 026/099 remains true.
--
-- CODE SHAPE: XXXX-XXXX uppercase hex, drawn from gen_random_uuid()'s CSPRNG entropy. That
-- is 32 bits, which would be thin for an anonymously-guessable secret and is not thin here:
-- redemption requires an already-authenticated session (auth.uid() must be non-null), each
-- code is single-use, at most ten are live per account, and Supabase's /auth rate limits
-- (0017-adjacent config, S2-T32) throttle the attempt rate. The dash is part of the code.
--
-- ON `(text)::bytea`: this is an I/O-conversion cast, so it runs byteain() over the string
-- and WOULD interpret a backslash escape. Both operands here are drawn from a fixed
-- alphabet — [0-9A-F] and a single '-' — so no escape sequence can occur, and the cast is
-- byte-for-byte equivalent to convert_to(..., 'UTF8'). Stated because it is the kind of
-- thing that becomes untrue the moment someone widens the code alphabet: if the shape ever
-- changes, switch to convert_to() in the same migration.
-- sha256() and encode() are core in PG11+; no pgcrypto is needed and none is installed
-- (0001_extensions.sql deliberately excludes it).
create or replace function public.issue_recovery_codes() returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid   := (select auth.uid());
  v_codes text[] := '{}'::text[];
  v_code  text;
  v_salt  text;
begin
  -- Not a policy substitute — a definer function bypasses RLS, so the caller's identity is
  -- the ONLY thing scoping this. An anonymous caller has no account to issue codes for.
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Invalidate the previous set. See the DELETE note above.
  delete from public.mfa_recovery_codes c
   where c.user_id = v_uid
     and c.consumed_at is null;

  while coalesce(array_length(v_codes, 1), 0) < 10 loop
    v_code := upper(
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' ||
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)
    );

    -- Ten draws from a 32-bit space collide with vanishing probability, but a duplicate
    -- would mean one plaintext redeems two rows and the user silently loses a code. Cheap
    -- to exclude; expensive to debug.
    if not (v_code = any(v_codes)) then
      v_codes := v_codes || v_code;
      v_salt  := replace(gen_random_uuid()::text, '-', '');

      insert into public.mfa_recovery_codes (user_id, code_salt, code_hash)
      values (v_uid, v_salt, encode(sha256((v_salt || v_code)::bytea), 'hex'));
    end if;
  end loop;

  -- The ONLY moment these strings exist outside the caller's screen.
  return query select u from unnest(v_codes) as u;
end;
$$;

comment on function public.issue_recovery_codes() is
  'Issues ten single-use TOTP recovery codes for the calling account and returns the '
  'plaintext EXACTLY ONCE. Invalidates any previously-issued unconsumed set. Only hashes '
  'are stored. PRD US-A3.';

-- ── consume_recovery_code() ────────────────────────────────────────────────────────
-- Redeems one code for the CALLING account. Returns true on success, false on a wrong
-- code, an already-consumed code, or another account's code — the same false in every
-- case, so the boolean discloses nothing beyond "that did not work". Reuse returns false
-- because consumed_at is already set and the row no longer matches.
--
-- The hash is recomputed per candidate row inside the WHERE clause, because the salt is
-- per row — there is no way to hash the input once and look it up, and that is the price
-- of per-row salting, paid over at most ten rows.
--
-- FOR UPDATE takes a row lock so two simultaneous submissions of the same code cannot both
-- observe consumed_at IS NULL and both succeed. A single-use credential that is usable
-- twice under a race is not single-use.
create or replace function public.consume_recovery_code(p_code text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_code text;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_code is null then
    return false;
  end if;

  -- Normalize what a human retypes off a printout: case and stray whitespace only. The
  -- dash is significant and is not stripped, so the accepted form is exactly the issued
  -- form.
  v_code := upper(regexp_replace(p_code, '\s', '', 'g'));

  select c.id
    into v_id
    from public.mfa_recovery_codes c
   where c.user_id = v_uid
     and c.consumed_at is null
     and c.code_hash = encode(sha256((c.code_salt || v_code)::bytea), 'hex')
   limit 1
   for update;

  if v_id is null then
    return false;
  end if;

  update public.mfa_recovery_codes
     set consumed_at = now()
   where id = v_id;

  return true;
end;
$$;

comment on function public.consume_recovery_code(text) is
  'Redeems one recovery code for the calling account. True once, false forever after — and '
  'false, never an error, for a wrong or foreign code, so it discloses nothing. FOR UPDATE '
  'makes single-use hold under concurrent submission. PRD US-A3, US-A4.';

-- ── grants ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER functions are granted to PUBLIC by default. Both functions already
-- refuse a null auth.uid(), but revoking anon states the intent in \df+ without reading a
-- body, and removes an anonymous endpoint that would otherwise be an unauthenticated
-- (if useless) call into credential machinery.
-- from PUBLIC too: the default EXECUTE grant to PUBLIC would keep anon privileged
-- no matter how many times anon itself is revoked (see 0015's note).
revoke execute on function public.issue_recovery_codes()        from public, anon;
revoke execute on function public.consume_recovery_code(text)   from public, anon;
grant  execute on function public.issue_recovery_codes()        to authenticated;
grant  execute on function public.consume_recovery_code(text)   to authenticated;
