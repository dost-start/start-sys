// ─────────────────────────────────────────────────────────────────────────────
// The Supabase client for the browser.
//
// Its only legitimate uses are auth interactions that must happen client-side —
// sign-in, TOTP challenge/verify, password update — and realtime, which this system
// does not use. It carries the anon key, which is safe to ship: RLS is the boundary,
// and an anon key with no session reaches nothing (ARCHITECTURE.md §5).
//
// PII IS NEVER FETCHED HERE. Member and applicant data is read in Server Components
// and passed down as already-filtered props (CLAUDE.md "Privacy"; CONVENTIONS §1.3).
// A client component that queries `people` is a bug even when RLS refuses it.
// ─────────────────────────────────────────────────────────────────────────────

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/database.types";

/**
 * Read the two public Supabase variables.
 *
 * Read INSIDE the function so a build without an environment still succeeds; a
 * missing variable then fails loudly at first use, naming what is absent.
 */
function readPublicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    const missing = [
      !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
      !anonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
    ].filter((name): name is string => name !== null);

    throw new Error(
      `Supabase browser client: missing required environment variable(s): ${missing.join(", ")}. ` +
        `Only NEXT_PUBLIC_* variables are available in the browser — a missing one here means ` +
        `the value was not set at build time.`,
    );
  }

  return { url, anonKey };
}

/**
 * Create the browser Supabase client. `@supabase/ssr` reads and writes the same
 * cookies the server client reads, so there is exactly one notion of "who is calling"
 * across middleware, Server Components, Server Actions and the browser.
 */
export function createBrowserSupabase(): SupabaseClient<Database> {
  const { url, anonKey } = readPublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}
