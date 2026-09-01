// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health — the liveness probe Better Stack polls (ARCHITECTURE.md §8).
//
// ⚠ THIS IS THE MINIMAL S1/S4-ERA VERSION. S7-T4 finalizes it: latency, the commit SHA,
// and the two-region monitor wiring. Keep it small until then.
//
// IT MUST NOT BE A BARE 200. A 200 from Vercel's edge proves only that Vercel is up; the
// availability NFR is about whether an authorized user can reach their records, which
// means Postgres answered. So this calls `current_term_id()` — a real RPC, granted to
// `anon` in 0018, reading a real table, touching no PII.
//
// NO RAW ERROR TEXT LEAVES THIS ROUTE. A Postgres message can name a schema, a function
// and a role; a Supabase connection error can name the project ref. Failure is a fixed
// body and a 500. The raw error goes to Sentry (S7-T8), never to a monitor's response.
//
// It is excluded from `middleware.ts`'s matcher: an unauthenticated prober must reach it.
// That is safe precisely because it returns no data — only a status word.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

/** A health check that could be cached is not a health check. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("current_term_id");

    // No active term is a legitimate org state (the morning of a rollover), not an
    // outage: the RPC answered. Only a transport or SQL failure is unhealthy.
    if (error !== null) {
      return NextResponse.json({ status: "error" }, { status: 500, headers: NO_STORE });
    }

    return NextResponse.json({ status: "ok" }, { status: 200, headers: NO_STORE });
  } catch {
    // Missing environment, unreachable host, cookie-store failure — all the same
    // answer to a monitor, and none of them describable to a stranger.
    return NextResponse.json({ status: "error" }, { status: 500, headers: NO_STORE });
  }
}
