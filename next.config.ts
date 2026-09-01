// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY RESPONSE HEADERS AND CRAWLER POLICY — BUILD_PLAN S7-T11, S7-T12.
//
// Everything here is a HEADER, applied by the platform to every response. None of it
// is an authorization control: RLS is the boundary (ARCHITECTURE.md §5), and nothing
// below would keep a single row from a caller a policy permits. These are the controls
// for the class of attack that does not go through the database at all — clickjacking,
// MIME confusion, a downgraded connection, a proof-document URL leaking in a `Referer`.
//
// ── THE ONE THING NOT TO BREAK ───────────────────────────────────────────────
// The proof-of-enrollment upload does not POST to us. The browser PUTs the bytes
// DIRECTLY to Google (or to Supabase Storage under ADR 0005), because Vercel caps
// request bodies at 4.5MB and a phone photo of a Certificate of Registration routinely
// exceeds it (ARCHITECTURE.md §4.1 step 4). A `connect-src` that omits those origins
// therefore breaks the highest-risk flow in the entire system — and it breaks it in
// the browser, on a real applicant's phone, where no test would have caught it.
//
// That is why the full policy ships as **Content-Security-Policy-Report-Only**. It is
// the pre-agreed S7 risk fallback, taken deliberately rather than discovered: an
// enforcing CSP would have to be validated against a real cross-origin resumable PUT
// on three browsers, and there is no day left to do that. Report-Only gives the
// violation reports that make enforcement safe later, while it cannot break anything.
// The debt is recorded in `docs/issues/2026-09-06-launch-debt.md` (item 5) alongside
// the nonce work that must land with it — `script-src 'unsafe-inline'` below is only
// tolerable because this header does not enforce.
//
// **`frame-ancestors` is the exception and ships ENFORCING**, in its own
// `Content-Security-Policy` header carrying nothing else. Clickjacking an admin's
// membership-status control is a real attack on this system, `frame-ancestors` is the
// only modern defence against it, and it cannot break the upload because it governs
// who may frame US, not who we may talk to. `X-Frame-Options: DENY` sits beside it for
// browsers that predate CSP level 2.
//
// ── WHY THERE IS NO `withSentryConfig` WRAPPER ───────────────────────────────
// ARCHITECTURE.md §1 locks `@sentry/nextjs`; ADR 0008 defers it. The SDK wraps this
// file and hooks the build, and the PII scrub — the half that carries the risk —
// ships independently in `lib/observability/scrub.ts`. See ADR 0008 for the three-step
// path to adopting it.
// ═══════════════════════════════════════════════════════════════════════════════

import type { NextConfig } from "next";

/**
 * The Report-Only policy.
 *
 * `connect-src` is the load-bearing directive and each origin is there for a reason:
 *   · `https://*.supabase.co`        — PostgREST, GoTrue and Storage. Every read and
 *                                      write in the app is an XHR to this origin.
 *   · `https://www.googleapis.com`   — the Drive resumable upload session URI the
 *                                      server mints and the browser PUTs to.
 *   · `https://*.googleusercontent.com` — where Drive redirects a resumable session.
 *
 * `img-src` carries `blob:` because the upload field previews the chosen file locally
 * before it is sent, and `data:` because the vendored shadcn/ui components inline a
 * handful of tiny assets.
 *
 * `'unsafe-inline'` on `script-src` is Next's requirement for its hydration bootstrap
 * without a per-request nonce. Removing it needs middleware to mint the nonce and a
 * CSP built per response — a day of work with a real regression surface, deferred as
 * launch debt rather than half-done.
 */
const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co https://www.googleapis.com https://*.googleusercontent.com",
  "font-src 'self'",
  "frame-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Applied to every response. */
const SECURITY_HEADERS = [
  {
    // Two years, subdomains included, preload-eligible. START-SYS asks a scholar to
    // upload a document containing their student number and home address; a single
    // plaintext round trip on campus wifi is the cheapest possible interception, and
    // HSTS is what removes the first one.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // A proof document is streamed through `/api/applications/[id]/proof` with a
    // Content-Type read from the STORED mime, never from the provider's response.
    // `nosniff` is what stops a browser from second-guessing that and executing a
    // file an applicant uploaded.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  { key: "X-Frame-Options", value: "DENY" },
  {
    // Enforcing, and deliberately carrying ONLY this directive — see the header note.
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'",
  },
  { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_CSP },
  {
    // Without this, a `Referer` on any outbound link leaks the full path — including
    // `/api/applications/<uuid>/proof`, i.e. the address of a scholar's Certificate of
    // Registration — to a third-party site. Cross-origin gets the origin only.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // This system needs none of these. Denying them means a compromised dependency
    // cannot ask for them either.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
] as const;

/**
 * `noindex` on everything except the two genuinely public pages (S7-T12).
 *
 * PRD §4: *"Other than the forms it sends out, the system is not accessible to the
 * general public."* `robots.txt` (see `app/robots.ts`) is a REQUEST that a well-behaved
 * crawler honours; `X-Robots-Tag` is an INSTRUCTION that applies even to a URL a
 * crawler reached from a link rather than from the sitemap. Both ship, because the
 * failure they prevent — `/admin/members` in a search index — is the kind of thing
 * that is noticed by someone else first.
 *
 * ⚠️ **Next cannot UNSET a header on a narrower path**, so this cannot be "noindex
 * everywhere, then remove it from two routes". It has to be a source that never
 * matches those two in the first place, which is what the negative lookahead does:
 * `/apply` and `/privacy` are excluded exactly (the `$` anchors them, so a
 * hypothetical `/applications` is still matched and still noindexed).
 *
 * Adding a public page means adding it here AND to `app/robots.ts` AND to
 * `middleware.ts`'s matcher — three places, deliberately, because making a page
 * publicly reachable in this system is not a routine change.
 */
const NOINDEX_EXCEPT_PUBLIC = "/((?!apply$|privacy$).*)";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: [...SECURITY_HEADERS] },
      {
        source: NOINDEX_EXCEPT_PUBLIC,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
