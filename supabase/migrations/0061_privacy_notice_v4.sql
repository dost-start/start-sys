-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0061_privacy_notice_v4.sql
-- WHAT:      Seeds privacy notice v4 — the version that names Google as a processor.
-- WHY:       The document store moved to Google Drive on 2026-09-10 (ADR 0018) and the
--            notice did not move with it. For several hours the applicant-facing page at
--            /privacy told people their two documents were stored in the Singapore
--            project, which had stopped being true the moment DOCUMENT_STORE changed.
--
--            Under RA 10173 consent is given AT COLLECTION and against a SPECIFIC
--            disclosure. A notice that misstates where personal data lives is worse than
--            no notice: it produces recorded consent to something that did not happen.
--            `app/(public)/privacy/page.tsx` already carried the rule — the paragraph, the
--            notice file and the register move in the SAME pull request as the variable —
--            and on the day it was not followed. This is that correction.
--
-- WHY A NEW VERSION AND NOT AN EDIT:
--            `privacy_notice_versions` has no UPDATE and no DELETE policy (0035). A row
--            records the exact text a given applicant agreed to, so "which wording did
--            this person consent to" stays answerable in 2031. Amending the notice is
--            always a new row; `applications.privacy_notice_version` then distinguishes
--            the v3 consents (documents in Singapore) from the v4 ones (documents in
--            Google Drive), which is precisely the distinction a regulator would ask about.
--
-- CITATION:  ADR 0018; CBL Art. VIII §6; PRD US-J1, US-J2; RA 10173 §12(a), §16.
-- ROLLBACK:  Forward-only. A published version is immutable by design.
-- ═══════════════════════════════════════════════════════════════════════════════════

insert into public.privacy_notice_versions (version, effective_at, body_sha256, url)
values (
  'v4',
  now(),
  'c78ac48ee4f11f23822c04cb3b328933f87cb749ddc9a8417375fc3c60ab4fac',
  '/privacy'
)
on conflict (version) do nothing;
