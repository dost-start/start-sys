-- ═══════════════════════════════════════════════════════════════════════════════════
-- 060_membership_transitions.sql  —  the CBL Art. VII membership state machine
--
-- WHAT:
--     1     positive control
--   2-8     every LEGAL edge in DATA_MODEL.md §3.1, walked by a permitted actor
--  9-12     the terminal states are terminal — four illegal edges, 23514
-- 13-14     the INSERT branch: a membership is born active or renewal_pending, never else
-- 15-18     the forward terminated edge belongs to the Executive Board — refused for
--           crrd_admin and moderator by RLS *and*, independently, by the trigger
-- 19-21     a termination must name a FRESH, substantial ground
-- 22-25     the reversal edge (PRD US-D6) belongs to the Executive Board too
-- 26-28     officer, regional rep and member update ZERO rows — and do not raise
--    29     an archived term is read-only for exec_admin as well
--    30     a status-unchanged UPDATE is not a transition and must pass untouched
-- 31-32     the trigger exists, and no DELETE policy does
--
-- WHY:  PRD §3 v1.0 item 11 makes six membership statuses a requirement; the CBL makes two
--   of them an Executive Board act (Art. VII §3.2.3 for the removal, §3.2.5-3.2.6 for the
--   appeal). DATA_MODEL.md §13 rule 10 calls merging membership status with officer
--   standing the single most likely future mistake in this schema. This file is where the
--   machine stops being a diagram.
--
-- ⚠ TWO REFUSAL MECHANISMS, MEASURED SEPARATELY, AND THE DIFFERENCE MATTERS.
--   memberships_update (0014) carries `(status <> 'terminated' or auth_role() = 'exec_admin')`
--   in BOTH halves, so for a real request:
--     · moving a row INTO terminated fails the WITH CHECK half, which RAISES 42501; and
--     · touching a row that is ALREADY terminated fails the USING half, which SILENTLY
--       FILTERS — zero rows affected, no error at all.
--   The trigger in 0028 refuses both directions with 42501. RLS does not reach a SECURITY
--   DEFINER caller whose owner holds BYPASSRLS, so both mechanisms are load-bearing and
--   this file asserts each on its own: login_as() measures the policy (15, 16, 22),
--   set_claims() keeps the session role's privileges while making auth_role() answer for a
--   fixture, which bypasses RLS and measures the TRIGGER (17, 23). A file that used only
--   login_as() would pass with the trigger deleted.
--
-- ⚠ NO SAVEPOINTS. pgTAP keeps its running test number in a temp table, so
--   `rollback to savepoint` after plan() rewinds the counter and emits duplicate test
--   numbers. Every edge therefore gets its OWN membership row (L1..L9 in
--   helpers/records-fixtures.psql) and the file is ORDER-DEPENDENT: an assertion that
--   consumes a row's state runs after the one that produced it.
--
-- ⚠ TRIGGER ORDER. Same-timing triggers fire alphabetically:
--   trg_memberships_enforce_transition runs before trg_memberships_freeze_archived (e < f).
--   Assertion 29 therefore uses a LEGAL edge on the archived row, so the freeze is what
--   refuses it; an illegal edge there would report 23514 and prove nothing about the freeze.
--
-- CITATION:  BUILD_PLAN S5-T1, S5-T2, S5-T15; DATA_MODEL.md §3.1, §7.3, §13 rule 10;
--            ARCHITECTURE.md §4.3, §5; PRD §3 v1.0 item 11; PRD US-D1, US-D2, US-D3,
--            US-D5, US-D6, US-F2, US-H5; CBL Art. VII §1, §3.1, §3.2.3, §3.2.5-3.2.6.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql
\ir helpers/records-fixtures.psql

select plan(32);


-- Scratchpad for row counts. CREATED by the session role, WRITTEN while impersonating —
-- a fixture cannot CREATE in this session's temp schema (auth.psql grants USAGE only).
-- Same pattern as 030 and 049.
--
-- A data-modifying CTE cannot appear inside a sub-select, so "this UPDATE affected N rows"
-- is captured with GET DIAGNOSTICS in a DO block and asserted afterwards.
create temp table fx_rows (k text primary key, v int);
grant insert, select on fx_rows to public;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — positive control
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Every refusal below is a 42501 or a 23514, and a malformed claim makes auth_role() NULL,
-- which makes RLS return zero rows and the terminated guard raise for everyone. All of the
-- deny assertions would then pass for entirely the wrong reason. This is the assertion that
-- says the impersonation machinery works at all.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select is(
  (select count(*)::int from public.memberships), 15,
  'POSITIVE CONTROL: crrd_admin sees exactly 15 memberships (helpers/fixtures.psql 5 + '
  'helpers/records-fixtures.psql 10). If this is 0 the claims are malformed and every '
  'refusal below is meaningless'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2-8 — every legal edge, walked by a permitted actor
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select lives_ok(
  $$ update public.memberships set status = 'active'
      where id = '00000000-0000-4000-c100-000000000011' $$,
  'renewal_pending -> active by a moderator: CRRD approves a renewal (DATA_MODEL.md §3.1). '
  'The operating tier owns every membership transition except the two the Constitution '
  'reserves to the Executive Board'
);

select lives_ok(
  $$ update public.memberships set status = 'left'
      where id = '00000000-0000-4000-c100-000000000012' $$,
  'renewal_pending -> left by a moderator: the renewal was declined or never completed. '
  'This is also the edge roll_over_term() sweeps at term end'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select lives_ok(
  $$ update public.memberships set status = 'graduated'
      where id = '00000000-0000-4000-c100-000000000013' $$,
  'active -> graduated by a crrd_admin (PRD US-D3)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select lives_ok(
  $$ update public.memberships set status = 'resigned'
      where id = '00000000-0000-4000-c100-000000000014' $$,
  'active -> resigned by a moderator (PRD US-D3)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select lives_ok(
  $$ update public.memberships set status = 'left'
      where id = '00000000-0000-4000-c100-000000000015' $$,
  'active -> left by a crrd_admin: the quiet, non-adjudicated exit. Collapsing this into '
  '`terminated` would make an Executive Board ruling indistinguishable from an unreturned '
  'renewal form in the audit log (DATA_MODEL.md §3.1)'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select lives_ok(
  $$ update public.memberships
        set status = 'terminated',
            ended_reason = 'Executive Board vote 2026-09-05: loss of DOST scholarship status'
      where id = '00000000-0000-4000-c100-000000000016' $$,
  'active -> terminated by an EXEC_ADMIN, with a written ground — PRD US-D5, CBL Art. VII '
  '§3.2.3 (a simple majority vote of the Executive Board)'
);

select lives_ok(
  $$ update public.memberships
        set status = 'active',
            ended_reason = 'Appeal upheld by the Special Advisor 2026-09-06; reinstated'
      where id = '00000000-0000-4000-c100-000000000016' $$,
  'terminated -> active by an EXEC_ADMIN: THE ONLY REVERSAL EDGE IN THE ENTIRE SCHEMA '
  '(PRD US-D6, CBL Art. VII §3.2.5-3.2.6). Without it a successful appeal would be worked '
  'around with a second people row, which is exactly how a member acquires a second member ID'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 9-12 — the terminal states are terminal, and not merely unpermissioned
-- ═══════════════════════════════════════════════════════════════════════════════════
-- exec_admin is the actor for all four ON PURPOSE. These are not authorization failures —
-- the widest role in the system cannot cross them either, because a term-scoped membership
-- record does not un-graduate. A returning member gets a NEW ROW IN A NEW TERM and keeps
-- their original member_id (PRD US-H5). 23514, not 42501.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin

select throws_ok(
  $$ update public.memberships set status = 'active'
      where id = '00000000-0000-4000-c100-000000000013' $$,
  '23514'::char(5), null::text,
  'graduated -> active is refused even for exec_admin: terminal WITHIN THE TERM. Re-joining '
  'is a new row in a new term (PRD US-H1, US-H5)'
);

select throws_ok(
  $$ update public.memberships set status = 'active'
      where id = '00000000-0000-4000-c100-000000000014' $$,
  '23514'::char(5), null::text,
  'resigned -> active is refused even for exec_admin'
);

select throws_ok(
  $$ update public.memberships set status = 'active'
      where id = '00000000-0000-4000-c100-000000000015' $$,
  '23514'::char(5), null::text,
  'left -> active is refused even for exec_admin'
);

select throws_ok(
  $$ update public.memberships set status = 'resigned'
      where id = '00000000-0000-4000-c100-000000000013' $$,
  '23514'::char(5), null::text,
  'graduated -> resigned is refused: a terminal state has NO outbound edge at all, not '
  'merely no edge back to active'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 13-14 — the INSERT branch
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Run as the SESSION role, which is a superuser and therefore bypasses RLS entirely. That
-- is the point: `memberships` has an INSERT policy naming three roles, and this assertion
-- is about the trigger, which must refuse a bad starting state even when no policy is in
-- the way — the shape a SECURITY DEFINER caller presents.
--
-- Order matters: 13 must run before 14, because memberships is UNIQUE (person_id, term_id)
-- and 14 consumes L10's only free slot in the active term.
select throws_ok(
  format(
    $$ insert into public.memberships (person_id, term_id, status, region_id, year_level)
       values ('00000000-0000-4000-b100-000000000020', %L, 'graduated', %L, 4) $$,
    pg_temp.fx_active_term(), pg_temp.fx_region('R03')
  ),
  '23514'::char(5), null::text,
  'a membership CANNOT be created already graduated — a person is not inserted mid-history '
  '(DATA_MODEL.md §3.1). This also protects the seed and every fixture file from drifting '
  'into an unreachable state'
);

select lives_ok(
  format(
    $$ insert into public.memberships (person_id, term_id, status, region_id, year_level)
       values ('00000000-0000-4000-b100-000000000020', %L, 'renewal_pending', %L, 4) $$,
    pg_temp.fx_active_term(), pg_temp.fx_region('R03')
  ),
  'a membership MAY be created as renewal_pending — the state of a new term''s row between '
  'renewal submission and CRRD approval (PRD US-G7)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 15-18 — the forward terminated edge is the Executive Board's alone
-- ═══════════════════════════════════════════════════════════════════════════════════
-- CBL Art. VII §3.2.3. crrd_admin and moderator own every OTHER membership transition, so
-- this is the narrowest write in the system and the one most likely to be widened by
-- accident — "the moderator can update member status" is true of five values out of six.

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select throws_ok(
  $$ update public.memberships
        set status = 'terminated', ended_reason = 'attempted by the wrong tier entirely'
      where id = '00000000-0000-4000-c100-000000000017' $$,
  '42501'::char(5), null::text,
  'a CRRD_ADMIN cannot terminate a membership (CBL Art. VII §3.2.3, PRD US-D5 — narrower '
  'than every other status). TWO mechanisms produce this 42501 and both are load-bearing: '
  'the BEFORE trigger''s role gate fires first, and memberships_update''s WITH CHECK half '
  'would refuse the resulting row behind it'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000004');   -- moderator
select throws_ok(
  $$ update public.memberships
        set status = 'terminated', ended_reason = 'attempted by the wrong tier entirely'
      where id = '00000000-0000-4000-c100-000000000017' $$,
  '42501'::char(5), null::text,
  'a MODERATOR cannot terminate a membership either, even though the locked role model gives '
  'them "update member status" for every other value'
);
select pg_temp.logout();

-- The SAME refusal, measured one layer down. set_claims() leaves the session role's
-- privileges intact, so RLS is out of the picture and this reaches enforce_membership_
-- transition() directly. If the trigger's role gate were deleted, 15 and 16 would still pass
-- and only THIS assertion would go red — which is the whole reason it exists.
select pg_temp.set_claims('00000000-0000-4000-a000-000000000004');  -- moderator claims only
select throws_ok(
  $$ update public.memberships
        set status = 'terminated', ended_reason = 'attempted around RLS, as a definer would'
      where id = '00000000-0000-4000-c100-000000000017' $$,
  '42501'::char(5), null::text,
  'THE TRIGGER REFUSES INDEPENDENTLY OF RLS: a moderator''s claims with the session role''s '
  'privileges is the shape a SECURITY DEFINER caller presents, and RLS does not reach it. '
  '0028 is the guard for approve_application(), roll_over_term() and every future definer'
);
select pg_temp.logout();

select is(
  (select status::text from public.memberships
    where id = '00000000-0000-4000-c100-000000000017'), 'active',
  'L7 is still active after three refused terminations — a refusal that left the row half '
  'written would be worse than no guard'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19-21 — a termination must name a fresh, substantial ground
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-D5: "recording a termination requires a written ground; the audit entry names the
-- deciding officer, the ground, and the timestamp." Two mechanisms, asserted separately.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin

select throws_ok(
  $$ update public.memberships set status = 'terminated'
      where id = '00000000-0000-4000-c100-000000000017' $$,
  '23514'::char(5), null::text,
  'exec_admin terminating WITHOUT touching ended_reason is refused by the trigger: the '
  'ground must belong to THIS decision, not be inherited from the column''s previous '
  'contents (PRD US-D5)'
);

select throws_ok(
  $$ update public.memberships
        set status = 'terminated', ended_reason = 'short'
      where id = '00000000-0000-4000-c100-000000000017' $$,
  '23514'::char(5), null::text,
  'a FRESH but 5-character ground is refused as well. The ten-character floor is enforced '
  'twice — by the trigger for the DECISION and by the memberships_terminated_has_ground '
  'CHECK for the ROW, so a terminated row can never exist without one. It refuses "ok", '
  '"n/a" and "-" without pretending to judge prose; the same floor 0024 puts on a rejection '
  'reason'
);

select is(
  (select status::text from public.memberships
    where id = '00000000-0000-4000-c100-000000000017'), 'active',
  'L7 is STILL active: neither groundless attempt left a partial write'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 22-25 — the reversal edge is the Executive Board's alone too
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Setup, not an assertion: put L9 into `terminated` and LEAVE it there, so the reversal
-- assertions have a real terminated row to attack. Only exec_admin can do this, so claims
-- are set for the duration of the one statement.
select pg_temp.set_claims('00000000-0000-4000-a000-000000000001');  -- exec_admin
update public.memberships
   set status = 'terminated',
       ended_reason = 'Executive Board vote 2026-09-05: repeated breach of data privacy (CBL Art. VI §3.1.3)'
 where id = '00000000-0000-4000-c100-000000000019';
select pg_temp.logout();

-- A crrd_admin attacking an already-terminated row hits memberships_update's USING half,
-- which FILTERS rather than raises. Zero rows affected, no error — and that asymmetry is
-- worth asserting rather than assuming, because a reviewer reading assertion 15 would
-- reasonably expect this one to raise too.
select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
do $$
declare n int;
begin
  update public.memberships
     set status = 'active', ended_reason = 'attempting to undo an Executive Board ruling'
   where id = '00000000-0000-4000-c100-000000000019';
  get diagnostics n = row_count;
  insert into fx_rows values ('crrd_reversal', n);
end;
$$;
select pg_temp.logout();

select is(
  (select v from fx_rows where k = 'crrd_reversal'), 0,
  'a crrd_admin''s attempt to reinstate a terminated member affects ZERO rows and raises '
  'NOTHING: memberships_update''s USING half hides an already-terminated row from every tier '
  'but exec_admin. PRD US-D6 is exec_admin''s alone (CBL Art. VII §3.2.5-3.2.6)'
);

-- And the trigger refuses the same edge one layer down, where RLS never filtered it.
select pg_temp.set_claims('00000000-0000-4000-a000-000000000003');  -- crrd_admin claims only
select throws_ok(
  $$ update public.memberships
        set status = 'active', ended_reason = 'attempting to undo a ruling, around RLS'
      where id = '00000000-0000-4000-c100-000000000019' $$,
  '42501'::char(5), null::text,
  'the trigger refuses the REVERSAL edge for a non-exec caller too, so the silent filter '
  'above is not the only thing standing between a moderator and an overturned Executive '
  'Board ruling'
);
select pg_temp.logout();

select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok(
  $$ update public.memberships set status = 'active'
      where id = '00000000-0000-4000-c100-000000000019' $$,
  '23514'::char(5), null::text,
  'even exec_admin cannot reinstate WITHOUT a fresh ground. A reinstatement that silently '
  'inherited the termination''s own reason would read, in the audit log, as if the Board '
  'terminated someone in order to reinstate them'
);

select lives_ok(
  $$ update public.memberships
        set status = 'active',
            ended_reason = 'Appeal upheld by the Special Advisor; reinstated 2026-09-07'
      where id = '00000000-0000-4000-c100-000000000019' $$,
  'exec_admin reinstates with a fresh ground. The termination and the reinstatement are two '
  'separately attributable audit actions with the original ground still readable (PRD US-D6)'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 26-28 — the read-only tiers affect zero rows, and do NOT raise
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-D2 and US-F2 are MISSING POLICIES, not raised errors: memberships_update simply
-- does not name officer, regional_rep or member, so the USING half is false and the rows
-- are invisible to the statement. That is the correct shape — CONVENTIONS.md §4.3, an
-- RLS-empty result is `not_found`, never `unauthorized`, because "forbidden" would confirm
-- the row exists. A test that expected 42501 here would be asserting the wrong design.

select pg_temp.login_as('00000000-0000-4000-a000-000000000005');   -- officer
do $$
declare n int;
begin
  update public.memberships set year_level = 5
   where id = '00000000-0000-4000-c100-000000000018';
  get diagnostics n = row_count;
  insert into fx_rows values ('officer_update', n);
end;
$$;
select pg_temp.logout();

select is(
  (select v from fx_rows where k = 'officer_update'), 0,
  'an OFFICER''s update affects zero rows and raises nothing — "view-only" is a property of '
  'the database, not of the UI (PRD US-D2)'
);

select pg_temp.login_as('00000000-0000-4000-a000-000000000006');   -- regional_rep_a (NCR)
do $$
declare n int;
begin
  update public.memberships set year_level = 5
   where id = '00000000-0000-4000-c100-000000000001';       -- R1, inside rep_a's OWN region
  get diagnostics n = row_count;
  insert into fx_rows values ('rep_update', n);
end;
$$;
select pg_temp.logout();

select is(
  (select v from fx_rows where k = 'rep_update'), 0,
  'a REGIONAL REP cannot edit even a member of their OWN region (PRD US-F2): regional access '
  'is not regional editing, and this is the assertion that says so — the row is one the rep '
  'can read'
);

select pg_temp.login_as('00000000-0000-4000-a000-000000000008');   -- member
do $$
declare n int;
begin
  update public.memberships set year_level = 5
   where id = '00000000-0000-4000-c000-000000000002';       -- the member's OWN membership
  get diagnostics n = row_count;
  insert into fx_rows values ('member_update', n);
end;
$$;
select pg_temp.logout();

select is(
  (select v from fx_rows where k = 'member_update'), 0,
  'a MEMBER cannot edit their own membership row: v1 members see their record but do not '
  'edit it — CRRD owns the record (PRD §4 deferred scope)'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 29 — an archived term is read-only for everyone, exec_admin included
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A LEGAL edge on purpose. trg_memberships_enforce_transition fires first (alphabetical
-- ordering, e < f), so an illegal edge here would raise 23514 and prove nothing about the
-- freeze. active -> graduated passes the transition guard and is then refused by
-- trg_memberships_freeze_archived (0006) with 42501.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok(
  $$ update public.memberships set status = 'graduated'
      where id = '00000000-0000-4000-c000-000000000005' $$,
  '42501'::char(5), null::text,
  'a LEGAL edge on an ARCHIVED term is still refused, for exec_admin as much as anyone '
  '(DATA_MODEL.md §7.3). The documented escape hatch is unfreeze_term(), tech_admin only '
  'and audited — never a policy edit'
);
select pg_temp.logout();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 30-32 — the no-op path, and the two structural facts
-- ═══════════════════════════════════════════════════════════════════════════════════

select pg_temp.login_as('00000000-0000-4000-a000-000000000003');   -- crrd_admin
select lives_ok(
  $$ update public.memberships
        set ended_reason = 'CRRD note: contacted about renewal 2026-09-05'
      where id = '00000000-0000-4000-c100-000000000018' $$,
  'an UPDATE that does not change status is NOT a transition and passes untouched. Region '
  'corrections, year-level bumps and CRRD notes (PRD US-D1) all land here; a guard that '
  'treated every UPDATE as an edge would refuse every ordinary record edit'
);
select pg_temp.logout();

select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
    where c.relname = 'memberships'
      and t.tgname = 'trg_memberships_enforce_transition'
      and not t.tgisinternal), 1,
  'trg_memberships_enforce_transition exists on memberships. lib/members/transitions.ts '
  'mirrors the edge list this trigger holds and its test parses 0028 from disk — if the '
  'trigger is renamed, that parse and this assertion both fail, which is the point'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'memberships'
      and cmd in ('DELETE', 'ALL')), 0,
  'ZERO DELETE (or ALL) policies on memberships. Membership end is a status change and '
  'nothing else — PRD Reliability NFR, CLAUDE.md banned patterns. Everything this file '
  'asserts about the state machine is worth nothing if a row can simply be removed'
);


select * from finish();

rollback;
