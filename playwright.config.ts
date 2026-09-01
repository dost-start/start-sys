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
  fullyParallel: true,
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
