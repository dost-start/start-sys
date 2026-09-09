import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Repo root — the "@/*" -> "./*" path alias in tsconfig.json, mirrored for Vitest.
const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": repoRoot,
      // `server-only` throws on import by design (see test-stubs/server-only.ts). Vitest
      // is not a bundle, so without this stub no module carrying the guard is testable.
      "server-only": fileURLToPath(new URL("./test-stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Colocated tests (CONVENTIONS §8.1) — never a top-level tests/ directory.
    include: ["**/*.test.ts"],
    // e2e/ belongs to Playwright; its specs must not be collected here.
    //
    // `.claude/**` is excluded because agent tooling puts git worktrees under it, each with
    // its OWN node_modules — so a stale worktree made `pnpm test` collect a second, older
    // copy of this repo's suite plus zod's internal tests, and report ~13 failures that had
    // nothing to do with the working tree. `node_modules/**` alone does not cover it: that
    // glob is anchored at the root, and the nested copies are several directories down.
    exclude: [
      "e2e/**",
      "**/node_modules/**",
      ".next/**",
      "e2e-artifacts/**",
      ".claude/**",
      "**/.claude/**",
    ],
    globals: false,
  },
});
