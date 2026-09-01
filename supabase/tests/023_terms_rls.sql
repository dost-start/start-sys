-- ═══════════════════════════════════════════════════════════════════════════════════
-- 023_terms_rls.sql  —  §3 of 0014: terms and application windows
--
-- WHAT:
--    1-2   POSITIVE CONTROLS — authenticated tiers read BOTH terms, active and archived
--    3-5   anon reads exactly ONE term, and it is the active one; zero archived
--    6-8   anon sees an application window WHILE IT IS OPEN, and only that one
--    9-10  once the window's closes_at is in the past anon sees ZERO, while an
--          authenticated tier still sees both — closed is INVISIBLE, not deleted
--   11-13  writing `terms`: exec_admin 0 rows, tech_admin@aal1 0 rows, tech_admin@aal2 1
--   14-15  ...and the same asymmetry on INSERT, which RAISES rather than counting 0
--   16-19  writing `application_windows`: crrd_admin AND tech_admin per ADR 0003, aal2
--          required, moderator and anon refused
--
-- WHY 6-10 ARE THE MOST LOAD-BEARING ASSERTIONS IN THE FILE. 0008's anonymous INSERT policy
--   on `applications` EXISTS-checks public.application_windows FROM INSIDE ITS OWN POLICY
--   EXPRESSION, EVALUATED AS THE ANON ROLE. So application_windows_read_anon is what makes
--   PRD US-B4 a database fact — "with the window closed, the public form refuses
--   submissions; a forwarded or bookmarked link is inert", enforced at the data layer and
--   not by hiding a link. Two consequences this file is here to pin:
--
--     · If application_windows_read_anon is ever NARROWED or removed, every anonymous
--       submission fails with an opaque row-level-security error that reads EXACTLY LIKE A
--       FORM BUG — and gets "fixed" by widening something worse. Assertions 6-8 turn that
--       into a red test instead.
--     · If it is ever WIDENED to `using (true)`, a closed period becomes merely inert
--       rather than invisible, and assertion 9 fails.
--
-- WHY 11-15 ASSERT TWO DIFFERENT SHAPES OF REFUSAL. An RLS-refused UPDATE affects ZERO ROWS
--   and returns quietly; an RLS-refused INSERT RAISES 42501 on the WITH CHECK violation.
--   That asymmetry is Postgres, not this schema. A test that expected a raise from the
--   update would fail; a test that expected silence from the insert would too. Both halves
--   are asserted so neither is rediscovered at 2am.
--
-- WHY exec_admin IS REFUSED ON `terms` (assertion 11) AND IT IS NOT AN OVERSIGHT. OQ-7,
--   resolved by the project heads 2026-09-01: the CTO leads term rollover. CEO and COO
--   oversee RECORDS; the CTO executes the STATE CHANGE. terms_insert/terms_update name
--   tech_admin alone, deliberately, and the same guard sits on roll_over_term() and
--   unfreeze_term() so the whole term-lifecycle surface has exactly one owner
--   (ARCHITECTURE.md §5). Widening it back needs a migration and an ADR, never an
--   application-code check — and never a quiet edit here.
--
-- WHY 16-18 NAME TWO ROLES. ADR 0003: PRD US-B4 says "As a CRRD Admin, I can open and close
--   the application period", while ARCHITECTURE.md §5 lists application_windows among the
--   tables only tech_admin writes. The conflict is resolved in the direction that survives
--   an empty CTO seat (OQ-13): a tech_admin-only gate would mean the CCDO cannot open the
--   application period while the CTO seat is vacant — which is the one seat most likely to
--   be vacant at a term boundary (CBL Art. VI §4.4.1 expressly permits a willful vacancy in
--   the 45 days before term end). Either writer is audited by
--   trg_application_windows_audit, so US-B4's "written to the audit log with the
--   responsible user" holds for both.
--
-- ⚠ THE WINDOW ROWS ARE SEEDED HERE, NOT IN fixtures.sql. 0016 seeds no application window
--   — the org opens one when it opens one — so this file creates both a currently-OPEN and
--   an already-CLOSED window on the ACTIVE term. They differ by form_kind because
--   application_windows carries UNIQUE (term_id, form_kind). The active term is used
--   because trg_application_windows_freeze_archived (0005) refuses a window on an archived
--   one.
--
-- CITATION:  BUILD_PLAN S2-T17; ARCHITECTURE.md §4.3, §5; DATA_MODEL.md §6/0005, §7.5, §9;
--            docs/decisions/0003-application-window-authority.md;
--            PRD §3 v1.0 items 4, 5; PRD US-A1, US-A3, US-B1, US-B4, US-H2, US-H3, OQ-7,
--            OQ-13; CBL Art. V §1 and §2, Art. VI §4.2 and §4.4.1.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir ../test-helpers/auth.sql
\ir ../test-helpers/fixtures.sql

select plan(19);


-- Two windows on the ACTIVE term, seeded as the session role. W1 is open right now; W2
-- closed five days ago. Different form_kind values because of UNIQUE (term_id, form_kind).
insert into public.application_windows (id, term_id, form_kind, opens_at, closes_at)
values
  ('00000000-0000-4000-9000-000000000001', pg_temp.fx_active_term(),
   'membership_application', now() - interval '1 day',  now() + interval '1 day'),
  ('00000000-0000-4000-9000-000000000002', pg_temp.fx_active_term(),
   'committee_application', now() - interval '10 days', now() - interval '5 days')
on conflict (id) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-2 — POSITIVE CONTROLS: authenticated tiers read the whole term list
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-H3: administrators select a previous term and read its records. Every
-- authenticated tier may read the term LIST — knowing that a 2025-2026 term existed
-- discloses nothing, and what it CONTAINS is guarded by the per-table policies, so officers
-- and reps gain no access to prior terms they could not see at the time.
--
-- Two terms exist: the seeded active 2026-2027 and the fixture's archived 2025-2026.

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
select is((select count(*)::int from public.terms), 2,
  'officer reads BOTH terms — POSITIVE CONTROL; anon''s 1 below is meaningless without it');
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select is((select count(*)::int from public.terms), 2,
  'exec_admin reads both terms — PRD US-H3 historical retrieval');
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3-8 — the anonymous surface: one term, one open window
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_anon();

select is((select count(*)::int from public.terms), 1,
  'anon reads exactly 1 term — a draft or archived term is not an anonymous visitor''s '
  'business; the public form resolves its own term through current_term_id()');

select is((select status::text from public.terms), 'active',
  'and the one term anon reads is the ACTIVE one — asserted by VALUE, because "exactly 1" '
  'would also be satisfied by a policy that leaked the wrong single row');

select is(
  (select count(*)::int from public.terms where status = 'archived'), 0,
  'anon reads 0 archived terms — prior-term data is not a public surface (PRD US-A1)'
);

-- 6-8 — the window pair. anon holds a SELECT GRANT on application_windows (0015 grants it
-- explicitly, and without that grant every anonymous submission would fail with an opaque
-- RLS error), so what narrows this to one row is application_windows_read_anon's
-- `now() between opens_at and closes_at`.
select is((select count(*)::int from public.application_windows), 1,
  'anon sees exactly 1 application window — the one that is OPEN RIGHT NOW (PRD US-B4)');

select is((select form_kind::text from public.application_windows), 'membership_application',
  'and it is the OPEN window, not the closed one — asserted by VALUE, so a policy that '
  'returned the wrong single row fails here');

-- 8 — the closed window is invisible to anon while it plainly exists. This is the pair that
-- makes "the application period is closed" a database FACT rather than a hidden link.
select is(
  (select count(*)::int from public.application_windows
    where form_kind = 'committee_application'),
  0,
  'the already-closed window is INVISIBLE to anon — closed is a database fact, not a UI '
  'state (PRD US-B4: "enforcement is at the data layer, not by hiding the link")'
);

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-10 — closing a window takes effect on the next statement
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The check lives in the POLICY, not in a cache, so closing is immediate and needs no
-- deploy, no restart and no invalidation. BUILD_PLAN S4-T24's admin screen says this in
-- words; these two assertions are the same claim as a measurement.

update public.application_windows
   set closes_at = now() - interval '1 minute'
 where id = '00000000-0000-4000-9000-000000000001';

select pg_temp.login_anon();

select is((select count(*)::int from public.application_windows), 0,
  'once closes_at is in the past anon sees ZERO windows — a forwarded or bookmarked /apply '
  'link is inert from the very next statement, with no cache to invalidate');

select pg_temp.logout();
select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer

-- 10 — and nothing was deleted. Every authenticated tier still reads the full schedule;
-- there is no DELETE path anywhere in this schema and closing a period is not one.
select is((select count(*)::int from public.application_windows), 2,
  'an authenticated tier still reads BOTH windows — closing a period hides it from anon, '
  'it does not remove it (PRD Reliability NFR: no user-facing delete exists)');

select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 11-15 — writing `terms`
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The UPDATE target is the ARCHIVED term and the statement is a no-op
-- (`set label = label`), for two reasons: reject_write_to_archived_term() is deliberately
-- NOT attached to `terms` itself — roll_over_term() has to be able to flip the status
-- (DATA_MODEL.md §7.3) — and touching the ACTIVE term would move the fixture ground under
-- the rest of the file. What is being measured is how many rows the policy lets the
-- statement reach, not what it writes.

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin, aal2
with u as (
  update public.terms set label = label
   where id = '00000000-0000-4000-d000-000000000001' returning 1
)
select is(count(*)::int, 0,
  'exec_admin''s UPDATE on terms affects ZERO rows — OQ-7, resolved: the CTO leads the term '
  'lifecycle, and exec_admin was DELIBERATELY narrowed out of this guard (ARCHITECTURE.md §5)'
) from u;
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal1');   -- tech_admin, aal1
with u as (
  update public.terms set label = label
   where id = '00000000-0000-4000-d000-000000000001' returning 1
)
select is(count(*)::int, 0,
  'tech_admin at aal1 affects ZERO rows — the database backstop for PRD US-A3 holds with '
  'the MFA middleware removed entirely'
) from u;
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal2');   -- tech_admin, aal2
with u as (
  update public.terms set label = label
   where id = '00000000-0000-4000-d000-000000000001' returning 1
)
select is(count(*)::int, 1,
  'tech_admin at aal2 affects exactly 1 row — asserted explicitly, because a policy that '
  'refused everyone would satisfy 11 and 12 and make rollover impossible (PRD US-H2)'
) from u;
select pg_temp.logout();

-- 14-15 — the same boundary on INSERT, which RAISES instead of counting zero. Inserted as
-- 'draft': the one_active_term partial unique index forbids a second active term, and the
-- CBL Art. V §1 CHECKs require a term ending in May of the succeeding year.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin, aal2
select throws_ok(
  $$ insert into public.terms (label, starts_on, ends_on, status)
     values ('2097-2098', date '2097-06-01', date '2098-05-31', 'draft') $$,
  '42501'::char(5),
  null::text,
  'crrd_admin cannot define a term — an RLS-refused INSERT RAISES 42501, unlike the '
  'silently-zero UPDATE above; both shapes are asserted so neither is rediscovered later'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000002', 'aal2');   -- tech_admin, aal2
select lives_ok(
  $$ insert into public.terms (label, starts_on, ends_on, status)
     values ('2097-2098', date '2097-06-01', date '2098-05-31', 'draft') $$,
  'tech_admin at aal2 CAN define a term — PRD US-H2, and CBL Art. V §1 dates are satisfied '
  '(1 June to 31 May of the succeeding year)'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 16-19 — writing `application_windows`: ADR 0003, both writers, aal2 required
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Each attempt uses a form_kind not already taken on the active term, because of
-- UNIQUE (term_id, form_kind). Only assertion 16 actually creates a row; the three
-- refusals create nothing, so they can safely share 'freeform'.

select pg_temp.login_as('00000000-0000-4000-a000-000000000003', 'aal2');   -- crrd_admin
select lives_ok(
  $$ insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
     select public.current_term_id(), 'membership_renewal',
            now() - interval '1 hour', now() + interval '1 hour' $$,
  'crrd_admin at aal2 CAN open a window — ADR 0003 resolves PRD US-B4 against '
  'ARCHITECTURE.md §5 in the direction that survives an empty CTO seat (OQ-13)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004', 'aal2');   -- moderator
select throws_ok(
  $$ insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
     select public.current_term_id(), 'freeform',
            now() - interval '1 hour', now() + interval '1 hour' $$,
  '42501'::char(5),
  null::text,
  'moderator cannot open a window — opening the application period is a CHIEF-level act, '
  'and this is one of the places the OQ-14 moderator boundary is drawn (PRD §2)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003', 'aal1');   -- crrd_admin, aal1
select throws_ok(
  $$ insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
     select public.current_term_id(), 'freeform',
            now() - interval '1 hour', now() + interval '1 hour' $$,
  '42501'::char(5),
  null::text,
  'crrd_admin at aal1 cannot open a window — the aal2 predicate applies to BOTH writers, '
  'not only to the tech_admin branch (PRD US-A3)'
);
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok(
  $$ insert into public.application_windows (term_id, form_kind, opens_at, closes_at)
     select public.current_term_id(), 'freeform',
            now() - interval '1 hour', now() + interval '1 hour' $$,
  '42501'::char(5),
  null::text,
  'anon cannot open a window — anon READS this table (that is what makes US-B4 work) and '
  'must never write it; the read grant and the write policy are separate mechanisms'
);
select pg_temp.logout();


select * from finish();

rollback;
