// ─────────────────────────────────────────────────────────────────────────────
// The published privacy notice's version string, as ONE constant the consent
// checkboxes on `/apply` and `/renew` send (BUILD_PLAN S3-T20, S7-T21).
//
// Since S7-T22 (migration 0035) the database owns the VALUE: `privacy_notice_versions`
// is an append-only register, and `enforce_consent_server_values()` overwrites
// whatever version a client sends with the register's current row — so a client can
// never backdate a consent or claim agreement to a superseded notice. This constant
// is therefore the client's copy of the current version (it lands in
// `applications.payload`, alongside the trigger-stamped column), and the SEED value
// for the register row that publishes the same text.
//
// Bumping it is a manual discipline with three parts, all in one commit: rewrite
// `docs/privacy/PRIVACY_NOTICE.md` (its applicant-facing half must match
// `app/(public)/privacy/page.tsx` word for word), bump this string and the date, and
// add a migration inserting the new `privacy_notice_versions` row with the file's
// sha256 (`shasum -a 256 docs/privacy/PRIVACY_NOTICE.md`). The CI digest guard fails
// until the third part lands.
// ─────────────────────────────────────────────────────────────────────────────

/** The version an applicant's consent checkbox currently agrees to. Max 32 chars — see `consentShape` in `lib/applications/schema.ts`. */
export const PRIVACY_NOTICE_VERSION = "v4";

/**
 * When this version took effect.
 *
 * `v4` (2026-09-10) names Google as a processor. The document store moved to Google Drive
 * that day (ADR 0018) and the notice did not move with it, so for a few hours applicants
 * were ticking a consent box against a statement that had become false — it said the two
 * documents sat in the Singapore project. Under RA 10173 consent is given at collection,
 * to a specific disclosure; a notice that misstates where personal data lives is worse
 * than no notice at all, which is why `page.tsx` carries the "same PR as the variable"
 * rule and why this is a version bump rather than a quiet edit.
 *
 * `v3` (2026-09-09) had corrected the same paragraph in the other direction and disclosed
 * the draft autosave.
 */
export const PRIVACY_NOTICE_EFFECTIVE_DATE = "2026-09-10";
