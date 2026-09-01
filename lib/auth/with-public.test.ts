// ─────────────────────────────────────────────────────────────────────────────
// BUILD_PLAN S3-T14. Two assertions carry this file:
//
//   1. A rate-limit refusal and a validation failure produce the SAME code and the
//      SAME message. A distinct rate-limit code would tell a prober that their earlier
//      requests registered — the confirmation the whole anti-enumeration design exists
//      to deny (0008's absent anon SELECT policy, 0019's silent unknown-id return).
//
//   2. The IP-keyed bucket runs BEFORE the body is parsed and the inner function is
//      never invoked on a refusal — asserted by a spy call count of 0, not by the
//      returned value. A guard that runs after the side effect passes a
//      returns-an-error test and still mints a Drive session URI for every attempt.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimit = vi.fn();
const headersGet = vi.fn();
const createServerSupabase = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (args: unknown) => checkRateLimit(args),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => headersGet(name) }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: () => createServerSupabase(),
}));

const { withPublic } = await import("@/lib/auth/with-public");

/** A minimal zod-shaped parser: accepts `{ email: string }`, rejects everything else. */
const emailSchema = {
  safeParse(input: unknown) {
    if (
      typeof input === "object" &&
      input !== null &&
      typeof (input as { email?: unknown }).email === "string"
    ) {
      return { success: true as const, data: { email: (input as { email: string }).email } };
    }
    return {
      success: false as const,
      error: { issues: [{ path: ["email"], message: "Email is required" }] },
    };
  },
};

const FAKE_CLIENT = { rpc: vi.fn() };

beforeEach(() => {
  checkRateLimit.mockReset().mockResolvedValue(true);
  headersGet
    .mockReset()
    .mockImplementation((name: string) =>
      name === "x-forwarded-for" ? "203.0.113.9, 70.41.3.18" : null,
    );
  createServerSupabase.mockReset().mockResolvedValue(FAKE_CLIENT);
});

describe("withPublic runs the action", () => {
  it("parses, then calls the inner function with the parsed body and a context", async () => {
    const inner = vi.fn().mockResolvedValue({ ok: true, data: "done" });
    const action = withPublic({ rateLimit: null, schema: emailSchema }, inner);

    const result = await action({ email: "a@b.ph" });

    expect(result).toEqual({ ok: true, data: "done" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner.mock.calls[0]?.[1]).toEqual({ email: "a@b.ph" });
    expect(inner.mock.calls[0]?.[0]).toMatchObject({ supabase: FAKE_CLIENT, ip: "203.0.113.9" });
  });

  it("takes the FIRST hop of x-forwarded-for — the last hop is Vercel's edge", async () => {
    // Keying on the last hop would put every applicant in one bucket and turn the
    // limiter into an outage during application week.
    const inner = vi.fn().mockResolvedValue({ ok: true, data: null });
    const action = withPublic(
      { rateLimit: { bucket: "apply_ip", limit: 10 }, schema: emailSchema },
      inner,
    );

    await action({ email: "a@b.ph" });

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit.mock.calls[0]?.[0]).toMatchObject({ key: "203.0.113.9" });
  });

  it("falls back to x-real-ip, then to a shared bucket, rather than failing", async () => {
    headersGet.mockImplementation((name: string) => (name === "x-real-ip" ? "198.51.100.4" : null));
    const inner = vi.fn().mockResolvedValue({ ok: true, data: null });
    await withPublic(
      { rateLimit: { bucket: "b", limit: 1 }, schema: emailSchema },
      inner,
    )({
      email: "a@b.ph",
    });
    expect(checkRateLimit.mock.calls[0]?.[0]).toMatchObject({ key: "198.51.100.4" });

    headersGet.mockImplementation(() => null);
    checkRateLimit.mockClear();
    await withPublic(
      { rateLimit: { bucket: "b", limit: 1 }, schema: emailSchema },
      inner,
    )({
      email: "a@b.ph",
    });
    expect(checkRateLimit.mock.calls[0]?.[0]).toMatchObject({ key: "unknown" });
  });
});

describe("withPublic refuses", () => {
  it("returns field errors on a validation failure, keyed for setError", async () => {
    const inner = vi.fn();
    const action = withPublic({ rateLimit: null, schema: emailSchema }, inner);

    const result = await action({ nope: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("validation");
    expect(result.error.fields).toEqual({ email: ["Email is required"] });
    expect(inner).toHaveBeenCalledTimes(0);
  });

  it("refuses a throttled caller WITHOUT parsing and WITHOUT invoking the action", async () => {
    checkRateLimit.mockResolvedValue(false);
    const inner = vi.fn();
    const parse = vi.spyOn(emailSchema, "safeParse");
    const action = withPublic(
      { rateLimit: { bucket: "apply_ip", limit: 10 }, schema: emailSchema },
      inner,
    );

    const result = await action({ email: "a@b.ph" });

    expect(result.ok).toBe(false);
    // The load-bearing pair: nothing was parsed, and nothing was run.
    expect(parse).toHaveBeenCalledTimes(0);
    expect(inner).toHaveBeenCalledTimes(0);
    parse.mockRestore();
  });

  it("gives a throttled caller the IDENTICAL code and message a bad body gets", async () => {
    // If these two ever diverge, the limiter has become an oracle. See the header.
    const inner = vi.fn();
    const action = withPublic(
      { rateLimit: { bucket: "apply_ip", limit: 10 }, schema: emailSchema },
      inner,
    );

    const invalid = await action({ nope: 1 });

    checkRateLimit.mockResolvedValue(false);
    const throttled = await action({ email: "a@b.ph" });

    expect(invalid.ok).toBe(false);
    expect(throttled.ok).toBe(false);
    if (invalid.ok || throttled.ok) throw new Error("unreachable");
    expect(throttled.error.code).toBe(invalid.error.code);
    expect(throttled.error.message).toBe(invalid.error.message);
  });
});

describe("input-keyed buckets", () => {
  it("run AFTER parsing, keyed on a field, and never see a raw body", async () => {
    const inner = vi.fn().mockResolvedValue({ ok: true, data: null });
    const action = withPublic(
      {
        rateLimit: [
          { bucket: "apply_ip", limit: 10 },
          { bucket: "apply_email", limit: 3, key: (input) => input.email.toLowerCase() },
        ],
        schema: emailSchema,
      },
      inner,
    );

    await action({ email: "Maria@Example.PH" });

    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    expect(checkRateLimit.mock.calls[0]?.[0]).toMatchObject({
      bucket: "apply_ip",
      key: "203.0.113.9",
    });
    expect(checkRateLimit.mock.calls[1]?.[0]).toMatchObject({
      bucket: "apply_email",
      key: "maria@example.ph",
      limit: 3,
    });
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("refuses on the email bucket with the same generic failure, action not invoked", async () => {
    checkRateLimit.mockImplementation((args: { bucket: string }) =>
      Promise.resolve(args.bucket !== "apply_email"),
    );
    const inner = vi.fn();
    const action = withPublic(
      {
        rateLimit: [
          { bucket: "apply_ip", limit: 10 },
          { bucket: "apply_email", limit: 3, key: (input) => input.email },
        ],
        schema: emailSchema,
      },
      inner,
    );

    const result = await action({ email: "a@b.ph" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("validation");
    expect(inner).toHaveBeenCalledTimes(0);
  });

  it("skips a bucket whose key resolves to null rather than bucketing everyone together", async () => {
    const inner = vi.fn().mockResolvedValue({ ok: true, data: null });
    const action = withPublic(
      { rateLimit: { bucket: "apply_email", limit: 3, key: () => null }, schema: emailSchema },
      inner,
    );

    await action({ email: "a@b.ph" });

    expect(checkRateLimit).toHaveBeenCalledTimes(0);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
