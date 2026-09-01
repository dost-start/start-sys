// ─────────────────────────────────────────────────────────────────────────────
// BUILD_PLAN S3-T7's named acceptance: "the unit test asserts NO RAW IP STRING appears
// in the value passed to the RPC."
//
// That is the assertion that matters here. A rate limiter that works perfectly while
// writing raw client IPs into a table has created a new category of personal data on
// the one surface a stranger can reach (RA 10173; CBL Art. VIII §6). The test does not
// inspect the implementation — it inspects the serialized argument object, which is
// what actually crosses the wire.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkRateLimit, hmacKey } from "@/lib/rate-limit";

const RAW_IP = "203.0.113.9";
const RAW_EMAIL = "maria.delacruz@example.edu.ph";

type RpcSpy = ReturnType<typeof vi.fn>;

/** A Supabase client stub exposing only `rpc`, which is all this module uses. */
function clientReturning(result: { data: unknown; error: unknown }): {
  supabase: Parameters<typeof checkRateLimit>[0]["supabase"];
  rpc: RpcSpy;
} {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    // The stub is intentionally partial: widening it would test the stub, not the code.
    supabase: { rpc } as unknown as Parameters<typeof checkRateLimit>[0]["supabase"],
    rpc,
  };
}

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_HMAC_KEY", "test-hmac-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("no raw subject reaches the database", () => {
  it("sends a digest, not the IP address — asserted on the serialized RPC payload", async () => {
    const { supabase, rpc } = clientReturning({ data: true, error: null });

    await checkRateLimit({ supabase, bucket: "apply_ip", key: RAW_IP, limit: 10 });

    expect(rpc).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(rpc.mock.calls[0]);
    // THE assertion. Not "the hash is correct" — "the raw value is nowhere in the call".
    expect(serialized).not.toContain(RAW_IP);
    expect(serialized).toContain(hmacKey(RAW_IP));
  });

  it("sends a digest, not the email address", async () => {
    const { supabase, rpc } = clientReturning({ data: true, error: null });

    await checkRateLimit({ supabase, bucket: "apply_email", key: RAW_EMAIL, limit: 3 });

    const serialized = JSON.stringify(rpc.mock.calls[0]);
    expect(serialized).not.toContain(RAW_EMAIL);
    expect(serialized).not.toContain("example.edu.ph");
  });

  it("passes the bucket, limit and window through unchanged", async () => {
    const { supabase, rpc } = clientReturning({ data: true, error: null });

    await checkRateLimit({ supabase, bucket: "apply_ip", key: RAW_IP, limit: 10 });

    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_bucket: "apply_ip",
      p_key_hash: hmacKey(RAW_IP),
      p_limit: 10,
      p_window: "1 hour",
    });
  });
});

describe("hmacKey", () => {
  it("is deterministic for one key and different across keys", () => {
    const a = hmacKey(RAW_IP);
    expect(hmacKey(RAW_IP)).toBe(a);

    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "a-different-key");
    expect(hmacKey(RAW_IP)).not.toBe(a);
  });

  it("distinguishes two subjects, so one visitor's limit is not another's", () => {
    expect(hmacKey("203.0.113.9")).not.toBe(hmacKey("203.0.113.10"));
  });

  it("falls back to the dev pepper outside production rather than taking /apply down", () => {
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(() => hmacKey(RAW_IP)).not.toThrow();
    expect(hmacKey(RAW_IP)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("THROWS in production when the key is absent — a guessable digest is reversible", () => {
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => hmacKey(RAW_IP)).toThrow(/RATE_LIMIT_HMAC_KEY/);
  });
});

describe("the allow/deny decision", () => {
  it("allows while the RPC says true and refuses when it says false", async () => {
    const allowed = clientReturning({ data: true, error: null });
    await expect(
      checkRateLimit({ supabase: allowed.supabase, bucket: "b", key: RAW_IP, limit: 1 }),
    ).resolves.toBe(true);

    const refused = clientReturning({ data: false, error: null });
    await expect(
      checkRateLimit({ supabase: refused.supabase, bucket: "b", key: RAW_IP, limit: 1 }),
    ).resolves.toBe(false);
  });

  it("fails OPEN when the RPC itself errors — the limiter must not take /apply down", async () => {
    // Deliberate: the limiter is defence in depth over the anon INSERT policy and the
    // application window, which are the real boundary. A database problem here shows
    // up in Sentry, not as a public form that refuses every applicant.
    const broken = clientReturning({ data: null, error: { code: "57014" } });
    await expect(
      checkRateLimit({ supabase: broken.supabase, bucket: "b", key: RAW_IP, limit: 1 }),
    ).resolves.toBe(true);
  });
});
