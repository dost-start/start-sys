// ─────────────────────────────────────────────────────────────────────────────
// The TypeScript half of the rate limiter. The other half is `check_rate_limit()` in
// `0018_apply_rate_limits.sql` — a fixed-window counter in a table, because
// ARCHITECTURE.md §5 requires IP + email limiting on `/apply` and `/login` while
// ARCHITECTURE.md §7 and CLAUDE.md ban Redis, Upstash, BullMQ, Inngest and QStash.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS MODULE EXISTS AT ALL: THE KEY IS HASHED BEFORE IT LEAVES THE PROCESS.
// ═══════════════════════════════════════════════════════════════════════════════
// A rate limiter's natural key is an IP address or an email. Both are personal data
// under RA 10173 — which CBL Art. VIII §6 makes a CONSTITUTIONAL obligation of this
// organization, not merely a statutory one. Writing raw client IPs into a table to
// enforce a limit would create a brand-new category of personal data, on the one
// surface a stranger can reach, with no retention basis and no entry in the
// processing register.
//
// So the subject is HMAC'd here and only the digest crosses the wire. The database
// can count attempts by a subject it cannot identify. `check_rate_limit()`'s own
// comment says the same thing from the other side; neither is decoration.
//
// HMAC and not a bare hash: a plain sha256 of an IPv4 address is trivially reversible
// by enumerating all 2^32 of them. The keyed digest is not.
// ─────────────────────────────────────────────────────────────────────────────

// NOT `import "server-only"`. This module is imported directly by its own Vitest
// suite, where the `server-only` package resolves to its throwing export. It is
// server-only by construction anyway — `node:crypto` and the HMAC secret cannot
// exist in a browser bundle — and the eslint client/server rules cover the rest.

import { createHmac } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/database.types";

/**
 * The pepper used when `RATE_LIMIT_HMAC_KEY` is absent OUTSIDE production.
 *
 * ⚠ This is a deliberate, narrow decision, not a shortcut. The alternative — throwing
 * on a missing key — would mean that a developer or a CI run without the secret takes
 * down the public application form entirely, and the failure would look like a broken
 * form rather than a missing variable. Rate limiting is a hardening control; it must
 * not be a hard dependency of the surface it hardens.
 *
 * In production a missing key DOES throw (see `hmacKey`), because there the digests
 * would be guessable and the privacy property this module exists for would be gone.
 */
const DEV_ONLY_PEPPER = "dev-only-pepper";

/**
 * Hash a rate-limit subject (an IP address, an email) for storage.
 *
 * @throws in production when `RATE_LIMIT_HMAC_KEY` is unset — a predictable digest is
 *         a reversible one, and the whole point of this module is that it is not.
 */
export function hmacKey(value: string): string {
  const secret = process.env.RATE_LIMIT_HMAC_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "RATE_LIMIT_HMAC_KEY is not set. It is required in production: without it the " +
          "rate-limit key digests are guessable and raw subjects become recoverable. " +
          "Set it in the Vercel Production scope; the value lives in Bitwarden " +
          "(docs/runbooks/03-CREDENTIAL_ROTATION.md).",
      );
    }

    return createHmac("sha256", DEV_ONLY_PEPPER).update(value, "utf8").digest("hex");
  }

  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

/** One fixed window. Everything on `/apply` uses an hour. */
export const ONE_HOUR = "1 hour";

export type CheckRateLimitArgs = {
  /** The caller's own Supabase client. `anon` on the public form — that is correct. */
  supabase: SupabaseClient<Database>;
  /** Bucket name, e.g. `apply_ip`. Namespaces one subject across different limits. */
  bucket: string;
  /** The RAW subject. Hashed here; it never leaves this function. */
  key: string;
  /** Attempts permitted per window. */
  limit: number;
  /** Postgres interval literal. Defaults to one hour. */
  window?: string;
};

/**
 * Record one attempt and report whether it is within the limit.
 *
 * The call itself counts — a refused attempt is still an attempt, which is what stops
 * an attacker from probing the boundary for free.
 *
 * Returns `true` (allow) if the RPC itself fails. That is a considered choice: the
 * limiter is defence in depth over the actual authorization boundary (the anon INSERT
 * policy and the application window), and a limiter outage must not take the public
 * application form down during application week. The RPC failing is a database
 * problem, and the database problem will be visible in Sentry and Better Stack.
 */
export async function checkRateLimit({
  supabase,
  bucket,
  key,
  limit,
  window = ONE_HOUR,
}: CheckRateLimitArgs): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: bucket,
    // ⚠ NEVER pass `key` here. The digest is the whole privacy property of this module.
    p_key_hash: hmacKey(key),
    p_limit: limit,
    p_window: window,
  });

  if (error) return true;

  return data !== false;
}
