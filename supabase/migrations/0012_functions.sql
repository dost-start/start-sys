-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0012_functions.sql
--
-- WHAT:      The authorization substrate every RLS policy in 0014 is written against,
--            plus the triggers that make the audit log and updated_at unskippable:
--              rr_region_grants              extra regions a regional rep may see
--              auth_role()                   the live capability of the calling account
--              auth_person_id()              the person that account is bound to
--              auth_region_id()              that account's PRIMARY region
--              auth_region_ids()             primary UNION rr_region_grants
--              trg_*_set_updated_at          people, memberships
--              trg_*_audit                   the NINE audited tables
--              has_confidentiality_ack()     CBL Art. VIII §7.1, per person PER TERM
--              assert_confidentiality_ack()  the same, as a hard precondition
--              get_person_sensitive()        the ONLY door to a scholar's PII
--
-- WHY THE AUTH HELPERS ARE TABLE LOOKUPS AND NOT JWT CLAIMS (security invariant 4):
--            Roles live in public.user_roles and are read PER STATEMENT. They are never
--            stamped into the JWT by a Custom Access Token Hook and never stored in
--            user_metadata (raw_user_meta_data is writable by the user themselves — a
--            role there is a one-line privilege escalation and the single most common
--            Supabase security bug). A JWT claim goes stale for the token lifetime, so a
--            member who graduates or an officer who is impeached would keep their
--            privileges for up to an hour. PRD US-A2 requires revocation to take effect
--            on the user's NEXT REQUEST, so stale claims are precisely the wrong failure
--            mode. Every helper is STABLE, so Postgres caches the result per statement:
--            one index probe per QUERY, not per row. At ~4,000 rows the performance
--            argument for the hook does not exist (ARCHITECTURE.md §5).
--
-- WHY rr_region_grants IS CREATED HERE AND 0009 IS DELIBERATELY SKIPPED AS A FILE:
--            DATA_MODEL.md §6 numbers this table 0009_regional. auth_region_ids() is
--            `language sql`, and SQL function bodies ARE validated at CREATE time, so it
--            cannot forward-reference a table that does not exist yet. The table and the
--            function that unions it must land in ONE file, and that file is this one.
--            **There is no 0009_regional.sql in this repo and none may be added later** —
--            S6-T2 and S7 both assume rr_region_grants already exists. If you are looking
--            for it, it is here. (BUILD_PLAN S2-T7; rr_send_grants is a DIFFERENT table
--            and belongs to v1.1, not to this migration.)
--
-- RECURSION HAZARD, RESOLVED HERE RATHER THAN DISCOVERED IN 0014:
--            public.user_roles carries FORCE ROW LEVEL SECURITY, and FORCE applies to the
--            table OWNER. A SECURITY DEFINER auth_role() whose owner lacks BYPASSRLS would
--            therefore re-enter the user_roles SELECT policy, which itself calls
--            auth_role() — infinite recursion, error 42P17, surfacing HOURS after these
--            functions were declared fine, at the moment 0014's policies land. Two things
--            keep that from happening and BOTH are required:
--              1. These functions are SECURITY DEFINER and are owned by the migration role
--                 (postgres), which holds BYPASSRLS. 016_auth_helpers.sql asserts
--                 rolbypassrls on the owner, so a future ownership change fails CI rather
--                 than the app.
--              2. 0014's user_roles policies MUST NOT call auth_role(). The self-read is
--                 `user_id = (select auth.uid())`; the admin read uses a separate helper.
--                 That is S2-T16's responsibility and is restated here so nobody "tidies"
--                 the policy into a recursion.
--
-- CITATION:  DATA_MODEL.md §6/0012, §6/0009, §8.3, §8.4; ARCHITECTURE.md §5;
--            PRD §3 v1.0 items 3, 16; PRD US-A2, US-B4, US-D1, US-E3, US-I1, US-J1, US-J5;
--            CBL Art. VIII §6 (RA 10173 as a constitutional obligation),
--            CBL Art. VIII §7.1 (the Confidentiality Agreement, "upon assuming their roles").
--
-- POLICIES:  Deferred to 0014_rls.sql per ADR 0002. rr_region_grants ships ENABLE + FORCE
--            here, so it is unreachable until a policy names it — the correct failure
--            direction.
--
-- ROLLBACK:  Forward-only. Dropping any auth_* helper drops every policy that calls it.
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- PART 1 — rr_region_grants  (DATA_MODEL.md §6/0009, landed here; see header)
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Extra regions a regional rep may see BEYOND their primary user_roles.region_id. Most
-- reps will have zero rows here; the table exists because the CBL sets no headcount per
-- region (Art. III §4.6) and a rep occasionally covers a neighbouring region during a
-- vacancy. Person-scoped rather than term-scoped, because — like user_roles — it is a
-- live access-control fact that must revoke instantly, not a historical record. The
-- history of who could see what is audit_log.
create table public.rr_region_grants (
  user_id    uuid not null references auth.users(id) on delete cascade,
  region_id  uuid not null references public.regions(id),
  granted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, region_id)
);

comment on table public.rr_region_grants is
  'Additional regions a regional_rep may read, beyond user_roles.region_id. Unioned by '
  'auth_region_ids(). DATA_MODEL.md §6/0009 — created in 0012 because auth_region_ids() '
  'is language sql and cannot forward-reference it. There is no 0009_regional.sql.';

-- auth_region_ids() reads this by user_id on every regional-rep request.
create index rr_region_grants_user on public.rr_region_grants (user_id);

alter table public.rr_region_grants enable row level security;
alter table public.rr_region_grants force  row level security;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- PART 2 — the auth context helpers
--
-- Every one of them: STABLE (cached per statement) + SECURITY DEFINER (so FORCE RLS on
-- user_roles cannot recurse) + SET search_path = '' + fully-qualified names.
-- CONVENTIONS.md §3.4 makes the last two mandatory with no exceptions: without
-- `search_path = ''` a definer function resolves unqualified names against the CALLER's
-- search_path, and a caller who can create a table named `user_roles` in a schema ahead
-- of public owns the whole authorization model.
--
-- current_term_id() already exists — it shipped in 0005_terms.sql. It is NOT recreated
-- here.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- The live capability of the calling account. NULL for anon and for an authenticated
-- account with no user_roles row (an invited user who has not been assigned a role yet) —
-- and NULL is the correct answer there, because every policy compares against a role
-- literal and a NULL comparison yields NULL, which RLS treats as "no". Deny by default.
--
-- `(select auth.uid())` rather than a bare auth.uid() so the planner treats it as an
-- InitPlan and evaluates it once per statement instead of once per row.
create or replace function public.auth_role() returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.user_roles where user_id = (select auth.uid());
$$;

comment on function public.auth_role() is
  'The calling account''s org_role, read LIVE from public.user_roles on every statement. '
  'Never a JWT claim, never user_metadata: revocation must take effect on the next request '
  '(PRD US-A2, US-E3). NULL for anon and for an account with no role row — deny by default. '
  'SECURITY DEFINER because user_roles carries FORCE RLS; see the recursion note in the header.';

-- The person this account IS. Used by the member-portal policies (a member sees their own
-- row and nothing else) and by the confidentiality gate below. NULL for a tech_admin who
-- is not a member — user_roles.person_id is nullable in both directions on purpose.
create or replace function public.auth_person_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select person_id from public.user_roles where user_id = (select auth.uid());
$$;

comment on function public.auth_person_id() is
  'The people.id this account is bound to, or NULL. Read live from user_roles, never from '
  'the JWT. Used by the member-portal policies and by has_confidentiality_ack().';

-- A regional rep's PRIMARY region. The rr_needs_region CHECK on user_roles (0004)
-- guarantees this is non-null for a regional_rep, so a policy comparing against it can
-- never accidentally match everything through a NULL. PRD US-F1.
create or replace function public.auth_region_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select region_id from public.user_roles where user_id = (select auth.uid());
$$;

comment on function public.auth_region_id() is
  'The calling account''s PRIMARY region. Non-null for regional_rep by the rr_needs_region '
  'CHECK (0004). PRD US-F1 — "view scholars from their own region only".';

-- Primary region UNION every rr_region_grants row. This is what the regional-rep policies
-- actually compare against (`region_id = any(public.auth_region_ids())`), so a rep with no
-- extra grants sees exactly one region and a rep covering two sees exactly two.
--
-- Returns '{}' rather than NULL when the account has no region at all, because
-- `x = any(NULL)` is NULL — which RLS reads as "no" today, but `x = any('{}')` is FALSE,
-- which is unambiguous. An empty array is the honest representation of "no regions" and
-- it removes a whole class of three-valued-logic surprise from the policy bodies.
create or replace function public.auth_region_ids() returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.r), '{}'::uuid[])
  from (
    select region_id as r from public.user_roles      where user_id = (select auth.uid())
    union
    select region_id      from public.rr_region_grants where user_id = (select auth.uid())
  ) s
  where s.r is not null;
$$;

comment on function public.auth_region_ids() is
  'Primary region UNION rr_region_grants, as a uuid[]. Returns {} (never NULL) so policy '
  'bodies get FALSE rather than NULL for an account with no region. PRD US-F1, US-F3.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- PART 3 — updated_at triggers  (BUILD_PLAN S2-T8)
--
-- set_updated_at() itself shipped in 0011_audit.sql. CONVENTIONS.md §3.3: updated_at is
-- maintained by TRIGGER and NEVER set in application code, so a Server Action that
-- forgets it — or one that sets it to a client-supplied clock — cannot produce a wrong
-- timestamp. That matters beyond tidiness: update_member_record() (0030) uses
-- memberships/people.updated_at as the optimistic-concurrency token for PRD US-D1
-- ("concurrent edits do not silently overwrite one another"), and a token the client can
-- set is not a token.
--
-- Only `people` and `memberships` carry updated_at; the other tables in 0003-0007 are
-- append-or-status-change only.
-- ═══════════════════════════════════════════════════════════════════════════════════

create trigger trg_people_set_updated_at
  before update on public.people
  for each row execute function public.set_updated_at();

create trigger trg_memberships_set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- PART 4 — the audit triggers  (BUILD_PLAN S2-T9)
--
-- audit_row() shipped in 0011_audit.sql; the tables it observes shipped in 0004-0007.
-- CREATE TRIGGER resolves BOTH at creation time, which is why the attachment is a third
-- migration rather than living in either of the other two.
--
-- AFTER INSERT OR UPDATE, FOR EACH ROW. No DELETE clause is needed anywhere: there is no
-- DELETE policy in this schema and none may be added (PRD Reliability NFR), so a delete
-- is unreachable from the app. audit_row() handles TG_OP = 'DELETE' anyway, so a future
-- definer-level delete would still be recorded.
--
-- THE AUDITED SET — DATA_MODEL.md §8.3, plus one addition:
--   people                            PRD US-D1 (before/after on every record change)
--   memberships                       PRD US-D3, US-D5 (status updates, terminations)
--   officer_assignments               PRD US-E3, US-E5, US-E6 (CBL Art. VI standing)
--   user_roles                        PRD US-E3 ("officer role changes" — named in the
--                                     History NFR verbatim)
--   terms                             PRD US-H2 (rollover is audited with its actor)
--   committee_memberships             PRD US-E1 (adding/removing a member is audited)
--   department_assignments            PRD US-E2
--   confidentiality_acknowledgements  CBL Art. VIII §7.1 — who signed, when, recorded by
--                                     whom. The precondition for every sensitive read, so
--                                     who granted it must be attributable.
--   application_windows               **ADDED HERE, not in DATA_MODEL.md §8.3.**
--                                     PRD US-B4 states outright: "opening and closing a
--                                     window is written to the audit log with the
--                                     responsible user." §8.3 omits the table, so the doc
--                                     and the requirement disagree; the requirement wins
--                                     and the divergence is flagged rather than silently
--                                     resolved (BUILD_PLAN S2-T9, and the S2 risk table's
--                                     "flag, do not silently resolve").
--
-- NOT audited here because the tables do not exist yet: applications (0008, S3) and
-- rr_send_grants (v1.1). Each attaches its own trigger in its own migration.
-- NOT audited at all, deliberately: audit_log itself (it would recurse), and
-- member_id_counters / rr_region_grants (allocation state and a scope grant, both
-- reachable only through audited paths).
--
-- SECURITY INVARIANT 6: this is a DATABASE trigger precisely so no code path can skip it.
-- **Do not add an application-side audit write anywhere.** A Server Action that writes its
-- own audit row is a code path that can be forgotten, and one that can be forged.
-- ═══════════════════════════════════════════════════════════════════════════════════

create trigger trg_people_audit
  after insert or update on public.people
  for each row execute function public.audit_row();

create trigger trg_memberships_audit
  after insert or update on public.memberships
  for each row execute function public.audit_row();

create trigger trg_officer_assignments_audit
  after insert or update on public.officer_assignments
  for each row execute function public.audit_row();

create trigger trg_user_roles_audit
  after insert or update on public.user_roles
  for each row execute function public.audit_row();

create trigger trg_terms_audit
  after insert or update on public.terms
  for each row execute function public.audit_row();

create trigger trg_committee_memberships_audit
  after insert or update on public.committee_memberships
  for each row execute function public.audit_row();

create trigger trg_department_assignments_audit
  after insert or update on public.department_assignments
  for each row execute function public.audit_row();

create trigger trg_confidentiality_acknowledgements_audit
  after insert or update on public.confidentiality_acknowledgements
  for each row execute function public.audit_row();

-- PRD US-B4. See the divergence note above.
create trigger trg_application_windows_audit
  after insert or update on public.application_windows
  for each row execute function public.audit_row();


-- ═══════════════════════════════════════════════════════════════════════════════════
-- PART 5 — the confidentiality gate  (BUILD_PLAN S2-T12, DATA_MODEL.md §8.4, PRD US-J5)
--
-- CBL Art. VIII §7.1: "All elected and appointed officers, committee members, and
-- advisors shall sign a Confidentiality Agreement" covering, among other things,
-- "sensitive personnel matters, disciplinary proceedings, and private member data"
-- (§7.1.4) — and §7 requires it "UPON ASSUMING THEIR ROLES", which is per term, because
-- roles are assumed per term (Art. V §1). Hence the person × term grain of
-- confidentiality_acknowledgements (0007) and hence this gate.
--
-- IT IS A PRECONDITION, NOT A REPORT. Every SECURITY DEFINER function that returns a
-- sensitive column asserts an acknowledgement for the CURRENT term before it returns
-- anything, for exec_admin, crrd_admin and moderator alike.
--
-- THE DAY-ONE FAILURE MODE IS DELIBERATE AND MUST NOT BE "FIXED": on the morning a new
-- term opens, nobody has acknowledged, so every sensitive read fails. A newly appointed
-- CCDO can see member rows but no contact details until their acknowledgement row exists.
-- That is what "upon assuming their roles" means; it makes signing part of onboarding
-- rather than a thing that never happens, and unblocking it is ONE INSERT by an
-- exec_admin (0014 makes that INSERT exec_admin-only). It belongs in the rollover runbook
-- (PRD US-K1), not in a code change. See ARCHITECTURE.md §9 item 5 — this is the most
-- likely reason a correct-looking admin query returns nulls in the first week of a term.
--
-- WHY THIS IS NOT RLS: it gates COLUMNS, and RLS is row-level. Same reason 0015's
-- column-level GRANTs exist. The assertion sits inside the RPC, immediately next to the
-- audit write, so "a read that is not permitted" and "a read that is not logged" are
-- impossible to separate.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Does the CALLER have a current-term acknowledgement on file?
--
-- An account with no person_id (a tech_admin who is not a member) can never satisfy this,
-- and that is correct rather than an oversight: the agreement is signed by a HUMAN, and an
-- account not bound to a person names no human. tech_admin cannot read sensitive columns
-- at all (OQ-5), so the case does not arise in practice.
create or replace function public.has_confidentiality_ack() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.confidentiality_acknowledgements a
    where a.person_id = public.auth_person_id()
      and a.term_id   = public.current_term_id()
  );
$$;

comment on function public.has_confidentiality_ack() is
  'TRUE when the calling account has a confidentiality acknowledgement for the CURRENT term. '
  'CBL Art. VIII §7.1 ("upon assuming their roles" — per term, per Art. V §1). '
  'PRD US-J5. Grain is person x term, so a 2024 signature does not authorize a 2026 read.';

-- The same, as a hard precondition.
--
-- PRD US-J5 is explicit that "a sensitive-column read by a user with no current-term
-- acknowledgement is REFUSED, AND THE REFUSAL IS AN ERROR, NOT AN EMPTY RESULT." An empty
-- result would be indistinguishable from "this scholar has no contact number on file" and
-- the CCDO would spend the first week of the term debugging the wrong thing.
--
-- The errcode is 42501 (insufficient_privilege) so it maps through mapDbError() to
-- `unauthorized` like any other refusal — but the MESSAGE is deliberately DISTINCT from
-- the plain role-guard refusal above it, and names the missing acknowledgement, so the UI
-- can render the one actionable sentence that unblocks the reader (BUILD_PLAN S5-T26:
-- "your Art. VIII §7 confidentiality acknowledgement for the current term is not on file;
-- an Executive Admin can add it"). A generic "not authorized" here would be a correct
-- refusal delivered as an unactionable dead end.
create or replace function public.assert_confidentiality_ack() returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_confidentiality_ack() then
    raise exception
      'confidentiality acknowledgement for the current term is not on file for this account (CBL Art. VIII §7.1); an Executive Admin must record it before sensitive member data can be read'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.assert_confidentiality_ack() is
  'Raises 42501 with a DISTINCT, actionable message when the caller has no current-term '
  'confidentiality acknowledgement. PRD US-J5: the refusal is an error, never an empty result. '
  'Called by every RPC that returns a sensitive column.';

-- ── get_person_sensitive() ─────────────────────────────────────────────────────────
-- THE door to a scholar's PII, and there is deliberately only one.
--
-- 0015_grants revokes ALL on public.people from authenticated and grants back a six-column
-- SELECT (id, member_id, given_name, family_name, join_year, created_at). So the sensitive
-- ten are not reachable by any ordinary query from any session, including a hand-written
-- one from an admin — a `select * from people` as `authenticated` raises 42501. Reading
-- them requires coming through here, and coming through here writes an audit row.
--
-- **The correct way to give a screen a sensitive field is to call this function. The
-- incorrect way — and the one banned by CLAUDE.md — is to widen the GRANT in 0015 or to
-- add a column to v_member_directory.**
--
-- ORDER OF OPERATIONS IS THE SECURITY PROPERTY, and it is:
--   1. role guard          exec_admin / crrd_admin / moderator, else 42501
--   2. acknowledgement     CBL Art. VIII §7.1, else a DISTINCT 42501
--   3. audit write         BEFORE the value is built, so a caller cannot get the data
--                          and dodge the record by disconnecting mid-statement
--   4. return
--
-- WHO IS EXCLUDED, AND WHY EACH:
--   tech_admin      OQ-5, default answer NO (least privilege). The PRD grants the CTO
--                   "configure the system and control access" — that is not "read
--                   everyone's address". If this is ever reversed it must be a DISTINCT
--                   AUDITED ROLE, never a quiet widening of tech_admin here.
--   officer         PRD US-D2 / US-J1 / OQ-6, default NO. The Special Advisor sits in this
--                   tier too (CBL Art. III §2.9, Art. X §2.4-2.5) and must not read the
--                   records of people whose appeals they adjudicate.
--   regional_rep    PRD US-J1. Regional scope is rows, never sensitive columns.
--   member, anon    obvious, and stated so the enumeration is complete.
--
-- moderator IS included: PRD §2 and ARCHITECTURE.md §5 — "you cannot review an
-- application without reading it." Their reads are audited identically and gated on the
-- same acknowledgement.
--
-- Returns the WHOLE people row as jsonb, unmasked. mask_sensitive() is for the AUDIT LOG,
-- which must never store PII; it is not for the authorized caller, who has just passed two
-- guards and been recorded. Masking here would defeat the entire purpose of the function.
--
-- VOLATILE (the plpgsql default, stated by omission of STABLE) because it WRITES. A STABLE
-- or IMMUTABLE marking would let the planner elide or reorder calls and the audit row
-- could go missing.
create or replace function public.get_person_sensitive(p_person_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  v_row  public.people;
begin
  -- 1. Role guard. Deliberately narrower than "can read a member row".
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin', 'moderator') then
    raise exception 'not authorized to read sensitive member data'
      using errcode = '42501';
  end if;

  -- 2. CBL Art. VIII §7.1. Raises with its own distinct, actionable message.
  perform public.assert_confidentiality_ack();

  select * into v_row from public.people p where p.id = p_person_id;

  -- A person that does not exist is not an authorization failure. CONVENTIONS.md §4.3: an
  -- empty result is `not_found`, never `unauthorized` — saying "forbidden" would confirm
  -- the row exists, which discloses that a named scholar has a record. Return NULL and let
  -- the caller map it.
  if v_row.id is null then
    return null;
  end if;

  -- 3. RA 10173 / CBL Art. VIII §6: "who looked at this scholar's data, and when" must be
  -- answerable. Written BEFORE the return value is built, so there is no window in which
  -- the data has been read but the read has not been recorded.
  --
  -- old_data and new_data are NULL ON PURPOSE. This is a READ, so there is no diff — and
  -- more importantly, putting the row here would turn the audit log into exactly the PII
  -- store that mask_sensitive() exists to prevent. The log records the ACT, never the
  -- values (DATA_MODEL.md §8.3).
  insert into public.audit_log (
    actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note
  )
  values (
    (select auth.uid()),
    v_role::text,
    'people',
    p_person_id,
    'VIEW_SENSITIVE',
    null,
    null,
    'sensitive columns read via get_person_sensitive()'
  );

  return to_jsonb(v_row);
end;
$$;

comment on function public.get_person_sensitive(uuid) is
  'The ONLY path to a scholar''s RA 10173 sensitive columns. Guards on role '
  '(exec_admin/crrd_admin/moderator — tech_admin excluded per OQ-5), then on a current-term '
  'confidentiality acknowledgement (CBL Art. VIII §7.1), then writes a VIEW_SENSITIVE audit '
  'row BEFORE returning. Never widen the 0015 column GRANT to avoid calling this. '
  'PRD US-J1, US-J5, US-I1. DATA_MODEL.md §8.4.';

-- SECURITY DEFINER functions are granted to PUBLIC by default. The internal role guard
-- already refuses anon (auth_role() is NULL), but revoking is the belt to that brace and
-- makes the intent readable in \df+ without reading the body.
revoke execute on function public.get_person_sensitive(uuid) from anon;

-- auth_role() / auth_person_id() / auth_region_id() / auth_region_ids() are deliberately
-- LEFT executable by anon: RLS policy expressions are evaluated as the CALLING role, and
-- the anon INSERT policy on applications (0008) and the anon SELECT policies on regions
-- and terms (0014) sit in policy bodies that call them. They disclose nothing — each
-- returns only the caller's own binding, which for anon is NULL.
