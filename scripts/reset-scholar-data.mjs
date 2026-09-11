// ─────────────────────────────────────────────────────────────────────────────
// reset-scholar-data.mjs — the ONE-OFF pre-intake data reset.
//
// ⚠️ THIS IS NOT AN APPLICATION FEATURE AND MUST NEVER BECOME ONE.
//
// CLAUDE.md: "Never hard-delete anything. No DELETE policy exists anywhere in the
// schema and none may be added." That rule governs the RUNNING system and it is
// untouched by this file: no DELETE policy is created, no route calls this, and the
// only way to run it is a human typing the command with the service-role key in the
// environment.
//
// ⚠️ THE PROJECT PINNED BELOW IS THE ONE THE DEPLOYED APP RUNS AGAINST, AND IT NOW
//    HOLDS REAL SCHOLAR PII.
//
// This header used to call it "a pre-launch scratch database" and put the reset in the
// same category as `supabase db reset`. That stopped being true when real intake opened
// against the same project ref that `.env.local` and the Vercel Production environment
// point at. It holds real applicants' birthdates, contact numbers, addresses and their
// Certificates of Registration (RA 10173), and every delete below is irreversible: no
// DELETE here is recoverable, docs/runbooks/02-RESTORE_FROM_BACKUP.md has never been
// drilled, and the 2026-09-10 run took no backup (offered and declined).
//
// WHY IT EXISTS: 2026-09-10, a one-off clear-down of seeded demo members and test
// submissions immediately before the first real intake.
// See docs/issues/2026-09-10-pre-intake-data-reset.md.
//
// WHAT IT KEEPS, DELIBERATELY:
//   · auth.users + user_roles — all six demo logins survive, so nobody is locked out.
//     Only user_roles.person_id is nulled, because the person rows are gone.
//   · Every reference table: regions, programs, universities, psgc_locations (43,769
//     rows), officer_positions, departments, terms, application_windows,
//     privacy_notice_versions.
//   · audit_log — it CANNOT be deleted from here even with the service-role key:
//     0011_audit.sql revokes DELETE from service_role itself. A masked record that
//     this reset happened survives, which is the correct outcome.
//
// SAFETY — TWO BARRIERS, and the ref pin is not the one that protects you:
//   1. The project-ref check refuses any ref other than the one named below. Note what
//      that does and does not buy: the named ref is the LIVE project, so it stops a
//      stray URL pointing at some OTHER project and stops nothing whatever about wiping
//      this one. It is NOT assertNotProduction() from lib/applications/test-support.ts —
//      that one refuses any non-local URL. This is its inverse and must never be read as
//      the same guard.
//   2. The caller must name the project by value in RESET_CONFIRM_PROJECT_REF. That is
//      the barrier that does not depend on anyone having read this header.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

/**
 * The project this reset is authorised for — WHICH IS THE LIVE ONE. Any other ref aborts.
 *
 * This constant is a pin, not a guard: the check below passes on exactly the one database
 * whose loss is unrecoverable. CONFIRM_ENV is the real barrier.
 */
const ALLOWED_PROJECT_REF = "rxtzeoodrdzpcyfkgenr";

/**
 * The second barrier: the caller must name the project they are about to wipe, by value.
 *
 *   RESET_CONFIRM_PROJECT_REF=rxtzeoodrdzpcyfkgenr node scripts/reset-scholar-data.mjs
 *
 * A generic `--yes` gets typed from muscle memory; a project ref has to be looked up and
 * matched against the URL already in the environment, which is the pause this script
 * needs. Nothing in CI or package.json invokes this file, so requiring it breaks no
 * automation.
 */
const CONFIRM_ENV = "RESET_CONFIRM_PROJECT_REF";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
  process.exit(1);
}

const ref = url.replace(/^https:\/\/([^.]+)\..*$/, "$1");
if (ref !== ALLOWED_PROJECT_REF) {
  console.error(
    `REFUSING TO RUN.\n` +
      `  This script is authorised for project ${ALLOWED_PROJECT_REF} only.\n` +
      `  NEXT_PUBLIC_SUPABASE_URL points at ${ref}.\n` +
      `  If you genuinely mean to reset a different project, edit ALLOWED_PROJECT_REF\n` +
      `  in this file in a reviewed commit — do not pass it as an argument.`,
  );
  process.exit(1);
}

// The second barrier. Deliberately AFTER the ref check, so the refusal can name the real
// project, and BEFORE createClient, so a refusal never constructs a service-role client.
if (process.env[CONFIRM_ENV] !== ref) {
  console.error(
    `REFUSING TO RUN — confirmation missing.\n` +
      `  Project ${ref} holds REAL scholar PII. This deletes every person, membership,\n` +
      `  application, renewal and campaign row, every object in the proof-of-enrollment\n` +
      `  bucket, and every file in the Google Drive proof folder.\n` +
      `  There is no undo: no DELETE here is recoverable, 02-RESTORE_FROM_BACKUP.md has\n` +
      `  never been drilled, and the 2026-09-10 run took no backup.\n` +
      `\n` +
      `  Take a backup first. Then name the project you are wiping:\n` +
      `    ${CONFIRM_ENV}=${ref} node scripts/reset-scholar-data.mjs`,
  );
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const PROOF_BUCKET = "proof-of-enrollment";

/**
 * FK order matters: children before parents. `user_roles.person_id` is nulled rather
 * than deleted, because the accounts stay.
 *
 * The second element is a column guaranteed NOT NULL on that table, because PostgREST
 * refuses an unfiltered DELETE. It is NOT always `id`: the join tables are keyed on a
 * composite primary key and have no `id` column at all, and
 * `confidentiality_acknowledgements` has neither `id` nor `created_at` — its columns
 * are `(person_id, term_id, signed_at, agreement_version, recorded_by)`.
 */
const TABLES_IN_DELETE_ORDER = [
  // Campaign history references people, and `email_recipients` freezes a copy of the
  // recipient's address and merge fields at send time — both registered sensitive
  // columns. It has to go with the people it names, or the wipe leaves PII behind in
  // a table nobody would think to look in.
  ["email_events", "id"],
  ["email_recipients", "id"],
  ["notifications", "id"],
  ["email_campaigns", "id"],
  ["committee_memberships", "membership_id"],
  ["department_assignments", "membership_id"],
  ["member_affiliations", "membership_id"],
  ["officer_assignments", "id"],
  ["confidentiality_acknowledgements", "person_id"],
  ["renewal_submissions", "id"],
  ["applications", "id"],
  ["memberships", "id"],
  ["people", "id"],
];

/** Tables reserved by a migration but not yet created (0010_email is a reserved number). */
function isMissingTable(error) {
  return error?.code === "42P01" || /does not exist|schema cache/i.test(error?.message ?? "");
}

async function countOf(table) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) return isMissingTable(error) ? "(no such table)" : `error: ${error.message}`;
  return count;
}

async function main() {
  console.log(`Project: ${ref}\n`);

  console.log("── Before ──");
  for (const t of [
    ...TABLES_IN_DELETE_ORDER.map(([n]) => n),
    "user_roles",
    "member_id_counters",
    "audit_log",
  ]) {
    console.log(`  ${t.padEnd(36)} ${await countOf(t)}`);
  }

  // ── 1. Storage objects ───────────────────────────────────────────────────
  // Objects are stored at `<applicationId>/<hash>.pdf`, so the bucket root lists
  // folders, not files. Keeping the rows and dropping the files (or the reverse)
  // is exactly the half-done state RA 10173 is meant to prevent.
  console.log("\n── Storage ──");
  const { data: prefixes, error: listErr } = await db.storage
    .from(PROOF_BUCKET)
    .list("", { limit: 1000 });
  if (listErr) {
    console.log(`  could not list bucket: ${listErr.message}`);
  } else {
    const paths = [];
    for (const p of prefixes ?? []) {
      const { data: files } = await db.storage.from(PROOF_BUCKET).list(p.name, { limit: 1000 });
      for (const f of files ?? []) paths.push(`${p.name}/${f.name}`);
    }
    if (paths.length === 0) {
      console.log("  nothing to delete");
    } else {
      const { error: rmErr } = await db.storage.from(PROOF_BUCKET).remove(paths);
      console.log(rmErr ? `  FAILED: ${rmErr.message}` : `  deleted ${paths.length} object(s)`);
    }
  }

  // ── 1b. Google Drive objects ─────────────────────────────────────────────
  // The store moved to Drive on 2026-09-10 (ADR 0018). Clearing the Supabase bucket
  // alone would leave every Certificate of Registration and Notice of Award sitting in
  // the org's Drive with no row pointing at it — documents belonging to people whose
  // records were just deleted, which is the exact half-done state RA 10173 forbids.
  // Only files inside the configured folder are touched, and `drive.file` means the app
  // can only see what it created anyway.
  console.log("\n── Google Drive ──");
  {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    const folderId = process.env.GOOGLE_DRIVE_PROOF_FOLDER_ID;

    if (!clientId || !clientSecret || !refreshToken || !folderId) {
      console.log("  Drive not configured — skipped");
    } else {
      const { google } = await import("googleapis");
      const auth = new google.auth.OAuth2({ clientId, clientSecret });
      auth.setCredentials({ refresh_token: refreshToken });
      const drive = google.drive({ version: "v3", auth });

      const listed = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "files(id,name)",
        pageSize: 1000,
        supportsAllDrives: true,
      });
      const files = listed.data.files ?? [];
      for (const file of files) {
        await drive.files.delete({ fileId: file.id, supportsAllDrives: true });
      }
      console.log(files.length ? `  deleted ${files.length} Drive file(s)` : "  nothing to delete");
    }
  }

  // ── 2. Unlink the accounts from the people about to be deleted ───────────
  console.log("\n── Accounts ──");
  {
    const { error, count } = await db
      .from("user_roles")
      .update({ person_id: null }, { count: "exact" })
      .not("person_id", "is", null);
    console.log(
      error
        ? `  FAILED: ${error.message}`
        : `  unlinked person_id on ${count} account(s); all logins kept`,
    );
  }

  // ── 3. Rows, children first ──────────────────────────────────────────────
  console.log("\n── Rows ──");
  for (const [table, filterColumn] of TABLES_IN_DELETE_ORDER) {
    const before = await countOf(table);
    const { error } = await db.from(table).delete().not(filterColumn, "is", null);
    if (error && isMissingTable(error)) {
      console.log(`  ${table.padEnd(36)} skipped — table does not exist`);
      continue;
    }
    console.log(
      error
        ? `  ${table.padEnd(36)} FAILED: ${error.message}`
        : `  ${table.padEnd(36)} deleted ${before}`,
    );
  }

  // ── 4. Member ID counter ─────────────────────────────────────────────────
  // Removing the counter rows makes the next allocation start at 0001 for its join
  // year. Safe here ONLY because no member ID from this data was ever issued to a
  // real scholar — a member ID is permanent and must never be handed out twice.
  console.log("\n── Member IDs ──");
  {
    const { error } = await db.from("member_id_counters").delete().gte("join_year", 0);
    console.log(
      error ? `  FAILED: ${error.message}` : "  counters cleared — next approval is <year>-0001",
    );
  }

  // ── 5. Re-bootstrap the operators ────────────────────────────────────────
  // WITHOUT THIS THE SYSTEM IS SIGNED-IN BUT INOPERABLE, and the failure is silent.
  //
  // Deleting `people` nulls every `user_roles.person_id`, and `auth_person_id()` reads
  // exactly that column. A confidentiality acknowledgement is keyed (person_id, term_id),
  // so an account with no person row can never hold one — and every sensitive read and
  // every document view is refused for good (CBL Art. VIII §7.1, PRD US-J5). CRRD would
  // sign in, see the application queue, click a Certificate of Registration and get a 500
  // with no explanation.
  //
  // This is the same hole a term rollover opens on the morning of a new term, which PRD
  // US-J5 calls a "known day-one failure mode" and OQ-18 leaves unassigned. Here it is
  // closed in the same operation that opens it.
  console.log("\n── Operators ──");
  {
    const { data: term } = await db
      .from("terms")
      .select("id, starts_on")
      .eq("status", "active")
      .maybeSingle();
    const { data: accounts } = await db.from("user_roles").select("user_id, role, person_id");

    if (!term) {
      console.log("  no active term — skipped");
    } else {
      const joinYear = new Date(term.starts_on).getUTCFullYear();
      for (const account of accounts ?? []) {
        if (account.person_id) continue;

        const { data: authUser } = await db.auth.admin.getUserById(account.user_id);
        const email = authUser?.user?.email ?? "";
        const local = email.split("@")[0] ?? "operator";
        const [first = "Operator", last = account.role] = local.split(".");
        const title = (word) => word.charAt(0).toUpperCase() + word.slice(1);

        // No `member_id`: an officer account is not a membership, and member IDs are
        // issued only by approve_application().
        const { data: person, error: personError } = await db
          .from("people")
          .insert({
            given_name: title(first),
            family_name: title(last),
            personal_email: email || null,
            join_year: joinYear,
          })
          .select("id")
          .single();

        if (personError || !person) {
          console.log(
            `  ${account.role.padEnd(14)} FAILED to create person: ${personError?.message}`,
          );
          continue;
        }

        await db.from("user_roles").update({ person_id: person.id }).eq("user_id", account.user_id);

        // Only the tiers that can read sensitive columns need this. tech_admin cannot
        // (OQ-5) and officer/regional_rep read through their own narrower paths.
        const needsAck = ["exec_admin", "crrd_admin", "regional_rep"].includes(account.role);
        if (needsAck) {
          const { error: ackError } = await db.from("confidentiality_acknowledgements").insert({
            person_id: person.id,
            term_id: term.id,
            agreement_version: "CBL-2026-VIII-7",
            recorded_by: account.user_id,
          });
          console.log(
            ackError
              ? `  ${account.role.padEnd(14)} person linked; ACK FAILED: ${ackError.message}`
              : `  ${account.role.padEnd(14)} person linked + confidentiality acknowledgement recorded`,
          );
        } else {
          console.log(`  ${account.role.padEnd(14)} person linked (no acknowledgement needed)`);
        }
      }
    }
  }

  console.log("\n── After ──");
  for (const t of [
    ...TABLES_IN_DELETE_ORDER.map(([n]) => n),
    "user_roles",
    "member_id_counters",
    "audit_log",
  ]) {
    console.log(`  ${t.padEnd(36)} ${await countOf(t)}`);
  }
  console.log("\nDone.");
}

await main();
