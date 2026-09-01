-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0024_reject_application.sql
--
-- WHAT:      Three things, all of them about the OTHER outcome and about making a decision
--            stick:
--              1. constraint applications.rejected_has_reason  — a rejection without a
--                 written ground is refused BY THE DATABASE
--              2. reject_application(p_app_id uuid, p_reason text) returns void
--              3. enforce_application_status_transition() + trg_applications_status_transition
--                 — the application state machine, as a trigger
--
-- WHY:       PRD US-C2: "Rejection records a REASON and leaves NO membership record" and
--            "an already-decided application CANNOT BE SILENTLY RE-DECIDED; a change of
--            decision is a new audited action." DATA_MODEL.md §3.2 draws the machine:
--            draft -> pending -> {approved | rejected}, both terminal.
--
-- ROLLBACK:  Forward-only. Dropping the CHECK would leave reasonless rejections
--            representable; dropping the trigger would leave `approved` reversible from a
--            hand-written UPDATE, which orphans a minted member ID (PRD US-C3).
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ CROSS-LANE COLLISION — TWO EXISTING TEST FIXTURES MUST BE UPDATED WITH THIS FILE ⚠⚠
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Two S3-lane test files seed a `rejected` application with NO review_note. Both INSERTs
-- start raising 23514 the moment this migration applies, because a rejected application with
-- no ground is exactly what PRD US-C2 forbids and exactly what the constraint below refuses.
-- **THE FIXTURES ARE WRONG, NOT THE CONSTRAINT** — a reasonless rejection is a state the
-- schema should never have been able to represent.
--
--   1. supabase/tests/042_applications_read_rls.sql, the third VALUES row (~line 73):
--        ('00000000-0000-4000-8000-00000000000c', pg_temp.fx_active_term(), 'rejected',
--         'rejected.applicant@fixture.start-sys.test', 'Rejected', 'Applicant',
--         '{"school_id_no":"FIXT-APP-C"}'::jsonb, 'ref-rejected-c', now());
--
--   2. supabase/tests/043_finalize_application_fn.sql, fixture row A5 (~line 92):
--        ('00000000-0000-4000-8000-000000000105', pg_temp.fx_active_term(), 'rejected',
--         'finalize.decided@fixture.start-sys.test', 'Finalize', 'Decided', '{}'::jsonb,
--         'ref-decided', encode(...), now() + interval '1 hour');
--
-- THE FIX IN BOTH CASES is one added column and one added value: the column list gains
-- `review_note` and the row gains a ground of at least ten characters after trimming, e.g.
--
--     'Proof of enrollment did not name the applicant.'
--
-- Neither file is in this lane, so the edit is FLAGGED HERE AND IN THE PR rather than made
-- silently. `grep -rn "'rejected'" supabase/ e2e/ lib/` finds nothing else that seeds one.
--
-- CITATION:  BUILD_PLAN S4-T3; DATA_MODEL.md §3.2, §6/0008; PRD US-C2, US-C3;
--            CONVENTIONS.md §3.1 (trigger naming), §3.4, §6 (schema floor == form floor).
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — a reason is a CONSTRAINT, not a required form field
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-C2 says rejection "records a reason". A required textarea satisfies that for anyone
-- using the UI and satisfies nothing for a hand-written PostgREST call, and `applications`
-- has an UPDATE policy for the three reviewer roles (0008) plus a narrowed column GRANT
-- (0027) — so `review_note` is directly writable and `status` is not. The floor therefore
-- has to live where the row does.
--
-- TEN characters, matching applicationRejectSchema's `min(10)` in lib/applications/schema.ts
-- EXACTLY. CONVENTIONS.md §6: one schema, both sides. If these two numbers ever disagree the
-- database refuses what the form accepted, and the applicant-facing failure is a 500 rather
-- than a field error — so the number is stated in both places and asserted in both places.
--
-- btrim() so twelve spaces is not a reason.
--
-- ⚠ APPROVED IS DELIBERATELY NOT COVERED. An approval's ground is the application itself;
-- requiring prose there would make approve_application() need an argument it has no source
-- for. review_note stays optional on an approved row.
alter table public.applications
  add constraint rejected_has_reason
  check (status <> 'rejected' or length(btrim(review_note)) >= 10);

comment on constraint rejected_has_reason on public.applications is
  'PRD US-C2: a rejection records a reason. Enforced at the row so a direct PostgREST call '
  'cannot bypass the form. The 10-character floor matches applicationRejectSchema.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — reject_application()
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The mirror of approve_application(), and its shape is deliberately near-identical so a
-- maintainer who has read one has read both. What is DIFFERENT is the whole point:
--
--   IT TOUCHES NOTHING ELSE. No people row, no membership, no member ID, no counter. PRD
--   US-C2: "rejection records a reason and LEAVES NO MEMBERSHIP RECORD."
--   047_application_decision_authz.sql asserts both deltas are zero rather than trusting the
--   absence of an INSERT statement to be permanent.
--
--   IT REFUSES AN APPROVED APPLICATION. Rejecting one would leave a minted member ID and a
--   live membership attached to a row that says "rejected" — the state DATA_MODEL.md §3.2
--   calls terminal-by-design. A genuine mistake is corrected by setting the resulting
--   memberships.status, which leaves an audit trail, not by rewriting the decision.
--
-- Returns void, not the row: a rejection has nothing to hand back, and a function that
-- returned the row would be a second read path around the audited
-- get_application_detail() (0026).
create or replace function public.reject_application(p_app_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   public.org_role := public.auth_role();
  v_reason text            := btrim(coalesce(p_reason, ''));
  a        public.applications;
begin
  -- Same three roles as approve. tech_admin refused (PRD OQ-5); officer, regional_rep,
  -- member and anon refused. See 0023 §1 for the full reasoning — it is not restated.
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin', 'moderator') then
    raise exception 'not authorized to decide an application'
      using errcode = '42501';
  end if;

  -- Checked BEFORE the row is touched, so a reviewer who typed three characters gets a
  -- clean validation error rather than a constraint violation naming an internal
  -- constraint. 23514 maps to `validation` in lib/action-result.ts, which is what lets the
  -- action attach the message to `fields.review_note` (BUILD_PLAN S4-T15).
  if length(v_reason) < 10 then
    raise exception 'a rejection reason of at least 10 characters is required'
      using errcode = '23514';
  end if;

  select * into a from public.applications where id = p_app_id for update;

  if not found then
    raise exception 'application % not found', p_app_id
      using errcode = 'P0002';
  end if;

  -- Idempotent, mirroring approve. A double-clicked Reject is a success, and it does NOT
  -- overwrite the reason already on file — the first recorded ground stands, and changing
  -- it is an explicit, audited UPDATE through the 0027 column grant.
  if a.status = 'rejected' then
    return;
  end if;

  if a.status <> 'pending' then
    raise exception 'application % is %, not pending', p_app_id, a.status
      using errcode = '55000';
  end if;

  update public.applications
     set status      = 'rejected',
         review_note = v_reason,
         reviewed_by = (select auth.uid()),
         reviewed_at = now()
   where id = p_app_id;
end;
$$;

comment on function public.reject_application(uuid, text) is
  'Rejects a pending application with a written ground of at least 10 characters. Creates NO '
  'person and NO membership (PRD US-C2), refuses an already-approved application, and is '
  'idempotent on an already-rejected one. exec_admin/crrd_admin/moderator only.';

revoke execute on function public.reject_application(uuid, text) from public;
revoke execute on function public.reject_application(uuid, text) from anon;
grant  execute on function public.reject_application(uuid, text) to   authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — the application state machine, as a trigger
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD US-C2's third criterion — "an already-decided application cannot be SILENTLY
-- re-decided" — expressed where NO CODE PATH CAN MISS IT. The two RPCs above already refuse
-- an illegal move; this trigger refuses it again for a hand-written UPDATE, a psql session,
-- a future RPC nobody has written yet, and a maintainer in 2029 who has never read either
-- function.
--
-- THE LEGAL EDGES (DATA_MODEL.md §3.2), and nothing else:
--
--     draft   -> pending     finalize_application() (0019). "Submitted" is prose for it.
--     pending -> approved    approve_application()  (0023). TERMINAL.
--     pending -> rejected    reject_application()   (0024). TERMINAL.
--     x       -> x           status untouched — an ordinary field correction under the
--                            0027 column grant, which must not be blocked
--
-- WHY approved AND rejected ARE TERMINAL. Reversing an approval would orphan a minted member
-- ID (PRD US-C3: "no approval can produce a member without an ID, or an ID without a
-- member") and would silently un-say a decision the audit log records as made. DATA_MODEL.md
-- §3.2: a genuine mistake is corrected by setting the resulting memberships.status to
-- 'left', which leaves a trail. A change of decision is a NEW audited action against the
-- membership, never an edit to this row.
--
-- ⚠ BEFORE **UPDATE** ONLY, AND THAT IS DELIBERATE. An INSERT branch would be redundant
-- (applications_insert_anon pins status='draft', and `authenticated` holds neither an INSERT
-- policy nor an INSERT privilege — 0008) and actively harmful: every pgTAP fixture seeds
-- decided applications directly as the session role to give the read matrix something
-- asymmetric to measure. Constraining INSERT would force those fixtures to walk the machine,
-- which tests the fixture rather than the policy. The INSERT surface is closed by absence,
-- which is the stronger mechanism.
create or replace function public.enforce_application_status_transition() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;                                   -- a field correction, not a decision
  end if;

  if (old.status, new.status) in (
       ('draft',   'pending'),
       ('pending', 'approved'),
       ('pending', 'rejected')
     ) then
    return new;
  end if;

  raise exception
    'illegal application status transition % -> % (application %)',
    old.status, new.status, old.id
    using errcode = 'check_violation';
end;
$$;

comment on function public.enforce_application_status_transition() is
  'The DATA_MODEL.md §3.2 application state machine. Permits draft->pending, '
  'pending->approved, pending->rejected and a status-unchanged update; refuses everything '
  'else with 23514. approved and rejected are terminal — PRD US-C2/US-C3.';

drop trigger if exists trg_applications_status_transition on public.applications;
create trigger trg_applications_status_transition
  before update on public.applications
  for each row execute function public.enforce_application_status_transition();
