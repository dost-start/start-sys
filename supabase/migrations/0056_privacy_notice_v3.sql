-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0056_privacy_notice_v3.sql
--
-- WHAT:      A third row in public.privacy_notice_versions — 'v3', for the 2026-09-09
--            revision of docs/privacy/PRIVACY_NOTICE.md.
--
-- WHY:       Two changes to the applicant-facing text, and both had to be made:
--
--            1. WHERE THE DOCUMENTS ARE. The notice said the uploaded registration form
--               and Notice of Award live in START-DOST's Google Drive. They do not, and
--               never have on this deployment: `DOCUMENT_STORE=supabase_storage` while
--               PRD OQ-1 is unresolved, so they are in the same Singapore project as the
--               database. A privacy notice that misstates where personal data is held is
--               a defect in the notice — under RA 10173 it is the disclosure a data
--               subject relies on to exercise their rights.
--
--            2. THE DRAFT ON THE APPLICANT'S OWN DEVICE. PR D saves what has been typed
--               into `/apply` and `/renew` in the browser's localStorage so a reload does
--               not lose it. That is a birthdate, a home address and a contact number on
--               a device the org does not control and may be shared. The new "On your own
--               device" section says so plainly, says the uploaded files are NOT saved
--               that way, and points at the Clear button on the form.
--
--            Neither change alters what is collected, who may read it, or the retention
--            period. But `privacy_notice_versions` is APPEND-ONLY by design (0035): the
--            applicants who ticked the box under v2 consented to THOSE BYTES, so a
--            revision is a new row and never an edit. `PRIVACY_NOTICE_VERSION` moves to
--            'v3' in the same commit, and the CI digest guard reads the hash below.
--
-- CBL/PRD:   PRD §3 v1.0 item 5; PRD US-B1 (consent at collection); PRD OQ-1 (document
--            store), OQ-2 (DPO/NPC — still open); CBL Art. VIII §6.
--
-- ROLLBACK:  Forward-only. v1 and v2 stay; every application keeps saying which text it
--            agreed to. Reverting the wording would be a v4 row.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- The digest of docs/privacy/PRIVACY_NOTICE.md's exact bytes at this commit:
--   shasum -a 256 docs/privacy/PRIVACY_NOTICE.md
-- ⚠ EDITING THAT FILE INVALIDATES THIS HASH. The next change is a v4 row in a new
--   migration with PRIVACY_NOTICE_VERSION bumped alongside it, exactly as here.
insert into public.privacy_notice_versions (version, effective_at, body_sha256, url)
values (
  'v3',
  now(),
  '727192013e8bc57e3ed472b84433cd17527fc2eb4892b495971fec5f46a1ce53',
  '/privacy'
)
on conflict (version) do nothing;
