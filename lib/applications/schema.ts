// ─────────────────────────────────────────────────────────────────────────────
// The membership application form, as ONE zod module imported by the client form and
// re-run inside the Server Action (CONVENTIONS.md §6; PRD §IV Data Integrity NFR —
// "validate required fields and formats before modifying membership records",
// implemented once instead of twice and drifting).
//
// Four sections, composed into one FLAT strict object. Flat is deliberate: a field
// name here equals the form input's `name`, which equals the zod issue path, which
// equals the key `error.fields` is keyed by, which equals the database column or
// payload key. A nested shape would put a dot in every path and break the straight
// line from a server field error to `setError` on the input that caused it.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ THE CONTRACT THAT MUST NOT DRIFT — APPLICATION_PAYLOAD_KEYS
// ═══════════════════════════════════════════════════════════════════════════════
// `approve_application()` (0041) reads FIFTEEN keys out of `applications.payload` with
// `payload->>'…'` and writes them onto the new `people` and `memberships` rows. Those
// fifteen strings are spelled HERE and nowhere else.
//
// ADR 0013 (2026-09-06, "Consequences"): home address returns to the form —
// `address_line`, `city_municipality`, `province`, `postal_code` — as four REQUIRED
// keys, joining the eleven the SRS form already collected. `school_id_no` is NOT one
// of them: it is removed from every screen and stays only as a legacy, optional
// payload key on pre-existing rows (0041 copies it "when present").
//
// A rename here does not fail typecheck, does not fail eslint, does not fail pgTAP,
// and does not fail at all — until the first approval on Day 4 writes a `people` row
// full of NULLs for a real scholar. `APPLICATION_PAYLOAD_KEYS` plus its assertion in
// `schema.test.ts` is the only thing standing between a rename and that outcome.
//
// KNOWN GAP, HANDED TO S4 RATHER THAN PAPERED OVER: `approve_application()` as
// written in DATA_MODEL.md §6/0012 copies neither `middle_name` nor `suffix` onto
// `people`, although `people` has both columns and this form collects both. They are
// stored in the payload below so nothing is lost, but unless S4 extends the function
// they are collected and discarded. Raised in the S3 PR.
//
// OQ-17 (the academic-program field): `program` is FREE TEXT with a datalist of the
// twelve CBL Art. I §4 programs, NOT an enum. CBL Art. VII §2 gives CRRD a real
// accreditation workflow whose output lands "in the succeeding amendment", so a
// closed list would refuse a legitimate applicant enrolled in a program that is
// mid-accreditation. The PRD's default is RECORD ONLY — the system stores what was
// submitted and CRRD adjudicates at review. Do not turn this into an enum without
// resolving OQ-17.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

// ── Formats ──────────────────────────────────────────────────────────────────

/**
 * Philippine mobile number, after separators are stripped. Accepts both forms a
 * scholar actually types: `+639171234567` and `09171234567`.
 *
 * Deliberately permissive rather than exhaustive: this rejects a typo, it does not
 * verify that a number is reachable. The system cannot verify truth — that is what
 * the proof-of-enrollment upload and CRRD review exist for (PRD §4 Assumptions).
 */
const PH_MOBILE_RE = /^(?:\+63|0)9\d{9}$/;

/** Everything a human puts between the digits of a phone number. */
const PHONE_SEPARATORS_RE = /[\s()\-.]/g;

const FACEBOOK_URL_RE = /^https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com|fb\.me)\/.+/i;

/** Philippine ZIP code: exactly four digits (ADR 0013 — home address returns to the form). */
const POSTAL_CODE_RE = /^\d{4}$/;
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;
const AWARD_YEAR_MIN = 2000;
const AWARD_YEAR_MAX = new Date().getUTCFullYear();

/** SRS 2026-09-05 — the `sex_option` enum (0038), in display order. */
export const SEX_OPTIONS = ["male", "female", "prefer_not_to_say"] as const;
export const SEX_LABELS: Record<(typeof SEX_OPTIONS)[number], string> = {
  male: "Male",
  female: "Female",
  prefer_not_to_say: "Prefer not to say",
};

/** SRS 2026-09-05 — the `scholarship_award` enum (0038), in the SRS's order. */
export const SCHOLARSHIP_AWARDS = [
  "ra_7687",
  "merit",
  "jlss_ra_7687",
  "jlss_merit",
  "jlss_ra_10612",
] as const;
export const SCHOLARSHIP_AWARD_LABELS: Record<(typeof SCHOLARSHIP_AWARDS)[number], string> = {
  ra_7687: "RA 7687",
  merit: "Merit",
  jlss_ra_7687: "JLSS RA 7687",
  jlss_merit: "JLSS Merit",
  jlss_ra_10612: "JLSS RA 10612",
};

/** Nobody in this organization was born before this. Catches a mistyped century. */
const EARLIEST_PLAUSIBLE_BIRTH_YEAR = 1900;

// ── The proof-of-enrollment limits, as the FORM sees them ────────────────────
// These duplicate `ALLOWED_MIME` / `MAX_PROOF_BYTES` in `lib/documents/types.ts`, and
// the duplication is deliberate rather than an oversight.
//
// This module is imported by a `'use client'` form, and CONVENTIONS.md §1.3 forbids a
// client file from importing anything under `lib/documents/`. Reaching across that
// line to save eleven characters of duplication would put the document-store surface
// one refactor away from a client bundle.
//
// The two lists are NOT peers. These are the limits applied to what the BROWSER
// CLAIMS, so that an oversize or wrong-type file is refused before a database row, a
// resumable session URI or a Google API call exists. `lib/documents/` owns the
// authoritative check — provider metadata plus magic-byte sniffing on the bytes that
// actually arrived (S3-T10, S3-T16) — and if the two ever disagree, the document
// store is right, because it is the only one looking at a fact rather than a claim.
//
// Drift is caught by an assertion in `schema.test.ts`, which is a test file and may
// import `lib/documents/types` freely.

/** MIME types the form will offer and accept as a CLAIM. */
export const DECLARED_ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
] as const;

/** 10MB. A phone photo of a Certificate of Registration is comfortably under this. */
export const MAX_DECLARED_PROOF_BYTES = 10 * 1024 * 1024;

const requiredText = (label: string, max = 120) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

/** An untouched optional input arrives as `""`, which is absence, not a value. */
const optionalText = (max = 120) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

/**
 * A whole number typed into an HTML input, which always arrives as a string.
 *
 * The `preprocess` is not decoration: `z.coerce.number()` turns `""` into `0`, so an
 * untouched field would fail with "must be between 1 and 8" instead of "required" —
 * a message that sends the applicant looking for a value they never entered.
 */
const coercedInt = (missingMessage: string, rangeMessage: string, min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number(missingMessage).int(rangeMessage).min(min, rangeMessage).max(max, rangeMessage),
  );

// ── Section 1 — personal ─────────────────────────────────────────────────────
// The densest PII in the system. Every field below is registered sensitive on
// `applications.payload` (DATA_MODEL.md §8.1) and is masked before it can reach the
// audit log.

const personalShape = {
  applicant_given_name: requiredText("First name"),
  middle_name: optionalText(),
  applicant_family_name: requiredText("Last name"),
  suffix: optionalText(16),
  // SRS 2026-09-05: "Sex (male/female/prefer not to say)". Stored on people.sex (0038).
  sex: z.enum(SEX_OPTIONS, "Select an option"),
  applicant_email: z
    .string()
    .trim()
    .max(254, "Email address is too long")
    .pipe(z.email("Enter a valid email address")),
  birthdate: z.iso
    .date("Enter your date of birth as YYYY-MM-DD")
    .refine((value) => new Date(`${value}T00:00:00Z`).getTime() <= Date.now(), {
      message: "Date of birth cannot be in the future",
    })
    .refine((value) => Number(value.slice(0, 4)) >= EARLIEST_PLAUSIBLE_BIRTH_YEAR, {
      message: "Enter a valid date of birth",
    }),
  contact_number: z
    .string()
    .trim()
    .min(1, "Contact number is required")
    .refine((value) => PH_MOBILE_RE.test(value.replace(PHONE_SEPARATORS_RE, "")), {
      message: "Enter a Philippine mobile number, e.g. 09171234567 or +639171234567",
    }),
  // SRS: "Facebook Account Link" — a contact channel, sensitive (RA 10173), registered.
  facebook_account: z
    .string()
    .trim()
    .min(1, "Facebook account link is required")
    .max(300, "Facebook account link is too long")
    .refine((value) => FACEBOOK_URL_RE.test(value), {
      message: "Enter the full link to your Facebook profile, e.g. https://facebook.com/yourname",
    }),
  // ADR 0013 (2026-09-06, "Consequences"): home address returns to the form. Required,
  // not legacy-optional this time — `approve_application()` (0041) already reads all
  // four `payload->>'…'` keys onto `people`, and they were simply null for every
  // SRS-era submission until now.
  address_line: requiredText("Street address", 200),
  city_municipality: requiredText("City or municipality", 120),
  province: requiredText("Province", 120),
  postal_code: z.string().trim().regex(POSTAL_CODE_RE, "Enter a 4-digit postal code"),
};

const academicShape = {
  // SRS: "DOST Scholarship Award" and "Year of Award" — the scholarship, not the org.
  scholarship_award: z.enum(SCHOLARSHIP_AWARDS, "Select your DOST scholarship award"),
  award_year: coercedInt(
    "Enter the year of your award",
    `Enter a four-digit year between ${AWARD_YEAR_MIN} and ${AWARD_YEAR_MAX}`,
    AWARD_YEAR_MIN,
    AWARD_YEAR_MAX,
  ),
  // SRS: closed lists, rows not code (0037). The ids are validated against the tables by
  // the FK on approval; here they are checked for shape only.
  university_id: z.uuid("Select your university"),
  program_id: z.uuid("Select your program"),
  year_level: coercedInt(
    "Select your year level",
    "Year level must be a whole number between 1 and 5",
    1,
    5,
  ),
  expected_grad_year: coercedInt(
    "Enter your expected year of graduation",
    `Enter a four-digit year between ${YEAR_MIN} and ${YEAR_MAX}`,
    YEAR_MIN,
    YEAR_MAX,
  ),
};

const membershipShape = {
  // A uuid from the seeded `regions` table (18 regions — RA 12000 added the Negros
  // Island Region). anon holds `select on public.regions`, so the dropdown is
  // populated by an ordinary anonymous read (0015_grants.sql).
  region_id: z.uuid("Select your region"),
};

// ── Section 4 — consent (RA 10173, captured AT COLLECTION) ───────────────────
// Consent obtained after the fact is not consent. ARCHITECTURE.md §4.1 step 2 puts
// the capture on the form itself, and CBL Art. VIII §6 makes RA 10173 a
// constitutional obligation of the organization, not merely a statutory one.
//
// `z.literal(true)` and not `z.boolean()`: an unticked box must fail on BOTH sides.
// The client check is UX; this same object is re-parsed inside the Server Action, so
// a client that strips the field or sends `false` is refused server-side too. The
// database-enforced half — the immutable `privacy_notice_versions` table and the
// `submitted_has_consent` CHECK — lands in S7-T22 and is a third mechanism, not a
// replacement for this one.

const consentShape = {
  consent_privacy_notice: z.literal(true, {
    message: "You must agree to the privacy notice before submitting",
  }),
  consent_privacy_notice_version: requiredText("Privacy notice version", 32),
  // SRS: "A tick box certifying accuracy of all information and confirmation of
  // understanding that falsification may lead to banning from future START activities."
  certify_accuracy: z.literal(true, {
    message: "You must certify that the information you provided is accurate",
  }),
};

export const applicationSubmitSchema = z
  .object({
    ...personalShape,
    ...academicShape,
    ...membershipShape,
    ...consentShape,
  })
  .strict();

export type ApplicationSubmitInput = z.infer<typeof applicationSubmitSchema>;

/**
 * What the browser DECLARES about the file it is about to upload.
 *
 * Checked here so `startApplication` can refuse an oversize or wrong-type file
 * BEFORE it touches the database or Google — no row, no session URI, no cost.
 *
 * ⚠ This is a claim, not a fact. The declared values are never trusted: after the
 * browser PUTs the bytes, `finalizeApplication` re-fetches the file's metadata from
 * the provider and sniffs its magic bytes, and it is THOSE values that are stored
 * (BUILD_PLAN S3-T16, ARCHITECTURE.md §4.1 step 5).
 */
const proofDeclarationShape = {
  proof_file_name: requiredText("File name", 255),
  proof_mime_type: z.enum(
    DECLARED_ALLOWED_MIME,
    "Upload a PDF, JPEG, PNG or HEIC file — that is what a phone photo or a scan produces",
  ),
  proof_size_bytes: coercedInt(
    "Attach your latest registration form",
    `The file must be between 1 byte and ${MAX_DECLARED_PROOF_BYTES / (1024 * 1024)}MB`,
    1,
    MAX_DECLARED_PROOF_BYTES,
  ),
  // SRS 2026-09-05: the Notice of Award is the second required file (0040).
  noa_file_name: requiredText("File name", 255),
  noa_mime_type: z.enum(
    DECLARED_ALLOWED_MIME,
    "Upload a PDF, JPEG, PNG or HEIC file — that is what a phone photo or a scan produces",
  ),
  noa_size_bytes: coercedInt(
    "Attach your Notice of Award",
    `The file must be between 1 byte and ${MAX_DECLARED_PROOF_BYTES / (1024 * 1024)}MB`,
    1,
    MAX_DECLARED_PROOF_BYTES,
  ),
};

export const startApplicationSchema = applicationSubmitSchema.extend(proofDeclarationShape);

export type StartApplicationInput = z.infer<typeof startApplicationSchema>;

/**
 * The input to `finalizeApplication`, returned to the browser by `startApplication`
 * and echoed back once the direct PUT completes.
 *
 * `upload_token` is a bearer capability for exactly one application row, which is what
 * lets the schema carry NO anon UPDATE policy anywhere (0019_finalize_application.sql).
 * It is never rendered into the DOM, the URL or a data attribute.
 */
export const finalizeApplicationSchema = z
  .object({
    application_id: z.uuid(),
    upload_token: z.string().min(1),
    storage_ref: z.string().min(1),
    noa_storage_ref: z.string().min(1),
  })
  .strict();
export type FinalizeApplicationInput = z.infer<typeof finalizeApplicationSchema>;

// ── The payload contract ─────────────────────────────────────────────────────

/**
 * THE FIFTEEN KEYS `approve_application()` READS OUT OF `applications.payload`.
 *
 * Source of truth: `supabase/migrations/0041_approve_and_record_v2.sql`. Asserted
 * against this schema's shape in `schema.test.ts` by a test named for exactly this.
 * Changing a string here without changing the SQL, or the SQL without changing this,
 * is the silent cross-slice failure described in the header.
 */
export const APPLICATION_PAYLOAD_KEYS = [
  "birthdate",
  "contact_number",
  "region_id",
  "year_level",
  "expected_grad_year",
  "sex",
  "facebook_account",
  "scholarship_award",
  "award_year",
  "university_id",
  "program_id",
  "address_line",
  "city_municipality",
  "province",
  "postal_code",
] as const;
export type ApplicationPayloadKey = (typeof APPLICATION_PAYLOAD_KEYS)[number];

/**
 * The shape written into the `applications.payload` jsonb column.
 *
 * Flat and scalar by construction, which keeps it assignable to the generated `Json`
 * type without a cast and keeps `payload->>'key'` — the only way `approve_application()`
 * reads it — a valid access for every key.
 */
export type ApplicationPayload = Record<string, string | number | null>;

/**
 * Build the `applications.payload` jsonb from a validated body.
 *
 * Contains the fifteen keys above VERBATIM, plus `middle_name` and `suffix` (0041
 * copies both onto `people` too, though they are not part of the payload contract
 * this module asserts) so that nothing an applicant typed is thrown away, plus the
 * consent record.
 *
 * DELIBERATELY ABSENT: `applicant_email`, `applicant_given_name`,
 * `applicant_family_name`. Those have their own columns on `applications`, and
 * duplicating them into the payload would make the same PII exist twice on one row —
 * two places for the five-year purge to reach, one of which it would miss.
 *
 * @param consentGivenAt the SERVER's clock, never the client's. A client-supplied
 *        consent timestamp is a backdated consent claim.
 */
export function buildApplicationPayload(
  data: ApplicationSubmitInput,
  consentGivenAt: string,
): ApplicationPayload {
  return {
    birthdate: data.birthdate,
    contact_number: data.contact_number,
    region_id: data.region_id,
    year_level: data.year_level,
    expected_grad_year: data.expected_grad_year,
    sex: data.sex,
    facebook_account: data.facebook_account,
    scholarship_award: data.scholarship_award,
    award_year: data.award_year,
    university_id: data.university_id,
    program_id: data.program_id,
    address_line: data.address_line,
    city_municipality: data.city_municipality,
    province: data.province,
    postal_code: data.postal_code,
    middle_name: data.middle_name ?? null,
    suffix: data.suffix ?? null,
    consent_privacy_notice_version: data.consent_privacy_notice_version,
    consent_given_at: consentGivenAt,
    certified_accuracy_at: consentGivenAt,
  };
}

// ── Submission-time standards (ADR 0013 §1) ──────────────────────────────────
// `check_submission_standards(p_email, p_payload)` is a SECURITY DEFINER RPC — the SQL
// contract is owned elsewhere — returning the failing field keys out of: `term`,
// `expected_grad_year`, `program_id`, `university_id`, `scholarship_award`,
// `award_year`, `applicant_email`. An empty array means the submission passes.
//
// Both `startApplication` and `startRenewal` call it AFTER building the payload and
// BEFORE the write that would create a pending row, so a submission that fails a
// checkable standard is refused before anything is stored (ADR 0013 §1: "a submission
// failing any check is refused at submission").
//
// `term` is not a field on either form — a missing active term means the application
// (or renewal) period cannot be open, so the CALLER maps it to `window_closed`, the
// same code a closed window already returns, rather than to a field error here.

/** Shown above the highlighted fields; never the only message a rejection carries. */
export const SUBMISSION_STANDARDS_GENERIC_MESSAGE = "Please fix the highlighted fields.";

/** One message per checkable field. `term` is deliberately absent — see the note above. */
export const SUBMISSION_STANDARDS_FIELD_MESSAGES: Record<string, string> = {
  expected_grad_year:
    "Only current students may apply: your expected graduation year must be after the current term ends.",
  program_id: "Select your program from the list.",
  university_id: "Select your university from the list.",
  scholarship_award: "Select your DOST scholarship award.",
  award_year: "Enter the year of your award.",
  applicant_email: "This email address cannot be used to apply. Please contact CRRD.",
};

/**
 * Turn the failing-key array `check_submission_standards()` returns into the same
 * `{ fields }` shape a failed zod parse produces (CONVENTIONS §6: server field errors
 * attach to their input, never a generic toast).
 *
 * `term` is excluded on purpose — the caller returns `window_closed` for it instead of
 * a field error, per the module note above. An unrecognized key (a future standard
 * this client has not been taught about) is silently dropped rather than crashing the
 * whole refusal into an unlabelled one.
 */
export function submissionStandardsFieldErrors(
  failures: readonly string[],
): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const key of failures) {
    if (key === "term") continue;
    const message = SUBMISSION_STANDARDS_FIELD_MESSAGES[key];
    if (message !== undefined) fields[key] = [message];
  }
  return fields;
}

export const REJECT_REASON_MIN_LENGTH = 10;

/** Bounded so a paste of an entire email thread does not become the audit record. */
export const REJECT_REASON_MAX_LENGTH = 2000;

/** Approve takes nothing but the row. Everything else is derived server-side. */
export const applicationApproveSchema = z
  .object({
    id: z.uuid("Select an application to approve"),
  })
  .strict();

export type ApplicationApproveInput = z.infer<typeof applicationApproveSchema>;

/**
 * Reject, with a written ground.
 *
 * `.trim()` runs BEFORE `.min()`, so ten spaces is not a reason. That is the same
 * order `length(btrim(review_note))` applies in SQL — deliberately, so the two agree
 * on the edge case rather than only on the happy path.
 */
export const applicationRejectSchema = z
  .object({
    id: z.uuid("Select an application to reject"),
    review_note: z
      .string()
      .trim()
      .min(
        REJECT_REASON_MIN_LENGTH,
        `Give a reason of at least ${REJECT_REASON_MIN_LENGTH} characters — it is recorded in the audit log and shown on the application`,
      )
      .max(
        REJECT_REASON_MAX_LENGTH,
        `Keep the reason under ${REJECT_REASON_MAX_LENGTH} characters`,
      ),
  })
  .strict();

export type ApplicationRejectInput = z.infer<typeof applicationRejectSchema>;

// ── The review queue's URL state ─────────────────────────────────────────────
// CONVENTIONS §2: filter, sort and pagination state lives in URL SEARCH PARAMS and
// nowhere else — no client state library, so a filtered queue is a shareable link and
// the back button works (PRD US-I3).

/**
 * The statuses the queue filters by (PRD US-C1: "Pending / Approved / Rejected").
 *
 * `draft` is deliberately ABSENT. A draft is an abandoned upload, not a submission —
 * the applicant never sees the word (DATA_MODEL.md §3.2) and `purge_abandoned_drafts()`
 * redacts it after 30 days. Offering it as a filter would put un-submitted applicant
 * PII on a reviewer screen for no decision anyone can take on it.
 */
export const APPLICATION_QUEUE_STATUSES = ["pending", "approved", "rejected"] as const;

export type ApplicationQueueStatus = (typeof APPLICATION_QUEUE_STATUSES)[number];

/** The only orderings the queue offers. PRD US-C1: "sorts by submission time". */
export const APPLICATION_SORTS = ["submitted_at.desc", "submitted_at.asc"] as const;

export type ApplicationSort = (typeof APPLICATION_SORTS)[number];

export const DEFAULT_APPLICATION_SORT: ApplicationSort = "submitted_at.desc";
export const DEFAULT_APPLICATIONS_PER_PAGE = 25;
export const MAX_APPLICATIONS_PER_PAGE = 100;

/**
 * A search param arrives as `string | string[] | undefined`. Take the first value and
 * treat an empty string as absence, so `?status=` is "no filter" rather than an
 * invalid enum member.
 */
const firstParam = (value: unknown): unknown => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  return raw;
};

const searchParam = <T extends z.ZodTypeAny>(inner: T) => z.preprocess(firstParam, inner);

/**
 * Parse `searchParams` into the queue's filter state.
 *
 * ⚠ THIS SCHEMA NEVER THROWS. Every field carries `.catch(...)`, so a shared,
 * hand-edited or stale link degrades to the default view instead of a 500. A filtered
 * queue is meant to be pasted into a group chat (PRD US-I3); a link that errors when
 * one param is stale is a link nobody shares twice.
 *
 * The cost is that `?status=nonsense` silently shows everything rather than
 * complaining. That is the right trade for a reviewer screen and it matches the rule
 * S5-T14 applies to the member grid, so both surfaces behave the same way.
 *
 * `term_id` is honoured for the reviewer roles only, and that gate is SERVER-SIDE in
 * `listApplications` — not here. A schema cannot know who is asking.
 */
export const applicationListFiltersSchema = z.object({
  status: searchParam(z.enum(APPLICATION_QUEUE_STATUSES).optional()).catch(undefined),
  term_id: searchParam(z.uuid().optional()).catch(undefined),
  sort: searchParam(z.enum(APPLICATION_SORTS).default(DEFAULT_APPLICATION_SORT)).catch(
    DEFAULT_APPLICATION_SORT,
  ),
  page: searchParam(z.coerce.number().int().min(1).default(1)).catch(1),
  per_page: searchParam(
    z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_APPLICATIONS_PER_PAGE)
      .default(DEFAULT_APPLICATIONS_PER_PAGE),
  ).catch(DEFAULT_APPLICATIONS_PER_PAGE),
});

export type ApplicationListFilters = z.infer<typeof applicationListFiltersSchema>;

/** Parse whatever a page received. Total by construction — see the schema's note. */
export function parseApplicationListFilters(input: unknown): ApplicationListFilters {
  return applicationListFiltersSchema.parse(input ?? {});
}
