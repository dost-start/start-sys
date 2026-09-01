// ESLint 9 flat config — START-SYS.
//
// The load-bearing rule here is `no-restricted-imports` confining the service-role
// Supabase client to `lib/server/**`. The service-role key BYPASSES Row Level Security,
// which is the authorization boundary for the whole system (ARCHITECTURE.md §5).
// Taking the "just use the service key" shortcut must therefore require editing this
// file, so that it shows up in a diff and a reviewer sees it.
//
// CLAUDE.md: "An ESLint no-restricted-imports rule enforces this — if you find yourself
// editing that rule, stop and ask."

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/** Paths that must never be imported outside `lib/server/**`. */
const ADMIN_CLIENT_MESSAGE =
  "the service-role key bypasses RLS — fix the policy, not the client (ARCHITECTURE §5)";

/** Direct-Postgres / ORM packages. Banned everywhere: they bypass RLS by construction. */
const ORM_MESSAGE =
  "no ORM and no direct postgres connection — all data access goes through @supabase/supabase-js with the caller's JWT (ARCHITECTURE §1, CONVENTIONS §11)";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "e2e-artifacts/**",
      "database.types.ts",
      "supabase/**",
      "docs/**",
      "next-env.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Repo-wide rules ────────────────────────────────────────────────────────
  {
    files: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs,jsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/server/admin-client", message: ADMIN_CLIENT_MESSAGE },
            { name: "pg", message: ORM_MESSAGE },
            { name: "postgres", message: ORM_MESSAGE },
            { name: "@prisma/client", message: ORM_MESSAGE },
            { name: "drizzle-orm", message: ORM_MESSAGE },
          ],
          patterns: [
            {
              // Catches relative escapes too: "../server/admin-client",
              // "../../lib/server/admin-client", "@/lib/server/admin-client.ts".
              group: ["**/server/admin-client", "**/server/admin-client.*"],
              message: ADMIN_CLIENT_MESSAGE,
            },
            {
              group: ["pg/*", "postgres/*", "@prisma/*", "drizzle-orm/*"],
              message: ORM_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // ── The one file permitted to hold the service-role key ────────────────────
  {
    files: ["lib/server/**/*.{ts,tsx}"],
    rules: {
      // Still bans the ORMs; only the admin-client restriction is lifted.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "pg", message: ORM_MESSAGE },
            { name: "postgres", message: ORM_MESSAGE },
            { name: "@prisma/client", message: ORM_MESSAGE },
            { name: "drizzle-orm", message: ORM_MESSAGE },
          ],
          patterns: [
            {
              group: ["pg/*", "postgres/*", "@prisma/*", "drizzle-orm/*"],
              message: ORM_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // ── No console in application code ─────────────────────────────────────────
  // The intake path builds the highest-PII request bodies in the system, and PII must
  // never be logged (CLAUDE.md "Privacy"; PRD §IV Data Privacy NFR). Log IDs, never values.
  {
    files: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
    },
  },

  // ── Test files ─────────────────────────────────────────────────────────────
  {
    files: ["**/*.test.{ts,tsx}", "e2e/**/*.{ts,tsx}", "scripts/**/*.{ts,mts,mjs}"],
    rules: {
      "no-console": "off",
    },
  },

  // eslint-config-prettier must come last: it disables stylistic rules that conflict
  // with Prettier, which owns formatting.
  prettier,
);
