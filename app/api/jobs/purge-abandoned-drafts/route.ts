// ─────────────────────────────────────────────────────────────────────────────
// THE ABANDONED-DRAFT SWEEP (BUILD_PLAN S3-T8, S3-T22; PRD US-J2, US-J3).
//
// An application draft holds a real person's birthdate, address, contact number and
// school ID for someone who never completed a submission. It is the WEAKEST RETENTION
// BASIS IN THE SYSTEM — there is no membership, no application, no decision, nothing
// the org can point at to justify keeping it — so it is swept nightly.
//
// The sweep destroys data on BOTH sides of the document boundary. Clearing the database
// row while leaving the uploaded Certificate of Registration in the store forever is the
// most common way this requirement is quietly failed, so this endpoint deletes each
// returned object AND reconciles orphans: files whose upload succeeded but whose
// finalize never ran, so the database holds no pointer to delete.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE MAY USE THE SERVICE-ROLE CLIENT
// ═══════════════════════════════════════════════════════════════════════════════
// `lib/server/admin-client.ts` names its permitted callers, and item 2 is "scheduled
// job endpoints under app/api/jobs/**, invoked by .github/workflows/scheduled.yml
// behind JOB_SHARED_SECRET". This is a JOB, not request-handling code: it acts as the
// system, not as a person, and `purge_abandoned_drafts()` is granted to `service_role`
// and revoked from PUBLIC, anon and authenticated precisely so that no human role can
// reach it (0020). The eslint disable below is that sanctioned case, and it is written
// out rather than solved by editing the rule — CLAUDE.md: "if you find yourself editing
// that rule, stop and ask."
//
// NOTHING IS LOGGED AND NOTHING IS RETURNED BUT COUNTS. Not an application id, not a
// storage ref, not an applicant's name. `no-console` is an eslint error under `app/**`.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

// eslint-disable-next-line no-restricted-imports -- job endpoint: the backup/job surface admin-client exists for (see its header, permitted caller 2)
import { createAdminClient } from "@/lib/server/admin-client";
import { getDocumentStore } from "@/lib/documents";

/** A job runs against live data; it must never be prerendered or cached. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The header `.github/workflows/scheduled.yml` sends. */
const SECRET_HEADER = "x-job-secret";

type JobResponse = {
  redacted: number;
  documentsDeleted: number;
  orphansDeleted: number;
};

/**
 * Constant-time comparison of two secrets of possibly different lengths.
 *
 * `timingSafeEqual` throws when the buffers differ in length, and length alone would
 * otherwise leak through the exception. Comparing fixed-width sha256 digests makes the
 * comparison constant-time AND length-independent.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { code: "unauthorized", message: "You do not have permission to perform this action." },
    { status: 401 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.JOB_SHARED_SECRET;

  // A missing secret is a misconfigured deployment, not a failed authentication. It must
  // NOT fall through to "no secret required" — that would leave the endpoint open.
  if (!expected) {
    return NextResponse.json(
      { code: "unknown", message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }

  const provided = request.headers.get(SECRET_HEADER);
  if (!provided || !secretMatches(provided, expected)) return unauthorized();

  const admin = createAdminClient();
  const store = getDocumentStore();

  // ── 1. Redact, and collect the documents to destroy ─────────────────────────
  // The default 30-day age lives in the SQL, not here, so the retention rule has one
  // home (0020). No audit insert for the redaction itself: trg_applications_audit fires
  // once per redacted row and masks the sensitive columns before writing, which is why
  // the audit trail proving the sweep ran does not become a copy of what it destroyed.
  const { data: purged, error: purgeError } = await admin.rpc("purge_abandoned_drafts", {});

  if (purgeError) {
    return NextResponse.json(
      { code: "unknown", message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }

  const rows: Array<{ application_id: string; storage_ref: string | null }> = purged ?? [];

  let documentsDeleted = 0;
  for (const row of rows) {
    if (!row.storage_ref) continue;
    try {
      await store.deleteDocument(row.storage_ref);
      documentsDeleted += 1;
    } catch {
      // Tolerated: a ref that is already gone is the outcome we wanted. Deleting is
      // idempotent by contract, and a provider outage is retried by tomorrow's run
      // (and by the orphan pass below, which no longer sees a pointer to this file).
    }
  }

  // ── 2. Orphan reconciliation ────────────────────────────────────────────────
  // The case step 1 structurally cannot cover: the browser's direct PUT succeeded but
  // `finalizeApplication` never ran, so no row ever recorded the ref. Nothing points at
  // the file, so nothing would ever delete it — a Certificate of Registration living in
  // the store forever with no record that it exists.
  //
  // `knownRefs` is every ref the database still references. `listOrphans` returns what
  // the store holds that this list does not mention.
  let orphansDeleted = 0;
  const { data: known, error: knownError } = await admin
    .from("applications")
    .select("proof_drive_file_id")
    .not("proof_drive_file_id", "is", null);

  if (!knownError && known) {
    const knownRefs = known
      .map((row: { proof_drive_file_id: string | null }) => row.proof_drive_file_id)
      .filter((ref): ref is string => ref !== null);

    try {
      for (const ref of await store.listOrphans(knownRefs)) {
        try {
          await store.deleteDocument(ref);
          orphansDeleted += 1;
        } catch {
          // Same tolerance as above; tomorrow's run sees it again.
        }
      }
    } catch {
      // The store could not enumerate. The redaction above still happened and is the
      // part with a legal deadline; reconciliation retries tomorrow.
    }
  }

  // ── 3. One audit row for the job itself ─────────────────────────────────────
  // The per-row trigger records WHAT was redacted. This records THAT the sweep ran, with
  // counts only — an operation a human can look for in `/admin/audit` when asking
  // "did the nightly purge happen?". `note` carries numbers and nothing else: the audit
  // log holds no PII, which is what lets it be append-only (DATA_MODEL.md §8.3).
  await admin.from("audit_log").insert({
    actor_user_id: null,
    actor_role: "system",
    table_name: "applications",
    row_id: null,
    operation: "PURGE",
    note:
      `purge_abandoned_drafts: redacted=${rows.length} ` +
      `documents_deleted=${documentsDeleted} orphans_deleted=${orphansDeleted}`,
  });

  const body: JobResponse = {
    redacted: rows.length,
    documentsDeleted,
    orphansDeleted,
  };

  return NextResponse.json(body, { status: 200 });
}
