import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

// The Compatibility NFR names Safari, and WebKit is the only project that catches it.
// On pull requests CI may set CI_E2E_CHROMIUM_ONLY to keep the merge gate under budget;
// the full matrix still runs on push to main.
const chromiumOnly = Boolean(process.env.CI_E2E_CHROMIUM_ONLY);

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const allProjects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
];

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-artifacts",
  // BUILD_PLAN S2-T41: seeds the eight auth fixtures (accounts, roles, org rows and
  // real TOTP factors) once, before any project runs. Self-skips when
  // SUPABASE_SERVICE_ROLE_KEY is absent, so a DB-less clone still runs the smoke spec.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  // ONE worker in CI, deliberately, and it is not a performance oversight.
  //
  // These specs share mutable state that the database only lets exist once: a single
  // open `application_windows` row per term, and one seeded member world. So
  // `approve-and-id`'s seeder closing the window mid-test makes `apply-with-upload`'s
  // submission return `window_closed` and create no row; `member-officer-read-only`
  // graduating a region-A member between `rr-scope-leak` reading the expected headcount
  // and the page rendering makes the RR dashboard show 14 where 15 was expected. Both
  // were observed as retry-flakes on 2026-09-03, both in specs that guard a security
  // boundary — and a flaky green on the RR scope gate is worse than a red one, because
  // it is the kind of failure people learn to re-run instead of read.
  //
  // Per-resource locks would be the surgical fix; serialising is the boring one, and it
  // removes the whole class rather than the two instances we happened to see. The suite
  // is 46 tests and ran in 2.4 minutes on two workers — this is not the expensive part
  // of CI. Local runs keep full parallelism, where a flake costs a re-run, not trust.
  workers: isCI ? 1 : undefined,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: chromiumOnly ? allProjects.slice(0, 1) : allProjects,
  webServer: {
    // Test the production build, not the dev server — the dev server does not exercise
    // the same bundling, and the client-bundle audit (S7-T10) reasons about build output.
    command: "pnpm build && pnpm start",
    port: 3000,
    reuseExistingServer: !isCI,
    timeout: 180000,
  },
});
