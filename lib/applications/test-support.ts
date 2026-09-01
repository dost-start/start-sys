// ─────────────────────────────────────────────────────────────────────────────
// DB-BACKED TEST SUPPORT FOR THE APPROVAL RACE (BUILD_PLAN S4-T12).
//
// ⚠ TEST SUPPORT ONLY. Nothing in `app/`, `components/` or any other `lib/` module
// may import this file. It is not imported by the application at any point, so Next
// never bundles it; it exists under `lib/applications/` so it sits next to the thing
// it tests rather than in a top-level `tests/` directory (CONVENTIONS §8.1).
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE HOLDS A PRIVILEGED CLIENT
// ═══════════════════════════════════════════════════════════════════════════════
// `people` has no INSERT policy for any human role (0014/0015), `applications` has no
// INSERT privilege for `authenticated` (0008 §6), and `confidentiality_acknowledgements`
// is exec_admin-INSERT-only. SEEDING IS A PRIVILEGED ACT BY CONSTRUCTION — which is the
// design working, not a hole in it. So the seeder runs as service_role, exactly as
// `e2e/fixtures/auth.ts` does and for exactly the same reason.
//
// It builds that client with `createClient` directly rather than importing
// `lib/server/admin-client.ts`, because that module is confined by an ESLint rule to
// `lib/server/**` callers and CLAUDE.md is explicit that the rule is not to be edited.
// The rule guards REQUEST-HANDLING code; this is test setup, and the distinction is the
// same one `e2e/fixtures/auth.ts` already relies on.
//
// ⚠ THE SUBJECT UNDER TEST NEVER USES THAT CLIENT. Every `approve_application()` call
// in the test runs through a client signed in as the crrd_admin FIXTURE, over the anon
// key, carrying a real JWT — because a race proved with a BYPASSRLS connection would
// prove nothing about the path a reviewer actually takes.
//
// ═══════════════════════════════════════════════════════════════════════════════
// NEVER RUN AGAINST PRODUCTION
// ═══════════════════════════════════════════════════════════════════════════════
// This seeds applications and approves them, which mints real member IDs and burns
// real counter sequences. `assertNotProduction()` refuses any non-local Supabase URL.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/database.types";
// The fixture identities are imported, not re-declared: BUILD_PLAN S2-T41's rule is
// that the pgTAP world and the JS world describe ONE system. A second set of emails
// here would be a second system that happens to pass its own tests.
import { FIXTURE_PASSWORD, FIXTURES } from "@/e2e/fixtures/auth";

export type TypedClient = SupabaseClient<Database>;

// ─────────────────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a live database is reachable.
 *
 * The suite is `describe.skipIf(!DB_TEST_ENV_READY)`, so `pnpm test` on a laptop with
 * no stack running is green-by-skip rather than red-by-environment. CI's `db` job
 * exports all three from `supabase status -o env`, so the race IS actually run there —
 * a test that only ever skips is not a test (BUILD_PLAN S4-T12, and the CI step that
 * exists to make this non-optional).
 */
export const DB_TEST_ENV_READY = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the DB-backed approval race test.`);
  return value;
}

/**
 * Same guard as `e2e/fixtures/auth.ts`, DELIBERATELY WITHOUT ITS ESCAPE HATCH.
 *
 * That seeder accepts `E2E_ALLOW_REMOTE_SEED=true` for a disposable staging project.
 * This one does not, and must not: it approves applications, which mints real member
 * IDs and permanently advances `member_id_counters`. A member ID is never reassigned
 * and never renumbered (PRD US-C4), so there is no undo for running this against a
 * database anybody cares about — not even a staging one seeded from real shapes.
 *
 * Local only. If you need it elsewhere, point a local stack at a copy.
 */
function assertNotProduction(url: string): void {
  if (/localhost|127\.0\.0\.1|host\.docker\.internal|\[::1\]/i.test(url)) return;
  throw new Error(
    `Refusing to run the approval race against a non-local Supabase (${url}). ` +
      `It seeds applications and mints real, unreassignable member IDs.`,
  );
}

/** service_role. Seeding only — never the client under test. */
export function adminClient(): TypedClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  assertNotProduction(url);
  return createClient<Database>(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** anon key, no session. The base for a signed-in reviewer client. */
function anonClient(): TypedClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  assertNotProduction(url);
  return createClient<Database>(url, requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The world the race needs
// ─────────────────────────────────────────────────────────────────────────────

export type ReviewWorld = {
  /** The one `active` term. Looked up by STATUS — `one_active_term` forbids a second. */
  termId: string;
  /**
   * `extract(year from terms.starts_on)`, which is what `approve_application()` uses
   * as `people.join_year` — never `now()`. Every member ID this suite mints is
   * `${joinYear}-NNN`, so the sequence assertions have to derive the prefix the same
   * way the function does.
   */
  joinYear: number;
  /** A real region uuid. `memberships.region_id` is NOT NULL, so the payload needs one. */
  regionId: string;
  /** The crrd_admin fixture's `auth.users.id`, as GoTrue actually assigned it. */
  crrdUserId: string;
};

const CRRD = FIXTURES.crrd_admin;

async function resolveCrrdUserId(admin: TypedClient): Promise<string> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === CRRD.email.toLowerCase());
    if (hit) {
      // Re-assert the password: the account may have been created by the Playwright
      // seeder with the same constant, or by a previous run, and a drifted password
      // would fail as an authorization error rather than as a setup error.
      const { error: updateError } = await admin.auth.admin.updateUserById(hit.id, {
        password: FIXTURE_PASSWORD,
        email_confirm: true,
      });
      if (updateError) throw updateError;
      return hit.id;
    }
    if (data.users.length < 200) break;
  }

  const attributes = {
    email: CRRD.email,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
    // NEVER a role in user_metadata — it is user-writable and a one-line privilege
    // escalation (ARCHITECTURE §5). Roles live in public.user_roles.
    user_metadata: {},
  };

  const withId = await admin.auth.admin.createUser({ ...attributes, id: CRRD.id });
  if (!withId.error && withId.data.user) return withId.data.user.id;

  const created = await admin.auth.admin.createUser(attributes);
  if (created.error) throw created.error;
  if (!created.data.user) throw new Error(`GoTrue returned no user for ${CRRD.email}`);
  return created.data.user.id;
}

/**
 * Make the crrd_admin fixture a working reviewer, idempotently.
 *
 * Every write is an `ignoreDuplicates` upsert, so running this after the Playwright
 * seeder — or twice in one run — is a no-op rather than an UPDATE. `people` carries the
 * member-ID immutability trigger (0022) and an audit trigger; rewriting rows would
 * churn the audit log for nothing.
 *
 * The confidentiality acknowledgement is seeded even though `approve_application()`
 * does not assert one: `get_application_detail()` and `log_document_view()` do
 * (CBL Art. VIII §7.1), and a reviewer fixture that can approve but cannot open the
 * application it approved is not the reviewer this suite claims to be exercising.
 */
export async function ensureReviewWorld(admin: TypedClient): Promise<ReviewWorld> {
  const { data: term, error: termError } = await admin
    .from("terms")
    .select("id, starts_on")
    .eq("status", "active")
    .maybeSingle();
  if (termError) throw termError;
  if (!term) throw new Error("No active term — run `pnpm db:reset` so 0016_seed.sql applies.");

  const { data: region, error: regionError } = await admin
    .from("regions")
    .select("id")
    .eq("code", "NCR")
    .maybeSingle();
  if (regionError) throw regionError;
  if (!region) throw new Error("Region NCR is not seeded — run `pnpm db:reset`.");

  const crrdUserId = await resolveCrrdUserId(admin);

  const upsert = async (
    table: "people" | "user_roles" | "confidentiality_acknowledgements" | "application_windows",
    rows: Record<string, unknown>[],
    onConflict: string,
  ) => {
    const { error } = await admin
      .from(table)
      // The generated Insert types are per-table unions; this seeder is deliberately
      // table-generic, so the row objects are checked by the database rather than by
      // the compiler. A wrong column fails loudly at setup, naming itself.
      .upsert(rows as never, { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`seeding ${table}: ${error.message}`);
  };

  // The reviewer's own person record. `personId` is the pgTAP helper's B2 uuid.
  if (CRRD.personId) {
    await upsert(
      "people",
      [
        {
          id: CRRD.personId,
          member_id: "2022-002",
          join_year: 2022,
          given_name: "Ethan",
          middle_name: "Dreiz",
          family_name: "Baltazar",
          personal_email: "ethan.baltazar@fixture.start-sys.test",
        },
      ],
      "id",
    );
  }

  await upsert(
    "user_roles",
    [{ user_id: crrdUserId, role: CRRD.role, person_id: CRRD.personId, region_id: null }],
    "user_id",
  );

  if (CRRD.personId) {
    await upsert(
      "confidentiality_acknowledgements",
      [
        {
          person_id: CRRD.personId,
          term_id: term.id,
          agreement_version: "CBL-2026-VIII-7",
          recorded_by: crrdUserId,
        },
      ],
      "person_id,term_id",
    );
  }

  // Not required to approve — `applications_read` has no window predicate — but the
  // review world is not honest without one: in production every row this suite decides
  // arrived through an open window (PRD US-B4).
  await upsert(
    "application_windows",
    [
      {
        term_id: term.id,
        form_kind: "membership_application",
        opens_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        closes_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    "term_id,form_kind",
  );

  return {
    termId: term.id,
    joinYear: new Date(`${term.starts_on}T00:00:00Z`).getUTCFullYear(),
    regionId: region.id,
    crrdUserId,
  };
}

/**
 * A client signed in as the crrd_admin fixture, over the ANON key.
 *
 * `signInWithPassword` yields an `aal1` session, which is correct and sufficient: the
 * aal2 predicate guards `user_roles`, `terms` and `application_windows` WRITES (S2-T16),
 * not the decision RPCs. Approving an application at aal1 is exactly what a reviewer who
 * has not been challenged this session does.
 */
export async function signInAsReviewer(): Promise<TypedClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: CRRD.email,
    password: FIXTURE_PASSWORD,
  });
  if (error) throw new Error(`reviewer sign-in failed: ${error.message}`);
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeding applications
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A per-run nonce. Every seeded applicant email carries it, which is what makes this
 * suite CLEANUP-FREE:
 *
 *   · `applications_one_live_per_email_per_term` is unique on (term, email) for any
 *     non-draft row, so re-running with the same addresses would collide;
 *   · `approve_application()` reuses an existing `people` row whose `personal_email`
 *     matches, so a repeated address on a second run would return the FIRST run's
 *     member ID and mint nothing — the contiguous-sequence assertion would fail for a
 *     reason that has nothing to do with concurrency.
 *
 * Unique addresses make both problems structurally impossible, and leave the previous
 * run's rows in place as ordinary history.
 */
export function runNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export type SeededApplications = {
  ids: string[];
  emails: string[];
};

/**
 * Insert `count` PENDING applications ready to be approved.
 *
 * `pending` (not `draft`) because `approve_application()` refuses anything else, and
 * the `pending_has_proof` CHECK (0008) means a non-draft row must carry a document
 * reference — hence the `fake:` refs. They are never dereferenced here: nothing in this
 * test opens a document, and `lib/documents/` is the only code that may interpret one.
 *
 * The payload keys are `APPLICATION_PAYLOAD_KEYS` verbatim. If they ever drift from
 * what `approve_application()` reads, `memberships.region_id` is NOT NULL and this
 * seeder's approvals fail loudly rather than writing NULLs — the same trip-wire
 * `schema.test.ts` guards from the other side.
 */
export async function seedPendingApplications(
  admin: TypedClient,
  world: ReviewWorld,
  count: number,
  nonce: string,
): Promise<SeededApplications> {
  const now = new Date().toISOString();

  const rows = Array.from({ length: count }, (_, index) => {
    const email = `race.${nonce}.${index}@fixture.start-sys.test`;
    return {
      term_id: world.termId,
      status: "pending" as const,
      applicant_email: email,
      applicant_given_name: `Race${index}`,
      applicant_family_name: `Applicant${nonce}`,
      payload: {
        birthdate: "2004-01-01",
        contact_number: "+639170000000",
        address_line: "1 Race Street",
        city_municipality: "Quezon City",
        province: "Metro Manila",
        postal_code: "1100",
        school: "Fixture University",
        school_id_no: `RACE-${nonce}-${index}`,
        region_id: world.regionId,
        year_level: 2,
        expected_grad_year: 2030,
        middle_name: null,
        suffix: null,
        program: "BS Computer Science",
      },
      proof_drive_file_id: `fake:test-${nonce}-${index}`,
      proof_mime_type: "application/pdf",
      proof_size_bytes: 1024,
      proof_verified_at: now,
      submitted_at: now,
      consented_at: now,
    };
  });

  const { data, error } = await admin
    .from("applications")
    .insert(rows as never)
    .select("id, applicant_email");
  if (error) throw new Error(`seeding applications: ${error.message}`);
  if (!data || data.length !== count) {
    throw new Error(`seeded ${data?.length ?? 0} applications, expected ${count}`);
  }

  return {
    ids: data.map((row) => row.id),
    emails: data.map((row) => String(row.applicant_email)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Observation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Exact row count, read as service_role so the number is the truth, not a view of it. */
export async function countRows(
  admin: TypedClient,
  table: "people" | "memberships",
): Promise<number> {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`counting ${table}: ${error.message}`);
  return count ?? 0;
}

/**
 * `member_id_counters.last_seq` for a join year, or 0 when the row does not exist yet.
 *
 * READ BEFORE THE RACE. The contiguity assertion is relative to this offset, never to
 * 1: `helpers/review-fixtures.psql` seeds a counter row, previous runs of this suite
 * leave one behind, and a fixture that assumed a virgin counter would fail on its
 * second run for a reason that looks exactly like a lost update.
 */
export async function readCounter(admin: TypedClient, joinYear: number): Promise<number> {
  const { data, error } = await admin
    .from("member_id_counters")
    .select("last_seq")
    .eq("join_year", joinYear)
    .maybeSingle();
  if (error) throw new Error(`reading member_id_counters: ${error.message}`);
  return data?.last_seq ?? 0;
}

/** How many memberships a person holds. Used to prove a retried approval creates one. */
export async function countMembershipsForPerson(
  admin: TypedClient,
  personId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId);
  if (error) throw new Error(`counting memberships: ${error.message}`);
  return count ?? 0;
}

/** The `person_id` an approval stamped onto an application. */
export async function personIdForApplication(
  admin: TypedClient,
  applicationId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("applications")
    .select("person_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(`reading application: ${error.message}`);
  return data?.person_id ?? null;
}

/**
 * The numeric sequence half of `2026-014`.
 *
 * Asserted against the expected prefix rather than split on `-`, so an id minted for
 * the wrong join year fails here instead of quietly passing the contiguity check.
 */
export function sequenceOf(memberId: string, joinYear: number): number {
  const prefix = `${joinYear}-`;
  if (!memberId.startsWith(prefix)) {
    throw new Error(`member id ${memberId} does not start with the expected ${prefix}`);
  }
  return Number(memberId.slice(prefix.length));
}
