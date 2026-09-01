# 2026-09-02 — Security review (BUILD_PLAN S7-T29, adapted to the build environment)

Nine checks. Where the plan's check assumes a deployed instance with a live database, the
structural equivalent that CI proves on every run is named instead — honestly, not as a
substitute claimed to be the same thing.

| # | Check | Result |
|---|---|---|
| 1 | **Middleware removal leaks no PII.** | **Structural proof, deploy-level crawl pending.** The pgTAP suite (52 files, exact row counts + exact column sets across nine role fixtures) runs entirely below the middleware — middleware does not exist in the `db` job at all — and is CI-blocking. Every officer/RR/member/anon read boundary is therefore proven with middleware absent by construction. The plan's browser-level crawl of a middleware-stripped deployment additionally needs a provisioned Supabase project (launch debt) and is listed in `docs/issues/2026-09-06-launch-debt.md`. |
| 2 | **Service-role key confined.** | `git grep -l SERVICE_ROLE` outside `.env.example`/`.github`/`lib/env*` hits only `lib/server/admin-client.ts` and its sanctioned consumers (invite flow, job endpoints, document-store backend, e2e/test seeding — each carrying the mandated eslint-disable with a reason). The `no-restricted-imports` ban was **observed red** during S1 (import from `app/` fails `pnpm check` citing the rule). |
| 3 | **Every SECURITY DEFINER declares search_path.** | pgTAP 026(d) and 099(3) both assert it over `pg_proc` — CI-blocking, red-verified during S7 authoring. |
| 4 | **Zero DELETE policies.** | pgTAP 001, 026(a) and 099(2) — three independent assertions over `pg_policies`. |
| 5 | **audit_log not writable.** | GRANT-level `REVOKE UPDATE, DELETE … FROM authenticated, anon, service_role` asserted by 002 and 099(4); zero UPDATE/INSERT/DELETE policies asserted by 068. |
| 6 | **Officer PostgREST access returns only granted columns.** | pgTAP 029 asserts `has_column_privilege` per column over the full `people` list and that `select *` raises — the UI is not in the path. Red-verified by granting `select (birthdate)` during S5 authoring. |
| 7 | **Proof proxy 404-not-403 + audit-before-stream.** | Route order is authorize-by-RLS-SELECT → fail-closed audit write → stream (`app/api/applications/[id]/proof/route.ts`); pgTAP 049 asserts the audit half; the e2e proof-view spec asserts the 200+audit pair through a real session. A denied caller gets 404, never 403 (asserted in the officer read-only spec). |
| 8 | **Rate limits + no enumeration.** | `check_rate_limit` fixed-window table (pgTAP 044); duplicate-email submission returns a byte-identical success (e2e case c + finalize's unique_violation swallow, pgTAP 043); login rate limiting is vendor-side config (`supabase/config.toml`), untestable until a project is provisioned — launch debt. |
| 9 | **Anon cannot enumerate applications.** | pgTAP 041/042: anon SELECT returns exactly 0 with rows present (behind an anti-vacuity control), and the new 041 test 1b proves `INSERT … RETURNING` raises — the enumeration-by-RETURNING channel is closed and pinned. |

**Finding of the review:** check 9's RETURNING channel was BROKEN in the opposite
direction — the public form itself could not submit (see finding 1 in
`2026-09-02-qa-hunt-findings.md`). Fixed and regression-pinned in the same branch.
