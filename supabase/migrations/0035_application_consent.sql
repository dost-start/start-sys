-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0035_application_consent.sql
--
-- WHAT:      The database-enforced half of RA 10173 consent.
--              public.privacy_notice_versions        an IMMUTABLE, append-only register of
--                                                    published notice versions, readable by
--                                                    anon, writable only by tech_admin
--              applications.consented_at             when the applicant consented
--              applications.privacy_notice_version   which published text they agreed to
--              constraint submitted_has_consent      no LIVE application without both
--              enforce_consent_server_values()       the server owns both VALUES
--
-- WHY:       BUILD_PLAN S7-T22. PRD US-B1 / ARCHITECTURE.md §4.1 step 2: "consent to the
--            privacy notice is captured here (RA 10173 requires consent at collection)."
--            Until now that was one zod `z.literal(true)` in lib/applications/schema.ts and
--            a pair of keys inside `payload` — a client-side affirmative act recorded in a
--            free-text blob. S3-T20 said so explicitly and named this migration as the
--            third mechanism. A checkbox a client could skip, and a version string a client
--            could choose, is not evidence of consent.
--
-- CBL/PRD:   PRD §3 v1.0 item 5; PRD US-B1; PRD OQ-2 (DPO/NPC registration — still open,
--            see the interim-contact note in docs/privacy/PRIVACY_NOTICE.md); PRD OQ-8
--            (the retention clock — the notice's retention sentence and
--            redact_expired_pii()'s selection predicate must change in ONE PR, never
--            separately). CBL Art. VIII §6 makes RA 10173 a CONSTITUTIONAL obligation of
--            the organization, not merely a statutory one, so this is org policy as well as
--            law.
--
-- ROLLBACK:  Forward-only (CONVENTIONS.md §3.4). ⚠ A revert is NOT a `drop column`: the
--            consent record is the compliance evidence for every application collected
--            after this migration applies, and it deliberately SURVIVES the five-year purge
--            (see §4). A genuine revert is a new migration that drops the CHECK and the
--            trigger and leaves the columns and the register in place.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ THIS MIGRATION BREAKS SIBLING TEST FIXTURES, AND THAT IS THE CORRECT BEHAVIOUR ⚠⚠
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- `submitted_has_consent` refuses any application row that is not `draft` and carries no
-- consent. Seven files seed or promote non-draft applications that predate this constraint
-- and therefore violate it. THEY MUST EACH ADD ONE VALUE — `consented_at` — to their
-- application INSERTs; the trigger fills `privacy_notice_version` in for them:
--
--   supabase/tests/helpers/review-fixtures.psql   6 non-draft rows (A1..A6)
--   supabase/tests/042_applications_read_rls.sql  the read-matrix rows
--   supabase/tests/045_purge_abandoned_drafts.sql the 31-day `pending` control row
--   supabase/tests/047_application_decision_authz.sql
--   supabase/tests/067_dashboard_performance.sql  the ~1,200-row volume seed
--   supabase/tests/041_applications_anon_insert_rls.sql   assertions 1, 13, 20-21: the two
--       DRAFTS that get promoted to `pending` must carry consent AT INSERT
--   supabase/tests/043_finalize_application_fn.sql        same — the draft the RPC flips
--   lib/applications/test-support.ts / e2e/fixtures/review-seed.ts, if either seeds a
--       non-draft row or flips one
--
-- The edit is mechanical: add `consented_at` to the column list and `now()` to the values.
-- The trigger overwrites the value with the server's own clock and stamps the current
-- version, so the literal passed does not matter — what matters is that the field is
-- PRESENT, which is what the design treats as the affirmative act (§3).
--
-- THE ALTERNATIVE WAS CONSIDERED AND REJECTED. The trigger could have auto-stamped consent
-- on any privileged INSERT, which would have left all seven files untouched. That writes
-- `consented_at = now()` for a person who never consented — a FABRICATED compliance record,
-- which is worse than a missing one and worse than a red test. RA 10173 evidence that the
-- system invented is not evidence. The constraint stays honest and the fixtures move.
--
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — public.privacy_notice_versions: the register, and why it is IMMUTABLE
-- ═══════════════════════════════════════════════════════════════════════════════════
-- A published version is a fact about the past. Amending the notice is a NEW ROW, never an
-- edit — which is precisely what makes "which text did this applicant agree to?" answerable
-- in 2031, after the notice has been rewritten twice. There is no UPDATE policy and no
-- DELETE policy on this table and none may be added; §2 additionally revokes both
-- privileges, so the absence is belt as well as braces.
--
-- `body_sha256` is the digest of docs/privacy/PRIVACY_NOTICE.md's exact bytes. It is the
-- link between the row and the text: app/(public)/privacy/page.tsx renders that same file
-- imported at build time, so one source of truth serves the page a scholar reads and the
-- hash recorded here, and the two cannot drift without the hash disagreeing.
create table public.privacy_notice_versions (
  -- The version string an application's `privacy_notice_version` references. Max 32 chars
  -- to match `consentShape` in lib/applications/schema.ts, which validates the copy the
  -- client sends (and which the trigger in §3 then overwrites anyway).
  version      text primary key
               constraint version_shape check (length(btrim(version)) between 1 and 32),

  -- When this text took effect. The trigger in §3 picks the row with the LATEST
  -- effective_at, so a notice can be published ahead of time and become current on its own.
  effective_at timestamptz not null,

  -- sha256 of docs/privacy/PRIVACY_NOTICE.md, lower-case hex. Format-checked so a truncated
  -- or upper-case paste fails at write time rather than at the next audit.
  body_sha256  text not null
               constraint body_sha256_is_hex check (body_sha256 ~ '^[0-9a-f]{64}$'),

  -- Where the published text lives for a reader. A path, not a full URL: the org's domain
  -- is unresolved (PRD OQ-10) and a hardcoded host would be wrong the day it lands.
  url          text not null,

  created_at   timestamptz not null default now()
);

comment on table public.privacy_notice_versions is
  'Append-only register of published privacy-notice versions (BUILD_PLAN S7-T22, PRD US-B1, '
  'CBL Art. VIII §6). NO UPDATE OR DELETE POLICY EXISTS AND NONE MAY BE ADDED: a published '
  'version is a fact about the past, and amending the notice is a new row. That immutability '
  'is what makes "which text did this applicant agree to" answerable years later.';

comment on column public.privacy_notice_versions.body_sha256 is
  'sha256 of docs/privacy/PRIVACY_NOTICE.md''s exact bytes. Recompute with: '
  'shasum -a 256 docs/privacy/PRIVACY_NOTICE.md';

alter table public.privacy_notice_versions enable  row level security;
alter table public.privacy_notice_versions force   row level security;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — privileges and policies
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Supabase's default privileges grant ALL on a new table in `public` to anon and
-- authenticated (0015 §0, 0018 §3). Revoke first, then hand back exactly two verbs — so the
-- UPDATE and DELETE this table must never accept are refused by a MISSING PRIVILEGE as well
-- as by a missing policy. 019_column_grants.sql assertion 16 asserts no ordinary table in
-- public grants DELETE to anon or authenticated; this revoke is what keeps that true.
revoke all on public.privacy_notice_versions from anon, authenticated;

-- SELECT to ANON is required, not a convenience: an anonymous applicant must be able to
-- READ the notice before they can meaningfully consent to it, and /privacy is one of the
-- three routes reachable without a session (0008, middleware matcher). This is the FIFTH
-- table on the anonymous read surface that 0015 §4 enumerates as four — the addition is
-- deliberate and is asserted in 093_application_consent_rls.sql, per that file's rule that
-- any widening needs a pgTAP assertion in the same PR.
grant select on public.privacy_notice_versions to anon, authenticated;

-- INSERT only. No UPDATE, no DELETE, ever.
grant insert on public.privacy_notice_versions to authenticated;

-- ── privacy_notice_versions_read ───────────────────────────────────────────────────
-- The published text and its version are public by definition. There is nothing here to
-- scope: a notice nobody may read is not a notice.
create policy privacy_notice_versions_read on public.privacy_notice_versions
  for select to anon, authenticated
  using (true);

-- ── privacy_notice_versions_insert ─────────────────────────────────────────────────
-- Publishing a notice version is system configuration, which is the Technical Admin's
-- (ARCHITECTURE.md §5: tech_admin writes terms, windows and roles). `has_aal2()` mirrors
-- terms_write (0014): a configuration write from a session that has not satisfied its
-- second factor is refused at the data layer even if the MFA middleware is bypassed
-- entirely (PRD US-A3).
--
-- Note what this deliberately does NOT allow: crrd_admin and exec_admin cannot publish a
-- notice version. The notice is the org's legal text, its hash is checked against a file in
-- the repo, and publishing one is a deploy-adjacent act — not a records edit.
create policy privacy_notice_versions_insert on public.privacy_notice_versions
  for insert to authenticated
  with check (public.auth_role() = 'tech_admin' and public.has_aal2());

-- ⚠ NO UPDATE POLICY AND NO DELETE POLICY. This is the enforcement, and §2's revoke is the
--   second layer. Do not add either — see the table comment.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — the seed: version v1
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The digest below was computed at authoring time from the exact bytes of the file:
--
--     shasum -a 256 docs/privacy/PRIVACY_NOTICE.md
--
-- ⚠ EDITING docs/privacy/PRIVACY_NOTICE.md INVALIDATES THIS HASH. That is the intended
--   coupling, not an inconvenience: a changed notice is a NEW VERSION (a new row in a new
--   migration, bumping PRIVACY_NOTICE_VERSION in lib/privacy/notice-version.ts in the same
--   commit), because applicants who consented to v1 consented to *these bytes*. Silently
--   editing the file under a stale hash is exactly the failure this register exists to make
--   impossible to hide.
--
-- `on conflict do nothing` so the migration is idempotent against a database that already
-- carries v1 — same discipline as 0016's seed blocks.
insert into public.privacy_notice_versions (version, effective_at, body_sha256, url)
values (
  'v1',
  now(),
  '23ac7ea81155d632c500f5f3e212f3753be8e413de689998ad04d9e25c6bf8ec',
  '/privacy'
)
on conflict (version) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4 — the two columns on public.applications
-- ═══════════════════════════════════════════════════════════════════════════════════
-- NEITHER COLUMN IS GRANTED TO `authenticated`, and that is deliberate. 0027 revoked all on
-- applications and granted back a fifteen-column SELECT list; `add column` grants nothing,
-- so both arrive withheld and 046_applications_review_rls.sql's exact-column-set assertion
-- still holds — "a column that nobody has classified defaults to failing rather than to
-- leaking". Reviewers see consent through get_application_detail() (0026), which returns
-- `to_jsonb(a)` minus the proof pointers and writes an audit row per read. That audited RPC
-- is the door; widening the GRANT is not.
--
-- NEITHER COLUMN IS REGISTERED IN sensitive_column_registry, also deliberate. A consent
-- timestamp and a version string are not personal data — they are the RECORD that personal
-- data was collected lawfully. Registering them would mask them out of every audit row
-- (0011's mask_sensitive) and NULL them at the five-year purge, destroying the evidence
-- that the collection was consented to while keeping the fact that it happened. The consent
-- record must OUTLIVE the data it authorised.
alter table public.applications
  add column consented_at           timestamptz,
  add column privacy_notice_version text
    references public.privacy_notice_versions(version);

comment on column public.applications.consented_at is
  'When the applicant consented to the privacy notice. ALWAYS the server''s clock — '
  'enforce_consent_server_values() overwrites whatever the client sent, so a backdated '
  'consent claim is unrepresentable (BUILD_PLAN S7-T22).';

comment on column public.applications.privacy_notice_version is
  'The published notice version the applicant agreed to. ALWAYS the server''s current '
  'version — a client cannot claim agreement to a superseded text.';

-- ── submitted_has_consent ──────────────────────────────────────────────────────────
-- A DRAFT may lack consent; anything past draft may not. Two reasons the line is drawn at
-- the draft boundary rather than at INSERT:
--
--   · a draft is a half-finished submission that the applicant has not made yet, and
--     purge_abandoned_drafts() (0020) redacts it after thirty days. Requiring consent on a
--     row nobody submitted would refuse the very first INSERT of the two-step upload flow.
--
--   · `pending` IS the submission (DATA_MODEL.md §3.2 — "submitted" is prose for the
--     draft -> pending flip). So this constraint says exactly: **no application is ever
--     submitted without a recorded consent against a published notice version.**
--
-- ⚠ THE CONSTRAINT IS LOAD-BEARING AT THE FLIP, NOT ONLY AT INSERT. finalize_application()
--   (0019) is SECURITY DEFINER and flips draft -> pending; the trigger below deliberately
--   does NOT stamp consent on UPDATE, so a draft inserted with no consent CANNOT be
--   finalized — it raises 23514 and stays a draft for the sweep. That is the whole point:
--   consent is captured AT COLLECTION or it is not captured at all.
alter table public.applications
  add constraint submitted_has_consent
    check (
      status = 'draft'
      or (consented_at is not null and privacy_notice_version is not null)
    );


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5 — enforce_consent_server_values(): the client's act, the server's values
-- ═══════════════════════════════════════════════════════════════════════════════════
-- THE DESIGN, IN ONE SENTENCE: the client's affirmative act is that it SENT the field at
-- all; the database owns both VALUES.
--
-- So on INSERT:
--   consented_at IS NOT NULL  ->  the applicant ticked the box. Overwrite consented_at with
--                                 now() and privacy_notice_version with the server's current
--                                 version. A client cannot backdate a consent and cannot
--                                 claim agreement to a superseded — or non-existent — text.
--                                 Because BEFORE triggers run before constraints are
--                                 checked, a client sending version 'v0' does not trip the
--                                 foreign key: the value is replaced with 'v1' first.
--   consented_at IS NULL      ->  no consent was offered. Clear privacy_notice_version too,
--                                 so a client cannot stash a version string without one.
--                                 The row may live as a draft and can never be finalized.
--
-- And on UPDATE: consent is IMMUTABLE, in both directions.
--   · changing an existing consent is refused — the record is evidence, not a field
--   · RECORDING consent for the first time on an UPDATE is also refused, which is the
--     less obvious half and the more important one. Without it, finalize_application() —
--     or any later back-office edit — could supply the consent the applicant never gave,
--     at the moment of submission, and satisfy §4's CHECK. "Consent at collection" would
--     become "consent at convenience". RA 10173 does not permit that and neither does this
--     trigger.
--
-- SECURITY DEFINER because it reads public.privacy_notice_versions from inside a trigger
-- fired by anon, by authenticated and by the migration owner alike, and the answer must not
-- depend on which of them is asking. `set search_path = ''` per CONVENTIONS.md §3.4 —
-- 099_security_invariants.sql asserts that for every definer function in public.
create or replace function public.enforce_consent_server_values() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text;
begin
  if tg_op = 'INSERT' then
    if new.consented_at is null then
      -- No affirmative act. Refuse to carry a version the applicant did not agree to.
      new.privacy_notice_version := null;
      return new;
    end if;

    -- The current published version: latest effective_at, version as a stable tiebreak so
    -- two rows published in the same transaction resolve deterministically.
    select p.version
      into v_version
      from public.privacy_notice_versions p
     order by p.effective_at desc, p.version desc
     limit 1;

    if v_version is null then
      -- No notice has been published, so there is nothing to consent to. Refusing here is
      -- the correct direction: collecting an application against an unpublished notice is
      -- the failure, not the refusal. 23514 so it surfaces the same way as the CHECK.
      raise exception
        'no published privacy notice version exists; consent cannot be recorded'
        using errcode = '23514';
    end if;

    new.consented_at           := now();
    new.privacy_notice_version := v_version;
    return new;
  end if;

  -- ── UPDATE ──────────────────────────────────────────────────────────────────────
  if new.consented_at           is distinct from old.consented_at
     or new.privacy_notice_version is distinct from old.privacy_notice_version then
    raise exception
      'consent is captured at collection and is immutable thereafter (RA 10173; '
      'BUILD_PLAN S7-T22)'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_consent_server_values() is
  'BEFORE INSERT OR UPDATE on applications. On INSERT, if the client sent consented_at at '
  'all (the affirmative act) the SERVER''s clock and current notice version are stamped in '
  'its place, so a backdated consent or a claim against a superseded notice is '
  'unrepresentable; if it did not, the version is cleared and the row can never be '
  'finalized. On UPDATE consent is immutable in BOTH directions — recording it late is '
  'refused too, because "consent at collection" is the requirement (BUILD_PLAN S7-T22).';

-- BEFORE INSERT OR UPDATE, one trigger, both arms. Trigger names on this table fire in
-- alphabetical order; `trg_applications_consent_server_values` sorts before
-- `trg_applications_freeze_archived` (0008) and before the status-transition guard (0024),
-- and the ordering is immaterial — this trigger raises or rewrites NEW, and the others
-- raise on state neither of them changes.
create trigger trg_applications_consent_server_values
  before insert or update on public.applications
  for each row execute function public.enforce_consent_server_values();
