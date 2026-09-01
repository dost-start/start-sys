-- ═══════════════════════════════════════════════════════════════════════════════════
-- 093_application_consent_rls.sql  —  RA 10173 consent, as a database fact
--
-- WHAT:
--    1-5   the register is IMMUTABLE: ENABLE+FORCE, zero UPDATE policies, zero DELETE
--          policies, and neither privilege granted to `authenticated` either
--    6-7   anon can READ the notice — and the seeded digest matches the published file
--    8-11  only tech_admin may PUBLISH a version; anon and exec_admin are refused; the
--          register cannot be UPDATEd by anyone
--   12-14  the CHECK: a draft may lack consent, a submission may not — including at the
--          draft -> pending FLIP, which is the case finalize_application() runs
--   15-18  the SERVER owns the values: a backdated timestamp and a bogus version are both
--          overwritten, and a version sent without consent is discarded
--   19-21  consent is IMMUTABLE on UPDATE **in both directions** — recording it late is
--          refused too
--   22-23  end to end through the real anonymous INSERT policy, and the row lands stamped
--   24-25  the two new columns are NOT readable by `authenticated`
--
-- WHY:  BUILD_PLAN S7-T22. PRD US-B1 / ARCHITECTURE.md §4.1 step 2 — "consent to the
--       privacy notice is captured here (RA 10173 requires consent at collection)". CBL
--       Art. VIII §6 makes RA 10173 a constitutional obligation of the organization, so
--       this is org policy as well as statute.
--
-- ⚠ THE THREE ASSERTIONS THAT CARRY THE DESIGN
--
--   14  A draft inserted WITHOUT consent cannot be finalized. The trigger deliberately does
--       not stamp consent on UPDATE, so `finalize_application()` — SECURITY DEFINER, and
--       therefore able to write anything — still cannot supply the consent the applicant
--       never gave. Delete this and "consent at collection" quietly becomes "consent at
--       submission", which is not consent.
--
--   16  A client sending version 'v0' does not trip the FOREIGN KEY. BEFORE triggers run
--       before constraints are checked, so the value is replaced with the server's current
--       version first. This is why a client cannot claim agreement to a superseded — or
--       invented — text, and why the failure mode is a correct row rather than an error the
--       applicant sees.
--
--   21  Recording consent for the first time on an UPDATE is REFUSED. The less obvious half
--       and the more important one: without it, any later back-office edit could satisfy
--       assertion 13's CHECK after the fact.
--
-- ⚠ ASSERTIONS 12-21 RUN AS THE SESSION ROLE ON PURPOSE. postgres carries BYPASSRLS, so
--   what is being measured there is the CHECK CONSTRAINT and the TRIGGER — the layer that
--   holds even for a definer function and even for a panicked psql session. The RLS half is
--   asserted separately at 8-11 and 22-23.
--
-- CITATION: BUILD_PLAN S7-T22, S7-T21, S7-T23; PRD §3 v1.0 item 5; PRD US-B1; PRD OQ-2
--           (DPO/NPC — still open); PRD OQ-8 (the retention clock); CBL Art. VIII §6;
--           DATA_MODEL.md §3.2, §8.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

\ir helpers/auth.psql
\ir helpers/fixtures.psql

select plan(25);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- fixture: an OPEN membership_application window, for assertion 22 only
-- ═══════════════════════════════════════════════════════════════════════════════════
-- `unique (term_id, form_kind)` means one row per kind per term; the fixtures file seeds no
-- window, so this file owns its own.
insert into public.application_windows (id, term_id, form_kind, opens_at, closes_at)
values ('00000000-0000-4000-9000-000000000093',
        pg_temp.fx_active_term(),
        'membership_application',
        now() - interval '1 day',
        now() + interval '7 days');


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1-5 — the register is append-only, at both layers
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 1 — 001_meta_force_rls.sql enumerates pg_class and would catch this anyway; asserted
-- here as well so a failure in THIS slice names the table that caused it.
select ok(
  (select c.relrowsecurity and c.relforcerowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'privacy_notice_versions'),
  'privacy_notice_versions has ENABLE and FORCE ROW LEVEL SECURITY — the meta-test still '
  'passes with the new table present'
);

-- 2-3 — the immutability, as an ABSENCE. A published version is a fact about the past:
-- amending the notice is a NEW ROW, and that is what makes "which text did this applicant
-- agree to" answerable in 2031 after the notice has been rewritten twice.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'privacy_notice_versions' and cmd = 'UPDATE'),
  0,
  'ZERO UPDATE policies on privacy_notice_versions — a published version cannot be edited, '
  'only superseded by a new row'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'privacy_notice_versions' and cmd = 'DELETE'),
  0,
  'ZERO DELETE policies on privacy_notice_versions — no DELETE policy exists anywhere in '
  'this schema and none may be added (CLAUDE.md banned patterns)'
);

-- 4-5 — and the privileges are revoked as well, so the absence above is belt AND braces.
-- 5 in particular is what keeps 019_column_grants.sql assertion 16 true with a new table in
-- the schema: Supabase's default privileges grant ALL on a new public table.
select ok(
  not has_table_privilege('authenticated', 'public.privacy_notice_versions', 'UPDATE'),
  'authenticated holds NO UPDATE privilege on privacy_notice_versions — 0035 §2 revokes the '
  'Supabase default, so the missing policy is not the only thing standing there'
);

select ok(
  not has_table_privilege('authenticated', 'public.privacy_notice_versions', 'DELETE'),
  'authenticated holds NO DELETE privilege on privacy_notice_versions — which is also what '
  'keeps 019''s "no ordinary table grants DELETE" assertion true'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 6-7 — anon can read the notice, and the seed matches the published file
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 6 — SELECT to anon is a REQUIREMENT, not a convenience: an anonymous applicant must be
-- able to read the notice before they can meaningfully consent to it. This is the fifth
-- table on the anonymous read surface that 0015 §4 enumerates as four, and it is asserted
-- here per that file's own rule that any widening needs a pgTAP assertion in the same PR.
select pg_temp.login_anon();

select is(
  (select count(*)::int from public.privacy_notice_versions),
  1,
  'anon reads EXACTLY 1 privacy notice version — the published text must be readable '
  'without an account or consent to it is not informed'
);

select pg_temp.logout();

-- 7 — the digest is the link between the row and the bytes. app/(public)/privacy/page.tsx
-- renders docs/privacy/PRIVACY_NOTICE.md imported at build time, so one source of truth
-- serves the page a scholar reads and the hash recorded here.
--     shasum -a 256 docs/privacy/PRIVACY_NOTICE.md
-- ⚠ EDITING THAT FILE IS SUPPOSED TO BREAK THIS. A changed notice is a new version, in a
--   new migration, with PRIVACY_NOTICE_VERSION bumped in the same commit — because the
--   applicants who consented to v1 consented to *these bytes*.
select is(
  (select body_sha256 from public.privacy_notice_versions where version = 'v1'),
  '4a3bf0841945f4acc0fed1285ca448aa83432ed27dc94047acb181fa9c0d4beb',
  'the seeded v1 digest is the sha256 of docs/privacy/PRIVACY_NOTICE.md — editing the notice '
  'under a stale hash is meant to fail here rather than pass silently'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 8-11 — publishing a version is tech_admin's, and nobody may edit one
-- ═══════════════════════════════════════════════════════════════════════════════════

-- 8 — anon holds no INSERT privilege at all, so this is refused before any policy runs.
select pg_temp.login_anon();
select throws_ok(
  $$ insert into public.privacy_notice_versions (version, effective_at, body_sha256, url)
     values ('anon-forged', now(),
             '0000000000000000000000000000000000000000000000000000000000000000', '/x') $$,
  '42501'::char(5), null::text,
  'anon cannot publish a privacy notice version — the anonymous surface is READ only, and '
  'a forged notice version is a forged consent record for every application that cites it'
);
select pg_temp.logout();

-- 9 — exec_admin is the widest tier in the system and is refused here too. The notice is
-- the org's legal text, its hash is checked against a file in the repo, and publishing one
-- is a deploy-adjacent act — not a records edit (ARCHITECTURE.md §5: tech_admin owns
-- system configuration).
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok(
  $$ insert into public.privacy_notice_versions (version, effective_at, body_sha256, url)
     values ('exec-forged', now(),
             '1111111111111111111111111111111111111111111111111111111111111111', '/x') $$,
  '42501'::char(5), null::text,
  'exec_admin cannot publish a privacy notice version — the widest tier is not wider here, '
  'because this is system configuration and not a records edit'
);
select pg_temp.logout();

-- 10 — ANTI-VACUITY CONTROL for 8 and 9. Without this, both refusals above would pass just
-- as happily against a table nobody can write to at all, which is a different bug.
select pg_temp.login_as('00000000-0000-4000-a000-000000000002');   -- tech_admin, aal2
select lives_ok(
  $$ insert into public.privacy_notice_versions (version, effective_at, body_sha256, url)
     values ('v2-draft', now() - interval '10 years',
             '2222222222222222222222222222222222222222222222222222222222222222',
             '/privacy') $$,
  'ANTI-VACUITY CONTROL: tech_admin CAN publish a version — so 8 and 9 are measuring the '
  'policy and not a table nobody can write to'
);
select pg_temp.logout();

-- 11 — and nobody may edit one. The privilege is missing (0035 §2) as well as the policy,
-- so this RAISES rather than affecting zero rows — a strictly stronger outcome than the
-- silent no-op an UPDATE normally produces under RLS.
select pg_temp.login_as('00000000-0000-4000-a000-000000000001');   -- exec_admin
select throws_ok(
  $$ update public.privacy_notice_versions set url = '/rewritten' where version = 'v1' $$,
  '42501'::char(5), null::text,
  'exec_admin cannot UPDATE a published version — refused by a MISSING PRIVILEGE, which is '
  'stronger than the zero-rows-affected an absent policy alone would give'
);
select pg_temp.logout();

-- ⚠ THE 'v2-draft' ROW FROM ASSERTION 10 IS LEFT IN PLACE ON PURPOSE. It carries an
--   effective_at of ten years ago, so from here on the register holds TWO versions and the
--   trigger's `order by effective_at desc` has something real to choose between. Every
--   "the server stamps v1" assertion below (16, 22) is therefore also a control on that
--   ordering: if the trigger picked the newest ROW rather than the newest EFFECTIVE text,
--   it would stamp 'v2-draft' and those assertions would fail. Assertion 20 additionally
--   uses it as a version that genuinely EXISTS, so the immutability refusal there is the
--   trigger's and not the foreign key's.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 12-14 — submitted_has_consent: the draft boundary IS the submission boundary
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Session role from here to 21: BYPASSRLS, so what is measured is the CHECK and the TRIGGER
-- — the layer that holds for a SECURITY DEFINER function and for a psql session at 2am.

-- 12 — a DRAFT may lack consent. Requiring it at INSERT would refuse the very first step of
-- the two-step upload flow, and purge_abandoned_drafts() (0020) redacts an unsubmitted
-- draft after thirty days regardless.
select lives_ok(
  $$ insert into public.applications
       (id, term_id, applicant_email, applicant_given_name, applicant_family_name)
     values ('00000000-0000-4000-8000-000000000931',
             public.current_term_id(),
             'no.consent.draft@fixture.start-sys.test', 'NoConsent', 'Draft') $$,
  'a DRAFT may exist without consent — otherwise the first INSERT of the two-step upload '
  'flow is refused before the applicant has submitted anything'
);

-- 13 — but a SUBMISSION may not. proof_drive_file_id is supplied so that pending_has_proof
-- (0008) cannot be the constraint that fires: the only thing left to refuse this row is
-- submitted_has_consent.
select throws_ok(
  $$ insert into public.applications
       (term_id, status, applicant_email, applicant_given_name, applicant_family_name,
        proof_drive_file_id)
     values (public.current_term_id(), 'pending',
             'no.consent.pending@fixture.start-sys.test', 'NoConsent', 'Pending',
             'ref-093-nocons') $$,
  '23514'::char(5), null::text,
  'a non-draft application with NULL consent raises 23514 — submitted_has_consent says, '
  'exactly, that no application is ever submitted without a recorded consent against a '
  'published notice version'
);

-- 14 — ⚠ THE ONE THAT CARRIES THE DESIGN. See the header. The consentless draft from 12 is
-- flipped exactly the way finalize_application() flips one, and it is refused.
select throws_ok(
  $$ update public.applications
        set status = 'pending',
            proof_drive_file_id = 'ref-093-flip',
            submitted_at = now()
      where id = '00000000-0000-4000-8000-000000000931' $$,
  '23514'::char(5), null::text,
  'a consentless DRAFT cannot be flipped to pending — the trigger does not stamp consent on '
  'UPDATE, so even finalize_application() (SECURITY DEFINER) cannot supply the consent the '
  'applicant never gave. "Consent at collection" or not at all'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 15-18 — the client's act, the SERVER's values
-- ═══════════════════════════════════════════════════════════════════════════════════
-- One row, inserted with a consent timestamp backdated six years and a version string that
-- does not exist in the register.

insert into public.applications
  (id, term_id, applicant_email, applicant_given_name, applicant_family_name,
   consented_at, privacy_notice_version)
values ('00000000-0000-4000-8000-000000000932',
        public.current_term_id(),
        'backdated@fixture.start-sys.test', 'Back', 'Dated',
        timestamptz '2020-01-01 00:00:00+08', 'v0');

-- 15 — now(), not 2020. A backdated consent claim is unrepresentable.
select is(
  (select consented_at from public.applications
    where id = '00000000-0000-4000-8000-000000000932'),
  now(),
  'a client-supplied consented_at of 2020-01-01 is OVERWRITTEN with the server''s clock — '
  'the client''s affirmative act is that it sent the field at all; the value is the '
  'database''s'
);

-- 16 — ⚠ and 'v0' becomes 'v1' WITHOUT tripping the foreign key, because BEFORE triggers
-- run before constraints are checked. See the header: this is what makes a claim of
-- agreement to a superseded or invented text impossible rather than merely erroneous.
select is(
  (select privacy_notice_version from public.applications
    where id = '00000000-0000-4000-8000-000000000932'),
  'v1',
  'a client-supplied version of ''v0'' is OVERWRITTEN with the server''s current version — '
  'and the bogus value never reaches the foreign key, because BEFORE triggers run first'
);

-- 17 — ANTI-VACUITY CONTROL for 14. Consent stamped AT INSERT is exactly what lets the same
-- flip succeed, so 14 is measuring the missing consent and not a broken flip.
select lives_ok(
  $$ update public.applications
        set status = 'pending',
            proof_drive_file_id = 'ref-093-ok',
            submitted_at = now()
      where id = '00000000-0000-4000-8000-000000000932' $$,
  'ANTI-VACUITY CONTROL: a draft that DID carry consent at insert flips to pending cleanly '
  '— so 14 fails for the reason it claims'
);

-- 18 — a version sent WITHOUT a consent timestamp is discarded rather than kept. Otherwise
-- a row could carry a notice version nobody agreed to, which reads in every report as a
-- consent that never happened.
insert into public.applications
  (id, term_id, applicant_email, applicant_given_name, applicant_family_name,
   privacy_notice_version)
values ('00000000-0000-4000-8000-000000000933',
        public.current_term_id(),
        'version.no.consent@fixture.start-sys.test', 'Version', 'NoConsent',
        'v1');

select is(
  (select privacy_notice_version from public.applications
    where id = '00000000-0000-4000-8000-000000000933'),
  null::text,
  'a version sent WITHOUT consented_at is cleared — a row must never carry a notice version '
  'that nobody agreed to'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 19-21 — consent is immutable, in BOTH directions
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The consent record is evidence, not a field. 19 and 20 are the obvious half; 21 is the
-- half that keeps "at collection" meaningful.

select throws_ok(
  $$ update public.applications set consented_at = now() - interval '1 year'
      where id = '00000000-0000-4000-8000-000000000932' $$,
  '23514'::char(5), null::text,
  'consented_at cannot be changed once recorded — the consent record is evidence, and '
  'evidence that can be edited is not evidence'
);

select throws_ok(
  $$ update public.applications set privacy_notice_version = 'v2-draft'
      where id = '00000000-0000-4000-8000-000000000932' $$,
  '23514'::char(5), null::text,
  'privacy_notice_version cannot be changed once recorded — an application cannot be '
  'retroactively re-pointed at a different published text'
);

-- 21 — ⚠ see the header. Without this, any later back-office edit satisfies 13's CHECK
-- after the fact and "consent at collection" becomes "consent at convenience".
select throws_ok(
  $$ update public.applications set consented_at = now()
      where id = '00000000-0000-4000-8000-000000000933' $$,
  '23514'::char(5), null::text,
  'consent cannot be RECORDED for the first time on an UPDATE either — RA 10173 requires '
  'consent at collection, so a late stamp is refused rather than accepted'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 22-23 — end to end, through the real anonymous INSERT policy
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Everything from 12 ran as the session role, measuring the CHECK and the trigger. This one
-- runs the path an applicant actually takes: `applications_insert_anon` (0008) pins six
-- columns to NULL and does NOT pin consented_at, which is what lets startApplication send
-- it — and the trigger is what makes sending it harmless.

select pg_temp.login_anon();
select lives_ok(
  $$ insert into public.applications
       (id, term_id, applicant_email, applicant_given_name, applicant_family_name,
        payload, consented_at, privacy_notice_version,
        submit_token_hash, submit_token_expires_at)
     values ('00000000-0000-4000-8000-000000000934',
             public.current_term_id(),
             'anon.consent@fixture.start-sys.test', 'Anon', 'Consent',
             '{"region_code":"NCR"}'::jsonb,
             timestamptz '1999-01-01 00:00:00+08', 'v0',
             'not-a-real-digest', now() + interval '1 hour') $$,
  'an ANONYMOUS applicant may send consent through applications_insert_anon — the policy '
  'pins six columns to NULL and deliberately does not pin this one'
);
select pg_temp.logout();

select is(
  (select consented_at::text || '|' || privacy_notice_version
     from public.applications where id = '00000000-0000-4000-8000-000000000934'),
  now()::text || '|v1',
  'and the anonymous row lands with the SERVER''s clock and the SERVER''s current version, '
  'not the 1999 timestamp and the invented ''v0'' the client sent'
);


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 24-25 — the new columns are NOT part of the reviewer read surface
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0027 revoked all on applications and granted back a fifteen-column SELECT list; `add
-- column` grants nothing, so both arrive withheld and 046's exact-column-set assertion
-- still holds. Reviewers see consent through get_application_detail() (0026), which returns
-- to_jsonb(a) minus the proof pointers and writes an audit row per read. THAT AUDITED RPC
-- IS THE DOOR — widening this GRANT to put consent on a screen is not.

select ok(
  not has_column_privilege('authenticated', 'public.applications', 'consented_at', 'SELECT'),
  'consented_at is NOT SELECT-granted to authenticated — the audited get_application_detail() '
  'RPC is the reviewer''s door to it, and 046''s exact-column-set assertion stays true'
);

select ok(
  not has_column_privilege('authenticated', 'public.applications', 'privacy_notice_version',
                           'SELECT'),
  'privacy_notice_version is NOT SELECT-granted to authenticated either — same door, same '
  'audit row'
);


select * from finish();

rollback;
