// ─────────────────────────────────────────────────────────────────────────────
// The browser origin that is going to PUT the bytes.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS — the 2026-09-10 upload outage, second cause
// ═══════════════════════════════════════════════════════════════════════════════
// Google's resumable upload endpoint binds CORS to the origin named on the
// INITIATION request, not on the PUT. Mint a session without an `Origin` header and
// Google will happily accept the browser's PUT, store the bytes, return 200 — and
// omit `Access-Control-Allow-Origin` from that response. The browser then discards a
// successful upload as a CORS failure, and the applicant is told to check their
// internet connection.
//
// Measured, both against the live API on the same folder and credential:
//
//     initiate WITHOUT Origin:  PUT 200  ACAO=(none)        ← browser blocks
//     initiate WITH    Origin:  PUT 200  ACAO=<the origin>  ← browser accepts
//
// This is why the fix is not just "use a credential with quota". Quota was one of the
// two causes; this was the other, and it hid behind the first.
//
// WHY IT IS READ PER REQUEST AND NOT FROM AN ENVIRONMENT VARIABLE: every Vercel
// preview deployment has its own hostname. A single `APP_BASE_URL` would be correct in
// production and silently wrong in every preview, which is the shape of bug that gets
// discovered by an applicant rather than by a reviewer.
// ═══════════════════════════════════════════════════════════════════════════════

import { headers } from "next/headers";

/**
 * The origin of the page that called this Server Action.
 *
 * Next sends `Origin` on Server Action requests, so the header path is the normal one.
 * `x-forwarded-*` is the fallback for a proxy that strips it; `host` is the last resort.
 *
 * Returns `null` rather than guessing when nothing usable is present. A wrong origin is
 * worse than no origin: Google would echo the wrong ACAO and the browser would still
 * block, but the header would look correct to anyone reading the code.
 */
export async function browserOriginFromRequest(): Promise<string | null> {
  const h = await headers();

  const origin = h.get("origin");
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;

  const forwardedHost = h.get("x-forwarded-host") ?? h.get("host");
  if (!forwardedHost) return null;

  const proto =
    h.get("x-forwarded-proto") ?? (forwardedHost.startsWith("localhost") ? "http" : "https");
  return `${proto}://${forwardedHost}`;
}
