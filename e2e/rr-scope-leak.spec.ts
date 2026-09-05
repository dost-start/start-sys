// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/rr-scope-leak.spec.ts — BUILD_PLAN S6-T15. THE DAY-5 EXIT GATE.
//
// The fourth of the six locked Playwright flows, and the one that decides whether the
// authorization story is true. If this file is red, Day 6 does not start: a red scope
// slice carried into hardening gets its failure attributed to the deploy.
//
// ═══════════════════════════════════════════════════════════════════════════════
// EVERY STEP SIGNS IN THROUGH THE REAL LOGIN AND TOTP SCREENS
// ═══════════════════════════════════════════════════════════════════════════════
// No injected JWT, no seeded cookie, no storageState shortcut. An API-level pass proves
// the DATABASE refuses; it does not prove the PAGE refuses to render region B. Those are
// different claims and PRD US-F1 is the second one. `scopeSignIn()` drives the same
// screens a rep uses, TOTP challenge included (PRD item 2: 2FA is mandatory above the
// Member tier, so a rep who cannot pass it is not a rep who can be tested).
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THE FIXTURE IS ASYMMETRIC (9 vs 6)
// ═══════════════════════════════════════════════════════════════════════════════
// Two equal halves make the two most likely bugs indistinguishable from correctness: a
// view that returns "the other region" and one that returns "the right region" produce
// the same count. Nine region-A members and six region-B members, with names that state
// their own region, mean a leak is legible in the page text rather than inferable from
// arithmetic. Step 2 then asserts the two collected NAME SETS ARE DISJOINT, which no
// single-rep test can establish however carefully it counts.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ WHY STEP 6 IS `test.fixme` AND NOT A WEAKER APPROXIMATION
// ═══════════════════════════════════════════════════════════════════════════════
// S6-T15 step 6 asks for steps 1–4 repeated with `middleware.ts` disabled — invariant 1
// written as a test, since ARCHITECTURE §5 claims deleting middleware would cost UX and
// not confidentiality. It cannot be done here: Playwright's `webServer` builds and starts
// the app ONCE for the whole suite, and renaming a file mid-run neither rebuilds it nor
// affects the already-running server. Faking it — stubbing a header, flipping an env flag
// the middleware itself reads — tests the flag, not the boundary, and would let a genuine
// leak pass under a green tick.
//
// It is therefore carried, deliberately and visibly, to:
//   • BUILD_PLAN **S2-T42**, which captured it once by hand with the twelve HTML captures
//     recorded in `docs/issues/2026-09-02-authz-slice-verification.md`; and
//   • BUILD_PLAN **S7-T29 check (1)**, the deploy-level scripted crawl against a preview
//     built from a branch with `middleware.ts` removed — anonymous and officer, every
//     route and every PostgREST table endpoint.
//
// A `fixme` that names where the coverage actually lives is honest. A green test that
// does not test the thing is not.
//
// SKIPS WITHOUT SUPABASE_SERVICE_ROLE_KEY, like every seeded spec.
// ═══════════════════════════════════════════════════════════════════════════════════

import { expect, test, type Page } from "@playwright/test";

import { MEMBERS_PATH } from "../lib/members/filters";
import { signIn } from "./fixtures/auth";
import {
  ALPHA_NAMES,
  BRAVO_NAMES,
  DASHBOARD_PLANTED_VALUES,
  PLANTED_SCHOOL_ID,
  REGION_A_CODE,
  REGION_B_CODE,
  countMembershipsInRegion,
  loadScopeState,
  readMembershipStatus,
  scopeAdminClient,
  scopeMembershipId,
  scopePersonId,
  scopeSignIn,
  scopeSignedInClient,
  seedDashboardWorld,
} from "./fixtures/dashboard-seed";

const HAS_SERVICE_KEY = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

test.skip(
  !HAS_SERVICE_KEY,
  "SUPABASE_SERVICE_ROLE_KEY is not set — the scope gate cannot be seeded or asserted.",
);

const REGION_PATH = "/region";
const DIRECTORY_PATH = "/directory";
const COMMITTEES_PATH = "/committees";
const DASHBOARD_PATH = "/dashboard";

/** PRD Performance NFR / US-D4: common page loads under 3 seconds. */
const PAGE_BUDGET_MS = 3000;

const FORBIDDEN_LITERALS = [...DASHBOARD_PLANTED_VALUES, PLANTED_SCHOOL_ID];

/**
 * ADR 0011: a Regional Representative WITH a current-term confidentiality acknowledgement
 * sees their own region's contact numbers, so the planted contact number is no longer a
 * leak on /region for rep A. The address and the school ID still are — the widening is
 * exactly the meeting's contact set and nothing more.
 */
const PLANTED_CONTACT_NUMBER = "+63917PLANTED99";
const REGION_FORBIDDEN_LITERALS = FORBIDDEN_LITERALS.filter((l) => l !== PLANTED_CONTACT_NUMBER);

/** Which scope surnames appear anywhere in the served payload. */
function namesPresent(html: string, names: readonly string[]): string[] {
  return names.filter((name) => html.includes(name));
}

test.describe("regional-rep scope gate (US-F1, US-F2, US-J1)", () => {
  test.beforeAll(async () => {
    if (!HAS_SERVICE_KEY) return;
    await seedDashboardWorld();
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  test("US-F1: rep A sees region A's headcount and every region-A member, and no region-B member", async ({
    page,
  }) => {
    const admin = scopeAdminClient();
    const state = loadScopeState();
    const regionA = state.regionIds[REGION_A_CODE];
    if (!regionA) throw new Error("Region A is not seeded.");

    // Computed, never hardcoded — the seeder is not the only writer in this database.
    const expected = await countMembershipsInRegion(admin, regionA, state.currentTermId);
    expect(expected).toBeGreaterThanOrEqual(ALPHA_NAMES.length);

    await scopeSignIn(page, "scope_rep_a");
    await page.goto(REGION_PATH);
    await page.waitForLoadState("networkidle");

    const html = await page.content();

    // The headcount the dashboard shows is region A's, not the organization's. The tiles
    // are `security_invoker` views over `memberships`, so this number is correct only
    // because RLS refused to compute any other one (ADR 0007) — there is no scoping code
    // behind it to get wrong, which is the whole design.
    await expect(page.getByText(String(expected)).first()).toBeVisible();

    expect(namesPresent(html, ALPHA_NAMES)).toEqual([...ALPHA_NAMES]);
    expect(namesPresent(html, BRAVO_NAMES)).toEqual([]);
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  test("US-F1: rep B sees the mirror image, and the two reps' member sets are disjoint", async ({
    page,
    browser,
  }) => {
    const admin = scopeAdminClient();
    const state = loadScopeState();
    const regionB = state.regionIds[REGION_B_CODE];
    if (!regionB) throw new Error("Region B is not seeded.");

    const expected = await countMembershipsInRegion(admin, regionB, state.currentTermId);
    expect(expected).toBeGreaterThanOrEqual(BRAVO_NAMES.length);

    await scopeSignIn(page, "scope_rep_b");
    await page.goto(REGION_PATH);
    await page.waitForLoadState("networkidle");
    const bravoHtml = await page.content();

    await expect(page.getByText(String(expected)).first()).toBeVisible();
    expect(namesPresent(bravoHtml, BRAVO_NAMES)).toEqual([...BRAVO_NAMES]);
    expect(namesPresent(bravoHtml, ALPHA_NAMES)).toEqual([]);

    // The disjointness claim needs both sides in one assertion — two independent
    // single-rep tests can each pass while the union quietly overlaps.
    const alphaContext = await browser.newContext();
    try {
      const alphaPage = await alphaContext.newPage();
      await scopeSignIn(alphaPage, "scope_rep_a");
      await alphaPage.goto(REGION_PATH);
      await alphaPage.waitForLoadState("networkidle");
      const alphaHtml = await alphaPage.content();

      const seenByA = new Set(namesPresent(alphaHtml, [...ALPHA_NAMES, ...BRAVO_NAMES]));
      const seenByB = new Set(namesPresent(bravoHtml, [...ALPHA_NAMES, ...BRAVO_NAMES]));

      expect(seenByA.size).toBeGreaterThan(0);
      expect(seenByB.size).toBeGreaterThan(0);
      expect([...seenByA].filter((name) => seenByB.has(name))).toEqual([]);
    } finally {
      await alphaContext.close();
    }
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  test("URL tampering returns rep A's own data or not-found — never region B, never a 403", async ({
    page,
  }) => {
    const state = loadScopeState();
    const regionB = state.regionIds[REGION_B_CODE];
    if (!regionB) throw new Error("Region B is not seeded.");
    const bravoTarget = BRAVO_NAMES[0];
    if (!bravoTarget) throw new Error("No region-B fixtures seeded.");

    await scopeSignIn(page, "scope_rep_a");

    await page.goto(REGION_PATH);
    await page.waitForLoadState("networkidle");
    const baseline = await page.content();
    const baselineNames = namesPresent(baseline, [...ALPHA_NAMES, ...BRAVO_NAMES]);

    // (a) Another region's id in the query string, and (b) an ARCHIVED term — a real one,
    // seeded for this purpose, because a made-up uuid would be refused for the wrong
    // reason. Prior-term visibility follows the same tier rules as current-term
    // visibility (PRD US-H3), so neither may change a single row.
    for (const tampered of [
      `${REGION_PATH}?region_id=${regionB}`,
      `${REGION_PATH}?term_id=${state.archivedTermId}`,
      `${REGION_PATH}?region_id=${regionB}&term_id=${state.archivedTermId}`,
    ]) {
      const response = await page.goto(tampered);
      await page.waitForLoadState("networkidle");
      const html = await page.content();

      expect(response?.status(), `${tampered} answered 403`).not.toBe(403);
      expect(namesPresent(html, BRAVO_NAMES), `${tampered} leaked region B`).toEqual([]);
      expect(namesPresent(html, [...ALPHA_NAMES, ...BRAVO_NAMES])).toEqual(baselineNames);
    }

    // (c) A deep link straight at a region-B member's record. The refusal must be
    // NOT FOUND, never forbidden: CONVENTIONS §4.3 — "forbidden" confirms the row exists,
    // which is a disclosure about a named scholar with no data in it at all.
    const deepLink = await page.goto(`${MEMBERS_PATH}/${scopePersonId(bravoTarget)}`);
    await page.waitForLoadState("networkidle");
    expect(deepLink?.status()).not.toBe(403);
    const deepHtml = await page.content();
    expect(deepHtml.includes(bravoTarget)).toBe(false);
    for (const literal of FORBIDDEN_LITERALS) {
      expect(deepHtml.includes(literal), `deep link leaked ${literal}`).toBe(false);
    }
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  test("US-J1: no scoped read-only surface carries a planted sensitive value", async ({
    page,
    browser,
  }) => {
    const alpha = ALPHA_NAMES[0];
    if (!alpha) throw new Error("No scope fixtures seeded.");

    // The rep's own surface.
    await scopeSignIn(page, "scope_rep_a");
    await page.goto(REGION_PATH);
    await page.waitForLoadState("networkidle");
    const regionHtml = await page.content();
    expect(regionHtml.includes(alpha), "the region dashboard rendered nothing").toBe(true);
    for (const literal of REGION_FORBIDDEN_LITERALS) {
      expect(regionHtml.includes(literal), `/region leaked ${literal}`).toBe(false);
    }
    // ADR 0011 positive control: rep A has signed, so its own region's contact numbers
    // render — through the audited, acknowledgement-gated RPC, not through a GRANT.
    expect(
      regionHtml.includes(PLANTED_CONTACT_NUMBER),
      "rep A's own-region contact roster did not render (ADR 0011)",
    ).toBe(true);

    // ...and rep B, who has NOT signed, gets the refusal panel and no contact number at
    // all — the CBL Art. VIII §7.1 gate, observable from the page (PRD US-J5).
    const repBContext = await browser.newContext();
    const repBPage = await repBContext.newPage();
    await scopeSignIn(repBPage, "scope_rep_b");
    await repBPage.goto(REGION_PATH);
    await repBPage.waitForLoadState("networkidle");
    const repBHtml = await repBPage.content();
    expect(
      repBHtml.includes(PLANTED_CONTACT_NUMBER),
      "an unacknowledged rep saw a contact number",
    ).toBe(false);
    expect(repBHtml).toMatch(/confidentiality acknowledgement/i);
    await repBContext.close();

    // …and both officer surfaces, in their own context so neither session bleeds.
    const officerContext = await browser.newContext();
    try {
      const officerPage: Page = await officerContext.newPage();
      await scopeSignIn(officerPage, "scope_officer");

      for (const path of [DIRECTORY_PATH, COMMITTEES_PATH]) {
        await officerPage.goto(path);
        await officerPage.waitForLoadState("networkidle");
        const html = await officerPage.content();
        for (const literal of FORBIDDEN_LITERALS) {
          expect(html.includes(literal), `${path} leaked ${literal}`).toBe(false);
        }
      }

      // Non-vacuity: the directory must have rendered a real roster, or the four
      // assertions above proved only that an empty page is empty.
      await officerPage.goto(DIRECTORY_PATH);
      await officerPage.waitForLoadState("networkidle");
      expect((await officerPage.content()).includes(alpha)).toBe(true);
    } finally {
      await officerContext.close();
    }
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────
  test("US-F2: rep A cannot change the status of a member in their own region", async () => {
    const admin = scopeAdminClient();
    const target = ALPHA_NAMES[4];
    if (!target) throw new Error("No scope fixtures seeded.");
    const membershipId = scopeMembershipId(target);
    const before = await readMembershipStatus(admin, membershipId);

    // Their own region deliberately: a rep editing region B is uninteresting, because
    // those rows are invisible. The claim under test is that a row they CAN read is still
    // a row they cannot write — a missing UPDATE policy, not a hidden button.
    const rep = await scopeSignedInClient("scope_rep_a");
    const { data, error } = await rep
      .from("memberships")
      .update({ status: "graduated" })
      .eq("id", membershipId)
      .select("id");

    // RLS refuses by returning NOTHING, not by raising. Asserting on an exception here
    // would produce a test that passes whatever the policy says.
    if (!error) expect(data ?? []).toHaveLength(0);
    expect(await readMembershipStatus(admin, membershipId)).toBe(before);
    await rep.auth.signOut();
  });

  // ── 6 ── see the header ───────────────────────────────────────────────────
  test.fixme("steps 1-4 repeat identically with middleware disabled (covered by S2-T42 and S7-T29 check 1)", async () => {
    // Intentionally unimplemented. Playwright's `webServer` builds and starts the app
    // once for the whole run, so `middleware.ts` cannot be removed mid-suite, and any
    // in-process approximation would test the approximation rather than the boundary.
    //
    // The coverage exists elsewhere and is not optional:
    //   • S2-T42 — twelve captured HTML payloads with middleware renamed off, greped for
    //     the planted literals, recorded in docs/issues/2026-09-02-authz-slice-verification.md
    //   • S7-T29 check (1) — the deploy-level anonymous and officer crawl over every
    //     route and every PostgREST table endpoint, against a preview built WITHOUT
    //     middleware.ts. If that crawl leaks any PII, ARCHITECTURE §5's central claim is
    //     false and Day 6 is not done.
  });

  // ── 7 ── PRD Performance NFR, US-D4 ───────────────────────────────────────
  test("the region and admin dashboards answer within the 3-second budget", async ({
    page,
    browser,
  }) => {
    await scopeSignIn(page, "scope_rep_a");
    const regionStart = Date.now();
    await page.goto(REGION_PATH, { waitUntil: "domcontentloaded" });
    const regionMs = Date.now() - regionStart;
    expect(regionMs, `/region took ${regionMs}ms`).toBeLessThan(PAGE_BUDGET_MS);

    const adminContext = await browser.newContext();
    try {
      const adminPage = await adminContext.newPage();
      await signIn(adminPage, "crrd_admin");
      const dashboardStart = Date.now();
      await adminPage.goto(DASHBOARD_PATH, { waitUntil: "domcontentloaded" });
      const dashboardMs = Date.now() - dashboardStart;
      expect(dashboardMs, `/dashboard took ${dashboardMs}ms`).toBeLessThan(PAGE_BUDGET_MS);
    } finally {
      await adminContext.close();
    }
  });
});
