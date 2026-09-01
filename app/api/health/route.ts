// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health — the liveness probe Better Stack polls (BUILD_PLAN S7-T4;
// ARCHITECTURE.md §8, the Availability NFR).
//
// IT MUST NOT BE A BARE 200. A 200 from Vercel's edge proves only that Vercel is up.
// The availability figure this endpoint produces is a claim about whether an authorized
// user could reach their records, which means Postgres has to have answered — so this
// calls `health_ping()`: a real round trip, granted to `anon`, reading no table and
// therefore exposing nothing (migration 0034).
//
// WHAT IT RETURNS, AND WHY EACH FIELD EARNS ITS PLACE:
//   status          the word the two Better Stack monitors match on. They assert the
//                   BODY as well as the code, because a 200 carrying an error body must
//                   count as down — otherwise the uptime number is measuring the CDN.
//   db_latency_ms   the round trip to ap-southeast-1. This is the number that says
//                   "slow" before it says "down", and the one that tells a 2029 officer
//                   whether a page felt slow because of the database or because of the
//                   render (PRD Performance NFR; the 3s budget).
//   commit          which build is actually serving. Vercel sets
//                   VERCEL_GIT_COMMIT_SHA; locally there is no commit, so it reads
//                   `dev`. Without it, "is the fix deployed?" is answered by guessing.
//
// NO RAW ERROR TEXT LEAVES THIS ROUTE. A Postgres message names schemas, functions and
// roles; a Supabase transport error names the project ref. This endpoint is
// unauthenticated by necessity — a monitor cannot log in — so failure is a fixed body
// and a 500, in the `ActionError` shape every other handler uses
// (CONVENTIONS.md §4.4). The raw error goes to the error tracker, never to the response.
//
// It is excluded from `middleware.ts`'s matcher, which is safe precisely because it
// returns no data — a status word, a duration, and a commit SHA.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

import { type ActionError, type ErrorCode, err, isErr } from "@/lib/action-result";
import { createServerSupabase } from "@/lib/supabase/server";

/** A health check that could be cached is not a health check. */
export const dynamic = "force-dynamic";
/** `nodejs`, not edge: the probe must exercise the same runtime the app's reads use. */
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" } as const;

type HealthBody = {
  status: "ok";
  db_latency_ms: number;
  commit: string;
};

/**
 * The `health_ping()` call, behind one narrow structural type.
 *
 * ⚠️ TEMPORARY INDIRECTION. `health_ping()` ships in migration `0034_health_ping.sql`
 * (S7-T3, a sibling lane); until `pnpm db:types` has been re-run against it, the
 * generated `Database["public"]["Functions"]` union does not carry the name and the
 * call will not typecheck. A cast on database data normally means the generated types
 * are stale (CONVENTIONS.md §5) — here it means exactly that, and says so, rather than
 * being silently absorbed into an `any`. **Delete this helper and call
 * `supabase.rpc("health_ping")` directly once the types are regenerated.**
 */
type HealthPingClient = {
  rpc(fn: "health_ping"): PromiseLike<{ error: { message?: unknown } | null }>;
};

/**
 * The bare `ActionError` for a code, so the failure body carries the SAME fixed,
 * user-safe message every Server Action returns (CONVENTIONS.md §4.4). Route Handlers
 * return the error itself rather than the `ActionResult` wrapper, and narrowing with
 * `isErr` keeps "err() returns the failure branch" a checked fact rather than a cast.
 */
function actionError(code: ErrorCode): ActionError {
  const result = err(code);
  return isErr(result) ? result.error : { code, message: "Something went wrong." };
}

/** One fixed body for every failure mode. A monitor learns nothing it should not. */
function unhealthy(): NextResponse {
  return NextResponse.json(actionError("upstream"), { status: 500, headers: NO_STORE });
}

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();

  try {
    const supabase = await createServerSupabase();
    const probe = supabase as unknown as HealthPingClient;

    const { error } = await probe.rpc("health_ping");

    const dbLatencyMs = Date.now() - startedAt;

    if (error !== null) {
      // The RPC is missing, the role lost EXECUTE, or the database refused. All of them
      // mean an authorized user cannot reach their records, which is the definition of
      // down for this system. Deliberately NOT fronted by a fallback probe: a health
      // check that quietly tries something else masks the missing migration it exists
      // to reveal.
      return unhealthy();
    }

    const body: HealthBody = {
      status: "ok",
      db_latency_ms: dbLatencyMs,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    };

    return NextResponse.json(body, { status: 200, headers: NO_STORE });
  } catch {
    // Missing environment, unreachable host, a cookie-store failure — one answer to a
    // stranger, and none of them describable to one.
    return unhealthy();
  }
}
