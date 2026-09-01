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
// `approve_application()` (DATA_MODEL.md §6/0012) reads ELEVEN keys out of
// `applications.payload` with `payload->>'…'` and writes them onto the new `people`
// and `memberships` rows. Those eleven strings are spelled HERE and nowhere else.
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

/** Philippine ZIP code: exactly four digits. */
const POSTAL_CODE_RE = /^\d{4}$/;

/** `join_year`/`expected_grad_year` bounds, matching the CHECK constraints in 0004/0006. */
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

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

  // `.trim()` BEFORE the format check, via a pipe: a trailing space pasted out of a
  // messaging app must not be an "invalid email address".
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

  address_line: requiredText("Street address", 200),
  city_municipality: requiredText("City or municipality"),
  province: requiredText("Province"),
  postal_code: z.string().trim().regex(POSTAL_CODE_RE, "Enter a four-digit postal code, e.g. 1101"),
};

// ── Section 2 — academic ─────────────────────────────────────────────────────

const academicShape = {
  school: requiredText("School", 200),
  school_id_no: requiredText("School ID number", 64),

  // OQ-17: free text with a datalist, never an enum. See the header.
  program: requiredText("Degree program", 200),

  year_level: coercedInt(
    "Select your year level",
    "Year level must be a whole number between 1 and 8",
    1,
    8,
  ),

  // OQ-3 is unresolved: how the system knows a member is graduating is the sole input
  // to the renewal rule the PRD states as "if and only if" (US-G7). v1.0 takes the
  // applicant's own declaration and records it; v1.2 must decide whether CRRD confirms
  // it at renewal. Do not derive it from year_level — that is wrong for irregulars,
  // shiftees and anyone on a five-year program.
  expected_grad_year: coercedInt(
    "Enter your expected year of graduation",
    `Enter a four-digit year between ${YEAR_MIN} and ${YEAR_MAX}`,
    YEAR_MIN,
    YEAR_MAX,
  ),
};

// ── Section 3 — membership ───────────────────────────────────────────────────

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
  /** Which published notice was agreed to. Amending the notice is a NEW version row. */
  consent_privacy_notice_version: requiredText("Privacy notice version", 32),
};

// ── The composed form ────────────────────────────────────────────────────────

/**
 * The whole application body. `.strict()` so an unknown key is REJECTED rather than
 * silently carried into `payload` — the payload is a jsonb column and would happily
 * store anything a client invented, including a field a later migration gives meaning
 * to.
 */
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
    "Attach your proof of enrollment",
    `The file must be between 1 byte and ${MAX_DECLARED_PROOF_BYTES / (1024 * 1024)}MB`,
    1,
    MAX_DECLARED_PROOF_BYTES,
  ),
};

/** The full input to `startApplication`: the form body plus the file declaration. */
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
  })
  .strict();

export type FinalizeApplicationInput = z.infer<typeof finalizeApplicationSchema>;

// ── The payload contract ─────────────────────────────────────────────────────

/**
 * THE ELEVEN KEYS `approve_application()` READS OUT OF `applications.payload`.
 *
 * Source of truth: DATA_MODEL.md §6/0012. Asserted against this schema's shape in
 * `schema.test.ts` by a test named for exactly this. Changing a string here without
 * changing the SQL, or the SQL without changing this, is the silent cross-slice
 * failure described in the header.
 */
export const APPLICATION_PAYLOAD_KEYS = [
  "birthdate",
  "contact_number",
  "address_line",
  "city_municipality",
  "province",
  "postal_code",
  "school",
  "school_id_no",
  "region_id",
  "year_level",
  "expected_grad_year",
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
 * Contains the eleven keys above VERBATIM, plus the fields the form collects that
 * `approve_application()` does not yet read (`middle_name`, `suffix`, `program`) so
 * that nothing an applicant typed is thrown away, plus the consent record.
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
    // The eleven, spelled exactly as approve_application() reads them.
    birthdate: data.birthdate,
    contact_number: data.contact_number,
    address_line: data.address_line,
    city_municipality: data.city_municipality,
    province: data.province,
    postal_code: data.postal_code,
    school: data.school,
    school_id_no: data.school_id_no,
    region_id: data.region_id,
    year_level: data.year_level,
    expected_grad_year: data.expected_grad_year,

    // Collected and preserved; not read by approve_application() today (see header).
    middle_name: data.middle_name ?? null,
    suffix: data.suffix ?? null,
    program: data.program,

    // RA 10173: which notice was agreed to, and when, by the server's clock.
    consent_privacy_notice_version: data.consent_privacy_notice_version,
    consent_given_at: consentGivenAt,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// S4 — THE REVIEW SURFACE (BUILD_PLAN S4-T13)
// ═════════════════════════════════════════════════════════════════════════════
// Appended to this module rather than started as a second one, because CONVENTIONS
// §6 says a form and the Server Action that receives it share ONE schema module. The
// reviewer screens are a different audience from the applicant, not a different
// feature — and a `review-schema.ts` beside this file is exactly how two validation
// rules for the same table start to drift.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The floor on a rejection reason, in characters after trimming.
 *
 * ⚠ THIS NUMBER IS A CONTRACT WITH THE DATABASE, NOT A UI PREFERENCE.
 * `0024_reject_application.sql` ships BOTH `rejected_has_reason`
 * (`check (status <> 'rejected' or length(btrim(review_note)) >= 10)`) AND the same
 * floor inside `reject_application()`. If this constant and that CHECK ever disagree,
 * the form accepts a reason the database then refuses — the reviewer sees a generic
 * validation error on a field they filled in correctly, and the bug is invisible in
 * every test that does not cross the boundary. Change one, change all three.
 *
 * PRD US-C2: "rejection records a reason". CBL-adjacent but not constitutional — this
 * is the PRD's requirement, enforced at the row so a direct PostgREST call cannot
 * bypass the form.
 */
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
