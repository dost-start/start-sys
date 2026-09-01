-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0015_grants.sql
--
-- WHAT:      Table- and column-level privileges. Four things:
--              1. The column-level GRANT on public.people — six non-sensitive columns to
--                 `authenticated`, and nothing else.
--              2. A blanket revoke of DELETE from anon and authenticated on every table
--                 in public.
--              3. The two intentionally-unreachable tables locked down at the GRANT level
--                 as well as at the policy level.
--              4. The narrow explicit anon read surface the public application form needs.
--
-- WHY THIS FILE EXISTS AT ALL — READ THIS BEFORE EDITING ANYTHING BELOW:
--            **RLS IS ROW-LEVEL AND CANNOT PROTECT A COLUMN.** 0014_rls.sql lets an
--            `officer` read every row of public.people, because PRD US-D2 says officers
--            view member records. Without this file, that same officer's hand-written
--            `select * from people` returns 600 scholars' birthdates, addresses, contact
--            numbers and school ID numbers — every policy in 0014 still passing, every
--            test still green. The column GRANT below is what actually delivers the Data
--            Privacy NFR and PRD US-J1, together with v_member_directory (0013) and the
--            confidentiality-gated RPCs (0012, 0030). Three mechanisms, one boundary; this
--            is the one that is invisible until it is missing.
--
-- WHY A DELETE REVOKE WHEN THERE ARE NO DELETE POLICIES: belt as well as braces. The
--            missing policy is the primary control (PRD Reliability NFR: "no user-facing
--            operation can delete a membership record"), but Supabase's default privileges
--            grant ALL on new public tables to anon and authenticated, so every table
--            arrives holding a DELETE privilege waiting for someone to add a policy in
--            2029. Revoking the privilege means such a policy would still delete nothing.
--            The loop is over pg_tables rather than a hand-maintained list, so a table
--            shipped next year is covered without anyone remembering this file.
--
-- WHAT IS DELIBERATELY *NOT* GRANTED, and each absence is load-bearing:
--            · No UPDATE on public.people for any role. Member-record edits go through
--              update_member_record() (0030) — role-gated, confidentiality-gated (CBL
--              Art. VIII §7.1) and audited. The people_update POLICY in 0014 is the second
--              lock on a door whose first lock is this missing GRANT. Widening this GRANT
--              "to make a Server Action work" is the exact banned move (CLAUDE.md).
--            · No privilege of any kind on public.member_id_counters or
--              public.mfa_recovery_codes. Both are reachable only from inside SECURITY
--              DEFINER functions.
--            · No sensitive column of public.people, to anybody. exec_admin, crrd_admin
--              and moderator reach those through get_person_sensitive() (0012), which
--              writes an audit row and refuses a caller with no current-term
--              confidentiality acknowledgement. That is PRD US-J5 and it cannot be
--              satisfied by a GRANT, because a GRANT cannot log.
--
-- CITATION:  ARCHITECTURE.md §5 ("Column protection — a second, separate mechanism") and
--            §8 (Data Privacy NFR); DATA_MODEL.md §6/0015, §8.1, §8.4;
--            PRD §3 v1.0 items 3, 5, 10, 15; PRD US-B1, US-D2, US-J1, US-J3, US-J5;
--            PRD Reliability NFR; CBL Art. VIII §6 (RA 10173 as a constitutional
--            obligation) and §7.1 (Confidentiality Agreements).
--
-- ROLLBACK:  Forward-only. Every statement here NARROWS access; reversing one widens it.
--            A genuine reversal is a new migration plus the pgTAP assertion that proves
--            the new boundary (019_column_grants.sql, 029_role_matrix_columns.sql).
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — public.people: the column boundary
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Start from zero. Supabase's default privileges grant ALL on new tables in public to
-- anon, authenticated and service_role, so `people` arrives fully readable and writable
-- and only RLS stands in the way. Revoking first means the column list below is the whole
-- truth rather than an addition to an inherited default.
revoke all on public.people from anon;
revoke all on public.people from authenticated;

-- The SIX non-sensitive columns, and nothing else, to every authenticated tier.
--   id, member_id, given_name, family_name, join_year, created_at
-- Row visibility on top of this is people_read (0014): admins and officers see all rows,
-- a regional rep sees their own region's, a member sees their own. So the boundary is the
-- INTERSECTION of a row policy and a column grant — which is exactly the two-mechanism
-- design, and why 029_role_matrix_columns.sql asserts the exact column SET per fixture and
-- not merely a row count.
--
-- The ten columns NOT in this list that DATA_MODEL.md §8.1 classifies — birthdate,
-- contact_number, personal_email, address_line, city_municipality, province, postal_code,
-- school, school_id_no, middle_name — are RA 10173 sensitive (CBL Art. VIII §6) and are
-- registered in sensitive_column_registry (0016), which drives both audit masking and the
-- five-year purge. `select birthdate from people` as an officer raises 42501; so does
-- `select *`. Both are asserted, because the second is what a hand-written query does.
--
-- `suffix`, `updated_at` and `redacted_at` are withheld too, and for a duller reason: they
-- are not classified sensitive, they are simply not needed by any tier below crrd_admin.
-- The grant is an allowlist, so a column is absent until someone argues it in.
grant select (
  id,
  member_id,
  given_name,
  family_name,
  join_year,
  created_at
) on public.people to authenticated;

-- anon gets nothing on `people`, at either level: no GRANT here and no policy in 0014.
-- The public application form (PRD US-B1) writes to `applications`, never to `people` —
-- a person row is created only by approve_application() (0023).


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — no DELETE privilege anywhere, for anybody
-- ═══════════════════════════════════════════════════════════════════════════════════

-- PRD Reliability NFR / CLAUDE.md: "Never hard-delete anything. No DELETE policy exists
-- anywhere in the schema and none may be added." Accidental mass deletion is meant to be
-- STRUCTURALLY impossible, not merely unpolicied.
--
-- The loop covers every ordinary table in public, including ones added after this
-- migration was written — pg_tables is read at APPLY time, so a table created in 0017 or
-- 0022 is covered without anyone remembering to come back here. Tables added in LATER
-- migrations are not covered by this run, which is why 026_policy_invariants.sql and
-- 099_security_invariants.sql assert the no-DELETE-policy invariant independently and
-- CI-blockingly: this loop is defence in depth, the missing policy is the control.
--
-- format('%I') quotes the identifier, so a table named in mixed case or with a reserved
-- word cannot break the loop or become an injection point.
do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  loop
    execute format('revoke delete on public.%I from anon, authenticated', r.tablename);
  end loop;
end;
$$;

-- audit_log additionally has UPDATE and DELETE revoked from service_role in 0011 — the
-- strong form of append-only, and the reason the five-year purge never needs to reach into
-- the log (it holds no PII: mask_sensitive() redacts at write time). Not repeated here.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — the two intentionally-unreachable tables
-- ═══════════════════════════════════════════════════════════════════════════════════

-- member_id_counters holds the state that makes `2024-001` unique and gapless. 0014
-- deliberately creates NO policy for it, so FORCE RLS already denies everything; this
-- revoke means that even a policy added by mistake in 2029 grants nothing. Reachable only
-- from inside allocate_member_id() (0022, SECURITY DEFINER). DATA_MODEL.md §4 mechanism 3.
revoke all on public.member_id_counters from anon;
revoke all on public.member_id_counters from authenticated;

-- public.mfa_recovery_codes is the OTHER intentionally-unreachable table and it is
-- deliberately NOT handled here — it is created in 0017, which applies AFTER this file, so
-- a revoke naming it would fail at apply time with "relation does not exist". The DO loop
-- above cannot reach it either, for the same reason: pg_tables is read at apply time and
-- the table does not exist yet.
--
-- That is acceptable because 0017 already carries both halves of its own lockdown: no
-- policy of any kind (so FORCE RLS denies everything) and `revoke execute` from anon on
-- issue_recovery_codes() and consume_recovery_code(). ACTION FOR THE 0017 OWNER, raised in
-- the PR rather than fixed across lanes: add `revoke all on public.mfa_recovery_codes from
-- anon, authenticated` to that migration, so a policy added there by mistake in 2029 grants
-- nothing — the same belt-and-braces member_id_counters gets above. A SELECT privilege on
-- recovery-code hashes is an offline cracking target; an INSERT or UPDATE privilege would
-- let a session forge or burn its own second factor. PRD US-A3.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4 — the anon read surface: four tables, explicitly, and no more
-- ═══════════════════════════════════════════════════════════════════════════════════

-- These four are granted EXPLICITLY rather than left to Supabase's default privileges, so
-- that the anonymous surface is enumerated in one readable place instead of being an
-- emergent property of a platform default. Row visibility is still cut by the anon
-- policies in 0014 — a GRANT without a policy returns zero rows under FORCE RLS.
--
--   regions              PRD US-B1 — the application form's region dropdown must render
--                        for someone with no account. 18 rows, Philippine geography.
--   officer_positions    the 23 CBL Art. III positions, published in the Constitution
--                        itself. Needed so the public surface can name a position, and
--                        asserted by S2-T15 ("anon sees ... 23 positions").
--   terms                policy narrows anon to status='active'; the form resolves its
--                        term through current_term_id().
--   application_windows  policy narrows anon to a window that is open RIGHT NOW. This is
--                        the pair that makes PRD US-B4 a database fact: 0008's anon INSERT
--                        policy EXISTS-checks this table AS ANON, so a forwarded or
--                        bookmarked /apply link is inert outside the period. If this grant
--                        is ever removed, every anonymous submission fails with an opaque
--                        RLS error that reads exactly like a form bug.
--
-- **Widening this list is how the public surface leaks.** Any addition needs a pgTAP
-- assertion in the same PR (040_anon_surface_grants.sql).
grant select on public.regions             to anon;
grant select on public.officer_positions   to anon;
grant select on public.terms               to anon;
grant select on public.application_windows to anon;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5 — SECURITY DEFINER functions are granted to PUBLIC by default
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Postgres grants EXECUTE on a new function to PUBLIC, which includes anon. A definer
-- function bypasses RLS by construction, so a definer function anon can call is a hole in
-- the wall regardless of what the policies say.
--
-- get_person_sensitive() — the ONLY door to a scholar's PII (PRD US-J1, US-J5) — is
-- already revoked from anon in 0012. Repeated here because REVOKE is idempotent and this is
-- the file a reviewer opens when asking "what can the anonymous role reach?"; a one-line
-- duplicate is cheaper than making them grep three migrations for the answer.
revoke execute on function public.get_person_sensitive(uuid) from anon;

-- issue_recovery_codes() and consume_recovery_code() are NOT listed here, and their absence
-- is ordering, not oversight: they are created in 0017, which applies after this file.
-- 0017 revokes execute on both from anon itself.

-- The three helpers introduced in 0014 read public.user_roles as a BYPASSRLS definer, so
-- anon must not be able to call them either. They return only a boolean about the CALLER,
-- so the disclosure is nil in practice — but "nil in practice" is not a security property,
-- and an anonymous caller has no business asking the authorization model any question.
revoke execute on function public.is_admin_reader()       from anon;
revoke execute on function public.is_user_roles_writer()  from anon;

-- has_aal2() is deliberately NOT revoked: it is SECURITY INVOKER, touches no table, and
-- reads only the caller's own JWT claim. Revoking it would buy nothing and would break the
-- anon evaluation path of any future policy that wants to assert "not an aal2 session".
