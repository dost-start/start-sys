// ═══════════════════════════════════════════════════════════════════════════════
// BUILD_PLAN S7-T8's acceptance, written as assertions.
//
// The headline case is the last `describe` in this file: ONE event carrying every
// route by which PII reaches an error tracker in this system — `school_id_no` and
// `address_line` in `extra`, `applicant_email` in a nested payload, a cookie header,
// an `?email=` query string, a member ID inside an exception message — SERIALIZED,
// then asserted to contain none of the literals. Serialized, because that is the
// shape the event actually leaves the process in: an assertion on `event.extra.x`
// would pass while the same value survived somewhere else in the tree.
//
// Every literal is declared once in `DIRTY` and both halves of the test read it, so
// the fixture and the assertion cannot drift.
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";

import {
  ALLOWED_HEADERS,
  CIRCULAR_MARKER,
  EMAIL_MARKER,
  MEMBER_ID_MARKER,
  type ObservabilityEvent,
  redactPatterns,
  reducedPath,
  scrubEvent,
} from "@/lib/observability/scrub";
import { SENSITIVE_KEYS } from "@/lib/observability/sensitive-keys";

// ── The literals. One declaration, read by the fixture and by the assertions. ──

const DIRTY = {
  schoolIdNo: "2021-00457-MN-0",
  addressLine: "14 Kalayaan Extension, Barangay Pinyahan",
  applicantEmail: "juan.delacruz@student.pup.edu.ph",
  contactNumber: "+639171234567",
  birthdate: "2004-01-03",
  cookieHeader: "sb-access-token=eyJhbGciOi.PAYLOAD.SIG; sb-refresh-token=abcdef",
  queryEmail: "maria.santos@example.org",
  memberId: "2024-001",
  bigMemberId: "2024-1000",
  serviceRoleKey: "sb_secret_do_not_ship_this",
  driveFileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
} as const;

/** Serialize the way a transport would, so an assertion covers the WHOLE tree. */
function serialized(event: ObservabilityEvent): string {
  return JSON.stringify(event);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 1 — the request body and the cookies are deleted outright
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 1: request.data and request.cookies are deleted, never masked", () => {
  it("drops a whole /apply body — the single worst disclosure this module prevents", () => {
    const scrubbed = scrubEvent({
      message: "insert failed",
      request: {
        url: "/apply",
        method: "POST",
        data: {
          given_name: "Juan",
          birthdate: DIRTY.birthdate,
          contact_number: DIRTY.contactNumber,
          address_line: DIRTY.addressLine,
          school_id_no: DIRTY.schoolIdNo,
        },
      },
    });

    expect(scrubbed.request?.data).toBeUndefined();
    // Not just the sensitive fields — the non-sensitive ones go too. There is no
    // partial-body mode, because a mask that decides what to keep is a mask with a bug
    // in it waiting to happen.
    expect(serialized(scrubbed)).not.toContain("Juan");
    expect(serialized(scrubbed)).not.toContain("given_name");
  });

  it("drops cookies, which are session tokens and therefore account takeover", () => {
    const scrubbed = scrubEvent({
      request: { url: "/admin/members", cookies: DIRTY.cookieHeader },
    });

    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(serialized(scrubbed)).not.toContain("sb-access-token");
  });

  it("drops query_string as a field, not only as part of the URL", () => {
    const scrubbed = scrubEvent({
      request: { url: "/auth/reset", query_string: `email=${DIRTY.queryEmail}` },
    });

    expect(scrubbed.request?.query_string).toBeUndefined();
    expect(serialized(scrubbed)).not.toContain(DIRTY.queryEmail);
  });

  it("counts what it removed without naming it", () => {
    const scrubbed = scrubEvent({
      request: { url: "/apply", data: { a: 1 }, cookies: "x", query_string: "y" },
    });

    expect(scrubbed.scrub?.removed_keys).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 2 — the URL is reduced to a pathname
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 2: the URL keeps its pathname and loses everything else", () => {
  const cases: ReadonlyArray<{ name: string; input: string; expected: string }> = [
    {
      name: "an absolute URL loses origin, query and fragment",
      input: `https://start.example.ph/auth/reset?email=${DIRTY.queryEmail}&token=abc#f`,
      expected: "/auth/reset",
    },
    {
      name: "a relative path loses its query",
      input: "/members?q=dela+cruz&region_id=NCR",
      expected: "/members",
    },
    { name: "a bare path is unchanged", input: "/apply", expected: "/apply" },
    {
      name: "a UUID in the path SURVIVES — IDs are what this codebase logs on purpose",
      input: "/api/applications/9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f/proof",
      expected: "/api/applications/9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f/proof",
    },
    {
      name: "credentials embedded in a URL are dropped with the origin",
      input: "https://user:hunter2@start.example.ph/admin/audit",
      expected: "/admin/audit",
    },
    {
      // `new URL(x, base)` would turn this into "/not%20a%20url%20at%20all" and echo
      // arbitrary text back under a field named `url`. Requiring a leading "/" or a
      // real absolute URL is what stops that.
      name: "an unparseable value is replaced, never passed through",
      input: "not a url at all",
      expected: "«unparseable»",
    },
    {
      name: "a javascript: URL is replaced — its payload lives in the 'path'",
      input: "javascript:alert(document.cookie)",
      expected: "«unparseable»",
    },
    {
      name: "a data: URL is replaced, payload and all",
      input: "data:text/plain;base64,YnJlYWNo",
      expected: "«unparseable»",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(name, () => {
      expect(reducedPath(input)).toBe(expected);
    });
  }

  it("applies through scrubEvent, not only through the helper", () => {
    const scrubbed = scrubEvent({
      request: { url: `https://start.example.ph/auth/reset?email=${DIRTY.queryEmail}` },
    });

    expect(scrubbed.request?.url).toBe("/auth/reset");
    expect(serialized(scrubbed)).not.toContain(DIRTY.queryEmail);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 3 — headers are an allowlist
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 3: headers are an allowlist, so an unknown header is excluded by default", () => {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (iPhone)",
    accept: "text/html",
    "content-type": "application/json",
    cookie: DIRTY.cookieHeader,
    authorization: "Bearer eyJhbGciOi.PAYLOAD.SIG",
    "x-forwarded-for": "203.0.113.42",
    "x-vercel-ip-city": "Manila",
    "x-some-header-nobody-has-invented-yet": "secret",
  };

  const scrubbed = scrubEvent({ request: { url: "/apply", headers } });

  it("keeps exactly the three allowlisted headers, lowercased", () => {
    expect(Object.keys(scrubbed.request?.headers ?? {}).sort()).toEqual(
      [...ALLOWED_HEADERS].sort(),
    );
  });

  it("drops the credential headers", () => {
    const text = serialized(scrubbed);
    expect(text).not.toContain("sb-access-token");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("authorization");
  });

  it("drops the IP headers — an IP address is personal data under RA 10173", () => {
    const text = serialized(scrubbed);
    expect(text).not.toContain("203.0.113.42");
    expect(text).not.toContain("x-forwarded-for");
  });

  it("drops a header the allowlist has never heard of, which is the whole point", () => {
    expect(serialized(scrubbed)).not.toContain("x-some-header-nobody-has-invented-yet");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 4 — the user is reduced to { id }
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 4: the user is reduced to an id", () => {
  it("keeps the id and drops email, ip_address, username and anything else", () => {
    const scrubbed = scrubEvent({
      user: {
        id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
        email: DIRTY.applicantEmail,
        ip_address: "203.0.113.42",
        username: "jdelacruz",
        member_id: DIRTY.memberId,
      },
    });

    expect(scrubbed.user).toEqual({ id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f" });

    const text = serialized(scrubbed);
    expect(text).not.toContain(DIRTY.applicantEmail);
    expect(text).not.toContain("203.0.113.42");
    expect(text).not.toContain("jdelacruz");
    expect(text).not.toContain(DIRTY.memberId);
  });

  it("drops the user entirely when there is no id to keep", () => {
    const scrubbed = scrubEvent({ user: { email: DIRTY.applicantEmail } });

    expect(scrubbed.user).toBeUndefined();
    expect(serialized(scrubbed)).not.toContain(DIRTY.applicantEmail);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 5 — sensitive keys are deleted recursively
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 5: every sensitive key is deleted at every depth", () => {
  // Table-driven over the imported list, so adding a column to `sensitive-keys.ts`
  // extends this suite automatically and CANNOT be added without being covered here.
  for (const key of SENSITIVE_KEYS) {
    it(`deletes "${key}" from extra`, () => {
      const scrubbed = scrubEvent({ extra: { [key]: "SENTINEL_VALUE_9137", keep: "yes" } });

      const text = serialized(scrubbed);
      expect(text).not.toContain("SENTINEL_VALUE_9137");
      // The key NAME goes too: a list of column names in an outbound payload is a
      // description of a scholar's record.
      expect(text).not.toContain(key);
      expect(scrubbed.extra?.keep).toBe("yes");
    });
  }

  it("reaches a key nested several levels down", () => {
    const scrubbed = scrubEvent({
      extra: {
        context: { application: { id: "app-1", payload: { school_id_no: DIRTY.schoolIdNo } } },
      },
    });

    const text = serialized(scrubbed);
    expect(text).not.toContain(DIRTY.schoolIdNo);
    expect(text).not.toContain("payload");
    expect(text).toContain("app-1");
  });

  it("reaches a key inside an array of objects", () => {
    const scrubbed = scrubEvent({
      extra: { rows: [{ id: "a", address_line: DIRTY.addressLine }, { id: "b" }] },
    });

    expect(serialized(scrubbed)).not.toContain(DIRTY.addressLine);
    expect(serialized(scrubbed)).toContain('"id":"a"');
  });

  it("matches case-insensitively, because an event payload may carry either casing", () => {
    const scrubbed = scrubEvent({ extra: { School_ID_No: DIRTY.schoolIdNo } });

    expect(serialized(scrubbed)).not.toContain(DIRTY.schoolIdNo);
  });

  it("deletes sensitive keys from tags as well as from extra", () => {
    const scrubbed = scrubEvent({
      tags: { route: "/apply", personal_email: DIRTY.applicantEmail },
    });

    expect(scrubbed.tags).toEqual({ route: "/apply" });
  });

  it("strips submit_token_hash — a bearer capability over one applicant's row", () => {
    const scrubbed = scrubEvent({ extra: { submit_token_hash: "deadbeef".repeat(8) } });

    expect(serialized(scrubbed)).not.toContain("deadbeef");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 6 — patterns inside surviving strings
// ─────────────────────────────────────────────────────────────────────────────

describe("rule 6: member-ID and email patterns are replaced inside strings", () => {
  const cases: ReadonlyArray<{ name: string; input: string; contains?: string; absent?: string }> =
    [
      {
        name: "a member ID in prose",
        input: `member ${DIRTY.memberId} already exists`,
        contains: MEMBER_ID_MARKER,
        absent: DIRTY.memberId,
      },
      {
        name: "a four-digit sequence member ID (2024-1000, the 1000th of a year)",
        input: `duplicate ${DIRTY.bigMemberId}`,
        contains: MEMBER_ID_MARKER,
        absent: DIRTY.bigMemberId,
      },
      {
        name: "an email address",
        input: `no row for ${DIRTY.applicantEmail}`,
        contains: EMAIL_MARKER,
        absent: DIRTY.applicantEmail,
      },
      {
        name: "a member ID in quotes",
        input: `key "${DIRTY.memberId}" violates unique constraint`,
        contains: MEMBER_ID_MARKER,
        absent: DIRTY.memberId,
      },
    ];

  for (const { name, input, contains, absent } of cases) {
    it(`redacts ${name}`, () => {
      const output = redactPatterns(input);
      if (contains !== undefined) expect(output).toContain(contains);
      if (absent !== undefined) expect(output).not.toContain(absent);
    });
  }

  // The boundary cases. Over-redacting a UUID would delete the only debugging signal
  // this system deliberately keeps ("log IDs, never values"), so the lookarounds in
  // MEMBER_ID_PATTERN exist specifically for these two.
  it("does NOT eat a UUID, whose middle groups look like a member ID", () => {
    const uuid = "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
    expect(redactPatterns(`row ${uuid} not found`)).toContain(uuid);
  });

  it("does NOT eat a numeric UUID-shaped id either", () => {
    const numeric = "12345678-1234-5678-9012-345678901234";
    expect(redactPatterns(numeric)).toBe(numeric);
  });

  it("does NOT eat an ISO timestamp", () => {
    const stamp = "2026-09-06T02:00:00.000Z";
    expect(redactPatterns(stamp)).toBe(stamp);
  });

  it("applies to exception values and stacks, which are otherwise kept whole", () => {
    const scrubbed = scrubEvent({
      exception: [
        {
          type: "PostgrestError",
          value: `duplicate key (member_id)=(${DIRTY.memberId})`,
          stack: `at approve (/lib/x.ts) for ${DIRTY.applicantEmail}`,
        },
      ],
    });

    const text = serialized(scrubbed);
    expect(text).not.toContain(DIRTY.memberId);
    expect(text).not.toContain(DIRTY.applicantEmail);
    // The diagnostic shape survives — that is why these are redacted and not dropped.
    expect(scrubbed.exception?.[0]?.type).toBe("PostgrestError");
    expect(scrubbed.exception?.[0]?.stack).toContain("at approve (/lib/x.ts)");
  });

  it("counts the replacements it made", () => {
    const scrubbed = scrubEvent({ message: `${DIRTY.memberId} and ${DIRTY.applicantEmail}` });

    expect(scrubbed.scrub?.redacted_patterns).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Structural properties
// ─────────────────────────────────────────────────────────────────────────────

describe("the scrub is pure and total", () => {
  it("does not mutate its input — a debugger must still show the real context", () => {
    const event: ObservabilityEvent = {
      request: { url: "/apply?x=1", data: { school_id_no: DIRTY.schoolIdNo } },
      extra: { nested: { address_line: DIRTY.addressLine } },
    };
    const before = JSON.stringify(event);

    scrubEvent(event);

    expect(JSON.stringify(event)).toBe(before);
  });

  it("survives a circular reference instead of overflowing the stack", () => {
    const cyclic: Record<string, unknown> = { id: "a" };
    cyclic.self = cyclic;

    const scrubbed = scrubEvent({ extra: { cyclic } });

    expect(serialized(scrubbed)).toContain(CIRCULAR_MARKER);
  });

  it("bounds a deeply nested payload rather than walking it forever", () => {
    let deep: Record<string, unknown> = { school_id_no: DIRTY.schoolIdNo };
    for (let i = 0; i < 40; i += 1) deep = { next: deep };

    const scrubbed = scrubEvent({ extra: deep });

    expect(serialized(scrubbed)).not.toContain(DIRTY.schoolIdNo);
  });

  it("bounds an enormous array", () => {
    const scrubbed = scrubEvent({
      extra: { rows: Array.from({ length: 5_000 }, (_, i) => `row-${i}`) },
    });

    expect((scrubbed.extra?.rows as unknown[]).length).toBeLessThanOrEqual(101);
  });

  it("handles an empty event without inventing fields", () => {
    expect(scrubEvent({})).toEqual({ scrub: { v: 1, removed_keys: 0, redacted_patterns: 0 } });
  });

  it("drops functions, which are never data", () => {
    const scrubbed = scrubEvent({ extra: { fn: () => "x", keep: 1 } });

    expect(scrubbed.extra).toEqual({ keep: 1 });
  });

  it("serializes an Error found in extra rather than losing it to JSON's {}", () => {
    const scrubbed = scrubEvent({ extra: { cause: new TypeError("bad input") } });

    expect(serialized(scrubbed)).toContain("bad input");
    expect(serialized(scrubbed)).toContain("TypeError");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE S7-T8 ACCEPTANCE CASE — one event, every route in, none of the literals out
// ═════════════════════════════════════════════════════════════════════════════

describe("S7-T8 acceptance: a fully dirty event serializes with none of the literals", () => {
  const dirtyEvent: ObservabilityEvent = {
    message: `approve failed for ${DIRTY.applicantEmail} (${DIRTY.memberId})`,
    level: "error",
    exception: [
      {
        type: "PostgrestError",
        value: `duplicate key value violates unique constraint (member_id)=(${DIRTY.memberId})`,
        stack: `at approveApplication (/lib/applications/review-actions.ts:41)\n  applicant ${DIRTY.applicantEmail}`,
      },
    ],
    request: {
      url: `https://start.example.ph/apply?email=${DIRTY.queryEmail}&next=/portal`,
      method: "post",
      headers: {
        cookie: DIRTY.cookieHeader,
        authorization: "Bearer eyJhbGciOi.PAYLOAD.SIG",
        "x-forwarded-for": "203.0.113.42",
        "user-agent": "Mozilla/5.0 (iPhone)",
      },
      cookies: DIRTY.cookieHeader,
      data: {
        applicant_email: DIRTY.applicantEmail,
        payload: {
          birthdate: DIRTY.birthdate,
          contact_number: DIRTY.contactNumber,
          address_line: DIRTY.addressLine,
          school_id_no: DIRTY.schoolIdNo,
        },
      },
      query_string: `email=${DIRTY.queryEmail}`,
    },
    user: {
      id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
      email: DIRTY.applicantEmail,
      ip_address: "203.0.113.42",
    },
    extra: {
      application_id: "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9",
      school_id_no: DIRTY.schoolIdNo,
      address_line: DIRTY.addressLine,
      proof_drive_file_id: DIRTY.driveFileId,
      nested: { deep: { personal_email: DIRTY.applicantEmail } },
      note: `service key ${DIRTY.serviceRoleKey} is not here on purpose`,
    },
    tags: { route: "/apply", contact_number: DIRTY.contactNumber },
  };

  const text = serialized(scrubEvent(dirtyEvent));

  // Every literal in the fixture, asserted individually so a failure names which one
  // escaped rather than reporting "the event was dirty".
  for (const [name, literal] of Object.entries(DIRTY)) {
    if (name === "serviceRoleKey") continue; // see the note below
    it(`does not contain ${name}`, () => {
      expect(text).not.toContain(literal);
    });
  }

  it("still carries the diagnostic signal — this is not just an empty object", () => {
    expect(text).toContain("PostgrestError");
    expect(text).toContain("/apply");
    expect(text).toContain("approveApplication");
    // The one ID a call site is SUPPOSED to attach survives, which is the entire
    // reason "log IDs, never values" is a workable rule.
    expect(text).toContain("0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9");
    expect(text).toContain("9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f");
  });

  it("reports what it removed, as counts and not as names", () => {
    const report = scrubEvent(dirtyEvent).scrub;

    expect(report?.v).toBe(1);
    expect(report?.removed_keys).toBeGreaterThan(0);
    expect(report?.redacted_patterns).toBeGreaterThan(0);
    expect(text).not.toContain("school_id_no");
    expect(text).not.toContain("applicant_email");
  });

  // ⚠️ A DELIBERATE, DOCUMENTED NON-GUARANTEE. `serviceRoleKey` is excluded from the
  // loop above because a secret pasted into free text by a call site — `note: "service
  // key sb_secret_… is not here"` — SURVIVES this module. The scrub removes structured
  // paths and two pattern classes; it is not a secret scanner, and pretending otherwise
  // would be the more dangerous claim. The controls that actually cover this case are
  // upstream: `no-console` under lib/**, "log IDs, never values" (CLAUDE.md), the
  // service-role import restriction in eslint.config.mjs, and the client-bundle audit
  // (S7-T10). Asserted here so the boundary is a tested fact rather than a surprise.
  it("does NOT claim to strip a secret pasted into free text — see the note above", () => {
    expect(text).toContain(DIRTY.serviceRoleKey);
  });
});
