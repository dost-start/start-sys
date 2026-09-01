// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/fixtures/review-seed.ts — the application-review world for
// `e2e/approve-and-id.spec.ts` (BUILD_PLAN S4-T22).
//
// WHAT IT SEEDS: one `pending` application per call, with a real proof document in the
// active document store, plus the confidentiality acknowledgement without which every
// reviewer read raises 42501.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ THE ACKNOWLEDGEMENT IS THE FIRST THING TO CHECK WHEN THIS SPEC FAILS
// ═══════════════════════════════════════════════════════════════════════════════
// `get_application_detail()` and `log_document_view()` both call
// `assert_confidentiality_ack()` (CBL Art. VIII §7.1, US-J5) before they return
// anything. Without a row for the reviewer's person in the CURRENT term, every detail
// page 404s and every proof view 500s — and because CONVENTIONS §4.3 maps a policy
// refusal to `not_found`, it looks exactly like a broken login, a broken RPC and a
// broken policy at once. BUILD_PLAN's S4 risk table names this as the most likely way
// to lose a day, so `ensureConfidentialityAck()` runs first in every seed.
//
// ═══════════════════════════════════════════════════════════════════════════════
// IT DOES NOT TOUCH THE APPLICATION WINDOW, DELIBERATELY
// ═══════════════════════════════════════════════════════════════════════════════
// Reviewing an application needs no open window: the window gates the anonymous
// INSERT (`applications_insert_anon`), and these rows are seeded with the service role,
// which is legitimate test setup rather than request-handling code. `application_windows`
// is UNIQUE (term_id, form_kind) — one global row that `apply-with-upload.spec.ts` opens
// and closes behind a cross-process lockfile. Writing it from here too would close the
// window out from under that spec in another browser project and fail it for a reason
// that has nothing to do with the code under test.
//
// NO DELETES, EVER. There is no DELETE policy anywhere in this schema and none may be
// added (CLAUDE.md; DATA_MODEL.md §13 rule 2). Isolation is a UNIQUE APPLICANT EMAIL
// PER CALL; rows accumulate in a scratch database and are swept by
// `purge_abandoned_drafts()` like any other.
// ═══════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { fakeDocumentStore, fakeStorePut } from "../../lib/documents/fake-store";
import { FIXTURES, FIXTURE_PASSWORD, loadFixtureState } from "./auth";

// ─────────────────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by e2e/fixtures/review-seed.ts`);
  return value;
}

/**
 * Service-role client. Legitimate for the same reason it is legitimate in
 * `e2e/fixtures/auth.ts`: this is TEST SETUP AND ASSERTION, not request-handling code.
 * There is also no other way to read `applications` from a test — it has, correctly, no
 * anon SELECT policy at all, and `audit_log` is readable only by exec/tech.
 */
export function adminClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * A client signed in as a fixture through the ordinary password flow — the same JWT a
 * browser would carry, so RLS and every SQL role guard apply exactly as they do to the
 * app. Used for the direct-RPC half of the idempotency case, which must be a REAL
 * caller and not the service role.
 *
 * The session is aal1 (no TOTP challenge). That is correct and not a shortcut:
 * `approve_application()` guards on `auth_role()` only, and no policy on `applications`
 * carries `has_aal2()`. If a future migration adds one, this call starts failing, which
 * is the right way to find out.
 */
export async function signedInClient(fixture: keyof typeof FIXTURES): Promise<SupabaseClient> {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email: FIXTURES[fixture].email,
    password: FIXTURE_PASSWORD,
  });
  if (error) throw new Error(`signing in as ${fixture}: ${error.message}`);
  return client;
}

/** Which document driver the app is running. CI runs the review spec on `fake` (S3-T23). */
export function documentDriver(): string {
  return process.env.DOCUMENT_STORE ?? "fake";
}

// ─────────────────────────────────────────────────────────────────────────────
// Term, region, acknowledgement
// ─────────────────────────────────────────────────────────────────────────────

export async function currentTermId(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin.rpc("current_term_id");
  if (error) throw error;
  if (!data) {
    throw new Error(
      "No active term. Run `pnpm db:reset` — 0016_seed.sql seeds the bootstrap term.",
    );
  }
  return data as string;
}

/**
 * A region uuid, resolved BY CODE. 0016 generates region ids with `gen_random_uuid()`,
 * so a hardcoded uuid is wrong on every fresh database.
 */
async function regionIdByCode(admin: SupabaseClient, code: string): Promise<string> {
  const { data, error } = await admin.from("regions").select("id").eq("code", code).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Region ${code} is not seeded — run \`pnpm db:reset\`.`);
  return String(data.id);
}

/**
 * CBL Art. VIII §7.1 / US-J5 — see the header. Idempotent on the (person, term) PK.
 *
 * `e2e/fixtures/auth.ts` already records one for exec_admin's and crrd_admin's people,
 * and deliberately NOT for the moderator's (so the day-one refusal stays a tested
 * behaviour). This re-asserts the reviewer's own so this spec does not silently depend
 * on the order in which the two seeders ran.
 */
export async function ensureConfidentialityAck(
  admin: SupabaseClient,
  fixture: keyof typeof FIXTURES,
): Promise<void> {
  const account = FIXTURES[fixture];
  if (account.personId === null) {
    throw new Error(`Fixture ${fixture} is bound to no person and cannot acknowledge.`);
  }

  const state = loadFixtureState();
  const termId = await currentTermId(admin);

  const { error } = await admin.from("confidentiality_acknowledgements").upsert(
    {
      person_id: account.personId,
      term_id: termId,
      agreement_version: "CBL-2026-VIII-7",
      recorded_by: state.userIds[FIXTURES.exec_admin.email],
    },
    { onConflict: "person_id,term_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`seeding confidentiality acknowledgement: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The proof document
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A minimal but genuine PDF. `%PDF-` is what `sniffMime` looks for, so this survives
 * the same magic-byte check a real Certificate of Registration does — a fixture that
 * only claimed to be a PDF would make the proof route's content-type assertion vacuous.
 */
function tinyPdfBytes(): Uint8Array {
  return new TextEncoder().encode(
    "%PDF-1.4\n" +
      "1 0 obj\n<< /Type /Catalog >>\nendobj\n" +
      "trailer\n<< /Root 1 0 R >>\n" +
      "%%EOF\n",
  );
}

export type SeededProof = {
  /** Provider-opaque; stored verbatim in `applications.proof_drive_file_id`. */
  storageRef: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * Put a real document in the FAKE store and hand back its ref.
 *
 * ⚠ FAKE DRIVER ONLY, and the spec skips the byte-streaming case for any other driver
 * rather than pretending. Seeding into Drive or Supabase Storage from a test process
 * would need real credentials and would leave objects behind in a shared bucket; the
 * document boundary exists so the rest of the flow is driver-agnostic, and the one case
 * that genuinely needs bytes is the one case allowed to name a driver.
 *
 * It works cross-process because the fake store's source of truth is the filesystem
 * (`$FAKE_STORE_DIR`, else a fixed directory under `os.tmpdir()`), not a module-level
 * Map — the Playwright process writes and the Next server process reads.
 */
export async function seedFakeProof(applicationId: string): Promise<SeededProof> {
  const bytes = tinyPdfBytes();
  const session = await fakeDocumentStore.createUploadSession({
    applicationId,
    fileName: "certificate-of-registration.pdf",
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
  });
  await fakeStorePut(session.storageRef, bytes, "application/pdf");

  return {
    storageRef: session.storageRef,
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The application
// ─────────────────────────────────────────────────────────────────────────────

export type SeededApplication = {
  id: string;
  email: string;
  givenName: string;
  familyName: string;
  termId: string;
  proof: SeededProof | null;
};

/** A fresh applicant identity per seed. Isolation WITHOUT a delete. */
function uniqueEmail(label: string): string {
  return `review-${label}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}@fixture.start-sys.test`;
}

/**
 * Insert one `pending` application, ready to be decided.
 *
 * ⚠ THE PAYLOAD'S ELEVEN KEYS ARE A CONTRACT WITH `approve_application()`. It reads
 * them with `payload->>'…'` and writes them onto the new `people` and `memberships`
 * rows (`lib/applications/schema.ts` — `APPLICATION_PAYLOAD_KEYS`). A key misspelled
 * here produces a `people` row full of NULLs and a NOT NULL violation on
 * `memberships.region_id`, and the failure names neither. They are spelled to match.
 *
 * `pending_has_proof` (0008) requires `proof_drive_file_id` on anything past `draft`,
 * so a pending row without a proof is not representable — which is why `withProof:
 * false` still stores a ref, just not one with bytes behind it.
 */
export async function seedPendingApplication(
  admin: SupabaseClient,
  options: { label: string; withProof?: boolean } = { label: "case" },
): Promise<SeededApplication> {
  const termId = await currentTermId(admin);
  const regionId = await regionIdByCode(admin, "NCR");

  const id = randomUUID();
  const email = uniqueEmail(options.label);
  const givenName = "Applicant";
  // A per-run surname so the queue row is findable by text without matching another
  // test's row running concurrently in a different browser project.
  const familyName = `Review${randomUUID()
    .slice(0, 8)
    .replace(/[^a-z]/gi, "x")}`;

  const proof =
    options.withProof === false
      ? null
      : documentDriver() === "fake"
        ? await seedFakeProof(id)
        : null;

  const now = new Date().toISOString();

  const { error } = await admin.from("applications").insert({
    id,
    term_id: termId,
    status: "pending",
    applicant_email: email,
    applicant_given_name: givenName,
    applicant_family_name: familyName,
    payload: {
      // The eleven, exactly as approve_application() reads them.
      birthdate: "2004-02-29",
      contact_number: "+639171230000",
      address_line: "Seeded Address 7",
      city_municipality: "Quezon City",
      province: "Metro Manila",
      postal_code: "1101",
      school: "Seeded University",
      school_id_no: "SEED-REVIEW-001",
      region_id: regionId,
      year_level: 2,
      expected_grad_year: 2029,
      // Carried but not read by approve_application() today.
      middle_name: "Seed",
      suffix: null,
      program: "BS Computer Science",
      consent_privacy_notice_version: "v1",
      consent_given_at: now,
    },
    // `pending_has_proof` makes this NOT NULL for any non-draft row. When there are no
    // bytes behind it (a non-fake driver), the proof route correctly answers 500 — which
    // is why the streaming case skips rather than asserting against a dangling ref.
    proof_drive_file_id: proof?.storageRef ?? `seeded-no-bytes-${id}`,
    proof_mime_type: proof?.mimeType ?? "application/pdf",
    proof_size_bytes: proof?.sizeBytes ?? 1024,
    proof_verified_at: now,
    submitted_at: now,
  });
  if (error) throw new Error(`seeding application: ${error.message}`);

  return { id, email, givenName, familyName, termId, proof };
}

// ─────────────────────────────────────────────────────────────────────────────
// Assertions the spec needs, all through the service role
// ─────────────────────────────────────────────────────────────────────────────

export type ApplicationRow = {
  id: string;
  status: string;
  person_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

export async function readApplication(
  admin: SupabaseClient,
  applicationId: string,
): Promise<ApplicationRow> {
  const { data, error } = await admin
    .from("applications")
    .select("id, status, person_id, reviewed_by, reviewed_at, review_note")
    .eq("id", applicationId)
    .single();
  if (error) throw error;
  return data as ApplicationRow;
}

/** The member ID minted (or reused) for an approved application. Null before approval. */
export async function memberIdFor(
  admin: SupabaseClient,
  applicationId: string,
): Promise<string | null> {
  const application = await readApplication(admin, applicationId);
  if (application.person_id === null) return null;

  const { data, error } = await admin
    .from("people")
    .select("member_id")
    .eq("id", application.person_id)
    .single();
  if (error) throw error;
  return (data as { member_id: string | null }).member_id;
}

export async function countMembershipsForPerson(
  admin: SupabaseClient,
  personId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId);
  if (error) throw error;
  return count ?? 0;
}

/** How many `people` rows carry this applicant's address. Zero after a rejection. */
export async function countPeopleByEmail(admin: SupabaseClient, email: string): Promise<number> {
  const { count, error } = await admin
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("personal_email", email);
  if (error) throw error;
  return count ?? 0;
}

/**
 * `VIEW_DOCUMENT` audit rows for one application, by one actor.
 *
 * Counted rather than merely existence-checked: RA 10173 asks "who looked at this
 * scholar's ID, and WHEN", not "has anyone ever looked", so three views must produce
 * three rows (BUILD_PLAN S4-T11).
 */
export async function countDocumentViews(
  admin: SupabaseClient,
  applicationId: string,
  actorUserId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("table_name", "applications")
    .eq("row_id", applicationId)
    .eq("operation", "VIEW_DOCUMENT")
    .eq("actor_user_id", actorUserId);
  if (error) throw error;
  return count ?? 0;
}

/** The `auth.users.id` GoTrue actually assigned a fixture. */
export function fixtureUserId(fixture: keyof typeof FIXTURES): string {
  const state = loadFixtureState();
  const id = state.userIds[FIXTURES[fixture].email];
  if (!id) throw new Error(`No seeded account for ${fixture} — re-run the Playwright globalSetup.`);
  return id;
}
