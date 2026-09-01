// BUILD_PLAN S1-T9: proves the Playwright wiring works before any real
// flow exists. Intentionally trivial — the six locked flows land later.
import { test, expect } from "@playwright/test";

test("home page renders the START-SYS heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "START-SYS" })).toBeVisible();
});
