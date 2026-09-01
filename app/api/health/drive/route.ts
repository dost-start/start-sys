// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health/drive — the document-store liveness probe (BUILD_PLAN S7-T5, S7-T17).
//
// THE FAILURE THIS EXISTS TO CATCH: a Google service-account key expires, a Shared
// Drive permission is revoked at handover, or a Storage bucket policy changes — and
// nothing tells anybody, because uploads only happen during application season. The
// first symptom would otherwise be an applicant, on a phone, at 11pm, watching a
// progress bar fail. `.github/workflows/scheduled.yml` calls this daily so the CTO
// learns it months earlier.
//
// IT REPORTS THE DRIVER THAT ACTUALLY SHIPPED, which S7 needs for two things beyond
// the check itself: the privacy notice's processor list and the RA 10173 processing
// register. A notice naming Google Drive while the files sit in Supabase Storage
// misstates where personal data lives, which is worse than no notice at all
// (ADR 0005; docs/RUNBOOK.md "Document store swap" step 5).
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY IT IS GUARDED AT ALL — it returns no records
// ═══════════════════════════════════════════════════════════════════════════════
// Two reasons, neither of them confidentiality of the response:
//   1. EVERY CALL COSTS A GOOGLE API REQUEST. An unauthenticated probe is a free
//      quota-exhaustion lever against the upload path, aimed by anyone who finds the
//      URL. Exhaust the quota and applications stop being submittable.
//   2. The driver name is a small piece of infrastructure inventory. Not a secret, but
//      not something to hand to a stranger either.
//
// Two accepted callers, and no third: the scheduled job (a shared secret in a HEADER,
// compared in constant time) and a signed-in `tech_admin` — the CTO, who is the role
// that would be debugging this at all (ARCHITECTURE.md §5). Note the asymmetry with
// `/api/health`, which is deliberately open: that one exposes a status word and has to
// be reachable by an external monitor that cannot log in.
//
// NO PROVIDER MESSAGE LEAVES THIS ROUTE. A Google error body names the service account,
// the folder and the Drive; a Supabase Storage error names the project ref. Failure is
// the fixed `ActionError` shape and a 500 (CONVENTIONS.md §4.4).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { type ActionError, type ErrorCode, err, isErr } from "@/lib/action-result";
import { getSessionContext } from "@/lib/auth/queries";
import { pingDocumentStore } from "@/lib/documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The header `.github/workflows/scheduled.yml` sends. Never a query parameter: a query string lands in access logs, proxy logs and browser history. */
const SECRET_HEADER = "x-job-secret";

const NO_STORE = { "cache-control": "no-store" } as const;

function actionError(code: ErrorCode): ActionError {
  const result = err(code);
  return isErr(result) ? result.error : { code, message: "Something went wrong." };
}

/**
 * Constant-time comparison of two secrets of possibly different lengths.
 *
 * `timingSafeEqual` throws when the buffers differ in length, and the length alone
 * would then leak through the exception. Comparing fixed-width sha256 digests makes the
 * comparison both constant-time and length-independent. Same helper shape as
 * `app/api/jobs/purge-abandoned-drafts/route.ts` — deliberately duplicated rather than
 * shared, because a shared "auth helper" is where an accidental early-return goes to
 * live unnoticed.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Is this caller allowed to spend a provider API request?
 *
 * The job secret is checked first because it is the common path and needs no database
 * round trip. A missing `JOB_SHARED_SECRET` does NOT fall through to "no secret
 * required" — that would leave the endpoint open on a misconfigured deployment — it
 * simply means the header path cannot authorize, and the session path still can.
 */
async function isAuthorized(request: Request): Promise<boolean> {
  const expected = process.env.JOB_SHARED_SECRET;
  const provided = request.headers.get(SECRET_HEADER);

  if (expected && provided && secretMatches(provided, expected)) return true;

  // The role is read live from `user_roles` on this request — never from a JWT claim,
  // so a CTO whose role was revoked this morning is refused this afternoon
  // (ARCHITECTURE.md §5).
  const session = await getSessionContext();
  return session?.role === "tech_admin";
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!(await isAuthorized(request))) {
    return NextResponse.json(actionError("unauthorized"), { status: 401, headers: NO_STORE });
  }

  try {
    // Whatever `DOCUMENT_STORE` selects: a Drive metadata read, a Storage list, or —
    // under the fake driver — nothing at all. Reporting the driver name is what tells
    // an operator that a deployment answering `fake` is not production.
    const { driver } = await pingDocumentStore();

    return NextResponse.json({ status: "ok", driver }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json(actionError("upstream"), { status: 500, headers: NO_STORE });
  }
}
