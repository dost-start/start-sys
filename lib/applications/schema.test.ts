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
  applicationSubmitSchema,
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
