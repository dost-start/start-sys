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
import { reportError } from "@/instrumentation";

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
    } catch (error) {
      // CONVENTIONS.md §4.3 — the raw error goes to the reporter, the caller gets a code.
      void reportError(error, { tags: { route: "api/jobs/purge-abandoned-drafts" } });
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
  // The renewal form's drafts hold the same PII on the same 30-day basis (0044).
  let renewalsRedacted = 0;
  const { data: purgedRenewals } = await admin.rpc("purge_abandoned_renewal_drafts", {});
  for (const row of (purgedRenewals ?? []) as Array<{
    renewal_id: string;
    storage_ref: string | null;
    noa_ref: string | null;
  }>) {
    renewalsRedacted += 1;
    for (const ref of [row.storage_ref, row.noa_ref]) {
      if (!ref) continue;
      try {
        await store.deleteDocument(ref);
        documentsDeleted += 1;
      } catch (error) {
        // CONVENTIONS.md §4.3 — the raw error goes to the reporter, the caller gets a code.
        void reportError(error, { tags: { route: "api/jobs/purge-abandoned-drafts" } });
        // already gone, or the store is unreachable — the next run retries via orphans
      }
    }
  }

  let orphansDeleted = 0;
  // Every column that can hold a live document ref. `applications.noa_drive_file_id`
  // (0040) and the whole of `renewal_submissions` (0044) were both added after this
  // reconciliation query was first written, and neither was ever added here — so every
  // Notice-of-Award file, and every renewal's proof/NOA file, was invisible to
  // `knownRefs` and got deleted as a false "orphan" on the very next nightly run, live
  // and approved records included (found 2026-09-08, QA review of `main`). If ANY of the
  // four reads below fails, `known` is left `null` for that source and the whole pass is
  // skipped — a partial known-set is more dangerous than skipping a night, because it
  // would delete real, referenced files.
  // PAGINATE. PostgREST caps every response at `max_rows` (config.toml = 1000) with NO
  // error and NO signal — a full page just means "there may be more". The previous version
  // read each column once with no `.range()`, so once any of these tables passed 1000 rows
  // (well within the system's own 5-term / ~600-member scale) `knownRefs` silently held
  // only the first 1000, and every Drive file behind a row past #1000 — real, approved
  // members' Certificates of Registration and Notices of Award — was classified an orphan
  // and permanently deleted (QA 2026-09-11, DOCS-01). Reading in full pages closes that.
  // A PAGE of exactly this size means "keep going"; a short page is the end.
  const PAGE = 1000;
  const collectRefs = async (
    table: "applications" | "renewal_submissions",
    col: "proof_drive_file_id" | "noa_drive_file_id",
  ): Promise<string[]> => {
    const refs: string[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from(table)
        .select(col)
        .not(col, "is", null)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const page = (data ?? []) as Array<Record<string, string | null>>;
      for (const row of page) {
        const ref = row[col];
        if (ref != null) refs.push(ref);
      }
      if (page.length < PAGE) break;
    }
    return refs;
  };

  // A PARTIAL known-set must NEVER drive deletes — that is the whole hazard. If any read
  // fails, leave knownRefs null and skip the orphan pass entirely tonight; the redaction
  // above (the part with a legal deadline) already happened, and reconciliation retries
  // tomorrow.
  let knownRefs: string[] | null = null;
  try {
    const groups = await Promise.all([
      collectRefs("applications", "proof_drive_file_id"),
      collectRefs("applications", "noa_drive_file_id"),
      collectRefs("renewal_submissions", "proof_drive_file_id"),
      collectRefs("renewal_submissions", "noa_drive_file_id"),
    ]);
    knownRefs = groups.flat();
  } catch (error) {
    void reportError(error, { tags: { route: "api/jobs/purge-abandoned-drafts" } });
  }

  if (knownRefs !== null) {
    try {
      for (const ref of await store.listOrphans(knownRefs)) {
        try {
          await store.deleteDocument(ref);
          orphansDeleted += 1;
        } catch (error) {
          // CONVENTIONS.md §4.3 — the raw error goes to the reporter, the caller gets a code.
          void reportError(error, { tags: { route: "api/jobs/purge-abandoned-drafts" } });
          // Same tolerance as above; tomorrow's run sees it again.
        }
      }
    } catch (error) {
      // CONVENTIONS.md §4.3 — the raw error goes to the reporter, the caller gets a code.
      void reportError(error, { tags: { route: "api/jobs/purge-abandoned-drafts" } });
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
      `purge_abandoned_drafts: redacted=${rows.length} renewals_redacted=${renewalsRedacted} ` +
      `documents_deleted=${documentsDeleted} orphans_deleted=${orphansDeleted}`,
  });

  const body: JobResponse = {
    redacted: rows.length,
    documentsDeleted,
    orphansDeleted,
  };

  return NextResponse.json(body, { status: 200 });
}
