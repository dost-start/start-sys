// ─────────────────────────────────────────────────────────────────────────────
// THE ONLY FILE IN THIS REPOSITORY THAT MAY HOLD SUPABASE_SERVICE_ROLE_KEY.
//
// The service-role key bypasses Row Level Security entirely. RLS is the
// authorization boundary for START-SYS (ARCHITECTURE.md §5): every user-facing read
// and write goes through `@supabase/supabase-js` carrying the caller's JWT, so
// policies apply by construction. A client created here has no such constraint —
// one careless query returns 600 scholars' PII with no error and no log entry.
//
// PERMITTED CALLERS — nothing else:
//   1. The invite flow (`lib/auth/invite-actions.ts`) — `auth.admin.inviteUserByEmail`,
//      because public signup is disabled and only an admin API can mint an account.
//      NOTE: the accompanying `user_roles` INSERT is made with the CALLER's client,
//      not this one, so RLS and the audit trigger both apply (S2-T39).
//   2. Scheduled job endpoints under `app/api/jobs/**`, invoked by
//      `.github/workflows/scheduled.yml` behind JOB_SHARED_SECRET — the abandoned-draft
//      sweep, the RA 10173 purge, the campaign drain. These are jobs, not
//      request-handling code, and act as the system rather than as a person.
//   3. Test and e2e fixture seeding (`e2e/fixtures/**`, `lib/**/test-support.ts`) —
//      setup, never anything that ships to a user.
//
// An ESLint `no-restricted-imports` rule fails the build if anything outside
// `lib/server/**` imports this module. If you are about to edit that rule to make a
// query work: STOP. The query returned nothing because a policy says so. Read
// ARCHITECTURE.md § "If your query returns nothing, read this first."
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Lazily create the service-role Supabase client.
 *
 * Lazy on purpose: constructing it at module load would make every importer of this
 * file — including a build-time analysis pass — require the secret to be present.
 *
 * @throws if the required environment variables are absent, naming each one, so a
 *         misconfigured deployment fails loudly at first use rather than producing a
 *         client that silently authenticates as `anon`.
 */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0 || !url || !serviceRoleKey) {
    throw new Error(
      `createAdminClient(): missing required environment variable(s): ${missing.join(", ")}. ` +
        `Set them in the Vercel Production scope (and .env.local for development); the real ` +
        `values live in Bitwarden. See docs/runbooks/03-CREDENTIAL_ROTATION.md.`,
    );
  }

  cached = createClient(url, serviceRoleKey, {
    auth: {
      // A service-role client has no user session and must never persist or refresh one.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return cached;
}
