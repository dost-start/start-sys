// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/login.spec.ts — the FIRST of the six locked Playwright flows (BUILD_PLAN S2-T41,
// ARCHITECTURE.md §1 "Testing & quality").
//
// Every case here drives the real screens. Nothing injects a JWT, seeds a cookie or
// calls supabase-js directly: an API-level pass proves the API refuses, and this file
// exists to prove the PAGES refuse.
//
// Requirements under test:
//   PRD MVP item 1  — no page but /apply reachable without login; invite-only.
//   PRD MVP item 2  — TOTP mandatory above Member; 2FA to complete a password reset.
//   US-A1, US-A2, US-A3, US-A4.
//
// The whole file skips when SUPABASE_SERVICE_ROLE_KEY is absent, because the fixtures
// it needs are not seeded then (see e2e/global-setup.ts).
// ═══════════════════════════════════════════════════════════════════════════════════

import { expect, test } from "@playwright/test";

import {
  FIXTURES,
  FIXTURE_MEMBER_SURNAMES,
  PLANTED_SENSITIVE_VALUES,
  authScreens,
  completeTotpChallenge,
  signIn,
  submitLogin,
} from "./fixtures/auth";

test.describe("Epic A — access and identity", () => {
  test.skip(
    !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "auth fixtures are not seeded without SUPABASE_SERVICE_ROLE_KEY",
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 1. US-A1
  // ───────────────────────────────────────────────────────────────────────────
  test("an anonymous request to an admin page is sent to login and returned to it afterwards", async ({
    page,
  }) => {
    await page.goto("/members");

    // The redirect carries the originally requested path, so login can return there.
    await expect(page).toHaveURL(/\/login\?next=%2Fmembers/);

    await submitLogin(page, FIXTURES.crrd_admin.email);
    await page.waitForURL(/\/auth\/mfa\/verify/);
    await completeTotpChallenge(page, "crrd_admin");

    // US-A1: "after login the user lands on the page they originally requested" —
    // NOT on the role's home. The second factor in between must not lose the target.
    await expect(page).toHaveURL(/\/members(\?.*)?$/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Account enumeration
  // ───────────────────────────────────────────────────────────────────────────
  test("a wrong password reports the identical message for a known and an unknown email", async ({
    page,
  }) => {
    const readFailure = async (email: string) => {
      await page.goto("/login");
      await submitLogin(page, email, "definitely-not-the-password");
      await expect(authScreens.errorMessage(page)).toBeVisible();
      return (await authScreens.errorMessage(page).innerText()).trim();
    };

    const known = await readFailure(FIXTURES.exec_admin.email);
    const unknown = await readFailure("no-such-account@fixture.start-sys.test");

    // Byte-identical. A message that differs — even in punctuation — turns the login
    // form into an oracle for "does this scholar have an account here?".
    expect(unknown).toBe(known);

    // And it must not echo either address back, which would leak the probe itself
    // into anything that logs or screenshots the page.
    expect(known).not.toContain(FIXTURES.exec_admin.email);
    expect(known).not.toContain("no-such-account@fixture.start-sys.test");

    // Neither failure may leave a session behind.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. PRD MVP item 1 — invitation only
  // ───────────────────────────────────────────────────────────────────────────
  test("the login surface offers no way to create an account", async ({ page }) => {
    await page.goto("/login");

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/sign ?up|register|create (an )?account/i);

    // A hidden route is not the control either — the check that matters is that no
    // affordance exists, and public signup is disabled at GoTrue (S2-T32).
    const hrefs = await page
      .locator("a")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
    expect(hrefs.some((href) => /sign-?up|register/i.test(href))).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. US-A3
  // ───────────────────────────────────────────────────────────────────────────
  test("an officer with no enrolled factor reaches the enrolment screen and no organizational data", async ({
    page,
  }) => {
    await page.goto("/login");
    await submitLogin(page, FIXTURES.officer.email);

    // Not the directory. An officer-or-above account without a second factor sees an
    // enrolment screen and an empty system.
    await page.waitForURL(/\/auth\/mfa\/enroll/);

    // And it holds under direct navigation, not just after login.
    await page.goto("/directory");
    await expect(page).toHaveURL(/\/auth\/mfa\/enroll/);

    const body = await page.locator("body").innerText();
    for (const planted of PLANTED_SENSITIVE_VALUES) {
      expect(body, `enrolment screen leaked ${planted}`).not.toContain(planted);
    }
    for (const surname of FIXTURE_MEMBER_SURNAMES) {
      expect(body, `enrolment screen leaked member ${surname}`).not.toContain(surname);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. US-A4's documented exception (ADR 0004)
  // ───────────────────────────────────────────────────────────────────────────
  test("a revoked account signs in with no MFA prompt and reaches only the refusal page", async ({
    page,
  }) => {
    await page.goto("/login");
    await submitLogin(page, FIXTURES.member.email);

    // `member` is the revoked tier (migration 0036): members hold no accounts under the
    // SRS, so the only account that can carry this label is one whose role was taken
    // away. It holds no organizational data, so no second factor is demanded (ADR 0004).
    await expect(page).toHaveURL(/\/unauthorized(\?.*)?$/);
    await expect(page).not.toHaveURL(/\/auth\/mfa/);

    // And it reaches nothing: every surface bounces it back to the refusal page.
    await page.goto("/members");
    await expect(page).toHaveURL(/\/unauthorized(\?.*)?$/);
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/unauthorized(\?.*)?$/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. PRD MVP item 2 — the aal1 → aal2 challenge
  // ───────────────────────────────────────────────────────────────────────────
  test("an enrolled admin is challenged for a code at aal1 and then reaches the requested page", async ({
    page,
  }) => {
    await page.goto("/audit");
    await expect(page).toHaveURL(/\/login\?next=%2Faudit/);

    await submitLogin(page, FIXTURES.crrd_admin.email);

    // Password alone yields an aal1 session, which is not enough for the admin
    // surface — the challenge carries the target forward.
    await expect(page).toHaveURL(/\/auth\/mfa\/verify\?next=%2Faudit/);

    // The aal1 session must not be usable for admin pages while the challenge stands.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/mfa\/verify/);

    // That probe REWROTE the challenge's `next` to /dashboard (the middleware carries
    // the page you were headed to). Re-arm the original target before typing the code,
    // or the success assertion below is comparing against the probe's destination.
    await page.goto("/audit");
    await expect(page).toHaveURL(/\/auth\/mfa\/verify\?next=%2Faudit/);

    await completeTotpChallenge(page, "crrd_admin");
    await expect(page).toHaveURL(/\/audit(\?.*)?$/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. US-A4 — "the reset link alone does not permit a password change"
  // ───────────────────────────────────────────────────────────────────────────
  test("a privileged account at aal1 is challenged for a second factor before the password form", async ({
    page,
  }) => {
    // The mailbox is factor one. This case reproduces the state that a recovery link
    // produces — an authenticated session that has NOT satisfied a second factor —
    // and asserts /auth/reset refuses to show the password form in it. The
    // email-link variant is the fixme below.
    await page.goto("/login");
    await submitLogin(page, FIXTURES.crrd_admin.email);
    await page.waitForURL(/\/auth\/mfa\/verify/);

    await page.goto("/auth/reset");

    await expect(authScreens.totpField(page)).toBeVisible();
    await expect(authScreens.newPasswordField(page)).toHaveCount(0);

    // Satisfying the factor is what unlocks the form — checked server-side by
    // re-reading AAL, never from a query parameter.
    await completeTotpChallenge(page, "crrd_admin");
    await expect(authScreens.newPasswordField(page)).toBeVisible();
  });

  test.fixme("the emailed recovery link alone cannot change a privileged password", async () => {
    // Needs mailbox capture (Inbucket locally, a Resend sandbox in CI) to click the
    // real recovery link and assert the AAL1 session it creates still cannot call
    // updateUser({ password }). The server-side half of that assertion already has
    // unit coverage in lib/auth/reset-actions.test.ts (S2-T38: with a mocked aal1
    // session and role crrd_admin, updateUser is never called — spy count 0). This
    // spec should replace the proxy in case 7 above once mail capture exists.
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// A landing check per role, so `homeForRole` is exercised through the real login flow
// and not only in its unit test.
// ═══════════════════════════════════════════════════════════════════════════════════
test.describe("post-login landing", () => {
  test.skip(
    !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "auth fixtures are not seeded without SUPABASE_SERVICE_ROLE_KEY",
  );

  for (const name of [
    "exec_admin",
    "tech_admin",
    "crrd_admin",
    "crrd_deputy",
    "regional_rep_a",
    "member",
  ] as const) {
    test(`${name} lands on ${FIXTURES[name].home}`, async ({ page }) => {
      await signIn(page, name);
      await expect(page).toHaveURL(new RegExp(`${FIXTURES[name].home}(\\?.*)?$`));
    });
  }
});
