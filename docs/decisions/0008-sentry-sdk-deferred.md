# ADR 0008 — The Sentry SDK is deferred; the PII scrub is not

**Date:** 2026-09-06
**Author:** S7 hardening lane (BUILD_PLAN S7-T8, S7-T9, S7-T11)
**Status:** Accepted — and explicitly time-limited. This is launch debt, tracked as item 4 of
[`docs/issues/2026-09-06-launch-debt.md`](../issues/2026-09-06-launch-debt.md), not a permanent
position.
**Deviates from:** `ARCHITECTURE.md` §1, "Ops, CI, infra" — which locks
`@sentry/nextjs` `10.x` (free tier) as the error tracker, *"PII scrubbing via `beforeSend`
stripping request bodies"*.

---

## Context

`ARCHITECTURE.md` §1 locks `@sentry/nextjs` into the stack and gives the reason plainly:
*"Without it, a failure in the Drive upload or the campaign drain is invisible until an
applicant complains."* That reason is real and it has not changed. This ADR does not dispute
the choice of vendor and does not propose an alternative one.

What forced a decision is **what the SDK does to the build, and when.**

`@sentry/nextjs` is not a library you import; it is a build integration. Wiring it means
wrapping `next.config.ts` in `withSentryConfig`, which installs a webpack/Turbopack plugin
that rewrites server and client entry points, injects instrumentation into the App Router
runtime, and — by default — uploads source maps as a post-build step. It also adds
`sentry.client.config.ts`, `sentry.server.config.ts` and `sentry.edge.config.ts`, three
files each carrying a separate `Sentry.init`.

Four facts about this particular week decided it:

1. **It lands on `next.config.ts`, on the last build day.** The same file S7-T11 is editing
   to add the security headers, in a slice whose loop-exit condition is a green production
   deploy. `pnpm build` is the dependency of every CI job, the client-bundle audit
   (S7-T10) and the deploy itself. A three-way version interaction between Next 16.3,
   Turbopack and a build plugin is exactly the shape of problem that consumes an afternoon,
   and there is no afternoon left — Day 7 is rehearsal, not work (BUILD_PLAN, Day 7).
2. **There is no Sentry project to send to.** OQ-9 and OQ-10 are unresolved: the org has no
   confirmed domain and no org-owned identity under which to create the account. Every
   console created this week already sits on a personal identity (launch-debt item 1).
   Installing a client for a service that does not exist buys an inert dependency and a
   build risk, and nothing else.
3. **Source-map upload is a second, separate decision.** It needs an auth token in CI, and
   uploading source maps for a system whose bundles are audited for PII leakage
   (S7-T10) deserves its own review rather than arriving as a default.
4. **The dangerous half of an error tracker is not the SDK.** An error tracker is a
   third-party endpoint that receives whatever an application hands it. What it receives is
   decided entirely by the scrub. `@sentry/nextjs` with a wrong `beforeSend` is far worse
   than no tracker at all; a correct scrub with no tracker is merely quiet.

That last point is what makes the split possible: **the risk and the vendor are separable,
and only one of them is urgent.**

## Decision

**Defer `@sentry/nextjs`. Ship the scrub, complete and tested, wired into a transport-agnostic
pipeline that the SDK later slots into without touching a call site.**

Concretely, three things land in this window:

| Ships | File | What it is |
|---|---|---|
| The scrub | `lib/observability/scrub.ts` | `scrubEvent(event)` — a pure function implementing the six rules below. Becomes `beforeSend` verbatim. |
| The pipeline | `instrumentation.ts` | `reportError(error, context)`, `onRequestError`, and a swappable transport. **`deliver` is the only exit and it is the caller of `scrubEvent`** — there is no path from a raw event to a transport. |
| The proof | `lib/observability/scrub.{test,integration.test}.ts` | 104 assertions. The integration suite asserts on the envelope the pipeline actually hands over, and keeps a negative fixture asserting the *unscrubbed* event still contains every literal — so the clean assertions cannot silently become tautologies. |

The six rules, in the order they apply (full reasoning in the module header):

1. `request.data` and `request.cookies` are **deleted outright** — not masked, not truncated.
2. `request.url` is reduced to its **pathname**; the query string is dropped whole.
3. Headers are an **allowlist** (`user-agent`, `accept`, `content-type`), never a denylist.
4. `event.user` is reduced to `{ id }`.
5. Any key in `SENSITIVE_KEYS` is **deleted recursively**, at any depth, anywhere.
6. Surviving strings have member-ID and email patterns replaced.

`SENSITIVE_KEYS` is imported from `lib/observability/sensitive-keys.ts` and never restated —
one list, two consumers (this and the client-bundle audit), mirroring
`DATA_MODEL.md` §8.1 and the `sensitive_column_registry` table.

The default transport POSTs a Sentry envelope when `SENTRY_DSN` is set and does **nothing**
when it is not — no buffer, no queue, no file. `SENTRY_DSN` is empty in every environment
today, so that branch is dormant; it exists so that provisioning Sentry is a Vercel
environment variable rather than a code change, the same shape as the document-store swap in
ADR 0005.

### Also decided here: the Content-Security-Policy ships Report-Only

Recorded in this ADR rather than a ninth one because it is the same judgement applied twice —
*ship the control that carries the risk, defer the integration that carries the build risk.*

`next.config.ts` sends **`Content-Security-Policy: frame-ancestors 'none'` enforcing**, and
the full policy as **`Content-Security-Policy-Report-Only`**. The reason is the upload flow:
the browser PUTs proof-of-enrollment bytes **directly** to Google or Supabase Storage, because
Vercel caps request bodies at 4.5MB and a phone photo of a Certificate of Registration exceeds
it (`ARCHITECTURE.md` §4.1 step 4). A `connect-src` that is wrong by one origin breaks the
highest-risk flow in the system, in the browser, on a real applicant's phone — where no test
in this repo would catch it. Validating an enforcing policy against a real cross-origin
resumable PUT on three browsers is a day of work that does not exist.

`frame-ancestors` is exempt because it governs who may frame *us*, not who we may talk to: it
cannot break the upload, and clickjacking an admin's membership-status control is a real
attack. `X-Frame-Options: DENY` ships beside it for pre-CSP-2 browsers.

`script-src 'unsafe-inline'` in the Report-Only policy is tolerable **only** because that
header does not enforce. Nonce-based CSP is launch-debt item 5 and must land together with
enforcement, never separately.

## Consequences

### What we get

- **The disclosure risk is closed before the vendor exists.** A failed `/apply` POST cannot
  ship a scholar's birthdate, contact number, address and school ID to a third party in
  another jurisdiction, because there is no code path that sends an unscrubbed event
  anywhere. That was the actual RA 10173 exposure (CBL Art. VIII §6 makes it a constitutional
  obligation, and Art. VI §3.1.3 makes a data-privacy breach a ground for impeachment).
- **The build is untouched.** No plugin, no entry rewriting, no source-map step, no new
  failure mode on the deploy day.
- **Call sites are already correct.** Anything written now calls `reportError`, which is the
  API it will keep. Adopting the SDK moves no call site.
- **The scrub is testable in a way `beforeSend` is not.** A pure function with an injectable
  transport can be asserted end to end in Vitest; an SDK-internal hook mostly cannot.

### What we lose, stated plainly

- **There is no error tracking in production today.** Not "degraded" — none. A failure in the
  Drive upload or the proof proxy is invisible unless someone reports it. The compensating
  controls are thinner than Sentry and should not be described as equivalent: Better Stack
  alerts on `/api/health` (S7-T6), the scheduled jobs post to Discord on failure, and Vercel's
  own function logs exist. **Nothing aggregates, deduplicates or alerts on an application
  exception.**
- **No breadcrumbs, no release health, no performance tracing.** The event shape here is a
  message, an exception, a reduced request, a user id and `extra`.
- **`onRequestError` is our own hook**, so its exact firing conditions are Next's and are not
  additionally covered by SDK behaviour. Unhandled throws in a Client Component are not
  captured at all — there is no browser-side reporter.
- **The envelope format is hand-built.** `parseDsn` and the three-line envelope are written
  against Sentry's public, stable format and have never been exercised against a real
  ingest endpoint. If the DSN branch is ever switched on before the SDK lands, **verify it
  against the real project once, by hand**, and do not assume it works because a unit test
  asserts its shape.
- **CSP does not enforce.** A successful XSS is not stopped by the Report-Only header. Nothing
  in this system currently renders untrusted HTML, and the enforcing `frame-ancestors` closes
  the clickjacking case — but the gap is real and is item 5 of the launch-debt register.

### Adopting the SDK later — three steps, and no fourth

1. `pnpm add --save-exact @sentry/nextjs@10.x`.
2. Wrap the export in `next.config.ts` with `withSentryConfig`, and create the three
   `sentry.*.config.ts` files with `Sentry.init({ dsn, beforeSend: scrubEvent, sendDefaultPii:
   false, replaysSessionSampleRate: 0 })`.
   **`beforeSend: scrubEvent` is the whole of the privacy wiring** — the scrub does not change.
   **Session Replay stays OFF**: a replay of an admin reading a member record is a screen
   recording of PII, and no `beforeSend` can redact a video.
3. In `instrumentation.ts`, replace the body of `postEnvelope` with `Sentry.captureEvent`, or
   call `setObservabilityTransport(Sentry.captureEvent)` in `register()`. **Do not remove
   `scrubEvent` from `deliver`** — one scrub, one place; the SDK path and the direct path must
   not diverge.

Then delete this ADR's entry from the launch-debt register, and re-run
`lib/observability/scrub.integration.test.ts`, whose negative fixture is what keeps the
adoption honest.

### Rejected alternatives

| Rejected | Why |
|---|---|
| **Install the SDK anyway, on the last build day** | The failure mode is a broken `pnpm build`, which blocks CI, the client-bundle audit and the deploy at once, for a service with no project to send to. The risk is asymmetric and the benefit is zero until OQ-9/OQ-10 resolve. |
| **Defer the scrub too, and ship nothing** | The scrub is the part that carries the RA 10173 risk. Deferring it would mean that whoever installs the SDK later — plausibly a different officer, in a different term, under time pressure — is the person who decides what an error tracker receives. That is exactly the decision this project does not leave to a future rush. |
| **Log errors to `console.error` in the meantime** | `no-console` is an ESLint **error** under `lib/**`, `app/**` and `components/**` for a reason: stdout on Vercel is a third-party log drain with no scrubbing at all, so it is strictly worse than the tracker it would be standing in for. |
| **Buffer unsent events in memory until a DSN appears** | A queue of unsent error events is a PII store with no retention basis, no entry in the processing register, and no deletion path — on a serverless runtime that discards it anyway. The events are dropped. |
| **A different vendor with a lighter SDK** (Axiom, Highlight, self-hosted GlitchTip) | A locked-stack substitution needs its own ADR and its own evaluation, and would add a vendor to the DPA register (S7-T21) that nobody has assessed. Deferring the *timing* of a locked choice is a much smaller decision than changing it. |
