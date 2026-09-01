// ─────────────────────────────────────────────────────────────────────────────
// THE SERVER-ONLY ENVIRONMENT ACCESSOR (BUILD_PLAN S7-T2).
//
// This file is one import and one function. Everything it validates lives in
// `lib/env.ts`; what it adds is the `server-only` guard.
//
// WHY THE GUARD IS THE WHOLE POINT: `import "server-only"` makes it a BUILD ERROR —
// not a runtime error, not a lint warning, not a code-review catch — for any module in
// a client bundle to reach the secret half of the environment. Without it, a single
// `'use client'` added to a file that transitively imports this one would inline
// `SUPABASE_SERVICE_ROLE_KEY` into JavaScript served to every visitor, and the build
// would succeed. `scripts/audit-client-bundle.mjs` (S7-T10) is the second net under
// this one; a build error is better than a CI grep because it fires immediately, in
// the editor.
//
// The same guard is why this file cannot be unit-tested: `server-only` throws under
// Vitest by design. The behaviour that matters — the schema, the naming rule, and the
// error naming every missing key — is proved in `lib/env.test.ts` against
// `parseServerEnv`, which is pure and lives in `lib/env.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { type EnvSource, parseServerEnv, type ServerEnv } from "@/lib/env";

let serverCache: ServerEnv | null = null;

/**
 * The validated server environment, parsed on FIRST RUNTIME ACCESS and cached.
 *
 * Lazy so that `pnpm build` and `pnpm typecheck` succeed in CI with no secrets present
 * — a build must never require a production credential — while the first request that
 * actually needs one fails loudly, naming every variable that is absent.
 *
 * @param source overridable for tests; a non-default source is never cached.
 * @throws naming every missing or invalid server variable.
 */
export function getServerEnv(source: EnvSource = process.env): ServerEnv {
  const isProcessEnv = source === (process.env as EnvSource);

  if (isProcessEnv && serverCache !== null) return serverCache;

  const parsed = parseServerEnv(source);
  if (isProcessEnv) serverCache = parsed;
  return parsed;
}

/** Drop the memoised server environment. Tests only; production never changes env. */
export function resetServerEnvCache(): void {
  serverCache = null;
}
