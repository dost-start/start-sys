// ─────────────────────────────────────────────────────────────────────────────
// PR E — the public forms' reference reads, memoised in the server process.
//
// `/apply` and `/renew` are `force-dynamic` + `force-no-store`, and correctly so: whether
// the window is open is a database fact that can flip between two requests, and a cached
// "open" page served after closing time would contradict `applications_insert_anon`.
//
// But that decision was applied to the WHOLE page, including three reads that cannot flip
// between two requests: the 18 regions, the 445 universities and the 13 programs. Those
// are reference data — rows that change only in a migration, which is a deploy, which
// starts a new process. So every anonymous hit on `/apply` was paying three sequential
// round trips (~25ms each, measured 2026-09-09 after the move to ap-southeast-1) to read
// answers that were already known.
//
// ⚠ WHAT IS DELIBERATELY *NOT* CACHED: `getPublicWindowState()`. That is the one read on
// this page whose answer is allowed to change between two requests, and caching it is
// exactly the bug the `force-dynamic` on the page exists to prevent. Do not add it here.
//
// WHY A MODULE-SCOPED MAP AND NOT `unstable_cache` / `"use cache"`: the page opts out of
// the Next data cache wholesale (`fetchCache = "force-no-store"`), so a Next-cache API
// here would be fighting a page-level directive — one framework upgrade away from either
// silently doing nothing or silently caching the window state too. A plain memo with a
// TTL is boring, is obvious to the next maintainer, and cannot leak past the process.
//
// STALENESS, STATED: after a migration adds a university, an already-warm instance can
// serve the old list for up to TTL. A migration ships with a deploy and a deploy replaces
// the instances, so in practice this window does not occur; if it did, the cost is that
// one applicant does not see a school for five minutes. That is the right trade against
// three round trips on every anonymous request.
//
// PER-PROCESS, NOT SHARED. Each serverless instance keeps its own copy. There is no
// invalidation channel and there deliberately isn't one — a cache that needs invalidating
// is a cache that needs a runbook.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

/** Five minutes. Long enough to cover a burst of applicants, short enough to self-heal. */
export const REFERENCE_TTL_MS = 5 * 60 * 1000;

type Entry = { value: unknown; expiresAt: number };

const entries = new Map<string, Entry>();

/**
 * Return `key`'s cached value, or produce it with `load` and cache it.
 *
 * An in-flight load is NOT shared: two simultaneous cold requests will both read. That is
 * accepted rather than solved with a promise cache — deduping adds a failure mode (one
 * request's error becoming another's) to save one query on a cold start.
 *
 * A `load` that throws or returns an empty array is NOT cached. An empty list here means a
 * transient read failure far more often than it means "the org has no universities", and
 * caching it would turn a blip into five minutes of a form nobody can complete.
 */
export async function cachedReference<T>(
  key: string,
  load: () => Promise<T[]>,
  ttlMs: number = REFERENCE_TTL_MS,
): Promise<T[]> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit !== undefined && hit.expiresAt > now) return hit.value as T[];

  const value = await load();
  if (value.length > 0) entries.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/** Drop every entry. Tests only; production has no invalidation path by design. */
export function resetReferenceCache(): void {
  entries.clear();
}
