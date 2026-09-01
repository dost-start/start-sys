// ─────────────────────────────────────────────────────────────────────────────
// The Supabase client for Server Components, Server Actions and Route Handlers.
//
// It carries the CALLER'S JWT from the request cookies, so every query it makes is
// evaluated under Row Level Security as that user. That is the whole security model
// (ARCHITECTURE.md §5): there is no second connection path, therefore no way to write
// a query that skips the boundary. If a query returns nothing, read
// ARCHITECTURE.md § "If your query returns nothing, read this first" — do not reach
// for `lib/server/admin-client.ts`.
//
// A NEW client is created per request. Never cache one across requests: it would
// serve one user's session to another.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/database.types";

/**
 * Read the two public Supabase variables.
 *
 * Read INSIDE the function, never at module load: a build that has no environment
 * (CI typecheck, a static analysis pass) must still succeed. A missing variable then
 * fails loudly at first use, naming what is absent, rather than producing a client
 * that silently authenticates as nobody.
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
      `Supabase client: missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env.local for development; production values live in the ` +
        `Vercel Production scope and in Bitwarden.`,
    );
  }

  return { url, anonKey };
}

/**
 * Create the request-scoped Supabase client.
 *
 * `getAll`/`setAll` are used deliberately — the deprecated `get`/`set`/`remove` trio
 * misses edge cases and produces the random-logout class of bug.
 */
export async function createServerSupabase(): Promise<SupabaseClient<Database>> {
  const { url, anonKey } = readPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. This is expected and harmless:
          // `middleware.ts` calls `updateSession()` on every matched request and
          // writes the refreshed session there. Swallowing here is the documented
          // @supabase/ssr pattern, not a dropped error.
        }
      },
    },
  });
}
