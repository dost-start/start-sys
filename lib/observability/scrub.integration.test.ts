// ═══════════════════════════════════════════════════════════════════════════════
// BUILD_PLAN S7-T9, ADAPTED — the scrub proved against the REAL PIPELINE.
//
// ── WHY THIS FILE IS NOT A SECOND COPY OF `scrub.test.ts` ────────────────────
// A unit test on a pure function proves the function. It proves nothing about whether
// the function is WIRED IN. `beforeSend` being configured on the wrong client, an
// early-return that skips it, a second code path that posts directly — every one of
// those leaves `scrub.test.ts` green while shipping an applicant's address to a third
// party. S7-T9 exists to close that gap, and its instruction is to build a real client
// from the exact options the config exports, install a capturing transport, and assert
// on the envelope.
//
// ── THE ADAPTATION, AND WHY IT IS FAITHFUL ───────────────────────────────────
// There is no Sentry SDK to construct a client from (ADR 0008 — deferred; the scrub
// ships, the vendor does not). The "real client" here is therefore the pipeline that
// actually exists and that every call site uses: `reportError` in `instrumentation.ts`.
// The property S7-T9 is really asserting is unchanged and is asserted here in full:
// **an event that leaves this process has been through `scrubEvent`, and there is no
// path by which one could not have been.**
//
// ── THE ENCODED RED (S7-T9's "assert the red — bypassing scrub fails") ───────
// A clean-envelope assertion is worthless if the fixture was never dirty. So this file
// keeps a NEGATIVE FIXTURE ASSERTION: `buildEvent` — the exported, deliberately
// unscrubbed half of the pipeline — is fed the SAME input and asserted to CONTAIN
// every PII literal. That is the red state, permanent and automated, rather than a
// one-time manual check somebody did in September 2026:
//
//   · If a future edit made `buildEvent` scrub, the negative assertions fail.
//   · If a future edit made `deliver` skip the scrub, the positive assertions fail.
//   · Neither can be satisfied by weakening the fixture, because both halves read
//     the SAME `DIRTY` constants.
// ═══════════════════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEvent,
  onRequestError,
  parseDsn,
  register,
  reportError,
  setObservabilityTransport,
} from "@/instrumentation";
import type { ObservabilityEvent } from "@/lib/observability/scrub";

// ── The dirty fixture. One declaration; both halves of the test read it. ─────

const DIRTY = {
  applicantEmail: "juan.delacruz@student.pup.edu.ph",
  schoolIdNo: "2021-00457-MN-0",
  addressLine: "14 Kalayaan Extension, Barangay Pinyahan",
  contactNumber: "+639171234567",
  cookieHeader: "sb-access-token=eyJhbGciOi.PAYLOAD.SIG",
  memberId: "2024-001",
  ipAddress: "203.0.113.42",
  driveFileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
} as const;

/** The id a call site is SUPPOSED to attach. It must survive; that is the point. */
const APPLICATION_ID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";

/** The error and context a real failure inside `finalizeApplication` would produce. */
function dirtyInput(): [Error, Parameters<typeof reportError>[1]] {
  const error = new Error(
    `insert into applications failed for ${DIRTY.applicantEmail} (member ${DIRTY.memberId})`,
  );
  error.stack = `Error: ${error.message}\n    at finalizeApplication (/lib/applications/actions.ts:212)`;

  return [
    error,
    {
      request: {
        url: `https://start.example.ph/apply?email=${DIRTY.applicantEmail}`,
        method: "POST",
        headers: {
          cookie: DIRTY.cookieHeader,
          "x-forwarded-for": DIRTY.ipAddress,
          "user-agent": "Mozilla/5.0 (iPhone)",
        },
        cookies: DIRTY.cookieHeader,
        data: {
          applicant_email: DIRTY.applicantEmail,
          payload: {
            address_line: DIRTY.addressLine,
            school_id_no: DIRTY.schoolIdNo,
            contact_number: DIRTY.contactNumber,
          },
        },
      },
      user: { id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f", email: DIRTY.applicantEmail },
      extra: {
        application_id: APPLICATION_ID,
        proof_drive_file_id: DIRTY.driveFileId,
        nested: { deep: { personal_email: DIRTY.applicantEmail } },
      },
      tags: { route: "/apply", contact_number: DIRTY.contactNumber },
    },
  ];
}

// ── A capturing transport, installed for every case that needs one ───────────

let captured: ObservabilityEvent[] = [];

beforeEach(() => {
  captured = [];
  setObservabilityTransport((event) => {
    captured.push(event);
  });
});

afterEach(() => {
  setObservabilityTransport(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Serialize the way a transport would — an assertion must cover the whole tree. */
function envelope(): string {
  expect(captured).toHaveLength(1);
  return JSON.stringify(captured[0]);
}

// ═════════════════════════════════════════════════════════════════════════════
// THE NEGATIVE FIXTURE — proof that the clean assertions below are not vacuous
// ═════════════════════════════════════════════════════════════════════════════

describe("the fixture really is dirty (the encoded red)", () => {
  // `buildEvent` is the unscrubbed half of the pipeline. If these assertions ever
  // fail, the fixture stopped carrying PII and every "clean envelope" assertion in
  // this file silently became a tautology.
  const [error, context] = dirtyInput();
  const raw = JSON.stringify(buildEvent(error, context));

  for (const [name, literal] of Object.entries(DIRTY)) {
    it(`buildEvent's UNSCRUBBED event contains ${name}`, () => {
      expect(raw).toContain(literal);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// THE POSITIVE — what the pipeline actually hands to a transport
// ═════════════════════════════════════════════════════════════════════════════

describe("reportError delivers an envelope that has been through the scrub", () => {
  it("delivers exactly one event", async () => {
    const [error, context] = dirtyInput();
    await reportError(error, context);

    expect(captured).toHaveLength(1);
  });

  // The same literals, in the same order, against the delivered envelope. A failure
  // names which one escaped rather than reporting "the envelope was dirty".
  for (const [name, literal] of Object.entries(DIRTY)) {
    it(`the delivered envelope does NOT contain ${name}`, async () => {
      const [error, context] = dirtyInput();
      await reportError(error, context);

      expect(envelope()).not.toContain(literal);
    });
  }

  it("carries the scrub's own report, which only scrubEvent can add", async () => {
    const [error, context] = dirtyInput();
    await reportError(error, context);

    // This is the structural proof: `scrub` is written by `scrubEvent` and by nothing
    // else, so an envelope carrying it cannot have taken a path around the scrub.
    expect(captured[0]?.scrub?.v).toBe(1);
    expect(captured[0]?.scrub?.removed_keys).toBeGreaterThan(0);
  });

  it("still carries the signal an on-call officer needs", async () => {
    const [error, context] = dirtyInput();
    await reportError(error, context);

    const text = envelope();
    expect(text).toContain("finalizeApplication");
    expect(text).toContain("/apply");
    // The one identifier a call site is supposed to attach.
    expect(text).toContain(APPLICATION_ID);
    expect(text).toContain("9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f");
  });

  it("reduces the user to an id and the request to a pathname", async () => {
    const [error, context] = dirtyInput();
    await reportError(error, context);

    expect(captured[0]?.user).toEqual({ id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f" });
    expect(captured[0]?.request?.url).toBe("/apply");
    expect(captured[0]?.request?.data).toBeUndefined();
    expect(captured[0]?.request?.cookies).toBeUndefined();
    expect(Object.keys(captured[0]?.request?.headers ?? {})).toEqual(["user-agent"]);
  });

  it("scrubs a bare error with no context at all", async () => {
    await reportError(new Error(`no row for ${DIRTY.applicantEmail}`));

    expect(envelope()).not.toContain(DIRTY.applicantEmail);
  });

  it("scrubs a thrown non-Error without crashing on it", async () => {
    await reportError({ code: "23505", detail: `Key (member_id)=(${DIRTY.memberId}) exists` });

    // The thrown value is not an Error, so there is no message to keep — but the
    // pipeline must still deliver something rather than throwing on the way.
    expect(captured).toHaveLength(1);
    expect(envelope()).not.toContain(DIRTY.memberId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `onRequestError` — the hook Next calls for an UNHANDLED throw
// ═════════════════════════════════════════════════════════════════════════════

describe("onRequestError routes an unhandled throw through the same scrub", () => {
  it("does not let an unhandled error take a shortcut past the scrub", async () => {
    await onRequestError(new Error(`render failed for ${DIRTY.applicantEmail}`), {
      path: `/admin/members?q=${DIRTY.applicantEmail}`,
      method: "GET",
      headers: { cookie: DIRTY.cookieHeader, "user-agent": "Mozilla/5.0" },
    });

    const text = envelope();
    expect(text).not.toContain(DIRTY.applicantEmail);
    expect(text).not.toContain(DIRTY.cookieHeader);
    expect(captured[0]?.request?.url).toBe("/admin/members");
    expect(captured[0]?.scrub?.v).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Reporting must never break the request it is reporting on
// ═════════════════════════════════════════════════════════════════════════════

describe("reportError is total", () => {
  it("swallows a transport that throws — telemetry must not manufacture an outage", async () => {
    setObservabilityTransport(() => {
      throw new Error("tracker unreachable");
    });

    await expect(reportError(new Error("original failure"))).resolves.toBeUndefined();
  });

  it("swallows a transport that rejects", async () => {
    setObservabilityTransport(() => Promise.reject(new Error("network down")));

    await expect(reportError(new Error("original failure"))).resolves.toBeUndefined();
  });

  it("survives a circular object in extra", async () => {
    const cyclic: Record<string, unknown> = { id: "a" };
    cyclic.self = cyclic;

    await expect(reportError(new Error("x"), { extra: { cyclic } })).resolves.toBeUndefined();
    expect(captured).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The default transport — dormant until a DSN exists (ADR 0008)
// ═════════════════════════════════════════════════════════════════════════════

describe("the default transport", () => {
  it("sends NOTHING and stores nothing when SENTRY_DSN is unset", async () => {
    setObservabilityTransport(null);
    vi.stubEnv("SENTRY_DSN", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await reportError(new Error(`no row for ${DIRTY.applicantEmail}`));

    // No network call, and no buffer either: an in-memory queue of unsent error events
    // would be a PII store with no retention basis.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a scrubbed envelope when a DSN IS set", async () => {
    setObservabilityTransport(null);
    vi.stubEnv("SENTRY_DSN", "https://abc123@o1.ingest.example.com/42");
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);

    const [error, context] = dirtyInput();
    await reportError(error, context);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe("https://o1.ingest.example.com/api/42/envelope/");
    // The body that would actually cross the wire, asserted for the literals. This is
    // the closest this file gets to S7-T9's "real client" and it is the assertion that
    // matters most: what a third party would receive.
    expect(String(init.body)).not.toContain(DIRTY.applicantEmail);
    expect(String(init.body)).not.toContain(DIRTY.schoolIdNo);
    expect(String(init.body)).toContain('"type":"event"');
  });

  it("swallows a fetch that rejects", async () => {
    setObservabilityTransport(null);
    vi.stubEnv("SENTRY_DSN", "https://abc123@o1.ingest.example.com/42");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("DNS failure"))),
    );

    await expect(reportError(new Error("x"))).resolves.toBeUndefined();
  });

  it("disables itself on a malformed DSN rather than throwing into a request", async () => {
    setObservabilityTransport(null);
    vi.stubEnv("SENTRY_DSN", "not-a-dsn");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(reportError(new Error("x"))).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("parseDsn", () => {
  it("derives the envelope endpoint and the public key", () => {
    expect(parseDsn("https://abc123@o1.ingest.example.com/42")).toEqual({
      endpoint: "https://o1.ingest.example.com/api/42/envelope/",
      publicKey: "abc123",
    });
  });

  const rejected = ["not-a-dsn", "https://o1.ingest.example.com/42", "https://abc123@host/", ""];

  for (const dsn of rejected) {
    it(`returns null for ${JSON.stringify(dsn)}`, () => {
      expect(parseDsn(dsn)).toBeNull();
    });
  }
});

describe("register", () => {
  it("is a safe no-op — anything that throws here fails the whole server boot", async () => {
    await expect(register()).resolves.toBeUndefined();
  });
});
