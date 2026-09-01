// ─────────────────────────────────────────────────────────────────────────────
// The published privacy notice's version string, as ONE constant the consent
// checkbox on `/apply` and the `/privacy` page both read (BUILD_PLAN S3-T20, S7-T21).
//
// Today this is a plain TS constant, not a database row. `applications.payload`
// stores whatever string a submission agreed to, so "which text did this applicant
// see" is answerable from this constant plus git history for as long as it stays a
// constant — which is only good enough for the seven-day build window.
//
// S7-T22 replaces this with a `privacy_notice_versions` table (immutable rows, no
// UPDATE/DELETE policy) and a database trigger that overwrites whatever a client
// sends with the server's own current version — so a client can never backdate a
// consent or claim agreement to a superseded notice. When that lands, this constant
// becomes the SEED value for the first row rather than the source of truth, and the
// consent Server Action starts reading the version from the database instead of
// importing this file. Until then, bumping this string on any real change to
// `docs/privacy/PRIVACY_NOTICE.md` / `app/(public)/privacy/page.tsx` is a manual
// discipline — do both in the same commit.
// ─────────────────────────────────────────────────────────────────────────────

/** The version an applicant's consent checkbox currently agrees to. Max 32 chars — see `consentShape` in `lib/applications/schema.ts`. */
export const PRIVACY_NOTICE_VERSION = "v1";

/** When this version took effect. Shown on `/privacy`; not otherwise load-bearing yet. */
export const PRIVACY_NOTICE_EFFECTIVE_DATE = "2026-09-01";
