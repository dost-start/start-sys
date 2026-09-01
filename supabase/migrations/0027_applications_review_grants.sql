-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0027_applications_review_grants.sql
--
-- WHAT:      The COLUMN boundary on public.applications:
--              · revoke all on applications from `authenticated`
--              · grant select on FIFTEEN renderable columns
--              · grant update on THREE editable columns
--            plus a migration-time assertion that the anonymous intake path survived.
--
-- WHY:       **RLS IS ROW-LEVEL AND CANNOT PROTECT A COLUMN.** applications_read (0008)
--            admits exec_admin, crrd_admin and moderator to every ROW, and today they hold
--            table-level SELECT on all 21 columns — including `payload`, the densest PII
--            object in the schema, and `proof_web_view_link`, a provider URL that PRD US-J2
--            forbids reaching a browser. A hand-written `select * from applications` from a
--            reviewer session returns all of it. This file is the second mechanism, the same
--            pair 0015 applies to `people`: a narrow GRANT, with the audited RPC (0026) as
--            the only door to what is withheld.
--
--            PRD US-J1 ("restriction is enforced at the data layer, NOT by omitting a column
--            from a page"), PRD US-J2, ARCHITECTURE.md §5 "Column protection — a second,
--            separate mechanism", CBL Art. VIII §6.
--
-- ROLLBACK:  Forward-only. ⚠ **NEVER WIDEN THIS GRANT TO MAKE A SCREEN WORK.** CLAUDE.md
--            bans it by name; the correct move is to call get_application_detail(), which
--            audits the read. A change here needs a pgTAP assertion in the same PR
--            (046_applications_review_rls.sql asserts the exact granted set, so widening it
--            turns CI red rather than turning a page green).
--
-- CITATION:  BUILD_PLAN S4-T4; ARCHITECTURE.md §5; DATA_MODEL.md §6/0015, §8.1;
--            PRD §3 v1.0 items 8, 10; PRD US-C1, US-D2, US-J1, US-J2; PRD §4 (Non-Goals,
--            applicant self-service); CONVENTIONS.md §0 rules 1-4.
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0 — INSPECTION TRAIL: what 0008 actually shipped, verified before anything is changed
-- ═══════════════════════════════════════════════════════════════════════════════════
-- BUILD_PLAN S4-T4 requires this file to READ the existing policies first, because
-- **PERMISSIVE POLICIES OR TOGETHER: a broader SELECT policy cannot be narrowed by adding
-- one.** If 0008 had named `officer`, `regional_rep` or `member`, the fix would be
-- `drop policy` + recreate here, not a second policy. Run before writing:
--
--     select policyname, cmd, roles, qual, with_check
--       from pg_policies where schemaname = 'public' and tablename = 'applications';
--
-- WHAT IS THERE (0008 §5), and it is correct:
--
--   applications_insert_anon  INSERT  {anon}           window EXISTS + term pin + status
--                                                      pin + the NULL block
--   applications_read         SELECT  {authenticated}  auth_role() in
--                                                      (exec_admin, crrd_admin, moderator)
--   applications_update       UPDATE  {authenticated}  same three, USING and WITH CHECK
--
-- No policy names officer, regional_rep, member or tech_admin. No DELETE policy — none
-- exists anywhere in the schema and none may be added (CLAUDE.md, PRD Reliability NFR).
-- **THEREFORE NO POLICY IS DROPPED OR RECREATED IN THIS FILE.** The row boundary was right;
-- only the column boundary is missing. 046 asserts both halves so this stays true.
--
-- PRIVILEGES as 0008 §6 left them:
--   authenticated   SELECT on all 21 columns (Supabase default); INSERT, UPDATE and DELETE
--                   revoked. So applications_update is a policy with no privilege behind it
--                   and grants nothing — 0008's own footer says so and hands the re-grant
--                   here.
--   anon            INSERT and SELECT retained (default); UPDATE and DELETE revoked.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — SELECT: fifteen renderable columns, and six withheld
-- ═══════════════════════════════════════════════════════════════════════════════════
-- `revoke all from authenticated` first, so the grant below is a whitelist and not a patch
-- over whatever the default happened to be. A column added to this table in 2029 is then
-- UNREADABLE until someone deliberately grants it — the correct failure direction, and the
-- reason 046's exact-set assertion is written against a literal list.
--
-- ⚠ `anon` IS NOT TOUCHED BY THIS REVOKE, and that is load-bearing in two directions:
--   INSERT  the public form writes as the `anon` database role (the Server Action holds no
--           session). Revoking it would break /apply with an error that reads like a form
--           bug. §3 asserts it at migration time so this can never be discovered in the field.
--   SELECT  kept so an anonymous `select … from applications` returns ZERO ROWS rather than
--           raising 42501 — the missing POLICY is the anti-enumeration mechanism, and a
--           privilege error would be a different (and noisier) answer for a table with rows
--           than for one without (0008 §6).
revoke all on public.applications from authenticated;

-- THE FIFTEEN. Everything a list row, a status badge or a decision banner needs, and nothing
-- that is a person's data or a document handle.
grant select (
  id,                       -- row identity; also the proxy route's path parameter
  term_id,                  -- term filter and the historical-retrieval selector
  status,                   -- the queue filter (PRD US-C1)
  applicant_given_name,     -- a name is on the officer directory too; not withheld anywhere
  applicant_family_name,
  proof_drive_file_id,      -- see the note below — granted on purpose, rendered never
  proof_mime_type,          -- decides PDF iframe vs <img> vs the HEIC notice (S4-T20)
  proof_size_bytes,         -- reviewer-facing sanity check on a truncated upload
  proof_verified_at,        -- whether the server re-verified provider metadata
  person_id,                -- links an approved application to the member it produced
  reviewed_by,              -- PRD US-C2: the audit entry names the deciding officer, and
  reviewed_at,              --   the screen must be able to show it too
  review_note,              -- the recorded ground for a rejection (PRD US-C2)
  submitted_at,             -- default sort: submission time (PRD US-C1)
  created_at
) on public.applications to authenticated;

-- ── THE SIX WITHHELD, each for its own reason ──────────────────────────────────────
--
--   applicant_email          RA 10173 sensitive (0008 §7). Reachable only through
--   payload                  get_application_detail() (0026), which audits the read.
--                            PRD US-C1's "every submitted field" is served by that RPC, not
--                            by widening this list.
--
--   proof_web_view_link      PRD US-J2. **A provider URL must never reach a browser.** It is
--                            one forwarded link from a Certificate of Registration on the
--                            public internet and it would bypass the audited proxy entirely.
--                            0026 strips it from the RPC's output as well.
--
--   submit_token_hash        A live authorization secret (finalize_application(), 0019), not
--   submit_token_expires_at  a record field. Nothing outside that definer needs either.
--
--   redacted_at              **THE DELIBERATE SIXTEENTH, AND IT IS WITHHELD.** BUILD_PLAN
--                            S4-T4 offers it as an optional extra column and it is declined,
--                            for two reasons. (a) Nothing in v1.0 renders it: the list shows
--                            status and the detail page reads the full row through 0026,
--                            which returns redacted_at like any other field — so the screen
--                            that could want it already has it. (b) Keeping the count at
--                            fifteen keeps this file, BUILD_PLAN S4-T4, 042's forward note
--                            and 046's exact-set assertion all saying the same number, and a
--                            column granted "in case" is a column nobody can later argue
--                            should be removed. If a redaction badge is ever wanted on the
--                            LIST, it is one line here plus one line in 046.
--
-- ⚠ WHY proof_drive_file_id IS GRANTED THOUGH IT IS REGISTERED SENSITIVE. The registry
-- (0008 §7) drives TWO mechanisms — audit masking and the purges — and neither is a GRANT.
-- The proxy route authorizes a document view by doing an ordinary RLS-checked SELECT for
-- this pointer with the CALLER'S OWN JWT (ARCHITECTURE.md §4.1 step 7): row returned means
-- authorized, null means 404. That is the whole design, and it needs this column readable by
-- the three reviewer roles. It is a provider-opaque reference, not a URL; it is useless
-- without service-account credentials; and it is stripped from get_application_detail()'s
-- output so it never reaches a rendered page (0026). Withholding it would force the route to
-- use the service-role client, which is strictly worse.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — UPDATE: three editable columns
-- ═══════════════════════════════════════════════════════════════════════════════════
-- PRD §4 (Non-Goals, "Applicant self-service edit after submission"): "v1 answer: applicant
-- contacts CRRD, CRRD edits the application." applications_update (0008) is the policy; this
-- is the privilege that makes it do anything, and it is deliberately three columns wide.
--
-- WHAT IS **NOT** HERE, AND WHY THE ABSENCES ARE THE POINT:
--
--   status                   The decision path is approve_application() and
--   person_id                reject_application() (0023, 0024) and nothing else. Granting
--   reviewed_by              status would let a reviewer approve an application with a
--   reviewed_at              hand-written UPDATE, skipping the member-ID mint, the
--                            membership insert and the person resolution — producing an
--                            "approved" row with no member behind it, which PRD US-C3
--                            forbids. approved_has_person and
--                            enforce_application_status_transition() would both refuse it,
--                            but relying on a CHECK to close an authorization hole is an
--                            accident waiting to be refactored. The privilege is the answer.
--
--   proof_*                  Written only by finalize_application() (0019) from a SERVER-SIDE
--                            re-fetch of the provider's own metadata, never from a claim. A
--                            reviewer who could edit proof_size_bytes could make a rejected
--                            oversize upload look compliant.
--
--   applicant_email          Withheld from SELECT, so it cannot be sensibly edited either —
--                            and it is the key of one_application_per_email_per_term and the
--                            input to approve_application()'s person resolution. Changing it
--                            silently re-points which human this application becomes. A
--                            genuine correction is a conversation with CRRD, not a text
--                            input; revisit only with an ADR.
--
--   payload                  **v1.1, deliberately.** A payload correction (a mistyped
--                            birthdate — the exact example PRD §4 gives) needs the reviewer
--                            to READ the payload first, and payload is withheld from SELECT.
--                            A blind whole-object overwrite is worse than no edit path: it
--                            would let one field's correction wipe ten others and the consent
--                            record with them. The right shape is a narrow
--                            update_application_payload(app_id, key, value) definer with the
--                            same two guards as 0026 and its own audit row, which is a
--                            designed feature and not a GRANT. Until then the answer is the
--                            one PRD §4 already gives: CRRD edits the name fields here, and
--                            anything deeper is re-submission.
--
-- All three ARE audited: trg_applications_audit (0008) fires on UPDATE and writes an
-- old/new diff. review_note is NOT in sensitive_column_registry, so a change of recorded
-- ground appears in the log in full — which is what makes "a change of decision is a new
-- audited action" (PRD US-C2) checkable after the fact. Editing review_note cannot erase a
-- rejection's ground: rejected_has_reason (0024) refuses NULL or a stub on a rejected row.
grant update (
  applicant_given_name,
  applicant_family_name,
  review_note
) on public.applications to authenticated;

-- NO INSERT GRANT for `authenticated`, matching the absent INSERT policy (0008 §5). An
-- application comes from an applicant through the public form; an admin entering one on
-- someone's behalf uses that form. NO DELETE, here or anywhere.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — migration-time assertion: the anonymous intake path survived
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A `revoke all … from authenticated` two lines above a table whose ONLY writer is `anon` is
-- exactly the shape of edit that gets widened to "revoke all from anon, authenticated" by a
-- future maintainer tidying up. If that happens, /apply breaks with an opaque error during
-- application week and nothing in the schema says why. Assert it here, where the failure is
-- a migration that refuses to apply rather than a form that refuses to submit.
--
-- 046 asserts the same two facts from the test suite. Both are cheap; the intake path is the
-- one surface a stranger uses and the one nobody is watching in July.
do $$
begin
  if not has_table_privilege('anon', 'public.applications', 'INSERT') then
    raise exception
      '0027 broke the anonymous intake path: anon no longer holds INSERT on '
      'public.applications. The public application form writes as the anon database role '
      '(PRD US-B1); applications_insert_anon is the control, not the privilege.';
  end if;

  if not has_table_privilege('anon', 'public.applications', 'SELECT') then
    raise exception
      '0027 broke the anti-enumeration shape: anon no longer holds SELECT on '
      'public.applications. anon must get ZERO ROWS from the missing read policy, not 42501 '
      'from a missing privilege (0008 §6).';
  end if;
end;
$$;

-- 0008's `comment on table public.applications` is deliberately left intact rather than
-- rewritten: replacing it here would silently drop its sentence about the sensitive-column
-- registrations. The column boundary this file adds is described on the columns instead, so
-- both facts survive and neither file overwrites the other.
comment on column public.applications.payload is
  'THE DENSEST PII OBJECT IN THE SCHEMA (birthdate, address, contact number, school ID). '
  'Withheld from every session role by the GRANT in 0027; readable only through the audited '
  'get_application_detail() (0026). Never widen the GRANT to reach it.';

comment on column public.applications.applicant_email is
  'RA 10173 sensitive and the key of one_application_per_email_per_term. Withheld from every '
  'session role by the GRANT in 0027; readable only through get_application_detail() (0026), '
  'which audits the read.';

comment on column public.applications.proof_drive_file_id is
  'Provider-opaque document reference. Granted for SELECT to the three reviewer roles for '
  'ONE caller — the proof proxy''s RLS-checked lookup (ARCHITECTURE.md §4.1 step 7) — and '
  'stripped from get_application_detail() so it never reaches a rendered page.';
