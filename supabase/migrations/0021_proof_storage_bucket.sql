-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0021_proof_storage_bucket.sql
--
-- WHAT:      The private `proof-of-enrollment` Supabase Storage bucket and its
--            `storage.objects` policies — the ADR 0005 fallback for proof-of-enrollment
--            documents when Google Drive is unavailable.
--
-- WHY IT SHIPS ON DAY 3 EVEN THOUGH DRIVE IS THE PRIMARY:
--            OQ-1 is unanswered. START-DOST may have no Google Workspace tenant that
--            supports Shared Drives — Workspace for Nonprofits' base tier does not include
--            them — and BUILD_PLAN S3 hard-timeboxes the Drive integration to 12:00 with a
--            pre-agreed fallback. That fallback is only cheap if it is an environment
--            variable and a redeploy. **A migration is not an environment variable.** So the
--            bucket ships today whether or not it is used: an empty private bucket costs
--            nothing and removes the last migration from the swap path.
--
-- WHAT THIS IS NOT: a general file store. PRD §4 excludes general file storage as a
--            non-goal; the only files this system handles are proof-of-enrollment
--            documents, one per application, and this bucket holds nothing else.
--
-- CITATION:  BUILD_PLAN S3-T11, S3-T12; ARCHITECTURE.md §4.1 ("Fallback (fully specified,
--            no TBD)"), §7; DATA_MODEL.md §6/0008 (`proof_drive_file_id` is
--            provider-opaque, which is why no table changes here); PRD §3 v1.0 item 6,
--            PRD US-B2, US-J2; CBL Art. VIII §6 (RA 10173 as a constitutional obligation).
--
-- ROLLBACK:  Forward-only. Dropping this bucket while the fallback is active would strand
--            every stored document, and there is no DELETE path anywhere in this schema by
--            design. If the org returns to Drive, run the one-time copy job FIRST and only
--            then tear the bucket down (ADR 0005, cost 5).
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- WHY THE WHOLE FILE IS GUARDED ON `storage.buckets` EXISTING
-- ═══════════════════════════════════════════════════════════════════════════════════
-- The `storage` schema is created by the Supabase platform, not by this repository's
-- migrations. It is present in every hosted project and in the standard local stack, but
-- it is NOT guaranteed in an arbitrary bare Postgres 17 — and this file must never be the
-- reason `supabase db reset` fails for a lane that has nothing to do with documents, or
-- the reason a restore drill (S7-T16) into a plain `postgres:17` container aborts.
--
-- So: if the storage schema is absent, this migration is a NOTICE and a no-op. That is the
-- correct failure direction — the fallback bucket is simply unavailable, which
-- `getDocumentStore()` will report loudly at first use, rather than the whole schema
-- failing to build.
-- ═══════════════════════════════════════════════════════════════════════════════════
do $$
begin

if to_regclass('storage.buckets') is null then
  raise notice '0021: storage schema not present; skipping the proof-of-enrollment bucket. This is expected in a bare Postgres (e.g. a restore drill) and NOT expected in a Supabase project.';
  return;
end if;

-- ─────────────────────────────────────────────────────────────────────────────────
-- 1 — the bucket
-- ─────────────────────────────────────────────────────────────────────────────────
-- public = false is the single most important column in this statement. A public bucket
-- puts a Certificate of Registration — which carries a student number, an address and a
-- signature — one guessable URL away from the open internet. That is the same failure as
-- "anyone with the link" sharing on Drive, which ARCHITECTURE.md §7 names as the single
-- most likely breach vector in this system (PRD US-J2). It is rejected here by the same
-- reasoning and a different mechanism.
--
-- file_size_limit and allowed_mime_types are the storage service's own enforcement, and
-- they are a THIRD copy of limits that also live in lib/documents/types.ts and in
-- finalize_application() (0019). Three copies is deliberate: each is the last gate on its
-- own side of a trust boundary, and the storage service is the only one of the three that
-- sees the bytes as they arrive.
--
-- image/heic is on the list because it is what an iPhone produces and a phone photo of a
-- Certificate of Registration is the majority submission (PRD Addendum). Omitting it would
-- reject the common case. Note that storage's own MIME check reads the request's declared
-- Content-Type — a claim — which is precisely why verifyUpload() re-fetches the provider's
-- metadata and sniffs magic bytes afterwards.
begin
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proof-of-enrollment',
  'proof-of-enrollment',
  false,
  10485760,   -- 10 MiB. Mirrors MAX_PROOF_BYTES and finalize_application()'s p_size check.
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic']
)
on conflict (id) do nothing;   -- idempotent: re-running a migration set must be a no-op
exception when insufficient_privilege then
  raise notice '0021: could not insert the proof-of-enrollment bucket (insufficient privilege). The Supabase Storage fallback is unavailable until this is created by hand; Drive is unaffected.';
end;

-- ─────────────────────────────────────────────────────────────────────────────────
-- 2 — policies on storage.objects
-- ─────────────────────────────────────────────────────────────────────────────────
-- storage.objects ships with RLS enabled by the Supabase platform, so these policies are
-- the whole of what is reachable. Note that `service_role` BYPASSES RLS entirely: the
-- document store's server-side operations (minting a signed upload URL, reading provider
-- metadata, deleting a rejected or expired object) run through lib/server/admin-client.ts
-- and are unaffected by every policy below. These policies govern the browser.
--
-- Created idempotently — `create policy` has no `if not exists` on PG17.
--
-- ⚠️ AND WRAPPED IN AN insufficient_privilege HANDLER, for one specific reason worth
-- stating: `storage.objects` is owned by `supabase_storage_admin`, not by the migration
-- role. That grant holds in a Supabase project, but if it ever does not, an unhandled
-- failure here would break `supabase db reset` for EVERY lane in the repository over a
-- fallback that is not even the active driver. Degrading to a NOTICE is safe in the
-- security sense and only in the security sense: a policy that fails to be created leaves
-- `storage.objects` denying by default, so the failure direction is MORE restrictive, not
-- less. The visible symptom would be signed uploads failing the moment the fallback is
-- exercised — loudly, and before any real document exists. This handler must never be
-- copied to a policy on a table in `public`, where absence is not the safe direction.

-- ── INSERT: anon + authenticated, into this bucket only ──────────────────────────
--
-- ⚠️ AN HONEST NOTE ON THE SURFACE THIS OPENS, flagged rather than quietly narrowed.
-- BUILD_PLAN S3-T11 specifies this policy on the basis that a signed upload still needs an
-- insert grant. It means any holder of the anon key — which is public by design; RLS is the
-- boundary — can write objects into this bucket. It is bounded four ways and none of them
-- is this policy: the bucket's own 10MB limit and MIME allowlist; the fact that nothing is
-- READABLE without a reviewer role (the SELECT policy below); the fact that an object with
-- no `applications` row pointing at it is invisible to the product; and the orphan
-- reconciliation in the abandoned-draft sweep (S3-T22), which deletes exactly those.
-- The residue is storage-quota abuse, not disclosure.
--
-- If signed uploads turn out not to require this grant — Supabase's storage service
-- validates the signed token itself — this policy can simply be dropped in a new
-- migration, which strictly narrows the surface. Raised for the S7 security review rather
-- than changed here on a guess.
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'proof_of_enrollment_insert'
  ) then
    create policy proof_of_enrollment_insert
      on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'proof-of-enrollment');
  end if;
exception when insufficient_privilege then
  raise notice '0021: could not create proof_of_enrollment_insert on storage.objects (insufficient privilege). Uploads via the Supabase Storage fallback will be refused until this is granted. Deny-by-default is intact.';
end;

-- ── SELECT: the three reviewer roles, and nobody else ────────────────────────────
--
-- The SAME three roles that `applications_read` names in 0008 — exec_admin, crrd_admin,
-- moderator — and for the same reason: an application is sensitive end to end, and
-- PRD OQ-5's default answer is that "configure the system and control access" is not "read
-- everyone's address", so tech_admin is excluded here exactly as it is there. officer,
-- regional_rep and member hold no read on an application and must hold none on its
-- document (PRD US-D2, US-J1).
--
-- ⚠️ THIS POLICY IS NOT THE PRODUCT'S READ PATH AND MUST NOT BECOME ONE. Documents are
-- read through `GET /api/applications/[id]/proof`, which authorizes by doing an ordinary
-- RLS-checked SELECT on the application row with the caller's own JWT and then writes an
-- audit row before a single byte moves (ARCHITECTURE.md §4.1 step 7; PRD US-C1, US-J2).
-- That proxy runs server-side through the admin client, so it does not depend on this
-- policy at all. This exists as defence in depth for the case where a reviewer session
-- reaches storage directly — it is a floor, not a door, and reading around the proxy would
-- produce an unaudited view, which under RA 10173 is the compliance failure itself.
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'proof_of_enrollment_select'
  ) then
    create policy proof_of_enrollment_select
      on storage.objects for select to authenticated
      using (
        bucket_id = 'proof-of-enrollment'
        and public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator')
      );
  end if;
exception when insufficient_privilege then
  raise notice '0021: could not create proof_of_enrollment_select on storage.objects (insufficient privilege). No role can read the bucket directly; the audited proof proxy is unaffected because it runs as the service role.';
end;

-- ── NO UPDATE POLICY, NO DELETE POLICY. DELIBERATELY. ────────────────────────────
--
-- CLAUDE.md, banned patterns: "Never hard-delete anything." CONVENTIONS.md §0 rule 4: no
-- DELETE policies anywhere. With RLS on and no matching policy, Postgres refuses the
-- statement — so no human role, through any session, can remove or overwrite a stored
-- proof-of-enrollment document. The two legitimate deletions both act as the SYSTEM and
-- both run through the service role, which bypasses RLS and therefore needs no policy:
--   · verifyUpload() deleting a file whose magic bytes contradict its declared type;
--   · the abandoned-draft sweep (0020, S3-T22) and the RA 10173 five-year purge, which
--     must destroy data on BOTH sides of the storage boundary — clearing the database and
--     leaving the documents behind forever is the most common way that requirement is
--     quietly failed (ARCHITECTURE.md §8).
-- Adding a DELETE policy here would fail the CI meta-test in 001_meta_force_rls.sql if
-- that test's scope ever widens past `public`, and it would be wrong regardless.

end $$;
