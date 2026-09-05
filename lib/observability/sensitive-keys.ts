// ─────────────────────────────────────────────────────────────────────────────
// THE SENSITIVE-KEY LIST — one source, two consumers (BUILD_PLAN S7-T8, S7-T10).
//
// This file exists so the error-tracker scrub and the client-bundle audit cannot
// drift apart. If they held separate copies, adding a column to one and forgetting
// the other would leave a real PII path uncovered while both files still looked
// correct — and nothing would fail.
//
// ⚠️ THIS IS A MIRROR, NOT THE SOURCE. `DATA_MODEL.md` §8.1 and the
// `sensitive_column_registry` TABLE are the classification of record; the database
// reads the table (audit masking, the five-year purge), and this constant exists only
// because a Node process cannot query Postgres before deciding what to strip from an
// error event. **Adding a sensitive column means: the migration registers it in
// `sensitive_column_registry` AND this list gains the same name, in the same commit**
// (DATA_MODEL.md §13 rule 4). `supabase/tests/099_security_invariants.sql` asserts the
// registry names only columns that actually exist; nothing can assert this file matches
// it from inside the database, so the discipline is the review.
//
// RA 10173, and CBL Art. VIII §6, which makes the Data Privacy Act a constitutional
// obligation of the organization rather than only a statutory one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Column names that carry personal data, mirroring `DATA_MODEL.md` §8.1.
 *
 * `people`: birthdate, contact_number, personal_email, address_line, city_municipality,
 * province, postal_code, school, school_id_no, middle_name.
 * `applications`: applicant_email, payload, proof_web_view_link, proof_drive_file_id,
 * plus `submit_token_hash` — not personal data, but a bearer capability over one
 * applicant's row, so it is stripped on the same terms.
 * `renewal_submissions`: payload. `email_recipients` (v1.1): to_email, merge.
 */
export const SENSITIVE_KEYS = [
  // people
  "birthdate",
  "contact_number",
  "personal_email",
  "address_line",
  "city_municipality",
  "province",
  "postal_code",
  "school",
  "school_id_no",
  "middle_name",
  "facebook_account", // 0038 — a contact channel, registered sensitive
  // applications / renewal_submissions
  "applicant_email",
  "payload",
  "proof_web_view_link",
  "proof_drive_file_id",
  "noa_drive_file_id", // 0040 — the Notice of Award pointer, same terms as the proof pointer
  "submit_token_hash",
  // email_recipients (0043): a frozen copy of contact data at send time
  "to_email",
  "merge",
] as const;

export type SensitiveKey = (typeof SENSITIVE_KEYS)[number];

const SENSITIVE_KEY_SET: ReadonlySet<string> = new Set<string>(SENSITIVE_KEYS);

/** Case-insensitive membership test — an event payload may carry either casing. */
export function isSensitiveKey(name: string): boolean {
  return SENSITIVE_KEY_SET.has(name.toLowerCase());
}

/**
 * Literals that must never appear in anything served to a browser, whatever the
 * surrounding context. Unlike a column NAME — which a form legitimately carries as a
 * field name — each of these is evidence that a server-only module was bundled.
 */
export const FORBIDDEN_CLIENT_LITERALS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "service_role",
  "BEGIN PRIVATE KEY",
  "BEGIN RSA PRIVATE KEY",
  "AGE-SECRET-KEY",
  // A client-side unrestricted read of the PII table. `people` is reachable to
  // `authenticated` only through a six-column GRANT (migration 0015), so this URL
  // would return nothing useful — but a client that tries is a design error, and the
  // GRANT is one careless migration away from being wider.
  "/rest/v1/people?select=*",
] as const;
