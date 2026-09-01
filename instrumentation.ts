// ═══════════════════════════════════════════════════════════════════════════════
// THE ERROR-REPORTING PIPELINE — BUILD_PLAN S7-T8, S7-T9; ADR 0008.
//
// ── WHY THERE IS NO `@sentry/nextjs` IMPORT IN THIS FILE ─────────────────────
// ARCHITECTURE.md §1 locks `@sentry/nextjs` 10.x into the stack, and it is still the
// intended destination. **It is deliberately not installed in this window** — the SDK
// wraps `next.config.ts` through `withSentryConfig` and hooks the build itself, and
// taking that on during a seven-day sprint puts the one thing that must not break
// (`pnpm build`, which every CI job and the deploy depend on) at version-interaction
// risk, on the last day, for a service the org has not yet provisioned. ADR 0008
// records the deviation, its cost, and the three-step path to adopting the SDK.
//
// **What was NOT deferred is the half that carries the risk.** An error tracker is
// only dangerous because of what it sends, and what it sends is decided by the scrub —
// `lib/observability/scrub.ts` — which ships complete and tested. Adopting the SDK
// later is `Sentry.init({ beforeSend: scrubEvent })`; the scrub does not change, and
// neither does any call site, because callers use `reportError` from here.
//
// ── THE ONE INVARIANT THIS FILE EXISTS TO HOLD ───────────────────────────────
//   **NO EVENT REACHES A TRANSPORT WITHOUT PASSING THROUGH `scrubEvent`.**
// It is structural, not remembered: `buildEvent` produces the raw event, `deliver`
// is the only function that touches a transport, and `deliver` is the caller of
// `scrubEvent`. There is no code path from a raw event to a transport.
// `scrub.integration.test.ts` proves it by asserting the raw event built from a
// dirty fixture DOES contain the PII literals while the delivered envelope does not —
// which is also what makes that assertion non-vacuous.
//
// ── AND THE SECOND: REPORTING NEVER BREAKS THE REQUEST IT IS REPORTING ON ────
// `reportError` swallows everything. A telemetry failure that turns a handled error
// into an unhandled one is strictly worse than no telemetry: it converts a logged
// problem into an outage. There is no `console` here either — `no-console` does not
// reach the repo root, but writing an error object to stdout is precisely the
// PII-logging CLAUDE.md forbids, and Vercel's log drain is a third party too.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  type ObservabilityEvent,
  type ObservabilityRequest,
  type ObservabilityUser,
  scrubEvent,
} from "@/lib/observability/scrub";

// ── Transport ────────────────────────────────────────────────────────────────

/**
 * Where a scrubbed event goes.
 *
 * Receives an event that has ALREADY been through `scrubEvent`. A transport must
 * never scrub — one scrub, one place, so there is exactly one thing to get right.
 */
export type ObservabilityTransport = (event: ObservabilityEvent) => void | Promise<void>;

let transport: ObservabilityTransport | null = null;

/**
 * Install a transport, replacing any current one. `null` restores the default.
 *
 * This is the seam `scrub.integration.test.ts` uses: it installs a capturing
 * transport and asserts on what the pipeline actually hands over, rather than
 * re-testing the pure function a second time. It is also how the Sentry SDK is
 * adopted without touching a single call site (ADR 0008, step 3).
 */
export function setObservabilityTransport(next: ObservabilityTransport | null): void {
  transport = next;
}

// ── The default transport: a Sentry envelope POST, or nothing ────────────────

/**
 * A Sentry DSN, split into what an envelope POST needs.
 *
 * `https://<publicKey>@<host>/<projectId>` → `https://<host>/api/<projectId>/envelope/`.
 * Parsed here rather than pulled from an SDK precisely because the SDK is what is
 * deferred; the format is stable and public.
 *
 * @returns `null` on anything unparseable. A malformed DSN must disable reporting
 *          silently, never throw into a request path.
 */
export function parseDsn(dsn: string): { endpoint: string; publicKey: string } | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, "").split("/").pop();

    if (url.username === "" || projectId === undefined || projectId === "") return null;

    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      publicKey: url.username,
    };
  } catch {
    return null;
  }
}

/**
 * POST one scrubbed event as a Sentry envelope, if `SENTRY_DSN` is set.
 *
 * **Dormant today.** No Sentry project is provisioned and `SENTRY_DSN` is empty in
 * every environment (`.env.example`; `lib/env.ts` types it optional), so this branch
 * does not run — it exists so that provisioning Sentry is a Vercel environment
 * variable rather than a code change, exactly like the document-store swap in ADR 0005.
 * When no DSN is set the event is DROPPED and nothing is stored: an in-memory ring
 * buffer of unsent error events would be a PII store with no retention basis, on a
 * serverless runtime that discards it anyway.
 *
 * Every failure is swallowed. The envelope format is three newline-delimited JSON
 * lines: envelope header, item header, payload.
 */
async function postEnvelope(event: ObservabilityEvent): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (dsn === undefined || dsn.trim() === "") return;

  const parsed = parseDsn(dsn.trim());
  if (parsed === null) return;

  const body = [
    JSON.stringify({ dsn: dsn.trim(), sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");

  try {
    await fetch(parsed.endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body,
      // Telemetry must never hold a serverless function open past its work.
      keepalive: true,
    });
  } catch {
    // Unreachable tracker, DNS failure, aborted request. Reporting is best-effort by
    // definition; a throw here would surface as a 500 on a request that had already
    // handled its own error.
  }
}

// ── Building the raw event ───────────────────────────────────────────────────

/** What a call site may attach. Every field is optional and every field is scrubbed. */
export type ReportContext = {
  /** Free-text summary. Overrides the error's own message when present. */
  message?: string;
  level?: ObservabilityEvent["level"];
  request?: ObservabilityRequest;
  user?: ObservabilityUser;
  /** Structured context. Prefer IDs; the scrub will remove PII, but do not rely on it. */
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
};

/** Normalise anything a `catch` can produce into an exception entry. */
function toException(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    const entry: { type: string; value: string; stack?: string } = {
      type: error.name,
      value: error.message,
    };
    if (error.stack !== undefined) entry.stack = error.stack;
    return entry;
  }

  if (typeof error === "string") return { type: "Error", value: error };

  // A thrown non-Error — a PostgREST error object, a rejected fetch. `String(...)` on
  // an arbitrary object yields "[object Object]", which is useless; the object itself
  // is placed in `extra` by the caller if it is worth having, where the scrub sees it.
  return { type: "UnknownError", value: "A non-Error value was thrown." };
}

/**
 * Build the RAW, UNSCRUBBED event.
 *
 * Exported for one reason: `scrub.integration.test.ts` asserts that the raw event
 * built from its dirty fixture genuinely CONTAINS the PII literals, so that the
 * assertion about the delivered envelope not containing them proves the pipeline
 * rather than proving the fixture was clean all along. That is the encoded red.
 *
 * ⚠️ **Never send this to a transport.** `deliver` is the only exit, and it scrubs.
 */
export function buildEvent(error: unknown, context: ReportContext = {}): ObservabilityEvent {
  const exception = toException(error);

  const event: ObservabilityEvent = {
    message: context.message ?? exception.value,
    level: context.level ?? "error",
    timestamp: new Date().toISOString(),
    exception: [exception],
  };

  const release = process.env.VERCEL_GIT_COMMIT_SHA;
  if (release !== undefined && release !== "") event.release = release;

  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (environment !== undefined && environment !== "") event.environment = environment;

  if (context.request !== undefined) event.request = context.request;
  if (context.user !== undefined) event.user = context.user;
  if (context.extra !== undefined) event.extra = context.extra;
  if (context.tags !== undefined) event.tags = context.tags;

  return event;
}

/** The only path from an event to a transport, and therefore the only scrub site. */
async function deliver(raw: ObservabilityEvent): Promise<void> {
  const scrubbed = scrubEvent(raw);
  const send = transport ?? postEnvelope;
  await send(scrubbed);
}

// ── The call site's entry point ──────────────────────────────────────────────

/**
 * Report an error. **Never throws, never logs, never returns a failure.**
 *
 * Use it where a raw database or upstream error is caught and mapped to a safe
 * `ActionError` — `mapDbError` deliberately neither logs nor returns the raw error
 * (`lib/action-result.ts`), and this is where that raw error is meant to go.
 *
 * Attach IDs, never values: `extra: { application_id }`, not `extra: { payload }`.
 * The scrub deletes a sensitive-named key wherever it finds one, but a guard is not a
 * licence — CLAUDE.md's "log IDs, never values" is still the rule at the call site.
 */
export async function reportError(error: unknown, context: ReportContext = {}): Promise<void> {
  try {
    await deliver(buildEvent(error, context));
  } catch {
    // Includes a throwing transport and a throwing scrub. Reporting an error must not
    // be able to replace the error it is reporting.
  }
}

// ── Next.js hooks ────────────────────────────────────────────────────────────

/**
 * Next's instrumentation hook. Runs once per server runtime at startup.
 *
 * A deliberate no-op: there is no SDK to initialise (ADR 0008), and the transport is
 * selected per call from `SENTRY_DSN` so nothing needs registering. It must stay
 * safe — anything that throws here fails the whole server boot, which is a strictly
 * worse outcome than having no telemetry.
 */
export async function register(): Promise<void> {
  // Intentionally empty. See the header.
}

/**
 * Next's `onRequestError` hook (App Router). Routes a server-side rendering or Route
 * Handler failure into the same scrubbed pipeline as an explicitly reported one, so
 * an unhandled throw cannot take a shortcut past `scrubEvent`.
 *
 * The `request` Next hands over carries `path` and `headers`; the headers are passed
 * through because the scrub allowlists them down to three, and `path` is passed as
 * `url` because the scrub reduces it to a pathname anyway.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context?: { routerKind?: string; routeType?: string },
): Promise<void> {
  const requestContext: ObservabilityRequest = {};
  if (request.path !== undefined) requestContext.url = request.path;
  if (request.method !== undefined) requestContext.method = request.method;
  if (request.headers !== undefined) requestContext.headers = request.headers;

  const tags: Record<string, string> = { source: "onRequestError" };
  if (context?.routerKind !== undefined) tags.router_kind = context.routerKind;
  if (context?.routeType !== undefined) tags.route_type = context.routeType;

  await reportError(error, { request: requestContext, tags });
}
