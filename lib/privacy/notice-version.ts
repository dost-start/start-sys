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
export const PRIVACY_NOTICE_VERSION = "v3";

/**
 * When this version took effect. `v3` (2026-09-09) corrects the storage paragraph — the
 * uploaded documents are in the Singapore project, not Google Drive — and discloses the
 * draft autosave added in PR D, which keeps what an applicant typed in their own browser.
 */
export const PRIVACY_NOTICE_EFFECTIVE_DATE = "2026-09-09";
