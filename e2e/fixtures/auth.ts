// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/fixtures/auth.ts — the Playwright half of the nine-fixture world.
//
// WHAT:  Seeds the SAME eight accounts, six people and five memberships that
//        `supabase/test-helpers/fixtures.sql` seeds for pgTAP, but against a REAL,
//        COMMITTED database, with REAL passwords and REAL TOTP factors — because
//        `e2e/login.spec.ts` drives the actual login screens rather than forging
//        `request.jwt.claims`.
//
// WHY:   BUILD_PLAN S2-T41: "seeds from the SAME UUIDs as
//        supabase/tests/helpers/fixtures.sql, so the pgTAP and Playwright worlds
//        describe one system rather than two." If these two files drift, a pgTAP
//        suite and a Playwright spec can both be green about different systems.
//
// IDENTIFIERS ARE THE CROSS-LANE CONTRACT and are copied verbatim from the pgTAP
//        helper: account uuids …a000-00000000000{1..8}, person uuids
//        …b000-00000000000{1..6}, membership uuids …c000-00000000000{1..4},
//        Region A = 'NCR', Region B = 'R07'. Emails are the pgTAP helper's, not an
//        invented second set.
//
// RUNS AS service_role. That is legitimate here: this is TEST SETUP, not
//        request-handling code (CLAUDE.md's ban is on `app/` importing the
//        service-role client). `people` has no INSERT policy for any human role by
//        design — seeding is a privileged act by construction.
//
// NEVER RUN THIS AGAINST PRODUCTION. It creates confirmed accounts with a known
//        password. `assertNotProduction()` refuses any non-local Supabase URL unless
//        E2E_ALLOW_REMOTE_SEED is set explicitly.
//
// SECRETS: the TOTP secrets it mints are written to FIXTURE_STATE_PATH, which lives
//        under `e2e-artifacts/` because that directory is already in `.gitignore`.
//        Nothing this file produces is ever committed.
// ═══════════════════════════════════════════════════════════════════════════════════

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generate as generateOtp } from "otplib";
import type { Page } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// The contract: names, uuids, emails, password
// ─────────────────────────────────────────────────────────────────────────────

/** The CONVENTIONS.md §8.1 fixture names, minus `anon` (which has no account). */
export type FixtureName =
  | "exec_admin"
  | "tech_admin"
  | "crrd_admin"
  | "crrd_deputy"
  | "officer"
  | "regional_rep_a"
  | "regional_rep_b"
  | "member";

export type FixtureAccount = {
  readonly name: FixtureName;
  /** The `org_role` written to `user_roles`. */
  readonly role: string;
  /** The uuid the pgTAP helper uses. Requested from GoTrue; see `resolveUserId`. */
  readonly id: string;
  readonly email: string;
  /** `people.id`, or null for an account bound to no person (tech_admin, both reps). */
  readonly personId: string | null;
  /** `regions.code`, or null. Required for `regional_rep` by the `rr_needs_region` CHECK. */
  readonly regionCode: string | null;
  /** Whether the seeder enrols a verified TOTP factor for this account. */
  readonly enrolTotp: boolean;
  /** Where `homeForRole()` sends them (lib/auth/route-access.ts). */
  readonly home: string;
};

/** One shared password. Not a secret: these accounts exist only in a scratch database. */
export const FIXTURE_PASSWORD = "fixture-password-1234";

const A = (n: number) => `00000000-0000-4000-a000-00000000000${n}`;
const B = (n: number) => `00000000-0000-4000-b000-00000000000${n}`;
const C = (n: number) => `00000000-0000-4000-c000-00000000000${n}`;

export const FIXTURES: Record<FixtureName, FixtureAccount> = {
  exec_admin: {
    name: "exec_admin",
    role: "exec_admin",
    id: A(1),
    email: "exec.admin@fixture.start-sys.test",
    personId: B(1),
    regionCode: null,
    enrolTotp: true,
    home: "/dashboard",
  },
  tech_admin: {
    name: "tech_admin",
    role: "tech_admin",
    id: A(2),
    email: "tech.admin@fixture.start-sys.test",
    personId: null,
    regionCode: null,
    enrolTotp: true,
    home: "/system",
  },
  crrd_admin: {
    name: "crrd_admin",
    role: "crrd_admin",
    id: A(3),
    email: "crrd.admin@fixture.start-sys.test",
    personId: B(2),
    regionCode: null,
    enrolTotp: true,
    home: "/dashboard",
  },
  // The CRRD deputy (DCCDO-C): crrd_admin under the SRS (2026-09-05, migration 0036),
  // and the ONE privileged account with no confidentiality acknowledgement — the
  // day-one refusal case. Same uuid and person as pgTAP's crrd_deputy fixture.
  crrd_deputy: {
    name: "crrd_deputy",
    role: "crrd_admin",
    id: A(4),
    email: "crrd.deputy@fixture.start-sys.test",
    personId: B(3),
    regionCode: null,
    enrolTotp: true,
    home: "/dashboard",
  },
  // DELIBERATELY UNENROLLED. US-A3: an officer-or-above account with no second
  // factor must see an enrolment screen and no organizational data. That case needs
  // an account in exactly this state, so the seeder actively strips any factor here.
  officer: {
    name: "officer",
    role: "officer",
    id: A(5),
    email: "officer@fixture.start-sys.test",
    personId: null,
    regionCode: null,
    enrolTotp: false,
    home: "/directory",
  },
  regional_rep_a: {
    name: "regional_rep_a",
    role: "regional_rep",
    id: A(6),
    email: "rep.a@fixture.start-sys.test",
    personId: null,
    regionCode: "NCR",
    enrolTotp: true,
    home: "/region",
  },
  regional_rep_b: {
    name: "regional_rep_b",
    role: "regional_rep",
    id: A(7),
    email: "rep.b@fixture.start-sys.test",
    personId: null,
    regionCode: "R07",
    enrolTotp: true,
    home: "/region",
  },
  // `member` is the REVOKED tier (0036): members hold no accounts under the SRS, so
  // this label exists only as what revokeRole writes. No factor, none demanded (ADR
  // 0004), and no route — it lands on the explicit refusal page.
  member: {
    name: "member",
    role: "member",
    id: A(8),
    email: "member@fixture.start-sys.test",
    personId: B(4),
    regionCode: null,
    enrolTotp: false,
    home: "/unauthorized",
  },
};

export const FIXTURE_NAMES = Object.keys(FIXTURES) as FixtureName[];

/**
 * The four planted literals carried by P4 (`00000000-…-b000-…004`, the member
 * fixture's person). Any served HTML containing one of these strings for an
 * `officer` or `regional_rep` session is a Data Privacy NFR failure — the officer
 * enrolment-gate case greps for exactly these.
 */
// `postal_code` ("1200") is deliberately excluded: four digits appear in ordinary
// page chrome, so grepping for it would produce false positives and the assertion
// would be switched off rather than believed.
export const PLANTED_SENSITIVE_VALUES = [
  "+639171234567", // contact_number
  "Planted Address Line 42", // address_line
  "PLANTED-SCH-001", // school_id_no
  "2003-04-15", // birthdate
] as const;

/** Family names that only appear on member records — a directory leak names one. */
export const FIXTURE_MEMBER_SURNAMES = ["Dela Cruz", "Reyes", "Peña", "Santos"];

// ─────────────────────────────────────────────────────────────────────────────
// Persisted state
// ─────────────────────────────────────────────────────────────────────────────

export type FixtureState = {
  generatedAt: string;
  supabaseUrl: string;
  /** email → the id GoTrue actually assigned. Authoritative over `FIXTURES[].id`. */
  userIds: Record<string, string>;
  /** email → base32 TOTP secret for the enrolled accounts. */
  totpSecrets: Record<string, string>;
};

/**
 * Under `e2e-artifacts/` on purpose: that directory is already in `.gitignore`, so
 * the TOTP secrets this file mints cannot be committed by accident. Overridable with
 * E2E_FIXTURE_STATE for a CI runner that wants them elsewhere.
 */
export const FIXTURE_STATE_PATH = resolve(
  process.env.E2E_FIXTURE_STATE ?? "e2e-artifacts/.fixture-state.json",
);

export function loadFixtureState(): FixtureState {
  try {
    return JSON.parse(readFileSync(FIXTURE_STATE_PATH, "utf8")) as FixtureState;
  } catch {
    throw new Error(
      `No fixture state at ${FIXTURE_STATE_PATH}. Run the Playwright globalSetup ` +
        `(e2e/global-setup.ts) with SUPABASE_SERVICE_ROLE_KEY set.`,
    );
  }
}

function writeFixtureState(state: FixtureState): void {
  mkdirSync(dirname(FIXTURE_STATE_PATH), { recursive: true });
  writeFileSync(FIXTURE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

/** A current TOTP code for an enrolled fixture. */
export async function totpCode(name: FixtureName): Promise<string> {
  const state = loadFixtureState();
  const secret = state.totpSecrets[FIXTURES[name].email];
  if (!secret) {
    throw new Error(`Fixture ${name} has no persisted TOTP secret — re-run globalSetup.`);
  }
  return generateOtp({ secret });
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to seed e2e auth fixtures.`);
  return value;
}

/**
 * Refuse to create known-password accounts anywhere that is not obviously a local or
 * scratch database. The cost of being wrong here is eight confirmed admin accounts
 * with a published password on a database holding real scholars' PII.
 */
function assertNotProduction(url: string): void {
  const isLocal = /localhost|127\.0\.0\.1|host\.docker\.internal|\[::1\]/i.test(url);
  if (isLocal || process.env.E2E_ALLOW_REMOTE_SEED === "true") return;
  throw new Error(
    `Refusing to seed e2e fixtures against a non-local Supabase (${url}). ` +
      `Set E2E_ALLOW_REMOTE_SEED=true only for a disposable staging project.`,
  );
}

function adminClient(): SupabaseClient {
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

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  // GoTrue's admin API has no "get by email", so page through. Eight fixtures in a
  // scratch database means one page in practice.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Create the account at its contract uuid if GoTrue accepts an explicit `id`, and
 * fall back to whatever id it assigns if it does not. The RETURNED id is what every
 * subsequent write uses — a mismatch between the pgTAP uuid and the real one would
 * otherwise produce `user_roles` rows pointing at nobody.
 */
async function resolveUserId(admin: SupabaseClient, account: FixtureAccount): Promise<string> {
  const existing = await findUserIdByEmail(admin, account.email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing, {
      password: FIXTURE_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    return existing;
  }

  const attributes = {
    email: account.email,
    password: FIXTURE_PASSWORD,
    email_confirm: true,
    user_metadata: {},
    // NEVER a role here. ARCHITECTURE §5: a role in user_metadata is user-writable
    // and a one-line privilege escalation. Roles live in public.user_roles.
  };

  // `AdminUserAttributes.id` lets us keep the pgTAP uuid, which is the whole point of
  // the cross-lane contract. Older GoTrue builds ignore or reject it, hence the retry.
  const withId = await admin.auth.admin.createUser({ ...attributes, id: account.id });
  if (!withId.error && withId.data.user) return withId.data.user.id;

  const withoutId = await admin.auth.admin.createUser(attributes);
  if (withoutId.error) throw withoutId.error;
  if (!withoutId.data.user) throw new Error(`GoTrue returned no user for ${account.email}`);
  return withoutId.data.user.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Org data — mirrors supabase/test-helpers/fixtures.sql §2, §3, §5, §8
// ─────────────────────────────────────────────────────────────────────────────

const PEOPLE = [
  {
    id: B(1),
    member_id: "2022-001",
    join_year: 2022,
    given_name: "Danielle",
    middle_name: "Reyes",
    family_name: "Quiambao",
    birthdate: "2001-01-11",
    contact_number: "+639180000001",
    personal_email: "danielle.quiambao@fixture.start-sys.test",
    address_line: "Fixture Street 1",
    city_municipality: "Quezon City",
    province: "Metro Manila",
    postal_code: "1100",
    school: "University of the Philippines Diliman",
    school_id_no: "FIXT-SCH-P1",
  },
  {
    id: B(2),
    member_id: "2022-002",
    join_year: 2022,
    given_name: "Ethan",
    middle_name: "Dreiz",
    family_name: "Baltazar",
    birthdate: "2001-02-22",
    contact_number: "+639180000002",
    personal_email: "ethan.baltazar@fixture.start-sys.test",
    address_line: "Fixture Street 2",
    city_municipality: "Pasig",
    province: "Metro Manila",
    postal_code: "1600",
    school: "Ateneo de Manila University",
    school_id_no: "FIXT-SCH-P2",
  },
  {
    id: B(3),
    member_id: "2023-001",
    join_year: 2023,
    given_name: "Maria",
    middle_name: "Cruz",
    family_name: "Santos",
    birthdate: "2002-03-03",
    contact_number: "+639180000003",
    personal_email: "maria.santos@fixture.start-sys.test",
    address_line: "Fixture Street 3",
    city_municipality: "Manila",
    province: "Metro Manila",
    postal_code: "1000",
    school: "Polytechnic University of the Philippines",
    school_id_no: "FIXT-SCH-P3",
  },
  {
    // THE PLANTED-LITERAL ROW. See PLANTED_SENSITIVE_VALUES.
    id: B(4),
    member_id: "2024-001",
    join_year: 2024,
    given_name: "Juan",
    middle_name: "Ponce",
    family_name: "Dela Cruz",
    birthdate: "2003-04-15",
    contact_number: "+639171234567",
    personal_email: "juan.delacruz@fixture.start-sys.test",
    address_line: "Planted Address Line 42",
    city_municipality: "Makati",
    province: "Metro Manila",
    postal_code: "1200",
    school: "Mapua University",
    school_id_no: "PLANTED-SCH-001",
  },
  {
    id: B(5),
    member_id: "2024-1000",
    join_year: 2024,
    given_name: "Andrea",
    middle_name: "Lim",
    family_name: "Reyes",
    birthdate: "2003-05-05",
    contact_number: "+639180000005",
    personal_email: "andrea.reyes@fixture.start-sys.test",
    address_line: "Fixture Street 5",
    city_municipality: "Cebu City",
    province: "Cebu",
    postal_code: "6000",
    school: "University of San Carlos",
    school_id_no: "FIXT-SCH-P5",
  },
  {
    id: B(6),
    member_id: "2025-007",
    join_year: 2025,
    given_name: "José",
    middle_name: "Miguel",
    family_name: "Peña",
    birthdate: "2004-06-06",
    contact_number: "+639180000006",
    personal_email: "jose.pena@fixture.start-sys.test",
    address_line: "Fixture Street 6",
    city_municipality: "Mandaue",
    province: "Cebu",
    postal_code: "6014",
    school: "Cebu Institute of Technology",
    school_id_no: "FIXT-SCH-P6",
  },
];

/** Active-term memberships, split 2 NCR / 2 R07. Matches pgTAP c000-…001..004. */
const MEMBERSHIPS = [
  { id: C(1), person_id: B(3), region_code: "NCR", year_level: 3, expected_grad_year: 2028 },
  { id: C(2), person_id: B(4), region_code: "NCR", year_level: 2, expected_grad_year: 2029 },
  { id: C(3), person_id: B(5), region_code: "R07", year_level: 4, expected_grad_year: 2027 },
  { id: C(4), person_id: B(6), region_code: "R07", year_level: 1, expected_grad_year: 2030 },
];

async function seedOrgData(admin: SupabaseClient, userIds: Record<string, string>): Promise<void> {
  // ignoreDuplicates everywhere: re-running the seeder must be a no-op, not an
  // UPDATE — `people` carries an immutability trigger on member_id, and rewriting
  // rows would churn the audit log for nothing.
  const insertIfAbsent = async (
    table: string,
    rows: Record<string, unknown>[],
    onConflict: string,
  ) => {
    const { error } = await admin.from(table).upsert(rows, { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`seeding ${table}: ${error.message}`);
  };

  await insertIfAbsent("people", PEOPLE, "id");

  const { data: regions, error: regionError } = await admin
    .from("regions")
    .select("id, code")
    .in("code", ["NCR", "R07"]);
  if (regionError) throw regionError;
  // Regions are resolved by CODE, never by a literal uuid: 0016 generates region ids
  // with gen_random_uuid(), so a hardcoded one is wrong on every fresh database.
  const regionId = new Map<string, string>();
  for (const region of regions ?? []) regionId.set(String(region.code), String(region.id));
  if (!regionId.has("NCR") || !regionId.has("R07")) {
    throw new Error("Regions NCR and R07 are not seeded — run `pnpm db:reset` first.");
  }

  // The active term is looked up by STATUS, never by label: `one_active_term` forbids
  // a second one, and hardcoding '2026-2027' breaks the day the bootstrap term moves.
  const { data: term, error: termError } = await admin
    .from("terms")
    .select("id, label")
    .eq("status", "active")
    .maybeSingle();
  if (termError) throw termError;
  if (!term) throw new Error("No active term — 0016_seed.sql has not been applied.");

  await insertIfAbsent(
    "memberships",
    MEMBERSHIPS.map((m) => ({
      id: m.id,
      person_id: m.person_id,
      term_id: term.id,
      status: "active",
      region_id: regionId.get(m.region_code),
      year_level: m.year_level,
      expected_grad_year: m.expected_grad_year,
    })),
    "id",
  );

  await insertIfAbsent(
    "user_roles",
    FIXTURE_NAMES.map((name) => {
      const f = FIXTURES[name];
      return {
        user_id: userIds[f.email],
        role: f.role,
        person_id: f.personId,
        region_id: f.regionCode ? regionId.get(f.regionCode) : null,
      };
    }),
    "user_id",
  );

  // CBL Art. VIII §7.1 (US-J5). exec_admin's and crrd_admin's people have signed for
  // the current term; the CRRD deputy's DELIBERATELY has not, so the day-one refusal is
  // a tested behaviour rather than a surprise.
  await insertIfAbsent(
    "confidentiality_acknowledgements",
    [B(1), B(2)].map((personId) => ({
      person_id: personId,
      term_id: term.id,
      agreement_version: "CBL-2026-VIII-7",
      recorded_by: userIds[FIXTURES.exec_admin.email],
    })),
    "person_id,term_id",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTP factors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enrol a verified TOTP factor by driving the ordinary user-session MFA flow — the
 * same calls the enrolment screen makes. There is no admin API for this, and there
 * should not be: a factor a user never proved possession of is not a second factor.
 *
 * @returns the base32 secret, so the spec can generate codes.
 */
async function enrolTotp(email: string, existingSecret: string | undefined): Promise<string> {
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: FIXTURE_PASSWORD,
  });
  if (signInError) throw new Error(`TOTP enrol sign-in for ${email}: ${signInError.message}`);

  try {
    const { data: factors, error: listError } = await client.auth.mfa.listFactors();
    if (listError) throw listError;
    const verified = factors.totp.filter((f) => f.status === "verified");

    // Already enrolled and we still hold the secret — leave it alone. Re-enrolling on
    // every run would invalidate any code a retrying test had already generated.
    if (verified.length > 0 && existingSecret) return existingSecret;

    // Enrolled but the secret is lost (fresh checkout, cleared artifacts). The factor
    // is unusable to us, so replace it.
    for (const factor of factors.totp) {
      const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw error;
    }

    const { data: enrolled, error: enrolError } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `e2e-${Date.now()}`,
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

/** Strip every factor, so the account is genuinely unenrolled (the officer case). */
async function stripTotp(email: string): Promise<void> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: FIXTURE_PASSWORD,
  });
  if (error) throw new Error(`TOTP strip sign-in for ${email}: ${error.message}`);
  try {
    const { data: factors } = await client.auth.mfa.listFactors();
    for (const factor of factors?.totp ?? []) {
      await client.auth.mfa.unenroll({ factorId: factor.id });
    }
  } finally {
    await client.auth.signOut();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Idempotent. Safe to run before every Playwright invocation; safe to run twice.
 */
export async function seedAuthFixtures(): Promise<FixtureState> {
  const admin = adminClient();

  const previous: FixtureState | null = (() => {
    try {
      return loadFixtureState();
    } catch {
      return null;
    }
  })();

  const userIds: Record<string, string> = {};
  for (const name of FIXTURE_NAMES) {
    const account = FIXTURES[name];
    userIds[account.email] = await resolveUserId(admin, account);
  }

  await seedOrgData(admin, userIds);

  const totpSecrets: Record<string, string> = {};
  for (const name of FIXTURE_NAMES) {
    const account = FIXTURES[name];
    if (account.enrolTotp) {
      totpSecrets[account.email] = await enrolTotp(
        account.email,
        previous?.totpSecrets[account.email],
      );
    } else {
      await stripTotp(account.email);
    }
  }

  const state: FixtureState = {
    generatedAt: new Date().toISOString(),
    supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    userIds,
    totpSecrets,
  };
  writeFixtureState(state);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page objects — every selector for the auth screens lives HERE
// ─────────────────────────────────────────────────────────────────────────────
//
// One place to fix when S2-T33/T36/T38 settle their markup, rather than seven.
// Accessible selectors only (role + label), so the specs also assert the screens are
// operable — the Usability NFR gets tested for free.

export const authScreens = {
  emailField: (page: Page) => page.getByLabel(/email/i),
  passwordField: (page: Page) => page.getByLabel(/^password$/i),
  newPasswordField: (page: Page) => page.getByRole("textbox", { name: /^new password$/i }),
  submitLogin: (page: Page) => page.getByRole("button", { name: /sign in|log ?in/i }),
  /** The six-digit TOTP input on both the verify and the reset challenge screens. */
  totpField: (page: Page) =>
    // Role textbox, not getByLabel: the verify screen's <section aria-labelledby>
    // ("Enter your authentication code") also matches a label lookup.
    page.getByRole("textbox", {
      name: /authentication code|verification code|one-time code|digit|totp/i,
    }),
  submitTotp: (page: Page) => page.getByRole("button", { name: /verify|continue|submit/i }),
  errorMessage: (page: Page) => page.getByRole("alert"),
};

/** Fill and submit the login form. Does NOT satisfy any MFA challenge that follows. */
export async function submitLogin(
  page: Page,
  email: string,
  password: string = FIXTURE_PASSWORD,
): Promise<void> {
  await authScreens.emailField(page).fill(email);
  await authScreens.passwordField(page).fill(password);
  await authScreens.submitLogin(page).click();
}

/**
 * Sign in through the real screens, satisfying the TOTP challenge when one appears.
 *
 * Deliberately NOT a seeded cookie or an injected JWT: BUILD_PLAN S2-T41 and S6-T15
 * both require these flows to pass through the actual login and MFA UI, because an
 * API-level pass does not prove the page refuses to render.
 */
export async function signIn(page: Page, name: FixtureName, next?: string): Promise<void> {
  const account = FIXTURES[name];
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await submitLogin(page, account.email);

  if (account.enrolTotp) {
    await page.waitForURL(/\/auth\/mfa\/verify/);
    await completeTotpChallenge(page, name);
  }
  await page.waitForURL((url) => !/\/login|\/auth\/mfa/.test(url.pathname));
}

/** Enter a fresh code on whichever screen is currently challenging for one. */
export async function completeTotpChallenge(page: Page, name: FixtureName): Promise<void> {
  await authScreens.totpField(page).fill(await totpCode(name));
  await authScreens.submitTotp(page).click();
}
