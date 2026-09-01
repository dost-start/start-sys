// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/global-setup.ts — BUILD_PLAN S2-T41.
//
// Seeds the auth fixtures once, before any Playwright project starts.
//
// SKIPS ENTIRELY when SUPABASE_SERVICE_ROLE_KEY is absent, so a contributor who has
// only cloned the repo still gets a green `pnpm test:e2e` (the auth specs skip
// themselves in the same condition) instead of a wall of connection errors that
// teaches them to ignore e2e output. CI always has the key, so the gate is real
// where it matters.
// ═══════════════════════════════════════════════════════════════════════════════════

import { seedAuthFixtures, FIXTURE_STATE_PATH } from "./fixtures/auth";

export default async function globalSetup(): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(
      "[e2e] SUPABASE_SERVICE_ROLE_KEY not set — skipping auth fixture seeding. " +
        "Specs that need it will skip themselves.",
    );
    return;
  }

  const state = await seedAuthFixtures();
  console.log(
    `[e2e] Seeded ${Object.keys(state.userIds).length} auth fixtures against ` +
      `${state.supabaseUrl} (state: ${FIXTURE_STATE_PATH}).`,
  );
}
