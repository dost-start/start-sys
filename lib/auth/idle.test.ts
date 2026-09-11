// The idle-logout rules (Officer feedback 2026-09-11: auto logout). `idleDecision`
// carries the cases the requirement names; the rest pin the helpers middleware and the
// browser share, so the two halves cannot drift apart.
import { describe, expect, it } from "vitest";

import {
  IDLE_LOGOUT_URL,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  idleDecision,
  idlePhase,
  isPrefetchRequest,
  isSupabaseAuthCookieName,
  LAST_ACTIVITY_COOKIE,
  LAST_ACTIVITY_COOKIE_MAX_AGE_S,
  lastAuthenticatedAtFromAccessToken,
  parseLastActivity,
  readCookie,
  serializeLastActivityCookie,
} from "@/lib/auth/idle";

const NOW = Date.parse("2026-09-11T08:00:00.000Z");
const MINUTE = 60 * 1000;
const seconds = (ms: number) => Math.floor(ms / 1000);

/** A JWT-shaped string whose payload is `claims`, base64url with no padding. The signature is never read. */
const tokenWith = (claims: unknown) =>
  `header.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.signature`;

describe("constants", () => {
  it("logs out after one hour and warns one minute before", () => {
    expect(IDLE_TIMEOUT_MS).toBe(3_600_000);
    expect(IDLE_WARNING_MS).toBe(60_000);
    expect(IDLE_LOGOUT_URL).toBe("/login?reason=idle");
  });
});

describe("parseLastActivity", () => {
  it("returns null when the cookie is missing", () => {
    expect(parseLastActivity(undefined, NOW)).toBeNull();
  });

  it.each(["", "abc", "-5", "12.5", "1e12", " 123", "0x10"])("returns null for %j", (value) => {
    expect(parseLastActivity(value, NOW)).toBeNull();
  });

  it("returns null more than five minutes in the future, and accepts up to five", () => {
    expect(parseLastActivity(String(NOW + 5 * MINUTE + 1), NOW)).toBeNull();
    expect(parseLastActivity(String(NOW + 5 * MINUTE), NOW)).toBe(NOW + 5 * MINUTE);
  });

  it("parses a past time", () => {
    expect(parseLastActivity(String(NOW - 10 * MINUTE), NOW)).toBe(NOW - 10 * MINUTE);
  });
});

describe("lastAuthenticatedAtFromAccessToken", () => {
  it("reads the password sign-in time from amr, in epoch ms", () => {
    const at = NOW - 10 * MINUTE;
    const token = tokenWith({ amr: [{ method: "password", timestamp: seconds(at) }] });
    expect(lastAuthenticatedAtFromAccessToken(token)).toBe(seconds(at) * 1000);
  });

  it("takes the latest method — a TOTP verified after the password", () => {
    const token = tokenWith({
      amr: [
        { method: "totp", timestamp: seconds(NOW - 2 * MINUTE) },
        { method: "password", timestamp: seconds(NOW - 3 * MINUTE) },
      ],
    });
    expect(lastAuthenticatedAtFromAccessToken(token)).toBe(seconds(NOW - 2 * MINUTE) * 1000);
  });

  it("ignores iat and exp — a refreshed token is not a fresh sign-in", () => {
    const signedIn = NOW - 3 * 60 * MINUTE;
    const token = tokenWith({
      iat: seconds(NOW),
      exp: seconds(NOW + 60 * MINUTE),
      amr: [{ method: "password", timestamp: seconds(signedIn) }],
    });
    expect(lastAuthenticatedAtFromAccessToken(token)).toBe(seconds(signedIn) * 1000);
  });

  it("still reads amr when another claim holds non-ASCII text", () => {
    const token = tokenWith({
      user_metadata: { given_name: "Peña" },
      amr: [{ method: "password", timestamp: seconds(NOW) }],
    });
    expect(lastAuthenticatedAtFromAccessToken(token)).toBe(seconds(NOW) * 1000);
  });

  it.each([
    ["no amr claim", tokenWith({ sub: "someone" })],
    ["amr as plain strings", tokenWith({ amr: ["password"] })],
    ["a non-numeric timestamp", tokenWith({ amr: [{ method: "password", timestamp: "soon" }] })],
    ["not a JWT", "not-a-token"],
    ["an empty payload", "header..signature"],
    ["a payload that is not base64 JSON", "header.@@@.signature"],
  ])("returns null for %s", (_label, token) => {
    expect(lastAuthenticatedAtFromAccessToken(token)).toBeNull();
  });
});

describe("idleDecision", () => {
  const authenticatedHoursAgo = NOW - 3 * 60 * MINUTE;

  it("missing cookie -> active (sessions that exist when this ships are not logged out)", () => {
    expect(
      idleDecision({
        cookieValue: undefined,
        lastAuthenticatedAt: authenticatedHoursAgo,
        now: NOW,
      }),
    ).toBe("active");
  });

  it("garbage cookie -> active", () => {
    expect(
      idleDecision({
        cookieValue: "not-a-time",
        lastAuthenticatedAt: authenticatedHoursAgo,
        now: NOW,
      }),
    ).toBe("active");
  });

  it("future cookie -> active", () => {
    expect(
      idleDecision({
        cookieValue: String(NOW + 10 * MINUTE),
        lastAuthenticatedAt: authenticatedHoursAgo,
        now: NOW,
      }),
    ).toBe("active");
  });

  it("fresh cookie -> active", () => {
    expect(
      idleDecision({
        cookieValue: String(NOW - MINUTE),
        lastAuthenticatedAt: authenticatedHoursAgo,
        now: NOW,
      }),
    ).toBe("active");
  });

  it("cookie 61 minutes old -> expired", () => {
    expect(
      idleDecision({
        cookieValue: String(NOW - 61 * MINUTE),
        lastAuthenticatedAt: authenticatedHoursAgo,
        now: NOW,
      }),
    ).toBe("expired");
  });

  it("stale cookie, but signed in with a password 1 minute ago -> active", () => {
    expect(
      idleDecision({
        cookieValue: String(NOW - 24 * 60 * MINUTE),
        lastAuthenticatedAt: NOW - MINUTE,
        now: NOW,
      }),
    ).toBe("active");
  });

  it("exactly 60 minutes idle -> active; one millisecond more -> expired", () => {
    expect(
      idleDecision({
        cookieValue: String(NOW - IDLE_TIMEOUT_MS),
        lastAuthenticatedAt: authenticatedHoursAgo,
        now: NOW,
      }),
    ).toBe("active");
    expect(
      idleDecision({
        cookieValue: String(NOW - IDLE_TIMEOUT_MS - 1),
        lastAuthenticatedAt: authenticatedHoursAgo,
        now: NOW,
      }),
    ).toBe("expired");
  });

  it.each([null, Number.NaN])(
    "a last authentication of %j does not rescue a stale cookie",
    (lastAuthenticatedAt) => {
      expect(
        idleDecision({ cookieValue: String(NOW - 61 * MINUTE), lastAuthenticatedAt, now: NOW }),
      ).toBe("expired");
    },
  );

  it("an hour idle stays expired after a token refresh — only amr counts, never iat", () => {
    const refreshedJustNow = tokenWith({
      iat: seconds(NOW),
      amr: [{ method: "password", timestamp: seconds(authenticatedHoursAgo) }],
    });
    expect(
      idleDecision({
        cookieValue: String(NOW - 61 * MINUTE),
        lastAuthenticatedAt: lastAuthenticatedAtFromAccessToken(refreshedJustNow),
        now: NOW,
      }),
    ).toBe("expired");
  });
});

describe("idlePhase (the browser's reading)", () => {
  it("is active before the last minute", () => {
    expect(idlePhase(NOW - 58 * MINUTE, NOW)).toBe("active");
  });

  it("warns from one minute before the timeout", () => {
    expect(idlePhase(NOW - (IDLE_TIMEOUT_MS - IDLE_WARNING_MS), NOW)).toBe("warning");
    expect(idlePhase(NOW - IDLE_TIMEOUT_MS + 1, NOW)).toBe("warning");
  });

  it("expires at the timeout", () => {
    expect(idlePhase(NOW - IDLE_TIMEOUT_MS, NOW)).toBe("expired");
  });
});

describe("isPrefetchRequest", () => {
  it.each([
    ["next-router-prefetch", "1"],
    ["next-router-segment-prefetch", "/_tree"],
    ["purpose", "prefetch"],
    ["sec-purpose", "prefetch;prerender"],
  ])("treats %s: %s as a prefetch", (name, value) => {
    expect(isPrefetchRequest(new Headers({ [name]: value }))).toBe(true);
  });

  it("treats a navigation or a Server Action call as activity", () => {
    expect(isPrefetchRequest(new Headers({ rsc: "1" }))).toBe(false);
    expect(isPrefetchRequest(new Headers({ "next-action": "abc" }))).toBe(false);
    expect(isPrefetchRequest(new Headers())).toBe(false);
  });
});

describe("isSupabaseAuthCookieName", () => {
  it.each([
    "sb-abcdefghijklmnop-auth-token",
    "sb-abcdefghijklmnop-auth-token.0",
    "sb-127-auth-token.12",
  ])("matches %s", (name) => {
    expect(isSupabaseAuthCookieName(name)).toBe(true);
  });

  it.each([LAST_ACTIVITY_COOKIE, "sb-auth-token", "other-auth-token", "sb-x-auth-token.a"])(
    "does not match %s",
    (name) => {
      expect(isSupabaseAuthCookieName(name)).toBe(false);
    },
  );
});

describe("cookie helpers", () => {
  it("reads one cookie out of document.cookie", () => {
    const jar = `sb-x-auth-token.0=abc; ${LAST_ACTIVITY_COOKIE}=${NOW}; other=1`;
    expect(readCookie(jar, LAST_ACTIVITY_COOKIE)).toBe(String(NOW));
    expect(readCookie(jar, "missing")).toBeUndefined();
    expect(readCookie("", LAST_ACTIVITY_COOKIE)).toBeUndefined();
  });

  it("serializes with the attributes middleware sets", () => {
    expect(serializeLastActivityCookie(NOW, true)).toBe(
      `${LAST_ACTIVITY_COOKIE}=${NOW}; Path=/; Max-Age=${LAST_ACTIVITY_COOKIE_MAX_AGE_S}; SameSite=Lax; Secure`,
    );
    expect(serializeLastActivityCookie(NOW, false)).not.toContain("Secure");
  });

  it("round-trips through parseLastActivity", () => {
    const written = serializeLastActivityCookie(NOW, false).split(";")[0] ?? "";
    expect(parseLastActivity(readCookie(written, LAST_ACTIVITY_COOKIE), NOW)).toBe(NOW);
  });
});
