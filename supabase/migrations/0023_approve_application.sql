-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0023_approve_application.sql
--
-- WHAT:      approve_application(p_app_id uuid) returns text  — the minted member_id.
--            ONE TRANSACTION that resolves or creates the person, allocates the member ID,
--            inserts the current-term membership and stamps the application.
--
-- WHY:       PRD §3 v1.0 items 8 and 9; PRD US-C2 ("approval creates the member's membership
--            record for the current term with status Active") and US-C3 ("no approval can
--            produce a member without an ID, or an ID without a member"). ARCHITECTURE.md
--            §4.1 step 8 and §6 mechanism 3: the three writes are one transaction precisely
--            so the half-states are unrepresentable.
--
-- ROLLBACK:  Forward-only; correct by `create or replace` in a NEW migration. Rolling this
--            back after a single approval would strand a minted member ID.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ONE DELIBERATE EXTENSION OVER DATA_MODEL.md §6/0012's ABRIDGED BODY, AND ONE FIX
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- EXTENSION — PERSON REUSE (BUILD_PLAN S4-T2). The abridged body always INSERTs a `people`
--   row. That is correct for a first-time applicant and WRONG for a returning one, and the
--   wrongness is the exact failure PRD US-C4/US-H5 exist to prevent: a returning scholar who
--   applies again would acquire a SECOND people row and therefore a SECOND member ID, and
--   2024-001 would in effect have become 2026-014. So person resolution is three steps, in
--   order:
--
--     1. applications.person_id, if a reviewer already linked the row
--     2. an existing people row whose personal_email equals applicant_email
--        — both columns are `citext`, so Juan@Example.com on Monday and juan@example.com
--          in 2026 are the same human, which is the whole reason 0004 and 0008 chose citext
--     3. otherwise INSERT a new person
--
--   Only step 3 can mint. Steps 1 and 2 fall through to allocate_member_id(), which
--   early-returns the existing id (0022) — so the reuse path returns 2024-007 UNCHANGED and
--   creates ZERO new people rows. 047_application_decision_authz.sql asserts exactly that.
--
--   ⚠ Email is the only identity signal an accountless application carries. It is a
--   deliberately imperfect match and it is the right one for v1.0: matching on name would
--   merge two different scholars, and matching on nothing would split one. A genuine
--   mismatch is corrected by CRRD before approval (PRD §4 — "applicant contacts CRRD, CRRD
--   edits the application"), which is why applications_update exists at all.
--
-- FIX — middle_name AND suffix ARE COPIED. lib/applications/schema.ts flagged this as a
--   KNOWN GAP handed to S4 rather than papered over: the form collects both, `people` has
--   columns for both, and the abridged body copies neither, so they were collected and
--   discarded. They live in the payload under those exact keys (buildApplicationPayload)
--   and are read here. `nullif(btrim(...), '')` so an empty string becomes NULL rather than
--   a blank suffix on a scholar's record.
--
-- ⚠ NO HAND-WRITTEN AUDIT INSERT. `applications`, `people` and `memberships` all carry
--   trg_*_audit (0008, 0012), which fire inside this transaction and attribute every row to
--   (select auth.uid()) — the reviewer. An application-side or function-side audit write
--   would DOUBLE-COUNT and, worse, would be a second audit path that a future refactor could
--   skip. The trigger is trigger-based precisely so no code path can miss it
--   (ARCHITECTURE.md §8, CLAUDE.md definition-of-done item 4).
--
-- CITATION:  BUILD_PLAN S4-T2; DATA_MODEL.md §6/0012, §3.1, §3.2, §4; ARCHITECTURE.md §4.1,
--            §5, §6; PRD §3 v1.0 items 8-9, PRD US-C2, US-C3, US-C4, US-H1, US-H5, US-I1;
--            PRD OQ-5 (tech_admin refused); CBL Art. VIII §6.
-- ═══════════════════════════════════════════════════════════════════════════════════

create or replace function public.approve_application(p_app_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      public.org_role := public.auth_role();
  a           public.applications;
  v_person    uuid;
  v_join_year int;
  v_member_id text;
begin
  -- ── 1. role guard ──────────────────────────────────────────────────────────────
  -- PRD US-C1/US-C2 give the decision to CRRD and Executive Admins; ARCHITECTURE.md §5
  -- gives moderators the operational surface, because you cannot review an application
  -- without reading it.
  --
  -- tech_admin IS REFUSED, deliberately (PRD OQ-5, default answer NO). An application row
  -- is the densest PII object in the schema and approving one writes a person, a member ID
  -- and a membership. "Configure the system and control access" is not that. officer,
  -- regional_rep, member and anon are refused for the obvious reasons — and the Special
  -- Advisor sits in the officer tier (CBL Art. III §2.9, Art. X §2.4-2.5), so an
  -- adjudicator of appeals must not also be a decider of admissions.
  --
  -- This guard is the ENFORCEMENT. withRole() in lib/applications/actions.ts is defence in
  -- depth over it: if withRole is wrong, this raises anyway.
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin', 'moderator') then
    raise exception 'not authorized to decide an application'
      using errcode = '42501';
  end if;

  -- ── 2. lock the row ────────────────────────────────────────────────────────────
  -- `for update` is what makes two reviewers clicking Approve in the same second safe: the
  -- second waits, then re-reads a row whose status is already 'approved' and takes the
  -- idempotent branch below. Without the lock both would see 'pending' and both would mint.
  select * into a from public.applications where id = p_app_id for update;

  if not found then
    -- CONVENTIONS.md §4.3: an absent row is not_found, never unauthorized. Raising
    -- "forbidden" here would confirm that an application with this id exists.
    raise exception 'application % not found', p_app_id
      using errcode = 'P0002';   -- no_data_found
  end if;

  -- ── 3. idempotency ─────────────────────────────────────────────────────────────
  -- PRD US-C3: "a retried or double-submitted approval returns the EXISTING ID rather than
  -- issuing a second one." Returned BEFORE the pending check, so a retry is a success and
  -- not a state error — a double-clicked Approve must not surface as a red banner.
  if a.status = 'approved' then
    return (select p.member_id from public.people p where p.id = a.person_id);
  end if;

  -- ── 4. state machine ───────────────────────────────────────────────────────────
  -- Only pending -> approved. A draft has not been submitted; a rejected application is a
  -- recorded decision and re-deciding it is a NEW audited action, not a silent overwrite
  -- (PRD US-C2). 55000 is object_not_in_prerequisite_state, which maps to `conflict`.
  -- enforce_application_status_transition() (0024) refuses the same move independently, so
  -- this check is the readable error and that trigger is the backstop.
  if a.status <> 'pending' then
    raise exception 'application % is %, not pending', p_app_id, a.status
      using errcode = '55000';
  end if;

  -- ── 5. person resolution (see the EXTENSION note in the header) ────────────────
  v_person := a.person_id;

  if v_person is null then
    select p.id into v_person
      from public.people p
     where p.personal_email = a.applicant_email   -- citext: case-insensitive by type
     limit 1;
  end if;

  if v_person is null then
    -- join_year comes from the TERM the application belongs to, never from now(): an
    -- application reviewed in July belongs to the term that opened in June, and the member
    -- ID must say so. The term runs 1 June -> 31 May (CBL Art. V §1, DATA_MODEL.md §7.5),
    -- so the starting calendar year is the join year.
    select extract(year from t.starts_on)::int
      into v_join_year
      from public.terms t
     where t.id = a.term_id;

    insert into public.people (
      join_year,
      given_name, middle_name, family_name, suffix,
      personal_email,
      birthdate, contact_number,
      address_line, city_municipality, province, postal_code,
      school, school_id_no
    )
    values (
      v_join_year,
      a.applicant_given_name,
      nullif(btrim(a.payload ->> 'middle_name'), ''),   -- the S3-T13 gap, closed
      a.applicant_family_name,
      nullif(btrim(a.payload ->> 'suffix'), ''),        -- likewise
      a.applicant_email,
      (a.payload ->> 'birthdate')::date,
      a.payload ->> 'contact_number',
      a.payload ->> 'address_line',
      a.payload ->> 'city_municipality',
      a.payload ->> 'province',
      a.payload ->> 'postal_code',
      a.payload ->> 'school',
      a.payload ->> 'school_id_no'
    )
    returning id into v_person;
  end if;

  -- ── 6. the member ID ───────────────────────────────────────────────────────────
  -- Idempotent and race-safe (0022). For a resolved returning person this returns their
  -- ORIGINAL id and mints nothing — PRD US-C4 and US-H5 in one line.
  v_member_id := public.allocate_member_id(v_person);

  -- ── 7. the membership ──────────────────────────────────────────────────────────
  -- PRD US-C2: approval creates the membership for the CURRENT term with status Active.
  -- PRD US-H1: one membership record per person per term — `unique (person_id, term_id)`
  -- (0006) is literally that sentence, and `on conflict do nothing` makes a retry that got
  -- as far as this insert idempotent rather than a constraint error.
  --
  -- region_id / year_level / expected_grad_year are read from the payload under the exact
  -- keys lib/applications/schema.ts freezes in APPLICATION_PAYLOAD_KEYS. A rename on either
  -- side fails NOTHING until this line writes NULLs for a real scholar, which is why that
  -- constant carries a test of its own. memberships.region_id is NOT NULL, so a missing
  -- region_id raises here rather than producing an unscoped member.
  insert into public.memberships (
    person_id, term_id, status, region_id, year_level, expected_grad_year
  )
  values (
    v_person,
    a.term_id,
    'active',
    (a.payload ->> 'region_id')::uuid,
    (a.payload ->> 'year_level')::int,
    (a.payload ->> 'expected_grad_year')::int
  )
  on conflict (person_id, term_id) do nothing;

  -- ── 8. stamp the application ───────────────────────────────────────────────────
  -- PRD US-C2: "both outcomes write an audit entry naming the deciding officer." That entry
  -- is written by trg_applications_audit off this UPDATE, with reviewed_by in the diff.
  update public.applications
     set status      = 'approved',
         person_id   = v_person,
         reviewed_by = (select auth.uid()),
         reviewed_at = now()
   where id = p_app_id;

  return v_member_id;
end;
$$;

comment on function public.approve_application(uuid) is
  'Approves an application in ONE transaction: resolves or creates the person (reusing an '
  'existing people row matched on personal_email, so a returning scholar keeps their member '
  'ID), allocates the member ID, inserts the current-term membership and stamps the row. '
  'Idempotent — a retry returns the existing member_id. exec_admin/crrd_admin/moderator only; '
  'tech_admin refused (PRD OQ-5). PRD US-C2, US-C3, US-C4, US-H1, US-H5.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- EXECUTE privileges
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Definer functions are granted to PUBLIC by default (see 0022 §3). Revoke, then grant back
-- to `authenticated` only — the guard is INSIDE the function, so a session role holding
-- EXECUTE is not itself a capability, but anon must not even be able to reach a body that
-- takes a row lock and reads applicant PII into local variables.
revoke execute on function public.approve_application(uuid) from public;
revoke execute on function public.approve_application(uuid) from anon;
grant  execute on function public.approve_application(uuid) to   authenticated;
