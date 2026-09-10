# 2026-09-10 — Production `SELECT 1` latency is cold start, not a problem

**Status:** Closed, no code change. Recorded so it is not re-investigated.
**Raised by:** QA 2026-09-10, ISSUE-012.

## The observation

`/api/health` on production reported `db_latency_ms: 1302` during the QA sweep, against
`164` locally. A bare `SELECT 1` eating 1.3 s of the PRD's 3-second Performance NFR budget
looked like a real problem, and it was flagged as one.

## What it actually is

Measured after the 2026-09-10 deploy, eight consecutive samples two seconds apart:

```
508  43  28  30  44  30  26  25      min=25  median=30  max=508
```

The first request pays for a cold Vercel function plus a cold Supabase pooler connection.
Every request after it is **25–44 ms**, which is what you would expect from `sin1` to
`ap-southeast-1` and leaves essentially the whole NFR budget intact.

The 1302 ms reading was itself a first-hit-after-idle sample. This system is idle for
months between application periods (it is the reason `ARCHITECTURE.md` §1 insists on
Supabase Pro — the Free tier's 7-day auto-pause would turn every cold start into a much
worse number), so cold starts are the normal case for the first visitor of the day and are
not worth engineering away at this volume.

## Consequences

Nothing to fix. Two things worth carrying forward:

- **Do not benchmark against a cold first sample.** `scripts/benchmark.ts` and the weekly
  `scheduled.yml` benchmark should warm the endpoint before timing it, or they will report
  a p95 dominated by cold starts and eventually fail the 3000 ms budget for no reason.
- **The uptime monitor's latency graph will show periodic spikes** at the same magnitude.
  They are cold starts, not degradation.

## Related

`docs/issues/2026-09-06-launch-debt.md` item 3 — the project is still on the Supabase Free
tier, so the auto-pause that makes cold starts genuinely bad has not been removed yet.
