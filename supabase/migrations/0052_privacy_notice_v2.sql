-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0052_privacy_notice_v2.sql
--
-- WHAT:      A second row in public.privacy_notice_versions — 'v2', the plain-language
--            rewrite of docs/privacy/PRIVACY_NOTICE.md (no version line, no lawyer note,
--            no parentheses; written for a college reader). From the moment this row's
--            effective_at passes, enforce_consent_server_values() (0035) stamps 'v2' on
--            every new application and renewal.
--
-- WHY:       Ethan, 2026-09-08, brand restyle: "remove the version, remove the lawyer
--            note, no jargon, make sure a college student can understand the whole thing."
--            0035's register is IMMUTABLE by design — the applicants who consented to v1
--            consented to *those bytes* — so a rewritten notice is a NEW row, never an
--            edit. lib/privacy/notice-version.ts moves to 'v2' in the same commit, and the
--            CI digest guard now reads the hash from the newest of these migrations.
--
-- CBL/PRD:   PRD §3 v1.0 item 5; PRD US-B1 (consent at collection); PRD OQ-2 (DPO/NPC —
--            still open); CBL Art. VIII §6 (RA 10173 as a constitutional obligation).
--
-- ROLLBACK:  Forward-only (CONVENTIONS.md §3.4). The v1 row stays; applications that
--            consented to v1 keep saying so. Reverting the wording means a v3 row.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- `body_sha256` is the digest of docs/privacy/PRIVACY_NOTICE.md's exact bytes at this
-- commit:  shasum -a 256 docs/privacy/PRIVACY_NOTICE.md
-- ⚠ EDITING THAT FILE INVALIDATES THIS HASH — the next change is a v3 row in a new
--   migration with PRIVACY_NOTICE_VERSION bumped alongside it, exactly as here.
--
-- `on conflict do nothing` so the migration is idempotent (0016 / 0035 discipline).
insert into public.privacy_notice_versions (version, effective_at, body_sha256, url)
values (
  'v2',
  now(),
  '3818ed79cff8e66d5b933336a1778bb66c571f9d6cd03965ee5f3ce084651c5e',
  '/privacy'
)
on conflict (version) do nothing;
