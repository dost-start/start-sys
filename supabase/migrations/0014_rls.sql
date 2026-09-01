-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0014_rls.sql
--
-- WHAT:      Every Row Level Security policy in the schema, in five sections:
--              §1  reference + audit    regions, officer_positions, affiliations,
--                                       sensitive_column_registry, audit_log
--              §2  identity             people, member_id_counters, user_roles
--              §3  terms                terms, term_summaries, application_windows
--              §4  membership           memberships, member_affiliations
--              §5  org structure        departments, committees, department_assignments,
--                                       committee_memberships, officer_assignments,
--                                       confidentiality_acknowledgements, rr_region_grants
--            Plus three small boolean helpers this file needs and nothing else does.
--
-- WHY ONE FILE: ADR 0002. Every policy body calls public.auth_role(), which lands in
--            0012_functions.sql, so a policy written in its creating migration would not
--            be creatable. The creating migrations still ship ENABLE + FORCE ROW LEVEL
--            SECURITY, so no table is ever unprotected in the interval — RLS forced with
--            no policy returns zero rows and refuses the write, which is the correct
--            failure direction. This supersedes CONVENTIONS.md §3.4's same-file rule for
--            this repo only, and only for policies.
--
-- WHY THIS FILE IS THE MOST LOAD-BEARING ARTIFACT IN THE REPO: ARCHITECTURE.md §5 —
--            "Authorization lives in the database, not the app." middleware.ts and
--            withRole() are UX and defence-in-depth; if middleware were deleted tomorrow,
--            no PII would leak, because these policies return empty sets. Every policy
--            below therefore carries the PRD US-* or CBL article it implements. A policy
--            without a citation is a policy nobody can review.
--
-- DENY BY DEFAULT: with RLS forced and no matching policy, Postgres returns zero rows and
--            refuses the write. Therefore **a capability not granted by a named policy
--            below does not exist**. Two tables are deliberately given NO policy at all —
--            public.member_id_counters and public.mfa_recovery_codes — and that absence
--            is the mechanism, not an oversight (026_policy_invariants.sql carries the
--            declared whitelist).
--
-- NO DELETE POLICY EXISTS ANYWHERE IN THIS FILE, AND NONE MAY BE ADDED. Membership end is
--            a status change; term end is a flag; committee dissolution is not carrying
--            the row into the next term (CBL Art. III §5.4). PRD Reliability NFR;
--            CLAUDE.md banned patterns; asserted by 026 and 099.
--
-- NO POLICY BELOW NAMES `officer` OR `regional_rep` FOR INSERT OR UPDATE. PRD US-D2
--            ("no update, create or delete path exists for the Officer tier on any
--            record") and US-F2 ("Regional Representatives cannot delete or alter any
--            record") are MISSING POLICIES, not missing buttons. 026_policy_invariants.sql
--            asserts this over pg_policies so it stays true in 2029.
--
-- TABLES DELIBERATELY ABSENT: applications and application-window *insert* semantics for
--            anon belong to 0008 (S3-T5); renewal_submissions, rr_send_grants and the
--            email tables are v1.1 and do not exist yet. Do not add placeholder policies
--            for tables this migration cannot see.
--
-- CITATION:  ARCHITECTURE.md §5; DATA_MODEL.md §9, §3.1, §3.4, §8.4;
--            PRD §3 v1.0 items 1, 3, 4, 10, 11, 16; PRD US-A2, US-B4, US-D2, US-D3,
--            US-D5, US-D6, US-E3, US-E4, US-E5/E6/E7, US-F1, US-F2, US-I1, US-J1, US-J5;
--            CBL Art. III §4 / §5, Art. VI, Art. VII §3.2.3, Art. VIII §7.1.
--
-- ROLLBACK:  Forward-only. Dropping a policy in this file widens access; the correct
--            reversal is a NEW migration that recreates it, with the pgTAP assertion
--            written first (CONVENTIONS.md §12 rule 3).
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- §0 — three helpers this file needs
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── is_admin_reader() ──────────────────────────────────────────────────────────────
-- Exists ONLY so that the user_roles SELECT policy can ask "is the caller an exec or tech
-- admin" WITHOUT calling public.auth_role().
--
-- Why not just call auth_role()? Because 0012_functions.sql's header makes it a standing
-- instruction that 0014's user_roles policies must not, and that instruction is worth
-- honouring as a symbol rather than as a comment. The hazard it guards is real and its
-- failure mode is nasty: public.user_roles carries FORCE ROW LEVEL SECURITY, and FORCE
-- applies to the table OWNER. A policy on user_roles that calls a helper which itself
-- SELECTs from user_roles re-enters that same policy — infinite recursion, error 42P17 —
-- unless the helper is SECURITY DEFINER owned by a role holding BYPASSRLS. Today
-- auth_role() satisfies that (owned by the migration role, asserted by
-- 016_auth_helpers.sql). But "this policy is safe because of a property of a function
-- three files away" is exactly the kind of load-bearing coincidence that gets tidied away
-- by a future maintainer. A dedicated, named helper carrying the reason on its own head
-- is cheap insurance.
--
-- SECURITY DEFINER + SET search_path = '' + fully-qualified names, per CONVENTIONS.md
-- §3.4 with no exceptions.
create or replace function public.is_admin_reader() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role in ('exec_admin', 'tech_admin')
  );
$$;

comment on function public.is_admin_reader() is
  'True when the calling account holds exec_admin or tech_admin. Used ONLY by the '
  'user_roles SELECT policy, which must not call auth_role() — see the recursion note in '
  '0012_functions.sql and in this function''s definition. PRD US-I1.';

-- ── has_aal2() ─────────────────────────────────────────────────────────────────────
-- PRD §3 v1.0 item 2 / US-A3: TOTP enrolment is mandatory for every account above Member
-- tier. This is the DATABASE backstop for that requirement: it holds even if the MFA
-- middleware is bypassed entirely, even if the API is called directly.
--
-- Reads no table, so SECURITY INVOKER (the default) is correct — there is nothing for a
-- definer to bypass. When request.jwt.claims is unset, auth.jwt() is NULL, so the
-- comparison yields NULL, which RLS reads as "no". Deny by default.
create or replace function public.has_aal2() returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.jwt() ->> 'aal') = 'aal2';
$$;

comment on function public.has_aal2() is
  'True only for a session that has satisfied its second factor. The database-side half of '
  'PRD US-A3/US-A4 — it refuses a privileged write from an aal1 session even when the '
  'middleware MFA gate has been removed. NULL claims yield NULL, i.e. deny.';

-- ── is_user_roles_writer() ─────────────────────────────────────────────────────────
-- PRD US-E3: only the Technical Admin (the CTO) assigns and revokes system roles, and
-- ARCHITECTURE.md §5 requires the aal2 predicate on privileged tables. Combined here for
-- the same recursion reason as is_admin_reader(): this predicate is evaluated INSIDE a
-- policy on public.user_roles and therefore may not read user_roles as the invoker.
create or replace function public.is_user_roles_writer() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = 'tech_admin'
  ) and public.has_aal2();
$$;

comment on function public.is_user_roles_writer() is
  'tech_admin AND aal2. The only predicate that permits a write to public.user_roles. '
  'PRD US-E3 (role assignment is the CTO''s alone) + US-A3 (2FA above Member tier). '
  'SECURITY DEFINER for the FORCE-RLS recursion reason documented on is_admin_reader().';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- §1 — REFERENCE DATA AND THE AUDIT LOG                              (BUILD_PLAN S2-T15)
--
-- The public application form is anonymous and needs the region list to render, so
-- `regions` and `officer_positions` are the only two tables in the whole schema that anon
-- may read in full. Widening that pair is how the public surface leaks; any addition
-- needs a pgTAP assertion in the same PR (mirrors S3-T2's anon-surface rule).
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── regions ────────────────────────────────────────────────────────────────────────
-- PRD US-B1: "the form is reachable without an account" and its region dropdown must
-- render for an anonymous applicant. Philippine geography is not confidential.
create policy regions_read on public.regions
  for select to anon, authenticated
  using (true);

-- PRD US-E3 / ARCHITECTURE.md §5: reference data is system configuration, which is the
-- Technical Admin's. RA 12000 (2024) added the Negros Island Region; a nineteenth region
-- would be a tech_admin write, not a CRRD click.
create policy regions_insert on public.regions
  for insert to authenticated
  with check (public.auth_role() = 'tech_admin');

create policy regions_update on public.regions
  for update to authenticated
  using (public.auth_role() = 'tech_admin')
  with check (public.auth_role() = 'tech_admin');

-- ── officer_positions ──────────────────────────────────────────────────────────────
-- The Constitution as data (CBL Art. III §2, §3, §4.6, §5). Readable by anon for the same
-- reason as regions: the application form and the public privacy notice may name a
-- position, and the 23 titles are published in the Constitution itself.
create policy officer_positions_read on public.officer_positions
  for select to anon, authenticated
  using (true);

-- CBL Art. XII: the position list changes only by constitutional amendment, which lands
-- as a cited migration. This policy exists so that an emergency amendment (Art. XII §4,
-- effective immediately on a 2/3 Executive Board vote) can be recorded by the CTO without
-- a deploy — the four-administrator CHECK in 0003 still refuses a fifth administrator.
create policy officer_positions_insert on public.officer_positions
  for insert to authenticated
  with check (public.auth_role() = 'tech_admin');

create policy officer_positions_update on public.officer_positions
  for update to authenticated
  using (public.auth_role() = 'tech_admin')
  with check (public.auth_role() = 'tech_admin');

-- ── affiliations ───────────────────────────────────────────────────────────────────
-- PRD US-G2: "affiliations are managed as data — a new partnership requires no code
-- change." Written by the CCDO, who runs the campaigns that filter on them. NOT readable
-- by anon: the list of the org's partners is not part of the public application surface.
create policy affiliations_read on public.affiliations
  for select to authenticated
  using (true);

create policy affiliations_insert on public.affiliations
  for insert to authenticated
  with check (public.auth_role() = 'crrd_admin');

create policy affiliations_update on public.affiliations
  for update to authenticated
  using (public.auth_role() = 'crrd_admin')
  with check (public.auth_role() = 'crrd_admin');

-- ── sensitive_column_registry ──────────────────────────────────────────────────────
-- The RA 10173 classification (CBL Art. VIII §6 makes RA 10173 a constitutional
-- obligation). Read-restricted to exec_admin and tech_admin because it is a map of
-- exactly where the PII is — useful to an auditor, useful to an attacker.
--
-- There is deliberately NO WRITE POLICY OF ANY KIND. CONVENTIONS.md §13 rule 4: a new
-- sensitive column is registered in the SAME MIGRATION that creates it. Registering one
-- from the app would mean the classification could drift from the schema at runtime,
-- and 099_security_invariants.sql asserts that every pair here names a column that
-- actually exists.
create policy sensitive_column_registry_read on public.sensitive_column_registry
  for select to authenticated
  using (public.auth_role() in ('exec_admin', 'tech_admin'));

-- ── audit_log ──────────────────────────────────────────────────────────────────────
-- PRD US-I1: "the log is readable only by Executive and Technical Admins." Note who is
-- excluded and that it is on purpose — crrd_admin and moderator are the tier whose reads
-- and writes this log records, so giving them the log would let the watched read the
-- watcher.
create policy audit_log_read on public.audit_log
  for select to authenticated
  using (public.auth_role() in ('exec_admin', 'tech_admin'));

-- NO INSERT, UPDATE OR DELETE POLICY ON audit_log, EVER.
--   INSERT: rows are written by audit_row(), a SECURITY DEFINER trigger owned by a
--           BYPASSRLS role. An INSERT policy would let a session forge an audit row, and
--           a forgeable audit log is worse than no audit log.
--   UPDATE/DELETE: append-only is already enforced at the GRANT level in 0011
--           (`revoke update, delete ... from authenticated, anon, service_role`), which is
--           the strong form — a policy added carelessly in 2029 cannot re-open what has
--           been revoked. NOT EVEN THE CEO CAN REWRITE HISTORY FROM THE APP.
-- PRD US-I1: "no user role can edit or delete an audit entry."


-- ═══════════════════════════════════════════════════════════════════════════════════
-- §2 — IDENTITY                                                      (BUILD_PLAN S2-T16)
--
-- READ THIS BEFORE EDITING: RLS is ROW-level and CANNOT protect a COLUMN. The officer and
-- regional-rep tiers are kept away from birthdates and addresses by the column-level
-- GRANT in 0015_grants.sql and by v_member_directory (0013) — NOT by anything in this
-- section. Do not try to solve columns here; you will only produce a policy that looks
-- like it protects something and does not.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── people ─────────────────────────────────────────────────────────────────────────
-- PRD US-D1 (admins view member records), US-D2 (officers view them), US-F1 (a regional
-- rep sees their own region only), US-E4 (a member sees their own record and nobody
-- else's).
--
-- The regional_rep branch resolves the region through the CURRENT TERM's membership, not
-- through a column on `people`: scholars relocate, and the rep who could see someone in
-- 2025 must not automatically see them in 2027 (DATA_MODEL.md §2.2). The EXISTS subquery
-- is itself subject to memberships_read below — harmless and in fact reinforcing, since
-- that policy applies the same region predicate; there is no recursion because
-- memberships_read never references `people`.
create policy people_read on public.people
  for select to authenticated
  using (
    public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator', 'officer')
    or (
      public.auth_role() = 'regional_rep'
      and exists (
        select 1
        from public.memberships m
        where m.person_id = people.id
          and m.term_id = public.current_term_id()
          and m.region_id = any (public.auth_region_ids())
      )
    )
    or (
      public.auth_role() = 'member'
      and people.id = public.auth_person_id()
    )
  );

-- PRD US-D1: "As a CRRD or Executive Admin, I can view and update member records."
-- Moderators hold it too — the locked role model gives them "update member records"
-- (PRD §2 Moderator row). Officers and regional reps are absent, and their absence IS
-- US-D2 and US-F2.
--
-- NOTE, AND IT IS NOT AN OVERSIGHT: 0015_grants.sql revokes ALL on public.people from
-- authenticated and grants back a six-column SELECT only — no table UPDATE. So this
-- policy is the SECOND lock on a door whose first lock is a missing GRANT. Member record
-- edits go through update_member_record() (0030), a SECURITY DEFINER RPC that is role-
-- gated, confidentiality-gated and audited. Widening the 0015 GRANT to "make a Server
-- Action work" is the exact banned move (BUILD_PLAN S5-T7, CLAUDE.md banned patterns).
create policy people_update on public.people
  for update to authenticated
  using (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'))
  with check (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));

-- NO INSERT POLICY ON people FOR ANY ROLE, AND NONE MAY BE ADDED.
-- A person row is created in exactly one place: approve_application() (0023), a SECURITY
-- DEFINER function that inserts `people`, allocates the member ID and inserts the
-- membership in ONE transaction. That is what makes PRD US-C3's "no approval can produce
-- a member without an ID, or an ID without a member" structurally true rather than
-- conventionally true. An INSERT policy here would create a second path that can produce
-- a person with no member ID.

-- ── member_id_counters ─────────────────────────────────────────────────────────────
-- NO POLICY OF ANY KIND, DELIBERATELY. With FORCE RLS on and no policy, the table is
-- unreachable by every human role, so member-ID allocation state can only be touched from
-- inside allocate_member_id() (0022, SECURITY DEFINER). 0015 additionally revokes every
-- table privilege on it. This table is on 026_policy_invariants.sql's declared
-- intentionally-unreachable whitelist — its absence there is a bug, its absence here is
-- the design. DATA_MODEL.md §4 mechanism 3.

-- ── user_roles ─────────────────────────────────────────────────────────────────────
-- RECURSION HAZARD — READ BEFORE TOUCHING. public.user_roles carries FORCE ROW LEVEL
-- SECURITY. A policy on this table that calls public.auth_role() would re-enter this same
-- policy (auth_role() SELECTs user_roles), and while auth_role() is currently definer-
-- owned by a BYPASSRLS role, none of the policies below rely on that coincidence:
-- the self-read compares auth.uid() directly, and the admin read and the write predicate
-- go through the two purpose-built helpers in §0. Do not "tidy" these into auth_role().

-- Every account may see its own row. This is what lets getSessionContext() resolve the
-- caller's own role — the read the app makes on literally every request.
create policy user_roles_read_self on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- PRD US-I1 / US-E3: exec_admin oversees all org records and tech_admin administers
-- access, so both need to see who holds what. Nobody else does — a moderator has no
-- business enumerating the org's accounts.
create policy user_roles_read_admin on public.user_roles
  for select to authenticated
  using (public.is_admin_reader());

-- PRD US-E3: "As a Technical Admin, I can assign and revoke system roles." Sole authority,
-- and gated on aal2 so the role-assignment surface cannot be reached from a session that
-- has only a password (PRD US-A3). ARCHITECTURE.md §5 flags the OQ-13 consequence: while
-- the CTO seat is vacant nobody can grant tech_admin to the CEO's designated acting
-- officer (CBL Art. VI §4.2). That is a real bootstrap gap and it is a human decision, not
-- something to widen here.
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check (public.is_user_roles_writer());

-- Revocation is an UPDATE to 'member', never a DELETE — there is no DELETE path anywhere
-- in this schema, and the account must keep existing so its audit trail keeps resolving.
create policy user_roles_update on public.user_roles
  for update to authenticated
  using (public.is_user_roles_writer())
  with check (public.is_user_roles_writer());


-- ═══════════════════════════════════════════════════════════════════════════════════
-- §3 — TERMS AND APPLICATION WINDOWS                                 (BUILD_PLAN S2-T17)
--
-- This section is what makes S3's anonymous application INSERT work at all: the anon
-- INSERT policy on `applications` (0008) reads public.application_windows from inside its
-- own policy expression AS THE ANON ROLE. If application_windows_read_anon below is ever
-- narrowed, every anonymous submission fails with an opaque row-level-security error that
-- reads exactly like a form bug — and gets "fixed" by widening something worse.
-- 041_applications_anon_insert_rls.sql exists so that turns CI red instead.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── terms ──────────────────────────────────────────────────────────────────────────
-- PRD US-H3: administrators select a previous term and read its records. Every
-- authenticated tier may READ the term list — knowing that a 2024-2025 term existed
-- discloses nothing; what it CONTAINS is guarded by the per-table policies, and officers
-- and reps do not gain access to prior terms they could not see at the time.
create policy terms_read on public.terms
  for select to authenticated
  using (true);

-- Anon sees the ACTIVE term only. The public application form resolves its term through
-- current_term_id(); a draft or archived term is not the anonymous visitor's business.
create policy terms_read_anon on public.terms
  for select to anon
  using (status = 'active');

-- PRD US-H2 + ARCHITECTURE.md §5: defining terms is system configuration, tech_admin's
-- alone, and the CTO leads rollover (OQ-7, resolved 2026-09-01). exec_admin is
-- DELIBERATELY narrowed out here — CEO/COO oversee records, the CTO executes the state
-- change. aal2 per US-A3.
create policy terms_insert on public.terms
  for insert to authenticated
  with check (public.auth_role() = 'tech_admin' and public.has_aal2());

create policy terms_update on public.terms
  for update to authenticated
  using (public.auth_role() = 'tech_admin' and public.has_aal2())
  with check (public.auth_role() = 'tech_admin' and public.has_aal2());

-- ── term_summaries ─────────────────────────────────────────────────────────────────
-- Frozen headcounts, so PRD US-H3's historical dashboards never re-scan archived rows.
-- Readable by every authenticated tier: it holds counts, never a person.
create policy term_summaries_read on public.term_summaries
  for select to authenticated
  using (true);

-- NO WRITE POLICY, DELIBERATELY. term_summaries is written by roll_over_term() (v1.2), a
-- SECURITY DEFINER function, inside the one rollover transaction. A snapshot a human can
-- edit is not a snapshot. PRD US-H2: "the current term's records are preserved as
-- historical data, unchanged."

-- ── application_windows ────────────────────────────────────────────────────────────
-- PRD US-B4. Every authenticated tier may read the schedule; the anon read is narrowed to
-- an OPEN window, so a closed period is INVISIBLE as well as inert.
create policy application_windows_read on public.application_windows
  for select to authenticated
  using (true);

-- The load-bearing one. `now() between opens_at and closes_at` is evaluated as anon, and
-- 0008's anon INSERT policy EXISTS-checks this table, so "the application period is
-- closed" is a database fact and a forwarded or bookmarked /apply link is inert.
create policy application_windows_read_anon on public.application_windows
  for select to anon
  using (now() between opens_at and closes_at);

-- BOTH crrd_admin AND tech_admin, per ADR 0003
-- (docs/decisions/0003-application-window-authority.md). PRD US-B4 says "As a CRRD Admin,
-- I can open and close the application period"; ARCHITECTURE.md §5 lists
-- application_windows among the tables only tech_admin writes. Shipping both resolves the
-- conflict in the direction that survives an empty CTO seat (OQ-13): a tech_admin-only
-- gate would mean the CCDO cannot open the application period while the CTO seat is
-- vacant, which is the one seat most likely to be vacant at a term boundary.
-- Opening and closing is audited by trg_application_windows_audit (0012), so US-B4's
-- "written to the audit log with the responsible user" holds for either writer.
create policy application_windows_insert on public.application_windows
  for insert to authenticated
  with check (
    public.auth_role() in ('tech_admin', 'crrd_admin')
    and public.has_aal2()
  );

create policy application_windows_update on public.application_windows
  for update to authenticated
  using (
    public.auth_role() in ('tech_admin', 'crrd_admin')
    and public.has_aal2()
  )
  with check (
    public.auth_role() in ('tech_admin', 'crrd_admin')
    and public.has_aal2()
  );


-- ═══════════════════════════════════════════════════════════════════════════════════
-- §4 — MEMBERSHIPS                                                   (BUILD_PLAN S2-T18)
--
-- The highest-value policy in the slice. memberships_update below is where CBL Art. VII
-- §3.2.3 stops being prose and becomes a database refusal.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- PRD US-D1 (admins), US-D2 (officers view), US-F1 (rep sees own region only),
-- US-E4 (member sees their own assignment and nobody else's).
-- The rep branch compares region_id on the membership row directly — the region is a fact
-- about the TERM membership, so a rep's visibility follows the scholar's current region
-- rather than a stale one (DATA_MODEL.md §2.2).
create policy memberships_read on public.memberships
  for select to authenticated
  using (
    public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator', 'officer')
    or (
      public.auth_role() = 'regional_rep'
      and region_id = any (public.auth_region_ids())
    )
    or (
      public.auth_role() = 'member'
      and person_id = public.auth_person_id()
    )
  );

-- PRD US-C2: approval creates the membership record. In practice this runs inside
-- approve_application() (definer), and renewal will insert here too (US-H1). The three
-- operating roles are named because the moderator tier owns application decisions.
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));

-- ┌──────────────────────────────────────────────────────────────────────────────────┐
-- │ CBL Art. VII §3.2.3, ENFORCED STRUCTURALLY. Read both halves; they are different │
-- │ requirements that happen to share a predicate.                                   │
-- │                                                                                  │
-- │ USING half  — governs which EXISTING rows this role may touch at all. A row that │
-- │               is already `terminated` is invisible to this policy for anyone but │
-- │               exec_admin, so the ONLY reversal edge in the entire schema,         │
-- │               terminated -> active, is exec_admin's alone. That is PRD US-D6:     │
-- │               reinstatement after the Special Advisor upholds an appeal           │
-- │               (CBL Art. VII §3.2.5-3.2.6). Without this half a crrd_admin could   │
-- │               quietly un-terminate a member the Executive Board removed.          │
-- │                                                                                  │
-- │ WITH CHECK half — governs the resulting row. Nobody but exec_admin may move a     │
-- │               membership INTO `terminated`. That is PRD US-D5 and CBL Art. VII    │
-- │               §3.2.3: "A simple majority vote (50% + 1) of the Executive Board is │
-- │               required for termination to be enacted." crrd_admin and moderator   │
-- │               are deliberately narrowed out even though the locked role model     │
-- │               gives them "update member status" for every OTHER transition —      │
-- │               `left` is legitimately a moderator's, `terminated` never is.        │
-- │                                                                                  │
-- │ This is exactly why `terminated` is a separate enum value and not a note in       │
-- │ ended_reason: you cannot write an RLS policy against free text (DATA_MODEL §3.1). │
-- │ The legal-EDGE machine (graduated -> active is impossible for anyone) is a        │
-- │ separate trigger in 0028; this policy is about WHO, that trigger is about WHAT.   │
-- └──────────────────────────────────────────────────────────────────────────────────┘
create policy memberships_update on public.memberships
  for update to authenticated
  using (
    public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator')
    and (status <> 'terminated' or public.auth_role() = 'exec_admin')
  )
  with check (
    public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator')
    and (status <> 'terminated' or public.auth_role() = 'exec_admin')
  );

-- ── member_affiliations ────────────────────────────────────────────────────────────
-- PRD US-G2. Read follows the memberships pattern exactly, resolved through the parent
-- membership because this link table carries no region or person of its own — a rep must
-- not learn that a scholar outside their region is a "START x DataCamp" member. The
-- EXISTS is evaluated under memberships_read, so the scoping is inherited rather than
-- restated, which is the point: one region predicate, one place to get it wrong.
create policy member_affiliations_read on public.member_affiliations
  for select to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.id = member_affiliations.membership_id
    )
  );

create policy member_affiliations_insert on public.member_affiliations
  for insert to authenticated
  with check (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));

create policy member_affiliations_update on public.member_affiliations
  for update to authenticated
  using (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'))
  with check (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));


-- ═══════════════════════════════════════════════════════════════════════════════════
-- §5 — ORG STRUCTURE                                                 (BUILD_PLAN S2-T19)
--
-- WHERE THE OQ-14 MODERATOR BOUNDARY IS ACTUALLY DRAWN, and the asymmetry is the
-- Constitution's, not ours:
--   STRUCTURE  (creating a committee or a department)  -> crrd_admin, the CCDO alone.
--              CBL Art. III §5.1-5.2 routes every committee creation, restructuring or
--              dissolution through a co-endorsement, COO review and CEO approval, so it
--              was never a deputy's to make.
--   STAFFING   (assigning a member to an EXISTING committee) -> moderator too. The
--              locked role model gives the DCCDO-C/D and DCTO-PD exactly this.
--   DISCIPLINE (any officer standing) -> exec_admin alone. Every value of
--              officer_assignment_status is a CBL Art. VI act reserved to the CEO or the
--              Executive Board.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── departments ────────────────────────────────────────────────────────────────────
-- CBL Art. III §4 fixes SEVEN departments, each headed by a named Chief. They are seeded
-- (0016), carried forward by rollover, and asserted by a CI-blocking invariant. So this
-- write policy is exercised roughly once per constitutional amendment (Art. XII), not
-- once per operational need — the power is the CCDO's, the occasion is near-zero.
-- PRD US-E2.
create policy departments_read on public.departments
  for select to authenticated
  using (true);

create policy departments_insert on public.departments
  for insert to authenticated
  with check (public.auth_role() = 'crrd_admin');

create policy departments_update on public.departments
  for update to authenticated
  using (public.auth_role() = 'crrd_admin')
  with check (public.auth_role() = 'crrd_admin');

-- ── committees ─────────────────────────────────────────────────────────────────────
-- The exact opposite, and again the Constitution's asymmetry: CBL Art. III §5 makes
-- committees discretionary and per-term — "created, restructured, or dissolved depending
-- on the operational needs of the organization". Creating one is one INSERT: no
-- migration, no deploy, no enum, no route (ARCHITECTURE.md §4.4). PRD US-E1.
--
-- Dissolution (Art. III §5.4, "only when it has no incumbent member") needs no DELETE
-- policy and must never get one: a committee is dissolved by not carrying it into the
-- next term, and a new term has no incumbents by construction.
create policy committees_read on public.committees
  for select to authenticated
  using (true);

create policy committees_insert on public.committees
  for insert to authenticated
  with check (public.auth_role() = 'crrd_admin');

create policy committees_update on public.committees
  for update to authenticated
  using (public.auth_role() = 'crrd_admin')
  with check (public.auth_role() = 'crrd_admin');

-- ── department_assignments ─────────────────────────────────────────────────────────
-- PRD US-E2 (assignments are term-scoped and audited) and US-E4 ("the member sees only
-- their own assignment, never anyone else's; no organizational roster is reachable from
-- the member view"). The scoping is resolved through the parent membership, so the rep
-- and member branches inherit memberships_read rather than restating a region predicate.
create policy department_assignments_read on public.department_assignments
  for select to authenticated
  using (
    public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator', 'officer')
    or exists (
      select 1
      from public.memberships m
      where m.id = department_assignments.membership_id
        and (
          (public.auth_role() = 'regional_rep' and m.region_id = any (public.auth_region_ids()))
          or (public.auth_role() = 'member' and m.person_id = public.auth_person_id())
        )
    )
  );

-- "Assign members to existing departments" is explicitly a moderator power (PRD §2).
create policy department_assignments_insert on public.department_assignments
  for insert to authenticated
  with check (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));

create policy department_assignments_update on public.department_assignments
  for update to authenticated
  using (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'))
  with check (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));

-- ── committee_memberships ──────────────────────────────────────────────────────────
-- PRD US-E1 (adding or removing a committee member is audited) and US-E4. Same shape and
-- the same reasoning as department_assignments.
create policy committee_memberships_read on public.committee_memberships
  for select to authenticated
  using (
    public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator', 'officer')
    or exists (
      select 1
      from public.memberships m
      where m.id = committee_memberships.membership_id
        and (
          (public.auth_role() = 'regional_rep' and m.region_id = any (public.auth_region_ids()))
          or (public.auth_role() = 'member' and m.person_id = public.auth_person_id())
        )
    )
  );

create policy committee_memberships_insert on public.committee_memberships
  for insert to authenticated
  with check (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));

create policy committee_memberships_update on public.committee_memberships
  for update to authenticated
  using (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'))
  with check (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));

-- ── officer_assignments ────────────────────────────────────────────────────────────
-- Who holds which CBL position this term, and their standing under CBL Art. VI. Readable
-- by every authenticated tier: the org chart is not confidential, and PRD US-E4 lets a
-- member see where they sit. The sensitive part of a separation is status_note's free
-- text, which is a known residual — it is not in sensitive_column_registry today and that
-- is worth revisiting when Art. VI events start being recorded.
create policy officer_assignments_read on public.officer_assignments
  for select to authenticated
  using (true);

-- ┌──────────────────────────────────────────────────────────────────────────────────┐
-- │ exec_admin ONLY, for every command. Not a convenience — CBL Art. VI reserves     │
-- │ every one of these to the CEO or the Executive Board:                             │
-- │   on_leave   §1.2  "The CEO shall acknowledge, approve, and issue a notice of LOA"│
-- │   suspended  §3.2.3 automatic on receipt of an impeachment complaint              │
-- │   impeached  §3.2.7 majority vote of the Executive Board; §3.2.8 "final and       │
-- │                     irrevocable" — the one state the Constitution declares         │
-- │                     terminal, so it has no outbound edge anywhere                  │
-- │   resigned   §2.2  approval rests with the CEO                                    │
-- │   dismissed  §1.7  automatic after an unanswered AWOL notice                      │
-- │ crrd_admin and moderator are refused AT THE DATA LAYER, not merely hidden from    │
-- │ (PRD US-E5, US-E6, US-E7). And note what this does NOT do: separation from OFFICE │
-- │ never touches memberships.status. An impeached CTO is still a member — Art. VI    │
-- │ §3.3 disqualifies them from holding a POSITION, not from the organization.         │
-- │ Merging the two is the single most likely future mistake in this schema.          │
-- │                                                                                  │
-- │ KNOWN DIVERGENCE, FLAGGED NOT FIXED: CBL Art. VI §1.6 makes the DCOO the officer  │
-- │ who issues the AWOL notice, and the locked role model gives the DCOO `officer` —  │
-- │ SELECT only. So the notice is issued outside the system and the dismissal is      │
-- │ recorded by an exec_admin with the DCOO named in status_note. Widening this to    │
-- │ the DCOO would create a quiet fifth administrator, which the 2026-09-01 decision  │
-- │ forecloses. PRD OQ-16 — a question for the project heads, not a policy edit.      │
-- └──────────────────────────────────────────────────────────────────────────────────┘
create policy officer_assignments_insert on public.officer_assignments
  for insert to authenticated
  with check (public.auth_role() = 'exec_admin');

create policy officer_assignments_update on public.officer_assignments
  for update to authenticated
  using (public.auth_role() = 'exec_admin')
  with check (public.auth_role() = 'exec_admin');

-- ── confidentiality_acknowledgements ───────────────────────────────────────────────
-- CBL Art. VIII §7.1: every officer, committee member and advisor signs a Confidentiality
-- Agreement "upon assuming their roles", covering "sensitive personnel matters,
-- disciplinary proceedings, and private member data" (§7.1.4). PRD US-J5 makes a
-- current-term acknowledgement a HARD PRECONDITION for reading any sensitive column —
-- enforced inside get_person_sensitive() and the other audited RPCs (0012, 0030), not
-- here, because that gates COLUMNS and RLS is row-level.
--
-- Read: your own row, plus exec_admin (who files them) and tech_admin (who audits
-- access). A person may see that they have signed; they may not enumerate who has not.
create policy confidentiality_acknowledgements_read on public.confidentiality_acknowledgements
  for select to authenticated
  using (
    person_id = public.auth_person_id()
    or public.auth_role() in ('exec_admin', 'tech_admin')
  );

-- exec_admin ONLY. ARCHITECTURE.md §5: "unblocking it is one INSERT by an exec_admin."
-- The deliberate day-one failure mode is worth stating plainly: on the morning a new term
-- opens, nobody has acknowledged, so every sensitive read fails until these rows are
-- filed. That is what "upon assuming their roles" means, and it belongs in the rollover
-- runbook (PRD US-K1, OQ-18) — not in a widened policy.
create policy confidentiality_acknowledgements_insert on public.confidentiality_acknowledgements
  for insert to authenticated
  with check (public.auth_role() = 'exec_admin');

-- NO UPDATE POLICY, DELIBERATELY. A signature is a historical fact with a timestamp and an
-- agreement version. Correcting one is a new row for a new term, or a tech_admin-mediated
-- migration — never an in-place edit that would make "did they sign, and against which
-- text" unanswerable in 2031.

-- ── rr_region_grants ───────────────────────────────────────────────────────────────
-- Extra regions a regional rep may read beyond their primary (unioned by
-- auth_region_ids()). A rep may see their own grants — knowing which regions you cover is
-- not a disclosure — and exec/tech admins may see all of them, since this table is part of
-- the answer to "who could see what, when" (PRD US-I1).
--
-- No recursion: auth_region_ids() reads THIS table, but it is SECURITY DEFINER owned by a
-- BYPASSRLS role, and this policy does not call it.
create policy rr_region_grants_read on public.rr_region_grants
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.auth_role() in ('exec_admin', 'tech_admin')
  );

-- Extending a rep's scope is an access-control change, so it is tech_admin's, alongside
-- user_roles (PRD US-E3). Note this is a DIFFERENT thing from rr_send_grants (v1.1), which
-- is CRRD's "go signal" to send (PRD US-F3) — scope to READ versus permission to SEND.
create policy rr_region_grants_insert on public.rr_region_grants
  for insert to authenticated
  with check (public.auth_role() = 'tech_admin' and public.has_aal2());

create policy rr_region_grants_update on public.rr_region_grants
  for update to authenticated
  using (public.auth_role() = 'tech_admin' and public.has_aal2())
  with check (public.auth_role() = 'tech_admin' and public.has_aal2());

-- ── public.mfa_recovery_codes ──────────────────────────────────────────────────────
-- NO POLICY, DELIBERATELY, and 0017's header says so at length. A SELECT policy would
-- expose hashes to offline cracking; an INSERT or UPDATE policy would let a session forge
-- or burn its own second factor. Access is only through issue_recovery_codes() and
-- consume_recovery_code(), both SECURITY DEFINER. On 026's declared whitelist.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- END. Two things to check before adding anything to this file:
--   1. Does the new policy name `officer` or `regional_rep` for INSERT or UPDATE? Then it
--      contradicts PRD US-D2 / US-F2 and 026_policy_invariants.sql will fail.
--   2. Is it a DELETE policy? Then it contradicts the Reliability NFR and 026 and 099 will
--      both fail. Removal is a status change.
-- If you are widening a policy to make a screen work, stop and write the pgTAP test first.
-- If the test feels wrong to write, the policy is wrong (CONVENTIONS.md §12 rule 3).
-- ═══════════════════════════════════════════════════════════════════════════════════
