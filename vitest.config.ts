import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Repo root — the "@/*" -> "./*" path alias in tsconfig.json, mirrored for Vitest.
const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": repoRoot,
    },
  },
  test: {
    environment: "node",
    // Colocated tests (CONVENTIONS §8.1) — never a top-level tests/ directory.
    include: ["**/*.test.ts"],
    // e2e/ belongs to Playwright; its specs must not be collected here.
    exclude: ["e2e/**", "node_modules/**", ".next/**", "e2e-artifacts/**"],
    globals: false,
  },
});
