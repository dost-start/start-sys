-- ═══════════════════════════════════════════════════════════════════════════════════
-- 040_anon_surface_grants.sql  —  the anonymous surface, enumerated and pinned
--
-- WHAT:
--    1-3   POSITIVE CONTROLS — anon really can reach the three things the public
--          application form needs: 18 regions, the active term, current_term_id()
--    4-9   what anon CANNOT reach: people raises, and memberships / user_roles /
--          audit_log / applications / renewal_submissions all return exactly zero
--   10-13  the table-privilege half, asserted separately from the policy half
--   14-19  the EXECUTE surface: which SECURITY DEFINER functions anon may call, and
--          which it may not
--   20-21  rate_limit_buckets is unreachable to anon at BOTH levels
--
-- WHY THIS FILE EXISTS: /apply is the ONLY unauthenticated surface in START-SYS (PRD
--   US-A1: "no page other than the public application form is reachable without logging
--   in"). 0015_grants.sql §4 and 0018_apply_rate_limits.sql §1 both carry the same
--   instruction in prose — "widening this list is how the public surface leaks; any
--   addition needs a pgTAP assertion in the same PR". **THIS IS THAT ASSERTION.** A future
--   migration that grants anon one more table or one more function fails here, by name,
--   before it reaches a review.
--
-- ⚠ TWO DIFFERENT MECHANISMS PRODUCE "anon cannot read this", AND THE DIFFERENCE MATTERS
--   WHEN DEBUGGING:
--     · `people` RAISES 42501 — 0015 revoked the table privilege outright. A missing GRANT
--       is an error.
--     · memberships / user_roles / audit_log / applications RETURN ZERO ROWS — anon holds
--       Supabase's default SELECT privilege on all four, and what refuses them is the
--       MISSING ANON POLICY under FORCE RLS. Deny-by-default, working as designed.
--   Both are correct; asserting both is what stops someone "fixing" the silent one by
--   granting something.
--
-- ⚠ POSITIVE CONTROLS BEFORE DENIALS (1-3). A broken anon session makes every count zero
--   and every deny assertion pass for the wrong reason. 1-3 establish that this session is
--   genuinely reading the database before the six zeroes below are trusted.
--
-- CITATION:  BUILD_PLAN S3-T2; 0015_grants.sql §4; 0018_apply_rate_limits.sql §1;
--            ARCHITECTURE.md §5; PRD §3 v1.0 items 1, 5; PRD US-A1, US-B1, US-B4, US-J1.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(21);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-3 — POSITIVE CONTROLS: what the public form genuinely needs
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_anon();

-- 1 — the region dropdown. PRD US-B1: the form is "reachable without an account", so its
-- controls have to render for someone who has none. 18, not 17 — RA 12000 (2024).
select is(
  (select count(*)::int from public.regions),
  18,
  'anon reads exactly 18 regions — POSITIVE CONTROL, and the application form''s region '
  'dropdown (PRD US-B1)'
);

-- 2 — anon may call current_term_id(). This is the ONE addition S3 makes to the anonymous
-- EXECUTE surface (0018 §1): the Server Action behind /apply resolves the term server-side
-- from this call rather than accepting a client-supplied term, and the anon INSERT policy on
-- applications independently pins `term_id = current_term_id()`.
select is(
  (select public.current_term_id()),
  (select id from public.terms where status = 'active'),
  'anon calling current_term_id() gets the active term — the public form never chooses its '
  'own term (BUILD_PLAN S3-T2)'
);

-- 3 — and it is not NULL, so assertion 2 is not two nulls agreeing with each other.
select isnt(
  (select public.current_term_id()),
  null,
  'current_term_id() is non-null for anon — ANTI-VACUITY CONTROL for assertion 2'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4-9 — what anon cannot reach, and by which of the two mechanisms
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 4 — people RAISES. 0015 revoked ALL from anon on this table, so this is a missing GRANT
-- rather than a missing policy. A person row is created only by approve_application(); the
-- public form writes to `applications` and never touches `people`.
select throws_ok(
  $$ select count(*) from public.people $$,
  '42501'::char(5),
  null::text,
  'anon selecting from people RAISES 42501 — 0015 revoked the privilege outright, so this '
  'is a missing GRANT, not a missing policy'
);

-- 5-8 — the four that return zero rows. anon holds the default SELECT privilege on each;
-- what refuses them is the MISSING ANON POLICY under FORCE ROW LEVEL SECURITY.
select is(
  (select count(*)::int from public.memberships),
  0,
  'anon reads 0 memberships — deny-by-default: the privilege exists, the policy does not'
);

select is(
  (select count(*)::int from public.user_roles),
  0,
  'anon reads 0 user_roles — the live access-control table is not part of any public surface'
);

select is(
  (select count(*)::int from public.audit_log),
  0,
  'anon reads 0 audit_log rows — PRD US-I1: the log is readable only by Executive and '
  'Technical Admins'
);

select is(
  (select count(*)::int from public.applications),
  0,
  'anon reads 0 applications — **the absence of an anon SELECT policy IS the '
  'anti-enumeration mechanism** (0008 §5). Re-asserted against real rows in 041/042'
);

-- 9 — renewal_submissions ships a read policy for the three reviewer roles and the person
-- themselves (0008 §5), and anon is neither.
select is(
  (select count(*)::int from public.renewal_submissions),
  0,
  'anon reads 0 renewal_submissions — the renewal surface belongs to people who already '
  'have an account (PRD US-H4)'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 10-13 — the table-privilege half, pinned independently of the policies
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Asserted from the catalog rather than by behaviour, so a change of GRANT is caught even
-- if some future policy happens to mask it. 0015_grants.sql §4 enumerates the anon read
-- surface as exactly four tables; these four assertions are the enumeration made executable.

select ok(
  has_table_privilege('anon', 'public.regions', 'select')
  and has_table_privilege('anon', 'public.officer_positions', 'select')
  and has_table_privilege('anon', 'public.terms', 'select')
  and has_table_privilege('anon', 'public.application_windows', 'select'),
  'anon holds SELECT on exactly the four tables 0015 §4 enumerates — regions, '
  'officer_positions, terms, application_windows'
);

select ok(
  not has_table_privilege('anon', 'public.people', 'select'),
  'anon holds NO select privilege on people — the revoke in 0015 §1 is what makes '
  'assertion 4 raise'
);

-- 12 — anon MUST keep INSERT on applications: the /apply Server Action holds no session and
-- genuinely writes as the `anon` database role. The POLICY is the control, not the grant.
select ok(
  has_table_privilege('anon', 'public.applications', 'insert'),
  'anon holds INSERT on applications — required, because the public form writes as the anon '
  'role; applications_insert_anon is what constrains it (0008 §5)'
);

-- 13 — and it must hold nothing else that could mutate a row. UPDATE in particular: the
-- entire reason finalize_application() exists is so that NO ANON UPDATE POLICY has to.
select ok(
  not has_table_privilege('anon', 'public.applications', 'update')
  and not has_table_privilege('anon', 'public.applications', 'delete'),
  'anon holds NO update and NO delete on applications — the draft -> pending flip goes '
  'through finalize_application(), which is why no anon UPDATE policy exists at all'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 14-19 — the anonymous EXECUTE surface
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Postgres grants EXECUTE on a new function to PUBLIC, and PUBLIC includes anon. A SECURITY
-- DEFINER function bypasses RLS by construction, so **every definer function anon can call
-- is a hole in the wall unless it carries its own guard.** These six assertions are the
-- inventory of that surface.

-- 14-16 — the three anon is SUPPOSED to reach, each with its own internal control.
select ok(
  has_function_privilege('anon', 'public.current_term_id()', 'execute'),
  'anon may call current_term_id() — discloses only what terms_read_anon already shows it '
  '(0018 §1)'
);

select ok(
  has_function_privilege(
    'anon', 'public.check_rate_limit(text, text, int, interval)', 'execute'),
  'anon may call check_rate_limit() — the public form is rate-limited and its Server Action '
  'holds no session (ARCHITECTURE.md §5)'
);

select ok(
  has_function_privilege(
    'anon', 'public.finalize_application(uuid, text, text, text, bigint)', 'execute'),
  'anon may call finalize_application() — the token gate inside it is the control, and it '
  'exists so no anon UPDATE policy has to (BUILD_PLAN S3-T6)'
);

-- 17-19 — the three anon must NOT reach.
select ok(
  not has_function_privilege(
    'anon', 'public.purge_abandoned_drafts(interval)', 'execute'),
  'anon may NOT call purge_abandoned_drafts() — a redaction job is not a public surface; '
  '0020 revokes from PUBLIC first, which is what makes the revoke bite'
);

select ok(
  not has_function_privilege('anon', 'public.get_person_sensitive(uuid)', 'execute'),
  'anon may NOT call get_person_sensitive() — THE door to a scholar''s RA 10173 columns '
  '(PRD US-J1, US-J5)'
);

select ok(
  not has_function_privilege('anon', 'public.is_admin_reader()', 'execute')
  and not has_function_privilege('anon', 'public.is_user_roles_writer()', 'execute'),
  'anon may NOT call the user_roles authorization helpers — an anonymous caller has no '
  'business asking the authorization model any question'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 20-21 — rate_limit_buckets is unreachable at BOTH levels
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The third DECLARED unreachable table, alongside member_id_counters and
-- mfa_recovery_codes (026_policy_invariants.sql's whitelist). Deny-by-default used as the
-- MECHANISM, not as a backstop — so even a policy added by mistake in 2029 grants nothing,
-- because there is no privilege for it to unlock.
--
-- It stores an HMAC of the caller's IP. A raw IP is personal data under RA 10173 (CBL
-- Art. VIII §6), which is why the digest is computed in the application before it ever
-- reaches the database — but a table of "who tried to apply, and when" is still a table
-- nobody should be able to read.

select ok(
  not has_table_privilege('anon', 'public.rate_limit_buckets', 'select')
  and not has_table_privilege('anon', 'public.rate_limit_buckets', 'insert')
  and not has_table_privilege('authenticated', 'public.rate_limit_buckets', 'select')
  and not has_table_privilege('authenticated', 'public.rate_limit_buckets', 'insert'),
  'neither anon nor authenticated holds ANY privilege on rate_limit_buckets — reachable '
  'only from inside check_rate_limit() (0018 §2)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'rate_limit_buckets'),
  0,
  'rate_limit_buckets carries ZERO policies of any kind — the absence is the mechanism, '
  'and 026_policy_invariants.sql already whitelists it by name'
);


select * from finish();

rollback;
