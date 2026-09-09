// ─────────────────────────────────────────────────────────────────────────────
// Calling a Server Action from the public forms WITHOUT the possibility of a hang.
//
// FINDING A10 (QA 2026-09-09): an applicant who submitted while a deploy was landing sat
// on "Finishing up…" forever. `finalizeApplication`'s POST 404'd — Server Action ids are
// build-scoped, so a redeploy invalidates the id the loaded page holds — the promise
// REJECTED rather than resolving to an `ActionResult`, and every error branch in the form
// tests `isErr(result)` on a value that never arrived. Nothing set the phase back, so the
// button stayed disabled and the screen stayed on its progress label. The applicant's
// documents were already uploaded; only the flip to `pending` was lost.
//
// A rejected Server Action is not exotic. It happens on a redeploy, on a dead connection,
// on a captive portal, and on a mobile network that drops mid-request — all of which are
// ordinary conditions for a scholar filling this form on a phone.
//
// So: every Server Action call from the public forms goes through `callAction`, which
//   1. catches the rejection and turns it into an ordinary `ActionResult` failure, and
//   2. imposes a deadline, because a request that never settles is the same defect as a
//      rejection the caller ignored — the UI waits forever either way.
//
// The result is always an `ActionResult`. The caller's existing `isErr` branch is what
// handles it, so the failure lands on the screen instead of in a dropped promise.
// ─────────────────────────────────────────────────────────────────────────────

import { err, type ActionResult } from "@/lib/action-result";

/**
 * How long a public-form Server Action may take before it is treated as failed.
 *
 * 45 seconds, not 10: `finalizeApplication` re-fetches BOTH uploaded documents' metadata
 * from the storage provider and sniffs their magic bytes before it returns, and this runs
 * on Philippine mobile data. A deadline shorter than the slow-but-working case turns a
 * successful submission into a retry, and the retry costs another round of the same work.
 */
export const ACTION_DEADLINE_MS = 45_000;

/**
 * The message an applicant sees when the call did not come back.
 *
 * Deliberately says the submission MAY not have gone through, and that retrying is safe.
 * Both are true: `finalize_application()` (0019) is idempotent on the same token and file,
 * so a retry after a response that was lost in transit is a no-op rather than a second
 * application — and telling someone their data is "lost" when it is sitting in a draft row
 * is how CRRD gets an inbox full of duplicate submissions.
 */
export const ACTION_UNREACHABLE_MESSAGE =
  "We could not reach the server to finish your submission. Your connection may have " +
  "dropped, or the site may have just been updated. Nothing was lost — press Submit " +
  "again to retry.";

/**
 * Run a Server Action, converting a rejection or a timeout into an `ActionResult` failure.
 *
 * `upstream` is the right code for both: the call never reached a decision, which is
 * distinct from `validation` (the server decided no) and from `conflict` (the server
 * decided something else happened first).
 */
export async function callAction<T>(
  run: () => Promise<ActionResult<T>>,
  deadlineMs: number = ACTION_DEADLINE_MS,
): Promise<ActionResult<T>> {
  const timeout = new Promise<ActionResult<T>>((resolve) => {
    setTimeout(() => resolve(err<T>("upstream", ACTION_UNREACHABLE_MESSAGE)), deadlineMs);
  });

  try {
    // `Promise.race` and not an AbortController: a Server Action call takes no signal, so
    // the request cannot actually be cancelled. The deadline releases the UI, and if the
    // request does eventually land it is harmless — the actions this wraps are idempotent.
    return await Promise.race([run(), timeout]);
  } catch {
    // The rejection itself is NOT surfaced or logged. It can carry the request body in a
    // framework error message, and this form's body is a scholar's birthdate, address and
    // contact number (`no-console` is an eslint error under lib/** for the same reason).
    return err<T>("upstream", ACTION_UNREACHABLE_MESSAGE);
  }
}
