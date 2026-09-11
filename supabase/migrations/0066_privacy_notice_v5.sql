-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0065_privacy_notice_v5.sql
--
-- WHAT:      Records privacy notice version `v5` in `privacy_notice_versions`, with the
--            sha256 of `docs/privacy/PRIVACY_NOTICE.md` as it now reads.
--
-- WHY:       QA 2026-09-11 (UX-01). v1–v4 told applicants their Regional Representative saw
--            only name / member ID / region / status. That has been false since 2026-09-06
--            (ADR 0011): `list_region_member_contacts()` shows an RR their own region's
--            members' email, phone, Facebook link and university. v5 corrects "Who can see
--            it", and adds the current address (0058) and the optional Instagram / GitHub /
--            LinkedIn links (0055) to "What we collect". Under RA 10173 consent is given to
--            a specific disclosure, so a corrected notice is a new version, and consent
--            captured since intake reopened rests on the version in force at the time.
--
-- WHY A NEW VERSION AND NOT AN EDIT: `privacy_notice_versions` has no UPDATE and no DELETE
--            policy (0035). "Which text did this applicant agree to" must stay answerable,
--            so an amendment is an append, never an in-place change. `PRIVACY_NOTICE_VERSION`
--            in `lib/privacy/notice-version.ts` is bumped to 'v5' in this same commit, and
--            the CI "privacy-notice digest" step compares the file's sha256 against the
--            newest seeding migration (this one).
--
-- CITATION:  ADR 0011 (RR contact access). RA 10173 (consent at collection).
--
-- ROLLBACK:  Forward-only. A published version is immutable by design.
-- ═══════════════════════════════════════════════════════════════════════════════════

insert into public.privacy_notice_versions (version, effective_at, body_sha256, url)
values (
  'v5',
  now(),
  'f6e5a2373d3e2dfbd7efb4268b6bf1544360281ed2661bab4922e30324af5c74',
  '/privacy'
)
on conflict (version) do nothing;
