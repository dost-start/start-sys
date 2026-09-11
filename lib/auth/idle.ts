// ─────────────────────────────────────────────────────────────────────────────
// Idle logout (Officer feedback 2026-09-11: auto logout; project head, 2026-09-11).
// A signed-in account is logged out after an hour with no activity, with a warning one
// minute before. No absolute cap: someone working continuously stays signed in.
//
// Shared by `middleware.ts` (the enforcement) and `components/auth/idle-logout.tsx`
// (the warning), so this module imports nothing server-only. Everything here is pure.
//
// ONE cookie carries the last activity time. The browser rewrites it on input,
// middleware on every real request. The cookie is NOT a credential: forging a newer
// value only extends the forger's own session, on a browser they already control. The
// session itself is Supabase's.
// ─────────────────────────────────────────────────────────────────────────────

/** Logged out after this long with no activity. */
export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

/** The "Still there?" warning opens this long before the logout. */
export const IDLE_WARNING_MS = 60 * 1000;

/** Holds the last activity time as epoch milliseconds, in decimal. */
export const LAST_ACTIVITY_COOKIE = "start_sys_last_activity";

/**
 * 400 days: the lifetime @supabase/ssr gives the auth cookies. The activity cookie must
 * outlive the session, because a MISSING cookie counts as active (see `idleDecision`) —
 * a 24-hour cookie would let a session left idle over a weekend come back signed in.
 */
export const LAST_ACTIVITY_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/** `/login?reason=idle` shows the "logged out after 1 hour of inactivity" notice. */
export const IDLE_LOGOUT_REASON = "idle";
export const IDLE_LOGOUT_URL = `/login?reason=${IDLE_LOGOUT_REASON}`;

/** A cookie value further than this into the future is not trusted. */
const MAX_FUTURE_MS = 5 * 60 * 1000;

/**
 * Parse the cookie value. Null when it is missing, not a plain non-negative integer, or
 * more than five minutes in the future.
 */
export function parseLastActivity(
  value: string | undefined,
  now: number = Date.now(),
): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms > now + MAX_FUTURE_MS) return null;
  return ms;
}

/**
 * When this session last AUTHENTICATED, in epoch ms, read from the access token's `amr`
 * claim — one `{ method, timestamp }` entry per method used (password, otp, totp …),
 * `timestamp` in seconds. Null when the claim is absent or the token cannot be read.
 *
 * ⚠ NOT `user.last_sign_in_at`. The auth server rewrites that on EVERY refresh-token swap
 * (supabase/auth: `RefreshTokenGrant` -> `GrantRefreshTokenSwap` -> `createRefreshToken`
 * -> `UpdateLastSignInAt`), and middleware refreshes an expired access token before the
 * idle check runs. Access tokens last one hour, the same as the idle limit, so a session
 * idle for an hour would always look freshly signed in and never be logged out. `amr`
 * timestamps are written when a method is used and carried unchanged across refreshes.
 *
 * Decoding without verifying the signature is safe HERE only because middleware reads the
 * token `getUser()` has just validated with the auth server, and the answer can only END a
 * session, never grant anything.
 */
export function lastAuthenticatedAtFromAccessToken(accessToken: string): number | null {
  const payload = accessToken.split(".")[1];
  if (payload === undefined || payload === "") return null;

  let claims: unknown;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    claims = JSON.parse(atob(padded));
  } catch {
    // Not a JWT we can read: no authentication time, so the cookie alone decides.
    return null;
  }

  if (typeof claims !== "object" || claims === null || !("amr" in claims)) return null;
  if (!Array.isArray(claims.amr)) return null;

  let latest: number | null = null;
  for (const entry of claims.amr) {
    if (typeof entry !== "object" || entry === null || !("timestamp" in entry)) continue;
    const seconds = entry.timestamp;
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) continue;
    const ms = seconds * 1000;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

/**
 * The server's decision, made by `middleware.ts` on every matched request.
 *
 * - No usable cookie -> "active". Sessions that exist when this ships are not all
 *   logged out at once, and middleware sets the cookie on this same request.
 * - Otherwise the last activity is the LATER of the cookie and the session's last
 *   authentication (`lastAuthenticatedAtFromAccessToken`), so a stale cookie left from
 *   yesterday cannot end a session started with a password a minute ago.
 * - "expired" only when MORE than IDLE_TIMEOUT_MS has passed.
 */
export function idleDecision({
  cookieValue,
  lastAuthenticatedAt,
  now,
}: {
  cookieValue: string | undefined;
  /** Epoch ms from `lastAuthenticatedAtFromAccessToken`; null when unknown. */
  lastAuthenticatedAt: number | null;
  now: number;
}): "active" | "expired" {
  const cookieMs = parseLastActivity(cookieValue, now);
  if (cookieMs === null) return "active";

  const lastActivity =
    lastAuthenticatedAt !== null && Number.isFinite(lastAuthenticatedAt)
      ? Math.max(cookieMs, lastAuthenticatedAt)
      : cookieMs;

  return now - lastActivity > IDLE_TIMEOUT_MS ? "expired" : "active";
}

/**
 * The browser's reading of the same cookie: "warning" from one minute before the
 * timeout, "expired" at it. Inclusive where the server is strict — the browser acting a
 * moment early is harmless.
 */
export function idlePhase(lastActivity: number, now: number): "active" | "warning" | "expired" {
  const idleFor = now - lastActivity;
  if (idleFor >= IDLE_TIMEOUT_MS) return "expired";
  if (idleFor >= IDLE_TIMEOUT_MS - IDLE_WARNING_MS) return "warning";
  return "active";
}

/** A prefetch is not activity: a link scrolling into view must not extend a session. */
export function isPrefetchRequest(headers: Pick<Headers, "get">): boolean {
  if (headers.get("next-router-prefetch") !== null) return true;
  if (headers.get("next-router-segment-prefetch") !== null) return true;
  if ((headers.get("purpose") ?? "").includes("prefetch")) return true;
  return (headers.get("sec-purpose") ?? "").includes("prefetch");
}

/**
 * The Supabase session cookies: `sb-<project ref>-auth-token`, split into `.0`, `.1`, …
 * when large (the supabase-js default storage key, chunked by @supabase/ssr). Middleware
 * expires these on an idle logout.
 */
export function isSupabaseAuthCookieName(name: string): boolean {
  return /^sb-.+-auth-token(?:\.\d+)?$/.test(name);
}

/** Read one cookie out of a `document.cookie`-style string. */
export function readCookie(cookieString: string, name: string): string | undefined {
  for (const part of cookieString.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/** The `document.cookie` assignment for the activity cookie — the attributes middleware sets. */
export function serializeLastActivityCookie(now: number, secure: boolean): string {
  return (
    `${LAST_ACTIVITY_COOKIE}=${Math.trunc(now)}; Path=/; ` +
    `Max-Age=${LAST_ACTIVITY_COOKIE_MAX_AGE_S}; SameSite=Lax${secure ? "; Secure" : ""}`
  );
}
