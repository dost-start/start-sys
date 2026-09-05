// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/member-officer-read-only.spec.ts — BUILD_PLAN S5-T30.
//
// The UI companion to `supabase/tests/061_officer_column_sets.sql`. That suite proves
// the officer and regional-rep tiers hold no GRANT on a sensitive column; this file
// proves the SCREENS built on top of it do not smuggle one back.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY IT GREPS THE SERVED HTML AND NOT THE RENDERED TABLE
// ═══════════════════════════════════════════════════════════════════════════════
// A Server Component that over-fetches leaks in the HTML PAYLOAD regardless of what the
// UI chooses to display: the value arrives in the flight data, in a serialized prop, in
// a `<script>` payload — and never appears on screen. Checking that a column header is
// absent would pass against exactly that bug. So every assertion here is a literal
// substring search over `page.content()` for the values `dashboard-seed.ts` planted
// (PRD US-D2, US-J1; CBL Art. VIII §6 makes RA 10173 a constitutional obligation).
//
// ⚠ EVERY ASSERTION IS GUARDED AGAINST A VACUOUS PASS. A page that rendered nothing —
// a redirect, a crash, an empty result — contains no planted literal either, and would
// sail through. So each case first asserts the officer CAN see the directory (a member
// ID and a scope surname are present) before asserting what is absent.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE WRITE CASE IS MADE THROUGH POSTGREST, NOT THROUGH THE UI
// ═══════════════════════════════════════════════════════════════════════════════
// PRD US-D2 and US-F2 say no create, update or delete path exists for these tiers —
// "enforced at the data layer, so it holds even if a UI control is mistakenly rendered".
// A Server Action cannot be invoked from Playwright, but the write it would perform can
// be attempted DIRECTLY against PostgREST carrying the officer's own JWT. That is the
// stronger test: it bypasses `withRole()` entirely and lands on the policy, which is the
// actual enforcement. `withRole()` is defence in depth and is unit-tested separately.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ THE MIDDLEWARE-OFF VARIANT IS DELIBERATELY NOT HERE
// ═══════════════════════════════════════════════════════════════════════════════
// ARCHITECTURE §5's central claim is that deleting `middleware.ts` would degrade UX, not
// confidentiality. Proving it needs the app rebuilt and restarted WITHOUT that file,
// which cannot be done mid-run against a Playwright `webServer` that started once for
// the whole suite. It belongs to BUILD_PLAN **S7-T29 check (1)** — the deploy-level
// anonymous and officer crawl against a preview built from a branch with `middleware.ts`
// removed — and to **S2-T42**, which already captured it once by hand. Asserting a
// weaker in-process approximation here would let a real leak pass under a green tick.
//
// SKIPS WITHOUT SUPABASE_SERVICE_ROLE_KEY: seeding and the database assertions are
// privileged, and a DB-less clone should still get a green `pnpm test:e2e`.
// ═══════════════════════════════════════════════════════════════════════════════════

import { expect, test, type Page } from "@playwright/test";

import { MEMBERS_PATH } from "../lib/members/filters";
import {
  ALPHA_NAMES,
  DASHBOARD_PLANTED_VALUES,
  PLANTED_SCHOOL_ID,
  countViewRecords,
  scopeAdminClient,
  scopeMembershipId,
  scopePersonId,
  scopeSignIn,
  scopeSignedInClient,
  readMembershipStatus,
  seedDashboardWorld,
} from "./fixtures/dashboard-seed";

const HAS_SERVICE_KEY = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

test.skip(
  !HAS_SERVICE_KEY,
  "SUPABASE_SERVICE_ROLE_KEY is not set — the scope world cannot be seeded or asserted.",
);

const DIRECTORY_PATH = "/directory";
const REGION_PATH = "/region";

/** Every literal that must never reach a read-only tier's payload. */
const FORBIDDEN_LITERALS = [...DASHBOARD_PLANTED_VALUES, PLANTED_SCHOOL_ID];

/**
 * The whole privacy assertion, in one place so both tiers get exactly the same one.
 *
 * @param page      a page already navigated to the surface under test
 * @param expectVisible a string that MUST be present, so an empty page cannot pass
 */
async function expectNoSensitiveLeak(
  page: Page,
  expectVisible: string,
  allowed: readonly string[] = [],
): Promise<void> {
  const html = await page.content();

  // Non-vacuity first. A redirect, a 404 or a crashed render contains no planted value
  // either, and every assertion below would pass against a screen showing nothing.
  expect(
    html.includes(expectVisible),
    `expected the directory to actually render (looking for "${expectVisible}")`,
  ).toBe(true);

  for (const literal of FORBIDDEN_LITERALS) {
    if (allowed.includes(literal)) continue;
    expect(html.includes(literal), `served HTML contains the planted value ${literal}`).toBe(false);
  }
}

/**
 * PRD US-D2: "No update, create or delete path exists for the Officer tier on any
 * record." Rendering one would be a lie about a capability that does not exist, and the
 * user's next move on the 42501 is to conclude the system is broken.
 */
async function expectNoWriteControls(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /^edit/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /change status|update status/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /approve|reject/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /delete|remove/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /assign/i })).toHaveCount(0);
}

test.describe("read-only tiers see no sensitive data and hold no write path", () => {
  test.beforeAll(async () => {
    if (!HAS_SERVICE_KEY) return;
    await seedDashboardWorld();
  });

  // ── 1 ── US-D2, US-J1 ─────────────────────────────────────────────────────
  test("US-J1: the officer directory payload contains none of the planted sensitive values", async ({
    page,
  }) => {
    const anyScopeMember = ALPHA_NAMES[0];
    if (!anyScopeMember) throw new Error("No scope fixtures seeded.");

    await scopeSignIn(page, "scope_officer");
    await page.goto(DIRECTORY_PATH);
    await page.waitForLoadState("networkidle");

    await expectNoSensitiveLeak(page, anyScopeMember);
    await expectNoWriteControls(page);
  });

  // ── 2 ── US-D2 ────────────────────────────────────────────────────────────
  test("an officer's direct link to a member record is refused and writes no VIEW_RECORD row", async ({
    page,
  }) => {
    const admin = scopeAdminClient();
    const target = ALPHA_NAMES[1];
    if (!target) throw new Error("No scope fixtures seeded.");
    const personId = scopePersonId(target);

    const before = await countViewRecords(admin, personId);

    await scopeSignIn(page, "scope_officer");
    await page.goto(`${MEMBERS_PATH}/${personId}`);
    await page.waitForLoadState("networkidle");

    // Refused. The shape of the refusal is deliberate: `get_member_record()` raises for
    // the officer tier and CONVENTIONS §4.3 maps a refusal to NOT FOUND, never to
    // "forbidden" — saying forbidden would confirm that a named scholar has a record.
    const html = await page.content();
    for (const literal of FORBIDDEN_LITERALS) {
      expect(html.includes(literal), `refused page still contains ${literal}`).toBe(false);
    }
    // Either the middleware bounced them to their own home, or the page rendered
    // not-found. Both are correct; landing on a working record page is not.
    const landed = new URL(page.url()).pathname;
    const isRecordPage = landed === `${MEMBERS_PATH}/${personId}`;
    if (isRecordPage) {
      await expect(page.getByText(/not found|does not exist/i).first()).toBeVisible();
    }

    // The audit log is the point: a refused read must not look like a read. A denied
    // access that still stamps a row would make the RA 10173 record unusable as evidence.
    expect(await countViewRecords(admin, personId)).toBe(before);
  });

  // ── 3 ── US-D2 / US-F2 at the data layer ──────────────────────────────────
  test("US-D2: an officer's own JWT cannot update a membership, even bypassing the UI", async () => {
    const admin = scopeAdminClient();
    const target = ALPHA_NAMES[2];
    if (!target) throw new Error("No scope fixtures seeded.");
    const membershipId = scopeMembershipId(target);

    const before = await readMembershipStatus(admin, membershipId);

    const officer = await scopeSignedInClient("scope_officer");
    const { data, error } = await officer
      .from("memberships")
      .update({ status: "graduated" })
      .eq("id", membershipId)
      .select("id");

    // No UPDATE policy names `officer` anywhere in the schema (0014 §4;
    // `026_policy_invariants.sql` asserts the absence). RLS's refusal is an EMPTY RESULT,
    // not an error — that silence is the single most confusing thing about this codebase,
    // and it is why the assertion below is on the row count and on the row itself, never
    // on an exception that will not arrive.
    if (!error) expect(data ?? []).toHaveLength(0);

    expect(await readMembershipStatus(admin, membershipId)).toBe(before);
    await officer.auth.signOut();
  });

  // ── 4 ── US-F1, US-F2 ─────────────────────────────────────────────────────
  test("US-J1: the regional-rep dashboard payload contains none of the planted sensitive values", async ({
    page,
  }) => {
    const anyRegionAMember = ALPHA_NAMES[0];
    if (!anyRegionAMember) throw new Error("No scope fixtures seeded.");

    await scopeSignIn(page, "scope_rep_a");
    await page.goto(REGION_PATH);
    await page.waitForLoadState("networkidle");

    // ADR 0011: rep A has signed the confidentiality agreement, so its OWN region's
    // contact numbers render on /region through the audited RPC. The address and the
    // school ID remain leaks. The region-B contact scoping is proven in pgTAP 071.
    await expectNoSensitiveLeak(page, anyRegionAMember, ["+63917PLANTED99"]);
    await expectNoWriteControls(page);
  });

  // ── 5 ── US-F2 ────────────────────────────────────────────────────────────
  test("US-F2: a regional rep cannot update a member in their OWN region", async () => {
    const admin = scopeAdminClient();
    const target = ALPHA_NAMES[3];
    if (!target) throw new Error("No scope fixtures seeded.");
    const membershipId = scopeMembershipId(target);

    const before = await readMembershipStatus(admin, membershipId);

    // Their own region on purpose. The interesting failure is not a rep editing region B
    // — RLS hides those rows entirely — it is a rep editing the region they CAN see.
    // "Regional access is not regional editing" is a missing policy, not a hidden button.
    const rep = await scopeSignedInClient("scope_rep_a");
    const { data, error } = await rep
      .from("memberships")
      .update({ status: "resigned" })
      .eq("id", membershipId)
      .select("id");

    if (!error) expect(data ?? []).toHaveLength(0);
    expect(await readMembershipStatus(admin, membershipId)).toBe(before);
    await rep.auth.signOut();
  });
});
