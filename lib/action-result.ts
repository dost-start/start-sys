// ─────────────────────────────────────────────────────────────────────────────
// The return contract for every Server Action in START-SYS (CONVENTIONS.md §4.2).
//
// Two rules this module exists to make structural rather than remembered:
//
//   1. EXPECTED failures are RETURNED, not thrown. A closed application window, a
//      denied write, a stale optimistic-concurrency token — these are outcomes the
//      UI renders, not crashes. Only programmer errors throw (CONVENTIONS §4.3).
//
//   2. A raw PostgREST / Postgres error NEVER reaches the client. `mapDbError`
//      collapses it to one of seven codes with a fixed, user-safe message. The raw
//      error is not stored on the returned object and is not logged here — this
//      module has no logging (`no-console` is an error under `lib/**`, and PII must
//      never be logged: CLAUDE.md "Privacy"). Sentry is wired in S3-T24/S7-T8 and is
//      where a raw error goes, after `beforeSend` has stripped the request body.
//
// THE LOAD-BEARING MAPPING: an empty result caused by RLS is `not_found`, never
// `unauthorized`. Saying "forbidden" confirms the row exists, which discloses that a
// named scholar has a record — a leak with no data in it (CONVENTIONS §4.3).
// ─────────────────────────────────────────────────────────────────────────────

/** The complete set of failure codes. Nothing outside this union may be returned. */
export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "window_closed"
  | "upstream"
  | "unknown";

export type ActionError = {
  code: ErrorCode;
  /** Safe to render to a user verbatim. Never contains a DB message or a field value. */
  message: string;
  /** Field-level messages keyed by the zod issue path, e.g. `{ review_note: [...] }`. */
  fields?: Record<string, string[]>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** The message returned for each code. Fixed strings — never interpolated with DB text. */
const MESSAGES: Record<ErrorCode, string> = {
  validation:
    "Some of the information provided is not valid. Please check the fields and try again.",
  unauthorized: "You do not have permission to perform this action.",
  not_found: "That record could not be found.",
  conflict: "That change conflicts with the current state of the record. Reload and try again.",
  window_closed: "The application period is not open.",
  upstream: "An external service is unavailable right now. Please try again shortly.",
  unknown: "Something went wrong. Please try again.",
};

/** Success. */
export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** Failure, with the standard message for the code unless one is supplied. */
export function err<T = never>(
  code: ErrorCode,
  message?: string,
  fields?: Record<string, string[]>,
): ActionResult<T> {
  const error: ActionError = { code, message: message ?? MESSAGES[code] };
  if (fields !== undefined) error.fields = fields;
  return { ok: false, error };
}

/** Narrowing helpers, so callers do not re-derive the discriminant. */
export function isOk<T>(result: ActionResult<T>): result is { ok: true; data: T } {
  return result.ok;
}

export function isErr<T>(result: ActionResult<T>): result is { ok: false; error: ActionError } {
  return !result.ok;
}

// ── Database error mapping ───────────────────────────────────────────────────

/**
 * Structural shape of a PostgREST error. Deliberately not the imported
 * `PostgrestError` type: `mapDbError` accepts anything (a thrown value, a network
 * failure, `null`) and must not crash while classifying it.
 */
type MaybeDbError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

/** SQLSTATE / PostgREST codes with a defined meaning for the UI. */
const CODE_MAP: Record<string, ErrorCode> = {
  // PostgREST: "JSON object requested, multiple (or no) rows returned" — the shape an
  // RLS-filtered `.single()` takes. NOT unauthorized: see the header note.
  PGRST116: "not_found",
  // PostgREST: schema cache miss for a table/column the caller cannot see.
  PGRST205: "not_found",
  // insufficient_privilege — a policy or a GRANT refused the statement outright.
  "42501": "unauthorized",
  // unique_violation — e.g. a second membership for the same (person, term).
  "23505": "conflict",
  // serialization_failure — used by update_member_record()'s optimistic concurrency
  // check (S5-T7): somebody else wrote the row first. The user reloads; nothing is lost.
  "40001": "conflict",
  // check_violation — a DB-level CHECK the client-side schema should have caught first
  // (e.g. `rejected_has_reason`). Surfacing it as `validation` keeps the form usable.
  "23514": "validation",
  // not_null_violation.
  "23502": "validation",
  // invalid_text_representation — a malformed uuid/date reached the database.
  "22P02": "validation",
  // foreign_key_violation — the referenced row is gone or was never visible.
  "23503": "conflict",
};

/**
 * Map any database or transport failure to a safe `ActionError`.
 *
 * `window_closed` is deliberately NOT produced here. A closed application window is a
 * refused INSERT, which arrives as 42501 and is indistinguishable from any other
 * policy denial at this layer — the intake action classifies it itself, because the
 * closure is public information and is the one place a distinct code is correct
 * (BUILD_PLAN S3-T15).
 *
 * @param raw the caught value. Never returned, never logged, never interpolated.
 */
export function mapDbError(raw: unknown): ActionError {
  if (raw === null || raw === undefined) {
    // An action that reached the error branch with nothing to classify almost always
    // means "the query returned no rows" — see ARCHITECTURE.md §9.
    return { code: "not_found", message: MESSAGES.not_found };
  }

  if (typeof raw === "object") {
    const candidate = raw as MaybeDbError;
    const code = typeof candidate.code === "string" ? candidate.code : null;

    if (code !== null) {
      const mapped = CODE_MAP[code];
      if (mapped !== undefined) return { code: mapped, message: MESSAGES[mapped] };

      // Class 08 — connection exception. Class 57 — operator intervention
      // (admin shutdown, query cancelled). Both are the database being unreachable
      // rather than the caller being wrong.
      if (code.startsWith("08") || code.startsWith("57")) {
        return { code: "upstream", message: MESSAGES.upstream };
      }
    }
  }

  return { code: "unknown", message: MESSAGES.unknown };
}

// ── Zod error mapping ────────────────────────────────────────────────────────

/**
 * Structural shape of a `ZodError`. Structural rather than imported so this module
 * carries no runtime dependency on zod and can be used from an edge handler.
 */
type ZodLikeError = {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
};

/** Issues whose path is empty are form-level, not field-level. */
export const FORM_ERROR_KEY = "_form";

/**
 * Turn a failed `schema.safeParse` into an `ActionError` whose `fields` map feeds
 * straight into react-hook-form's `setError` (CONVENTIONS §6 — server field errors are
 * attached to their inputs, never dropped into a generic toast).
 *
 * Keys are the dotted zod path, which by convention equals the form field `name`,
 * which by convention equals the database column name.
 */
export function toFieldErrors(error: ZodLikeError): ActionError {
  const fields: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : FORM_ERROR_KEY;
    const existing = fields[key];
    if (existing === undefined) {
      fields[key] = [issue.message];
    } else {
      existing.push(issue.message);
    }
  }

  return { code: "validation", message: MESSAGES.validation, fields };
}

/** Convenience: the failed half of `safeParse` straight to an `ActionResult`. */
export function validationFailure<T = never>(error: ZodLikeError): ActionResult<T> {
  return { ok: false, error: toFieldErrors(error) };
}
