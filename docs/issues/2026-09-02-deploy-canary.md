# 2026-09-02 — First production deploy + canary (BUILD_PLAN S7-T27)

**Deployment:** https://start-sys.vercel.app (project `start-sys`, `● Ready`, squash-merge
`2c858b1` of PR #1). Known-good build for rollback: `start-mz0k80bx8`.

**Environment honesty:** `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` are PLACEHOLDERS — no
hosted Supabase project exists yet (launch debt, `2026-09-06-launch-debt.md`). Every
database-backed surface therefore degrades to its designed empty/closed/error state; the
canary below verifies the degradation is graceful, not that data flows.

| Check | Result |
|---|---|
| `/login`, `/privacy`, `/apply`, `/robots.txt` public | 200 ✓ |
| `/apply` with no reachable window | renders the CLOSED state ("Applications are not open right now" + CRRD contact), no form ✓ |
| `/dashboard` logged out | 307 → `/login?next=%2Fdashboard` (US-A1 return-to) ✓ |
| `/api/health` | 500 `{"code":"upstream","message":"An external service is unavailable…"}` — correct against a dead DB, no raw error text ✓ |
| Security headers on every page | HSTS(preload) · nosniff · X-Frame-Options DENY + CSP frame-ancestors 'none' · Referrer-Policy strict-origin-when-cross-origin · Permissions-Policy · full CSP in Report-Only ✓ |
| Indexing | `X-Robots-Tag: noindex` everywhere except the public pair; robots.txt Disallow / with Allow /apply /privacy ✓ |
| Deployment protection | Vercel SSO restricted to PREVIEW deployments (S7-T1: previews are a second copy of the app and stay walled; production serves the public form) ✓ |

**Before real applicant data:** provision Supabase Pro (ap-southeast-1), replace the
placeholder envs, run migrations via CI, execute the launch-debt register.
