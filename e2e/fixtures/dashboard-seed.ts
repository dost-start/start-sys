// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/fixtures/dashboard-seed.ts — the two-region scope world (BUILD_PLAN S6-T14).
//
// WHAT IT SEEDS, and why each piece exists:
//
//   • 9 memberships in REGION A named ScopeAlpha01..09 and 6 in REGION B named
//     ScopeBravo01..06. Asymmetric on purpose: two equal halves make a scoping bug
//     that returns "the other region" indistinguishable from one that returns "the
//     right region", because both produce the same count.
//
//   • Two committees, ONE member on BOTH (ScopeAlpha01) and one on NEITHER
//     (ScopeAlpha09). The member on two committees is the dedupe fixture — the
//     directory view LEFT JOINs committees, so without a GROUP BY in
//     search_member_directory() they appear twice and every pagination total is
//     silently wrong. The member on none is the LEFT-JOIN fixture: an INNER JOIN
//     would drop them from the directory entirely.
//
//   • PLANTED SENSITIVE LITERALS on every scope person — one contact number, one
//     address line, one birthdate, all deliberately unmistakable strings. They are
//     what `member-officer-read-only.spec.ts` and `rr-scope-leak.spec.ts` grep the
//     SERVED HTML for. A Server Component that leaks does so in the payload
//     regardless of what the UI chooses to render, so the assertion is a string
//     search over page content, not a check that a column header is absent.
//
//   • THREE DEDICATED ACCOUNTS with real passwords and real verified TOTP factors:
//     `scope_rep_a` (region A), `scope_rep_b` (region B) and `scope_officer`.
//     ⚠ WHY NOT REUSE `e2e/fixtures/auth.ts`'s accounts: its `officer` fixture is
//     DELIBERATELY UNENROLLED, because US-A3 needs an account in exactly that state
//     to prove an officer with no second factor sees an enrolment screen and no
//     organizational data. That account therefore cannot reach `/directory` at all.
//     Enrolling it here would destroy the S2 case; hence a separate officer.
//
//   • An ARCHIVED TERM, for the URL-tampering case in rr-scope-leak step 3. A
//     `?term_id=<archived>` that changes nothing is only meaningful if the term id
//     is real — a made-up uuid would be refused for the wrong reason.
//
// RUNS AS service_role. Legitimate: this is TEST SETUP, not request-handling code
// (CLAUDE.md's ban is on `app/` importing the service-role client). `people` has no
// INSERT policy for any human role by design, so seeding is privileged by construction.
//
// IDEMPOTENT. Every row has a fixed uuid and is inserted with `ignoreDuplicates`, so
// running it before every Playwright invocation — and twice in a row — leaves identical
// counts. NO DELETES ANYWHERE: there is no DELETE policy in this schema and none may be
// added (CLAUDE.md; DATA_MODEL.md §13 rule 2). Isolation is fixed identity, not cleanup.
//
// NEVER RUN AGAINST PRODUCTION. It creates confirmed accounts with a known password;
// `assertNotProduction()` in auth.ts guards the same way and this file reuses that rule.
//
// SECRETS: the TOTP secrets it mints go to `e2e-artifacts/`, which is already in
// `.gitignore`. Nothing here is ever committed.
// ═══════════════════════════════════════════════════════════════════════════════════

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generate as generateOtp } from "otplib";
import type { Page } from "@playwright/test";

import { FIXTURE_PASSWORD, authScreens, submitLogin } from "./auth";

// ─────────────────────────────────────────────────────────────────────────────
// Identity — fixed uuids, so the seed is idempotent and a failure names a row
// ─────────────────────────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Deterministic uuids in their own namespace groups, disjoint from
 * `e2e/fixtures/auth.ts`'s `a000`/`b000`/`c000` families so the two seeders can never
 * collide on a primary key.
 */
const ALPHA_PERSON = (i: number) => `00000000-0000-4000-9a00-0000000000${pad2(i)}`;
const BRAVO_PERSON = (i: number) => `00000000-0000-4000-9b00-0000000000${pad2(i)}`;
const ALPHA_MEMBERSHIP = (i: number) => `00000000-0000-4000-9c00-0000000000${pad2(i)}`;
const BRAVO_MEMBERSHIP = (i: number) => `00000000-0000-4000-9d00-0000000000${pad2(i)}`;
const COMMITTEE = (i: number) => `00000000-0000-4000-9e00-0000000000${pad2(i)}`;
const ARCHIVED_TERM_ID = "00000000-0000-4000-9f00-000000000001";

/** Region A and Region B, referenced BY CODE — 0016 mints region ids with gen_random_uuid(). */
export const REGION_A_CODE = "NCR";
export const REGION_B_CODE = "R07";

export const ALPHA_COUNT = 9;
export const BRAVO_COUNT = 6;

/** `ScopeAlpha01`…`ScopeAlpha09`. Family names, so they appear in any directory row. */
export const ALPHA_NAMES = Array.from(
  { length: ALPHA_COUNT },
  (_, i) => `ScopeAlpha${pad2(i + 1)}`,
);
export const BRAVO_NAMES = Array.from(
  { length: BRAVO_COUNT },
  (_, i) => `ScopeBravo${pad2(i + 1)}`,
);

/**
 * ⚠ THE PLANTED LITERALS. Any served HTML containing one of these for an `officer` or
 * `regional_rep` session is a Data Privacy NFR failure (PRD US-J1, US-D2, CBL Art. VIII
 * §6). They are chosen to be impossible to produce by accident — no page chrome, no
 * date formatter and no phone-number placeholder emits any of these strings — so the
 * assertion can be a literal substring search that nobody is ever tempted to relax.
 */
export const DASHBOARD_PLANTED_VALUES = [
  "+63917PLANTED99", // people.contact_number
  "PLANTED-ADDR-LINE-7", // people.address_line
  "1999-12-31", // people.birthdate
] as const;

/** School ID, also sensitive, planted for the same reason and greppable the same way. */
export const PLANTED_SCHOOL_ID = "PLANTED-SCOPE-SCH-1";

// ─────────────────────────────────────────────────────────────────────────────
// The three scope accounts
// ─────────────────────────────────────────────────────────────────────────────

export type ScopeAccountKey = "scope_rep_a" | "scope_rep_b" | "scope_officer";

export type ScopeAccount = {
  readonly key: ScopeAccountKey;
  readonly email: string;
  /** The `org_role` written to `user_roles`. */
  readonly role: "regional_rep" | "officer";
  /** `regions.code`; required for `regional_rep` by the `rr_needs_region` CHECK (0004). */
  readonly regionCode: string | null;
  /** Where `homeForRole()` lands them (lib/auth/route-access.ts). */
  readonly home: string;
};

export const SCOPE_ACCOUNTS: Record<ScopeAccountKey, ScopeAccount> = {
  scope_rep_a: {
    key: "scope_rep_a",
    email: "scope.rep.a@fixture.start-sys.test",
    role: "regional_rep",
    regionCode: REGION_A_CODE,
    home: "/region",
  },
  scope_rep_b: {
    key: "scope_rep_b",
    email: "scope.rep.b@fixture.start-sys.test",
    role: "regional_rep",
    regionCode: REGION_B_CODE,
    home: "/region",
  },
  // Enrolled, unlike auth.ts's `officer` — see the header.
  scope_officer: {
    key: "scope_officer",
    email: "scope.officer@fixture.start-sys.test",
    role: "officer",
    regionCode: null,
    home: "/directory",
  },
};

export const SCOPE_ACCOUNT_KEYS = Object.keys(SCOPE_ACCOUNTS) as ScopeAccountKey[];

// ─────────────────────────────────────────────────────────────────────────────
// Persisted state
// ─────────────────────────────────────────────────────────────────────────────

export type ScopeState = {
  generatedAt: string;
  supabaseUrl: string;
  /** email → the id GoTrue actually assigned. Authoritative. */
  userIds: Record<string, string>;
  /** email → base32 TOTP secret. */
  totpSecrets: Record<string, string>;
  /** Resolved once at seed time so specs never re-derive them. */
  regionIds: Record<string, string>;
  currentTermId: string;
  archivedTermId: string;
  committeeIds: string[];
  /** ScopeAlpha/Bravo family name → people.id, for deep links and audit assertions. */
  personIds: Record<string, string>;
};

/**
 * Its own file beside auth.ts's, under `e2e-artifacts/` (already gitignored) so the TOTP
 * secrets minted here cannot be committed. Separate rather than merged because the two
 * seeders run independently and a shared file would make each one's write a race with
 * the other's read.
 */
export const SCOPE_STATE_PATH = resolve(
  process.env.E2E_SCOPE_STATE ?? "e2e-artifacts/.dashboard-fixture-state.json",
);

export function loadScopeState(): ScopeState {
  try {
    return JSON.parse(readFileSync(SCOPE_STATE_PATH, "utf8")) as ScopeState;
  } catch {
    throw new Error(
      `No scope-fixture state at ${SCOPE_STATE_PATH}. Call seedDashboardWorld() from the ` +
        `spec's beforeAll with SUPABASE_SERVICE_ROLE_KEY set.`,
    );
  }
}

function writeScopeState(state: ScopeState): void {
  mkdirSync(dirname(SCOPE_STATE_PATH), { recursive: true });
  writeFileSync(SCOPE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by e2e/fixtures/dashboard-seed.ts`);
  return value;
}

/** The same refusal auth.ts makes, for the same reason: known-password admin accounts. */
function assertNotProduction(url: string): void {
  const isLocal = /localhost|127\.0\.0\.1|host\.docker\.internal|\[::1\]/i.test(url);
  if (isLocal || process.env.E2E_ALLOW_REMOTE_SEED === "true") return;
  throw new Error(
    `Refusing to seed scope fixtures against a non-local Supabase (${url}). ` +
      `Set E2E_ALLOW_REMOTE_SEED=true only for a disposable staging project.`,
  );
}

export function scopeAdminClient(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  assertNotProduction(url);
  return createClient(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function anonClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * A supabase-js client signed in as a scope account through the ordinary password flow —
 * the same JWT a browser carries, so RLS and every column GRANT apply exactly as they do
 * to the app.
 *
 * This is how the "regional access is not regional editing" case is made (PRD US-F2):
 * a Server Action cannot be invoked from Playwright, but the write it would perform can
 * be attempted directly against PostgREST with the caller's own token — which is the
 * stronger test anyway, because it bypasses `withRole()` and lands on the policy that is
 * the actual enforcement.
 */
export async function scopeSignedInClient(key: ScopeAccountKey): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: SCOPE_ACCOUNTS[key].email,
    password: FIXTURE_PASSWORD,
  });
  if (error) throw new Error(`signing in as ${key}: ${error.message}`);
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts and TOTP
// ─────────────────────────────────────────────────────────────────────────────

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function resolveUserId(admin: SupabaseClient, account: ScopeAccount): Promise<string> {
  const existing = await findUserIdByEmail(admin, account.email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing, {
      password: FIXTURE_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    return existing;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
    // NEVER a role here. ARCHITECTURE §5: `user_metadata` is user-writable and a role
    // there is a one-line privilege escalation. Roles live in public.user_roles.
    user_metadata: {},
  });
  if (error) throw error;
  if (!data.user) throw new Error(`GoTrue returned no user for ${account.email}`);
  return data.user.id;
}

/**
 * Enrol a VERIFIED TOTP factor by driving the ordinary user-session MFA flow — exactly
 * the calls the enrolment screen makes, and the same flow `e2e/fixtures/auth.ts` uses.
 * (Its own helper is module-private, hence the second implementation rather than an
 * import; if it is ever exported, delete this and call it.)
 *
 * There is no admin API for this and there should not be: a factor whose possession was
 * never proved is not a second factor.
 */
async function enrolTotp(
  email: string,
  userId: string,
  existingSecret: string | undefined,
): Promise<string> {
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: FIXTURE_PASSWORD,
  });
  if (signInError) throw new Error(`TOTP enrol sign-in for ${email}: ${signInError.message}`);

  try {
    const { data: factors, error: listError } = await client.auth.mfa.listFactors();
    if (listError) throw listError;

    // Already enrolled and the secret survived — leave it alone. Re-enrolling would
    // invalidate a code a retrying test had already generated.
    if (factors.totp.some((f) => f.status === "verified") && existingSecret) return existingSecret;

    // A verified factor whose secret we LOST (fresh fixture-state file, re-run in the
    // same CI job) cannot be unenrolled from an aal1 session — GoTrue refuses with
    // "AAL2 required to unenroll verified factor", and without the secret aal2 is
    // unreachable. Clearing it is privileged test setup, so use the admin API.
    for (const factor of factors.totp) {
      const { error } = await scopeAdminClient().auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId,
      });
      if (error) throw error;
    }

    const { data: enrolled, error: enrolError } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `e2e-scope-${Date.now()}`,
    });
    if (enrolError) throw enrolError;

    const secret = enrolled.totp.secret;
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
      factorId: enrolled.id,
      code: await generateOtp({ secret }),
    });
    if (verifyError) throw new Error(`TOTP verify for ${email}: ${verifyError.message}`);
    return secret;
  } finally {
    await client.auth.signOut();
  }
}

/** A current TOTP code for a scope account. */
export async function scopeTotpCode(key: ScopeAccountKey): Promise<string> {
  const state = loadScopeState();
  const secret = state.totpSecrets[SCOPE_ACCOUNTS[key].email];
  if (!secret) throw new Error(`No persisted TOTP secret for ${key} — re-run the seed.`);
  return generateOtp({ secret });
}

/**
 * Sign in through the REAL login and TOTP screens.
 *
 * ⚠ Deliberately not a seeded cookie or an injected JWT. BUILD_PLAN S6-T15 requires every
 * step of the scope gate to pass through the actual UI, because an API-level pass proves
 * the database refuses — it does not prove the PAGE refuses to render region B.
 */
export async function scopeSignIn(page: Page, key: ScopeAccountKey, next?: string): Promise<void> {
  const account = SCOPE_ACCOUNTS[key];
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await submitLogin(page, account.email);

  await page.waitForURL(/\/auth\/mfa\/verify/);
  await authScreens.totpField(page).fill(await scopeTotpCode(key));
  await authScreens.submitTotp(page).click();
  await page.waitForURL((url) => !/\/login|\/auth\/mfa/.test(url.pathname));
}

// ─────────────────────────────────────────────────────────────────────────────
// Org data
// ─────────────────────────────────────────────────────────────────────────────

type PersonRow = Record<string, unknown>;

/**
 * One scope person. Every one carries the SAME planted literals, so a leak of ANY scope
 * row trips the grep — rather than only a leak of one designated unlucky row.
 */
function scopePerson(id: string, familyName: string, memberId: string): PersonRow {
  return {
    id,
    member_id: memberId,
    // 2019 is deliberately far from any term the system will ever approve into, so these
    // hand-written member_ids can never collide with a sequence `allocate_member_id()`
    // hands out. Nothing here touches `member_id_counters`.
    join_year: 2019,
    given_name: "Scope",
    middle_name: "Test",
    family_name: familyName,
    birthdate: "1999-12-31",
    contact_number: "+63917PLANTED99",
    personal_email: `${familyName.toLowerCase()}@fixture.start-sys.test`,
    address_line: "PLANTED-ADDR-LINE-7",
    city_municipality: "Quezon City",
    province: "Metro Manila",
    postal_code: "1100",
    school: "Scope Fixture University",
    school_id_no: PLANTED_SCHOOL_ID,
  };
}

async function insertIfAbsent(
  admin: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin.from(table).upsert(rows, { onConflict, ignoreDuplicates: true });
  if (error) throw new Error(`seeding ${table}: ${error.message}`);
}

async function resolveRegionIds(admin: SupabaseClient): Promise<Record<string, string>> {
  const { data, error } = await admin
    .from("regions")
    .select("id, code")
    .in("code", [REGION_A_CODE, REGION_B_CODE]);
  if (error) throw error;

  const map: Record<string, string> = {};
  for (const row of data ?? []) map[String(row.code)] = String(row.id);
  if (!map[REGION_A_CODE] || !map[REGION_B_CODE]) {
    throw new Error(
      `Regions ${REGION_A_CODE} and ${REGION_B_CODE} are not seeded — run \`pnpm db:reset\`.`,
    );
  }
  return map;
}

/** The active term, by STATUS. Never by label: `one_active_term` is the invariant, not '2026-2027'. */
async function resolveCurrentTermId(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin
    .from("terms")
    .select("id")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No active term — 0016_seed.sql has not been applied.");
  return String(data.id);
}

/**
 * A real archived term for the URL-tampering case.
 *
 * Dates satisfy 0005's three CHECKs: `ends_on` falls in MAY (CBL Art. V §1), `ends_on` is
 * in the year after `starts_on`, and `ends_on > starts_on`. A term ending in July is a
 * schema error, not a typo to discover at 2am.
 */
async function ensureArchivedTerm(admin: SupabaseClient): Promise<string> {
  const { data: existing, error: readError } = await admin
    .from("terms")
    .select("id")
    .eq("id", ARCHIVED_TERM_ID)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return ARCHIVED_TERM_ID;

  const { error } = await admin.from("terms").upsert(
    {
      id: ARCHIVED_TERM_ID,
      label: "2019-2020",
      starts_on: "2019-06-01",
      ends_on: "2020-05-31",
      status: "archived",
      archived_at: new Date().toISOString(),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`seeding archived term: ${error.message}`);
  return ARCHIVED_TERM_ID;
}

// ─────────────────────────────────────────────────────────────────────────────
// The entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed the whole scope world. Idempotent; safe before every run and safe twice.
 */
export async function seedDashboardWorld(): Promise<ScopeState> {
  const admin = scopeAdminClient();

  const previous: ScopeState | null = (() => {
    try {
      return loadScopeState();
    } catch {
      return null;
    }
  })();

  const regionIds = await resolveRegionIds(admin);
  const currentTermId = await resolveCurrentTermId(admin);
  const archivedTermId = await ensureArchivedTerm(admin);

  // ── People ────────────────────────────────────────────────────────────────
  const people: PersonRow[] = [
    ...ALPHA_NAMES.map((name, i) => scopePerson(ALPHA_PERSON(i + 1), name, `2019-1${pad2(i + 1)}`)),
    ...BRAVO_NAMES.map((name, i) => scopePerson(BRAVO_PERSON(i + 1), name, `2019-2${pad2(i + 1)}`)),
  ];
  await insertIfAbsent(admin, "people", people, "id");

  // ── Memberships — the asymmetry that makes a scoping bug visible ──────────
  const memberships = [
    ...ALPHA_NAMES.map((_, i) => ({
      id: ALPHA_MEMBERSHIP(i + 1),
      person_id: ALPHA_PERSON(i + 1),
      term_id: currentTermId,
      status: "active",
      region_id: regionIds[REGION_A_CODE],
      year_level: (i % 4) + 1,
      expected_grad_year: 2028,
    })),
    ...BRAVO_NAMES.map((_, i) => ({
      id: BRAVO_MEMBERSHIP(i + 1),
      person_id: BRAVO_PERSON(i + 1),
      term_id: currentTermId,
      status: "active",
      region_id: regionIds[REGION_B_CODE],
      year_level: (i % 4) + 1,
      expected_grad_year: 2029,
    })),
  ];
  await insertIfAbsent(admin, "memberships", memberships, "id");

  // ── Committees ────────────────────────────────────────────────────────────
  // Not seeded by 0016 and deliberately so: CBL Art. III §5 makes committees per-term
  // and discretionary, unlike the seven constitutional departments. Creating one is one
  // INSERT and no migration (ARCHITECTURE §4.4), which is exactly what this proves.
  const committeeIds = [COMMITTEE(1), COMMITTEE(2)];
  await insertIfAbsent(
    admin,
    "committees",
    [
      { id: COMMITTEE(1), term_id: currentTermId, code: "SCOPE_ONE", name: "Scope Committee One" },
      { id: COMMITTEE(2), term_id: currentTermId, code: "SCOPE_TWO", name: "Scope Committee Two" },
    ],
    "id",
  );

  // ScopeAlpha01 sits on BOTH (the dedupe fixture); ScopeAlpha09 on NEITHER (the
  // LEFT-JOIN fixture). Everyone else is spread across the two so a committee panel has
  // something to count.
  const committeeMemberships: { membership_id: string; committee_id: string }[] = [
    { membership_id: ALPHA_MEMBERSHIP(1), committee_id: COMMITTEE(1) },
    { membership_id: ALPHA_MEMBERSHIP(1), committee_id: COMMITTEE(2) },
    ...[2, 3, 4, 5].map((i) => ({
      membership_id: ALPHA_MEMBERSHIP(i),
      committee_id: COMMITTEE(1),
    })),
    ...[6, 7, 8].map((i) => ({ membership_id: ALPHA_MEMBERSHIP(i), committee_id: COMMITTEE(2) })),
    { membership_id: BRAVO_MEMBERSHIP(1), committee_id: COMMITTEE(1) },
  ];
  await insertIfAbsent(
    admin,
    "committee_memberships",
    committeeMemberships,
    "membership_id,committee_id",
  );

  // ── Accounts ──────────────────────────────────────────────────────────────
  const userIds: Record<string, string> = {};
  for (const key of SCOPE_ACCOUNT_KEYS) {
    const account = SCOPE_ACCOUNTS[key];
    userIds[account.email] = await resolveUserId(admin, account);
  }

  await insertIfAbsent(
    admin,
    "user_roles",
    SCOPE_ACCOUNT_KEYS.map((key) => {
      const account = SCOPE_ACCOUNTS[key];
      return {
        user_id: userIds[account.email],
        role: account.role,
        // Bound to no person: neither a scoped rep nor a read-only officer needs one,
        // and a null keeps them out of every "own record" policy branch by construction.
        person_id: null,
        region_id: account.regionCode ? regionIds[account.regionCode] : null,
      };
    }),
    "user_id",
  );

  const totpSecrets: Record<string, string> = {};
  for (const key of SCOPE_ACCOUNT_KEYS) {
    const email = SCOPE_ACCOUNTS[key].email;
    totpSecrets[email] = await enrolTotp(email, userIds[email]!, previous?.totpSecrets[email]);
  }

  const personIds: Record<string, string> = {};
  ALPHA_NAMES.forEach((name, i) => {
    personIds[name] = ALPHA_PERSON(i + 1);
  });
  BRAVO_NAMES.forEach((name, i) => {
    personIds[name] = BRAVO_PERSON(i + 1);
  });

  const state: ScopeState = {
    generatedAt: new Date().toISOString(),
    supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    userIds,
    totpSecrets,
    regionIds,
    currentTermId,
    archivedTermId,
    committeeIds,
    personIds,
  };
  writeScopeState(state);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assertions the specs need — all through the service role
// ─────────────────────────────────────────────────────────────────────────────

/** The `auth.users.id` GoTrue actually assigned a scope account. */
export function scopeUserId(key: ScopeAccountKey): string {
  const state = loadScopeState();
  const id = state.userIds[SCOPE_ACCOUNTS[key].email];
  if (!id) throw new Error(`No seeded account for ${key} — re-run seedDashboardWorld().`);
  return id;
}

/**
 * `VIEW_RECORD` audit rows for one person, optionally by one actor.
 *
 * Counted, never merely existence-checked. RA 10173 asks "who opened this scholar's
 * record, and WHEN" — three opens must produce three rows, and a test that only asks
 * "has anyone ever" would pass against a log that stopped recording months ago.
 */
export async function countViewRecords(
  admin: SupabaseClient,
  personId: string,
  actorUserId?: string,
): Promise<number> {
  let query = admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("table_name", "people")
    .eq("row_id", personId)
    .eq("operation", "VIEW_RECORD");
  if (actorUserId) query = query.eq("actor_user_id", actorUserId);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** UPDATE audit rows on one `people` row — the "an edit is attributable" assertion. */
export async function countPeopleUpdates(admin: SupabaseClient, personId: string): Promise<number> {
  const { count, error } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("table_name", "people")
    .eq("row_id", personId)
    .eq("operation", "UPDATE");
  if (error) throw error;
  return count ?? 0;
}

export async function readPerson(
  admin: SupabaseClient,
  personId: string,
): Promise<{ contact_number: string | null; updated_at: string }> {
  const { data, error } = await admin
    .from("people")
    .select("contact_number, updated_at")
    .eq("id", personId)
    .single();
  if (error) throw error;
  return data as { contact_number: string | null; updated_at: string };
}

export async function readMembershipStatus(
  admin: SupabaseClient,
  membershipId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("memberships")
    .select("status")
    .eq("id", membershipId)
    .single();
  if (error) throw error;
  return String((data as { status: string }).status);
}

/** Current-term membership count for one region — the number the RR dashboard must show. */
export async function countMembershipsInRegion(
  admin: SupabaseClient,
  regionId: string,
  termId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("region_id", regionId)
    .eq("term_id", termId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Current-term membership count matching a status AND a region — the expectation the
 * two-facet case in `member-records.spec.ts` compares the rendered grid against.
 *
 * Computed from the database rather than hardcoded on purpose: a hardcoded number goes
 * stale the moment another spec seeds a member, and the repair is always to loosen the
 * assertion.
 */
export async function countMembershipsByStatusAndRegion(
  admin: SupabaseClient,
  status: string,
  regionId: string,
  termId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("status", status)
    .eq("region_id", regionId)
    .eq("term_id", termId);
  if (error) throw error;
  return count ?? 0;
}

/** The membership id for a scope person in the current term. */
export function scopeMembershipId(familyName: string): string {
  const alphaIndex = ALPHA_NAMES.indexOf(familyName);
  if (alphaIndex >= 0) return ALPHA_MEMBERSHIP(alphaIndex + 1);
  const bravoIndex = BRAVO_NAMES.indexOf(familyName);
  if (bravoIndex >= 0) return BRAVO_MEMBERSHIP(bravoIndex + 1);
  throw new Error(`${familyName} is not a scope fixture member.`);
}

/** The `people.id` for a scope member, from persisted state. */
export function scopePersonId(familyName: string): string {
  const id = loadScopeState().personIds[familyName];
  if (!id) throw new Error(`${familyName} is not a seeded scope member.`);
  return id;
}
