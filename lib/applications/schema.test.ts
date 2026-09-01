// ─────────────────────────────────────────────────────────────────────────────
// BUILD_PLAN S3-T13's acceptance, asserted.
//
// The load-bearing test in this file is the FIRST one. `approve_application()` reads
// eleven `payload->>'…'` keys; those strings live in `schema.ts` and in a SQL function
// and nowhere else. A rename on either side fails no typecheck, no lint and no pgTAP
// suite — it fails on Day 4 by writing a `people` row full of NULLs for a real
// scholar. This test is the only thing between those two facts.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import { ALLOWED_MIME, MAX_PROOF_BYTES } from "@/lib/documents/types";

import {
  APPLICATION_PAYLOAD_KEYS,
  APPLICATION_QUEUE_STATUSES,
  applicationApproveSchema,
  applicationRejectSchema,
  applicationSubmitSchema,
  DEFAULT_APPLICATION_SORT,
  DEFAULT_APPLICATIONS_PER_PAGE,
  MAX_APPLICATIONS_PER_PAGE,
  parseApplicationListFilters,
  REJECT_REASON_MAX_LENGTH,
  REJECT_REASON_MIN_LENGTH,
  buildApplicationPayload,
  DECLARED_ALLOWED_MIME,
  finalizeApplicationSchema,
  MAX_DECLARED_PROOF_BYTES,
  startApplicationSchema,
} from "@/lib/applications/schema";

/**
 * The eleven keys, transcribed independently from DATA_MODEL.md §6/0012 rather than
 * imported, so the assertion below compares two sources instead of comparing the
 * module to itself.
 */
const KEYS_APPROVE_APPLICATION_READS = [
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
];

/** A complete, valid submission. Every rejection case below mutates exactly one field. */
const VALID = {
  applicant_given_name: "Maria",
  middle_name: "Santos",
  applicant_family_name: "Dela Cruz",
  suffix: "",
  applicant_email: "maria.delacruz@example.edu.ph",
  birthdate: "2005-03-14",
  contact_number: "09171234567",
  address_line: "123 Katipunan Avenue",
  city_municipality: "Quezon City",
  province: "Metro Manila",
  postal_code: "1108",
  school: "University of the Philippines Diliman",
  school_id_no: "2023-12345",
  program: "BS Computer Science",
  year_level: "2",
  expected_grad_year: "2027",
  region_id: "11111111-1111-4111-8111-111111111111",
  consent_privacy_notice: true,
  consent_privacy_notice_version: "v1.0",
};

/** The first issue path for a failed parse, as the dotted key `error.fields` uses. */
function firstIssuePath(input: unknown): string {
  const parsed = applicationSubmitSchema.safeParse(input);
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error("unreachable");
  const issue = parsed.error.issues[0];
  expect(issue).toBeDefined();
  return (issue?.path ?? []).map(String).join(".");
}

describe("payload keys match every key approve_application() reads", () => {
  it("APPLICATION_PAYLOAD_KEYS is exactly the eleven keys in DATA_MODEL §6/0012", () => {
    expect([...APPLICATION_PAYLOAD_KEYS].sort()).toEqual(
      [...KEYS_APPROVE_APPLICATION_READS].sort(),
    );
    expect(APPLICATION_PAYLOAD_KEYS).toHaveLength(11);
  });

  it("every one of those eleven is a field the form actually collects", () => {
    const formFields = Object.keys(applicationSubmitSchema.shape);
    for (const key of APPLICATION_PAYLOAD_KEYS) {
      expect(formFields).toContain(key);
    }
  });

  it("buildApplicationPayload emits all eleven with a non-null value", () => {
    const parsed = applicationSubmitSchema.parse(VALID);
    const payload = buildApplicationPayload(parsed, "2026-09-03T01:00:00.000Z");

    for (const key of APPLICATION_PAYLOAD_KEYS) {
      expect(Object.keys(payload)).toContain(key);
      expect(payload[key]).not.toBeNull();
      expect(payload[key]).not.toBeUndefined();
    }
  });

  it("keeps middle_name, suffix and program even though approve_application() drops them", () => {
    // The known gap handed to S4: these are collected and, until approve_application()
    // is extended, discarded at approval. Storing them means nothing the applicant
    // typed is lost in the meantime.
    const parsed = applicationSubmitSchema.parse(VALID);
    const payload = buildApplicationPayload(parsed, "2026-09-03T01:00:00.000Z");
    expect(payload["middle_name"]).toBe("Santos");
    expect(payload["suffix"]).toBeNull();
    expect(payload["program"]).toBe("BS Computer Science");
  });

  it("never duplicates the applicant's identity columns into the payload", () => {
    // applicant_email / _given_name / _family_name have their own columns. Duplicating
    // them would put the same PII in two places, one of which the five-year purge and
    // the abandoned-draft sweep would miss.
    const parsed = applicationSubmitSchema.parse(VALID);
    const payload = buildApplicationPayload(parsed, "2026-09-03T01:00:00.000Z");
    expect(Object.keys(payload)).not.toContain("applicant_email");
    expect(Object.keys(payload)).not.toContain("applicant_given_name");
    expect(Object.keys(payload)).not.toContain("applicant_family_name");
  });

  it("records the consent version and the SERVER's timestamp, never the client's", () => {
    const parsed = applicationSubmitSchema.parse(VALID);
    const payload = buildApplicationPayload(parsed, "2026-09-03T01:00:00.000Z");
    expect(payload["consent_privacy_notice_version"]).toBe("v1.0");
    expect(payload["consent_given_at"]).toBe("2026-09-03T01:00:00.000Z");
  });
});

describe("applicationSubmitSchema accepts a real submission", () => {
  it("parses the valid body and coerces the numeric inputs", () => {
    const parsed = applicationSubmitSchema.parse(VALID);
    expect(parsed.year_level).toBe(2);
    expect(parsed.expected_grad_year).toBe(2027);
    // An untouched optional input arrives as "" and must read as absence.
    expect(parsed.suffix).toBeUndefined();
  });

  it("accepts the +63 form of a Philippine mobile number and tolerates separators", () => {
    for (const contact_number of ["+639171234567", "+63 917 123 4567", "0917-123-4567"]) {
      expect(applicationSubmitSchema.safeParse({ ...VALID, contact_number }).success).toBe(true);
    }
  });

  it("trims a pasted email rather than calling it invalid", () => {
    const parsed = applicationSubmitSchema.parse({
      ...VALID,
      applicant_email: "  maria.delacruz@example.edu.ph  ",
    });
    expect(parsed.applicant_email).toBe("maria.delacruz@example.edu.ph");
  });
});

describe("applicationSubmitSchema rejects", () => {
  it("a malformed Philippine contact number, on the contact_number field", () => {
    expect(firstIssuePath({ ...VALID, contact_number: "12345" })).toBe("contact_number");
    expect(firstIssuePath({ ...VALID, contact_number: "+1 415 555 0100" })).toBe("contact_number");
    expect(firstIssuePath({ ...VALID, contact_number: "091712345678" })).toBe("contact_number");
  });

  it("an alphabetic postal code, on the postal_code field", () => {
    expect(firstIssuePath({ ...VALID, postal_code: "ABCD" })).toBe("postal_code");
    expect(firstIssuePath({ ...VALID, postal_code: "110" })).toBe("postal_code");
    expect(firstIssuePath({ ...VALID, postal_code: "11080" })).toBe("postal_code");
  });

  it("year_level 0 and year_level 9", () => {
    expect(firstIssuePath({ ...VALID, year_level: "0" })).toBe("year_level");
    expect(firstIssuePath({ ...VALID, year_level: "9" })).toBe("year_level");
    expect(firstIssuePath({ ...VALID, year_level: "2.5" })).toBe("year_level");
  });

  it("consent that is false, absent, or the string 'true'", () => {
    // z.literal(true), not z.boolean(): PRD US-B1 / RA 10173 require an affirmative
    // act. An unticked box must fail server-side too, not only in the browser.
    expect(firstIssuePath({ ...VALID, consent_privacy_notice: false })).toBe(
      "consent_privacy_notice",
    );
    const withoutConsent: Record<string, unknown> = { ...VALID };
    delete withoutConsent["consent_privacy_notice"];
    expect(firstIssuePath(withoutConsent)).toBe("consent_privacy_notice");
    expect(firstIssuePath({ ...VALID, consent_privacy_notice: "true" })).toBe(
      "consent_privacy_notice",
    );
  });

  it("an unknown key, because payload is jsonb and would store anything invented", () => {
    const parsed = applicationSubmitSchema.safeParse({ ...VALID, is_admin: true });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    expect(parsed.error.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("a birthdate in the future and a mistyped century", () => {
    expect(firstIssuePath({ ...VALID, birthdate: "2999-01-01" })).toBe("birthdate");
    expect(firstIssuePath({ ...VALID, birthdate: "0205-03-14" })).toBe("birthdate");
    expect(firstIssuePath({ ...VALID, birthdate: "14/03/2005" })).toBe("birthdate");
  });

  it("a region that is not a uuid, and an expected_grad_year outside the CHECK bounds", () => {
    expect(firstIssuePath({ ...VALID, region_id: "NCR" })).toBe("region_id");
    expect(firstIssuePath({ ...VALID, expected_grad_year: "1999" })).toBe("expected_grad_year");
    expect(firstIssuePath({ ...VALID, expected_grad_year: "2101" })).toBe("expected_grad_year");
  });

  it("an empty required field, with a 'required' message rather than a range message", () => {
    const parsed = applicationSubmitSchema.safeParse({ ...VALID, year_level: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    expect(parsed.error.issues[0]?.message).toMatch(/select your year level/i);
  });
});

describe("startApplicationSchema — the file DECLARATION", () => {
  const VALID_START = {
    ...VALID,
    proof_file_name: "cor.jpg",
    proof_mime_type: "image/jpeg",
    proof_size_bytes: String(6 * 1024 * 1024),
  };

  it("accepts a 6MB phone photo — the size the whole direct-PUT design exists for", () => {
    const parsed = startApplicationSchema.parse(VALID_START);
    expect(parsed.proof_size_bytes).toBe(6 * 1024 * 1024);
  });

  it("refuses a disallowed declared type before any row or session URI exists", () => {
    const parsed = startApplicationSchema.safeParse({
      ...VALID_START,
      proof_mime_type: "application/zip",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    expect(parsed.error.issues[0]?.path.map(String).join(".")).toBe("proof_mime_type");
  });

  it("refuses an oversize declared file", () => {
    const parsed = startApplicationSchema.safeParse({
      ...VALID_START,
      proof_size_bytes: String(MAX_DECLARED_PROOF_BYTES + 1),
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    expect(parsed.error.issues[0]?.path.map(String).join(".")).toBe("proof_size_bytes");
  });

  it("still rejects an unknown key after extending the strict base", () => {
    expect(startApplicationSchema.safeParse({ ...VALID_START, whatever: 1 }).success).toBe(false);
  });

  it("keeps the FORM's declared limits in step with the document store's real ones", () => {
    // The duplication is deliberate (CONVENTIONS §1.3 — a client file may not import
    // lib/documents/). This test is a test file, so it may import both and compare.
    // If this fails, change BOTH, and read the header of schema.ts first: the document
    // store is the one checking a fact, so it is the one that is right.
    expect([...DECLARED_ALLOWED_MIME].sort()).toEqual([...ALLOWED_MIME].sort());
    expect(MAX_DECLARED_PROOF_BYTES).toBe(MAX_PROOF_BYTES);
  });
});

describe("finalizeApplicationSchema", () => {
  const VALID_FINALIZE = {
    application_id: "22222222-2222-4222-8222-222222222222",
    upload_token: "a".repeat(64),
    storage_ref: "drive-file-id-abc",
  };

  it("accepts the three values startApplication handed back", () => {
    expect(finalizeApplicationSchema.parse(VALID_FINALIZE)).toEqual(VALID_FINALIZE);
  });

  it("rejects a non-uuid application id, an empty token, and an unknown key", () => {
    expect(
      finalizeApplicationSchema.safeParse({ ...VALID_FINALIZE, application_id: "1" }).success,
    ).toBe(false);
    expect(
      finalizeApplicationSchema.safeParse({ ...VALID_FINALIZE, upload_token: "" }).success,
    ).toBe(false);
    expect(
      finalizeApplicationSchema.safeParse({ ...VALID_FINALIZE, status: "approved" }).success,
    ).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// S4 — the review surface (BUILD_PLAN S4-T13)
// ═════════════════════════════════════════════════════════════════════════════

describe("applicationRejectSchema", () => {
  const ID = "33333333-3333-4333-8333-333333333333";

  /**
   * THE LOAD-BEARING ASSERTION IN THIS BLOCK.
   *
   * `0024_reject_application.sql` ships the floor TWICE — as
   * `check (status <> 'rejected' or length(btrim(review_note)) >= 10)` and as an
   * explicit length check inside `reject_application()`. Transcribed here
   * INDEPENDENTLY rather than imported, so this compares two sources instead of
   * comparing the module to itself. If the SQL floor moves and this does not, the form
   * accepts a reason the database then refuses — and the reviewer sees a generic error
   * on a field they filled in correctly.
   */
  const SQL_REJECTED_HAS_REASON_FLOOR = 10;

  it("uses the same floor as the rejected_has_reason CHECK in 0024", () => {
    expect(REJECT_REASON_MIN_LENGTH).toBe(SQL_REJECTED_HAS_REASON_FLOOR);
  });

  it("refuses a 9-character reason", () => {
    const parsed = applicationRejectSchema.safeParse({ id: ID, review_note: "a".repeat(9) });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    expect(parsed.error.issues[0]?.path.map(String).join(".")).toBe("review_note");
  });

  it("accepts a 10-character reason", () => {
    const parsed = applicationRejectSchema.safeParse({ id: ID, review_note: "a".repeat(10) });
    expect(parsed.success).toBe(true);
  });

  it("trims BEFORE measuring, exactly as length(btrim(review_note)) does", () => {
    // Ten spaces around a two-character reason is a 22-character string and a
    // 2-character ground. SQL would refuse it; so must this, or the two disagree on
    // the only edge case anybody actually hits.
    const padded = `${" ".repeat(10)}no${" ".repeat(10)}`;
    expect(padded.length).toBeGreaterThan(REJECT_REASON_MIN_LENGTH);
    expect(applicationRejectSchema.safeParse({ id: ID, review_note: padded }).success).toBe(false);

    // And the stored value is the trimmed one, so `btrim` in SQL is a no-op rather
    // than a second, invisible transformation.
    const parsed = applicationRejectSchema.parse({ id: ID, review_note: "  a valid ground  " });
    expect(parsed.review_note).toBe("a valid ground");
  });

  it("refuses a non-uuid id and an unknown key", () => {
    expect(
      applicationRejectSchema.safeParse({ id: "nope", review_note: "a".repeat(12) }).success,
    ).toBe(false);
    expect(
      applicationRejectSchema.safeParse({ id: ID, review_note: "a".repeat(12), status: "rejected" })
        .success,
    ).toBe(false);
  });

  it("refuses a reason past the upper bound", () => {
    const parsed = applicationRejectSchema.safeParse({
      id: ID,
      review_note: "a".repeat(REJECT_REASON_MAX_LENGTH + 1),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("applicationApproveSchema", () => {
  it("takes the row and nothing else — everything is derived server-side", () => {
    const id = "44444444-4444-4444-8444-444444444444";
    expect(applicationApproveSchema.parse({ id })).toEqual({ id });
    // A client must never be able to suggest a member ID, a person or a term.
    expect(applicationApproveSchema.safeParse({ id, member_id: "2026-001" }).success).toBe(false);
    expect(applicationApproveSchema.safeParse({ id, person_id: id }).success).toBe(false);
  });
});

describe("applicationListFiltersSchema", () => {
  const TERM = "55555555-5555-4555-8555-555555555555";

  it("defaults an empty query string to the newest-first first page", () => {
    expect(parseApplicationListFilters({})).toEqual({
      status: undefined,
      term_id: undefined,
      sort: DEFAULT_APPLICATION_SORT,
      page: 1,
      per_page: DEFAULT_APPLICATIONS_PER_PAGE,
    });
  });

  it("coerces the strings a URL actually carries", () => {
    expect(
      parseApplicationListFilters({
        status: "pending",
        term_id: TERM,
        sort: "submitted_at.asc",
        page: "3",
        per_page: "50",
      }),
    ).toEqual({
      status: "pending",
      term_id: TERM,
      sort: "submitted_at.asc",
      page: 3,
      per_page: 50,
    });
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseApplicationListFilters({ status: ["approved", "rejected"] }).status).toBe(
      "approved",
    );
  });

  it("treats an empty param as absence, so ?status= is 'no filter'", () => {
    expect(parseApplicationListFilters({ status: "", term_id: "" })).toMatchObject({
      status: undefined,
      term_id: undefined,
    });
  });

  it("NEVER throws — a shared or stale link degrades to the default view", () => {
    // PRD US-I3: a filtered queue is meant to be pasted into a group chat. A link that
    // 500s when one param is stale is a link nobody shares twice.
    for (const input of [
      { status: "nonsense" },
      { term_id: "not-a-uuid" },
      { sort: "member_id.desc" },
      { page: "abc" },
      { page: "0" },
      { page: "-4" },
      { per_page: String(MAX_APPLICATIONS_PER_PAGE + 1) },
      { per_page: "0" },
      { status: { deep: true }, page: [] },
    ]) {
      expect(() => parseApplicationListFilters(input)).not.toThrow();
    }

    expect(parseApplicationListFilters({ status: "nonsense" }).status).toBeUndefined();
    expect(parseApplicationListFilters({ sort: "member_id.desc" }).sort).toBe(
      DEFAULT_APPLICATION_SORT,
    );
    expect(parseApplicationListFilters({ page: "abc" }).page).toBe(1);
    expect(
      parseApplicationListFilters({ per_page: String(MAX_APPLICATIONS_PER_PAGE + 1) }).per_page,
    ).toBe(DEFAULT_APPLICATIONS_PER_PAGE);
  });

  it("never offers `draft` as a queue filter", () => {
    // A draft is an abandoned upload holding applicant PII with the weakest retention
    // basis in the system (0020). There is no decision to take on one, so it is not a
    // view a reviewer is given.
    expect([...APPLICATION_QUEUE_STATUSES]).not.toContain("draft");
    expect(parseApplicationListFilters({ status: "draft" }).status).toBeUndefined();
  });

  it("strips params it does not own rather than rejecting the whole query", () => {
    const parsed = parseApplicationListFilters({ q: "dela cruz", page: "2" });
    expect(parsed.page).toBe(2);
    expect(parsed).not.toHaveProperty("q");
  });
});
