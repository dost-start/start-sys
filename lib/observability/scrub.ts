// ═══════════════════════════════════════════════════════════════════════════════
// THE ERROR-EVENT SCRUB — BUILD_PLAN S7-T8.
//
// One pure function, `scrubEvent`, standing between a thrown error and an error
// tracker. It is the single most load-bearing thing in the observability lane, and it
// is deliberately the ONLY part of that lane that ships in this window (ADR 0008: the
// `@sentry/nextjs` SDK is deferred; this module is wired into `instrumentation.ts`'s
// `reportError` instead, and becomes the SDK's `beforeSend` unchanged when it lands).
//
// ── WHAT IT IS PROTECTING AGAINST, CONCRETELY ────────────────────────────────
// `/apply` is the one surface a stranger can reach, and it builds the highest-PII
// request bodies in the system: birthdate, contact number, home address, school ID
// number, and a pointer to a Certificate of Registration. A single unhandled throw
// inside `finalizeApplication` would, with a naively-configured error tracker, ship
// that entire body to a third-party service in another jurisdiction — an unlogged,
// unconsented cross-border disclosure of a scholar's personal data. That is a
// REPORTABLE BREACH under RA 10173, which CBL Art. VIII §6 makes a constitutional
// obligation of the organization and not merely a statutory one, and CBL Art. VI
// §3.1.3 makes "breach of data privacy" a standalone ground for impeachment.
//
// So the rule is not "redact the obvious fields". The rule is: THE REQUEST BODY AND
// THE COOKIES ARE DELETED OUTRIGHT, unconditionally, before anything else is
// considered. Everything below that is defence in depth against the same event
// arriving by another route — a value copied into `extra`, an email interpolated into
// an exception message, a member ID in a stack frame.
//
// ── SIX RULES, IN THE ORDER THEY APPLY ───────────────────────────────────────
//   1. `request.data` and `request.cookies` are DELETED. Not masked, not truncated.
//      There is no debugging value in a form body that justifies the risk of keeping
//      any of it, and a mask that has to decide what to keep is a mask with a bug in
//      it waiting to happen.
//   2. `request.url` is reduced to its PATHNAME. The query string is dropped whole —
//      `?email=...` on a reset link is the canonical way PII reaches a URL, and
//      CLAUDE.md forbids putting personal data in query strings in the first place, so
//      anything found there is already a bug and must not be preserved.
//   3. HEADERS ARE AN ALLOWLIST, never a denylist. `user-agent`, `accept` and
//      `content-type` survive; `cookie`, `authorization`, `x-forwarded-for` and every
//      future header nobody thought about do not. A denylist is a list of the headers
//      that existed on the day it was written.
//   4. `event.user` is reduced to `{ id }`. An account id is what makes an event
//      actionable; an email address is personal data and an IP address is too.
//   5. Any key named in `SENSITIVE_KEYS` is DELETED RECURSIVELY, at any depth,
//      anywhere in the event. The key list is imported, never restated — see
//      `sensitive-keys.ts` for why that file is a mirror of the database registry.
//   6. Every surviving STRING has member-ID and email patterns replaced. This is the
//      rule that catches the case the other five cannot: a value that was never in a
//      field at all, only interpolated into a message.
//
// ── WHAT THIS MODULE IS NOT ──────────────────────────────────────────────────
// It is not a redaction guarantee for free-text an operator types. It is not
// PII-detection: it has no notion of a name or an address as prose. It removes the
// STRUCTURED paths by which this system's PII would reach an error tracker, plus two
// pattern classes. Anything else — a birthdate deliberately concatenated into an
// exception message as `"born 3 January 2004"` — is prevented at the throw site by
// `no-console` and by CLAUDE.md's "log IDs, never values", not here.
//
// PURE, AND KEPT PURE ON PURPOSE. It reads no environment, opens no socket, and
// mutates nothing it is given. That is what lets one unit test assert the whole
// contract over a table of fixtures, and what lets `scrub.integration.test.ts` prove
// the pipeline routes through it by comparing the scrubbed envelope against the
// unscrubbed event built from the same input.
// ═══════════════════════════════════════════════════════════════════════════════

import { SENSITIVE_KEYS, isSensitiveKey } from "@/lib/observability/sensitive-keys";

// ── The event shape ──────────────────────────────────────────────────────────

/**
 * The subset of a Sentry-shaped event this system produces.
 *
 * Deliberately OUR type and not an SDK import (ADR 0008). It is intentionally
 * Sentry-compatible in field names — `request`, `user`, `extra`, `tags`, `exception` —
 * so that adopting `@sentry/nextjs` later is `beforeSend: scrubEvent` and nothing else.
 */
export type ObservabilityEvent = {
  /** Human-readable summary. Usually `error.message`. */
  message?: string;
  /** Severity, Sentry's vocabulary. */
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  /** ISO 8601. Set by the caller so the scrub stays pure. */
  timestamp?: string;
  /** Which build produced this. A commit SHA, never a secret. */
  release?: string;
  /** `production` / `preview` / `development`. */
  environment?: string;
  exception?: ObservabilityException[];
  request?: ObservabilityRequest;
  user?: ObservabilityUser;
  /** Arbitrary structured context. THE most likely place PII arrives by accident. */
  extra?: Record<string, unknown>;
  /** Low-cardinality labels. Scrubbed identically — nothing is exempt. */
  tags?: Record<string, string>;
  /** Set by the scrub itself; see `ScrubReport`. Never supplied by a caller. */
  scrub?: ScrubReport;
};

export type ObservabilityException = {
  /** The constructor name, e.g. `TypeError`. */
  type?: string;
  /** `error.message`. Pattern-redacted, never dropped — it is the whole signal. */
  value?: string;
  /** `error.stack`. Pattern-redacted for the same reason. */
  stack?: string;
};

export type ObservabilityRequest = {
  /** Reduced to a pathname by rule 2. */
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  /** DELETED by rule 1. Present in the type only so a caller may pass it in. */
  cookies?: unknown;
  /** DELETED by rule 1. Same. */
  data?: unknown;
  /** DELETED — a query string is exactly what rule 2 exists to drop. */
  query_string?: unknown;
};

export type ObservabilityUser = {
  id?: string;
  /** Personal data. Dropped by rule 4; typed so a caller cannot pass it "by accident". */
  email?: string;
  ip_address?: string;
  username?: string;
  [key: string]: unknown;
};

/**
 * What the scrub did, as counts rather than names.
 *
 * A deleted key leaves no trace, which makes a scrubbed event hard to reason about
 * ("was there context here, or did the caller send none?"). Counts restore that signal
 * without naming anything: a column name is not personal data, but a list of them in
 * an outbound event is a description of a scholar's record, and there is no reason to
 * send one.
 */
export type ScrubReport = {
  /** Version of the rule set, so a future change is visible in the tracker. */
  v: 1;
  /** How many sensitive-named keys were deleted, at any depth. */
  removed_keys: number;
  /** How many member-ID / email patterns were replaced in surviving strings. */
  redacted_patterns: number;
};

// ── Markers and limits ───────────────────────────────────────────────────────

/** Replaces a matched member ID. Distinct from the email marker so a reader can tell. */
export const MEMBER_ID_MARKER = "«member-id»";

/** Replaces a matched email address. */
export const EMAIL_MARKER = "«email»";

/** Stands in for a value that referenced an ancestor. Prevents infinite recursion. */
export const CIRCULAR_MARKER = "«circular»";

/** Stands in for a subtree beyond `MAX_DEPTH`. */
export const DEPTH_MARKER = "«depth-limit»";

/** Headers that survive. Lowercase; comparison is case-insensitive. */
export const ALLOWED_HEADERS = ["user-agent", "accept", "content-type"] as const;

const ALLOWED_HEADER_SET: ReadonlySet<string> = new Set<string>(ALLOWED_HEADERS);

/**
 * Traversal bounds.
 *
 * Not performance tuning — a bound is what stops a hostile or accidental payload (a
 * deeply nested JSON body reflected into `extra`) from turning the scrub into the
 * denial of service, and what stops an unbounded array from being serialized whole
 * into an outbound request.
 */
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 8_000;

// ── Patterns (rule 6) ────────────────────────────────────────────────────────

/**
 * A START-SYS member ID: `2024-001`, and `2024-1000` once a join year passes 999
 * (`people.member_id_format` is `^\d{4}-\d{3,}$` — the `{3,}` is load-bearing).
 *
 * The lookaround is what keeps this from eating UUIDs. A uuid's middle groups look
 * like `-1234-5678-`, and a naive `\d{4}-\d{3,}` matches inside one. UUIDs are the
 * IDs this codebase logs ON PURPOSE — "log IDs, never values" — so destroying them
 * would remove the only debugging signal the scrub is supposed to preserve. Requiring
 * that neither side of the match is a word character or a hyphen excludes the embedded
 * case while still matching a member ID surrounded by spaces, quotes or punctuation.
 */
const MEMBER_ID_PATTERN = /(?<![\w-])\d{4}-\d{3,}(?![\w-])/g;

/**
 * An email address, deliberately permissive.
 *
 * Over-matching here costs a slightly less readable message. Under-matching costs an
 * applicant's address in a US error tracker. The asymmetry decides the tradeoff.
 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// ── Traversal state ──────────────────────────────────────────────────────────

type ScrubState = {
  removedKeys: number;
  redactedPatterns: number;
  /** Ancestors on the current path, for cycle detection. */
  seen: WeakSet<object>;
};

function newState(): ScrubState {
  return { removedKeys: 0, redactedPatterns: 0, seen: new WeakSet<object>() };
}

// ── Rule 6: string redaction ─────────────────────────────────────────────────

/**
 * Replace member-ID and email patterns in one string, counting the replacements.
 *
 * Internal — the counting variant. `redactPatterns` is the exported, state-free form.
 */
function redact(input: string, state: ScrubState): string {
  let count = 0;

  const truncated =
    input.length > MAX_STRING_LENGTH ? `${input.slice(0, MAX_STRING_LENGTH)}…«truncated»` : input;

  const withoutEmails = truncated.replace(EMAIL_PATTERN, () => {
    count += 1;
    return EMAIL_MARKER;
  });

  const withoutIds = withoutEmails.replace(MEMBER_ID_PATTERN, () => {
    count += 1;
    return MEMBER_ID_MARKER;
  });

  state.redactedPatterns += count;
  return withoutIds;
}

/**
 * Replace member-ID and email patterns in one string.
 *
 * Exported because the unit test asserts it directly — the pattern boundaries (a UUID
 * surviving, a member ID not) are the fiddliest part of this module and deserve
 * assertions that do not have to build a whole event first.
 */
export function redactPatterns(input: string): string {
  return redact(input, newState());
}

// ── Rule 5: the recursive walk ───────────────────────────────────────────────

/**
 * Deep-copy a value, deleting sensitive-named keys and pattern-redacting strings.
 *
 * Copies rather than mutates: `scrubEvent` must be safe to call on an object the
 * caller still holds, and a scrub that mutated its input would silently corrupt the
 * very context a developer is trying to read in a debugger.
 */
function scrubValue(value: unknown, depth: number, state: ScrubState): unknown {
  if (typeof value === "string") return redact(value, state);

  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  // A function or a symbol in an event payload is not data; it is a mistake. Drop the
  // reference rather than trying to serialize it.
  if (typeof value === "function" || typeof value === "symbol") return undefined;

  if (typeof value === "bigint") return value.toString();

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      type: value.name,
      value: redact(value.message, state),
      stack: value.stack === undefined ? undefined : redact(value.stack, state),
    };
  }

  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return DEPTH_MARKER;
    if (state.seen.has(value)) return CIRCULAR_MARKER;

    state.seen.add(value);

    try {
      if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY_ITEMS);
        const scrubbed = items.map((item) => scrubValue(item, depth + 1, state));
        if (value.length > MAX_ARRAY_ITEMS)
          scrubbed.push(`«${value.length - MAX_ARRAY_ITEMS} more»`);
        return scrubbed;
      }

      const out: Record<string, unknown> = {};

      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        // RULE 5. Deleted, not masked: a masked key still names a column of a
        // scholar's record in an outbound payload, and there is no reason to send one.
        if (isSensitiveKey(key)) {
          state.removedKeys += 1;
          continue;
        }

        const scrubbed = scrubValue(child, depth + 1, state);
        if (scrubbed !== undefined) out[key] = scrubbed;
      }

      return out;
    } finally {
      state.seen.delete(value);
    }
  }

  return undefined;
}

// ── Rule 2: URL reduction ────────────────────────────────────────────────────

/**
 * Reduce a URL to its pathname, dropping query string, fragment, host and credentials.
 *
 * The host is dropped as well as the query because it carries nothing: this is one
 * application on one domain, so the host is a constant, while a Supabase project ref
 * or a signed-upload host would be a leak of infrastructure detail for no benefit.
 *
 * @returns the pathname, or `"«unparseable»"` when the input is not a URL at all —
 *          never the original string, because "not parseable as a URL" is exactly the
 *          case where an unexpected value has ended up in this field.
 */
export function reducedPath(url: string): string {
  // A relative path is accepted ONLY when it actually looks like one. `new URL(x, base)`
  // will happily turn "not a url at all" into "/not%20a%20url%20at%20all" — so parsing
  // relatively first would echo arbitrary text back into the event under a field named
  // `url`, which is precisely the case this rule exists to prevent. Leading "/" is the
  // gate; the base is then only there to make the parse succeed and is discarded with
  // the origin.
  if (url.startsWith("/")) {
    try {
      return new URL(url, "http://localhost").pathname;
    } catch {
      return "«unparseable»";
    }
  }

  try {
    const parsed = new URL(url);
    // Reject a non-http scheme outright rather than reporting its path: `javascript:`,
    // `data:` and `blob:` URLs carry their payload IN the "path".
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "«unparseable»";
    return parsed.pathname;
  } catch {
    return "«unparseable»";
  }
}

// ── Rules 1 + 3: the request ─────────────────────────────────────────────────

function scrubRequest(
  request: ObservabilityRequest,
  state: ScrubState,
): ObservabilityRequest | undefined {
  const out: ObservabilityRequest = {};

  // RULE 1 — `data`, `cookies` and `query_string` are simply never copied across.
  // Expressed as an allowlist of what IS copied rather than a `delete` of what is not,
  // so a field added to the type in future is absent by default instead of present by
  // default. Deny-by-default is the same principle the schema runs on.

  if (request.url !== undefined) out.url = reducedPath(request.url);
  if (request.method !== undefined) out.method = String(request.method).toUpperCase();

  if (request.headers !== undefined && request.headers !== null) {
    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(request.headers)) {
      // RULE 3 — allowlist. `cookie` and `authorization` are excluded by not being
      // named, which is why a header nobody has thought of yet is also excluded.
      if (!ALLOWED_HEADER_SET.has(name.toLowerCase())) {
        state.removedKeys += 1;
        continue;
      }
      headers[name.toLowerCase()] = redact(String(value), state);
    }

    if (Object.keys(headers).length > 0) out.headers = headers;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

// ── Rule 4: the user ─────────────────────────────────────────────────────────

/**
 * Reduce a user to `{ id }`.
 *
 * An `auth.users` uuid is what makes an event actionable and is already what this
 * codebase logs everywhere else. An email is personal data; an IP address is personal
 * data under RA 10173 and is why `lib/rate-limit/` HMACs its subject before storing it
 * — sending one to an error tracker would undo that decision from the other side.
 */
function scrubUser(user: ObservabilityUser, state: ScrubState): ObservabilityUser | undefined {
  const id = typeof user.id === "string" && user.id.trim() !== "" ? user.id : undefined;

  for (const key of Object.keys(user)) {
    if (key !== "id") state.removedKeys += 1;
  }

  return id === undefined ? undefined : { id: redact(id, state) };
}

// ── The entry point ──────────────────────────────────────────────────────────

/**
 * Scrub one event. Pure: returns a new object and never mutates the input.
 *
 * This is the function that becomes `Sentry.init({ beforeSend })` verbatim when the
 * SDK is adopted (ADR 0008). Until then `instrumentation.ts`'s `reportError` calls it,
 * and `scrub.integration.test.ts` proves that pipeline cannot deliver an event that
 * has not been through here.
 */
export function scrubEvent(event: ObservabilityEvent): ObservabilityEvent {
  const state = newState();
  const out: ObservabilityEvent = {};

  if (event.message !== undefined) out.message = redact(event.message, state);
  if (event.level !== undefined) out.level = event.level;
  if (event.timestamp !== undefined) out.timestamp = event.timestamp;
  if (event.release !== undefined) out.release = event.release;
  if (event.environment !== undefined) out.environment = event.environment;

  if (Array.isArray(event.exception)) {
    // The message and the stack are the ENTIRE diagnostic value of an event, so they
    // are pattern-redacted rather than dropped — rule 6 is what makes keeping them safe.
    out.exception = event.exception.slice(0, MAX_ARRAY_ITEMS).map((entry) => {
      const scrubbed: ObservabilityException = {};
      if (entry.type !== undefined) scrubbed.type = entry.type;
      if (entry.value !== undefined) scrubbed.value = redact(entry.value, state);
      if (entry.stack !== undefined) scrubbed.stack = redact(entry.stack, state);
      return scrubbed;
    });
  }

  if (event.request !== undefined && event.request !== null) {
    const request = scrubRequest(event.request, state);
    // Counted whether or not they were present: a caller that never attached a body
    // and one whose body was removed both report "the body is not here", which is the
    // only claim this field should be read as making.
    if (event.request.data !== undefined) state.removedKeys += 1;
    if (event.request.cookies !== undefined) state.removedKeys += 1;
    if (event.request.query_string !== undefined) state.removedKeys += 1;
    if (request !== undefined) out.request = request;
  }

  if (event.user !== undefined && event.user !== null) {
    const user = scrubUser(event.user, state);
    if (user !== undefined) out.user = user;
  }

  if (event.extra !== undefined && event.extra !== null) {
    const extra = scrubValue(event.extra, 0, state);
    if (extra !== null && typeof extra === "object" && Object.keys(extra).length > 0) {
      out.extra = extra as Record<string, unknown>;
    }
  }

  if (event.tags !== undefined && event.tags !== null) {
    const tags: Record<string, string> = {};
    for (const [name, value] of Object.entries(event.tags)) {
      if (isSensitiveKey(name)) {
        state.removedKeys += 1;
        continue;
      }
      tags[name] = redact(String(value), state);
    }
    if (Object.keys(tags).length > 0) out.tags = tags;
  }

  out.scrub = {
    v: 1,
    removed_keys: state.removedKeys,
    redacted_patterns: state.redactedPatterns,
  };

  return out;
}

/**
 * The key list this module enforces, re-exported for the tests and for
 * `scripts/audit-client-bundle.mjs`'s sibling reasoning. Re-exported rather than
 * re-declared — one list, and the mirror discipline is documented at its source.
 */
export { SENSITIVE_KEYS };
