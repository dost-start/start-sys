# Runbook 03 — Credential Rotation

**Owner:** `tech_admin` (the CTO).
**Serves:** ARCHITECTURE.md §1 "Ops, CI, infra", §10 "Ownership rule"; `.env.example`;
`.github/workflows/scheduled.yml`.

---

## When to run this

- **On annual officer handover.** Every credential the outgoing CTO could have read
  gets rotated — this is the **first line item** in `ANNUAL_HANDOVER.md`.
- **On suspected compromise of any single credential** — rotate that one immediately;
  do not wait for the annual cycle.
- **On the schedule implied by the vendor** (e.g. a key that expires) — tracked
  per-row in the table below where relevant.

## Preconditions

1. **Bitwarden Teams vault access** for the credential you are rotating — every
   secret in this system has exactly one Bitwarden item, named in the table below.
2. **Console access** to the relevant org-owned account (Supabase, Vercel, GitHub,
   Google Cloud, Resend, Backblaze, Sentry, Better Stack, Cloudflare). If any console
   is still on a personal identity rather than an org-owned one, that migration is
   itself a launch blocker — see `docs/issues/2026-09-06-launch-debt.md`.
3. **A maintenance window if rotating `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_DB_URL`**
   — both require redeploys/re-runs to take effect, during which the invite flow and
   the nightly backup are briefly unavailable.

---

## The ten-secret inventory

Every secret in the system, where it is held, what breaks mid-rotation, and the
rotation command sequence. **Surface** is where the *value* lives operationally — a
Vercel environment variable, a GitHub Actions repository secret, or neither (the
credential lives only in the vendor's own auth flow, e.g. TOTP).

| # | Secret | Holder / surface | What breaks while rotating | Rotation steps |
|---|---|---|---|---|
| 1 | `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (Production + Preview, staging project) · Bitwarden | The invite-user flow (`lib/server/admin-client.ts` is its **only** legitimate reader — CLAUDE.md banned-pattern rule) is unavailable until redeploy completes | 1. Supabase dashboard → Project Settings → API → regenerate `service_role`. 2. Update the Bitwarden item. 3. Update the Vercel env var in **both** Production and Preview scopes (they point at different projects — ARCHITECTURE.md §1 preview isolation). 4. **Trigger a redeploy — the key does not take effect until the running Vercel functions restart.** 5. Confirm: invite a throwaway test user, confirm the `user_roles` row and its `audit_log` row both appear. |
| 2 | `SUPABASE_DB_URL` | GitHub Actions repository secret **only** · Bitwarden. **NEVER a Vercel variable — see `.env.example`'s "DELIBERATELY ABSENT" block.** | The `backup` job's next scheduled run fails its preflight check and posts to Discord (fails loud, never skips silently — `.github/workflows/scheduled.yml`) | 1. **This is the single most dangerous secret in the system** — a direct Postgres superuser connection that bypasses Row Level Security entirely. Rotate the role's password in the Supabase SQL editor (as the project owner, not through the app). 2. Update the GitHub repository secret (`gh secret set SUPABASE_DB_URL`). 3. Update the Bitwarden item. 4. Manually dispatch the `backup` job once (`workflow_dispatch`, job=`backup`) and confirm it completes green — do not wait for the next scheduled 02:00 PHT run to find out. |
| 3 | Google service account key (`GOOGLE_SA_CLIENT_EMAIL` + `GOOGLE_SA_PRIVATE_KEY`) | Vercel env (Production + Preview) · Bitwarden | Proof-of-enrollment uploads fail; `DOCUMENT_STORE=drive` deployments show `/api/health/drive` red until redeploy | 1. Google Cloud Console → IAM & Admin → Service Accounts → create a new key for the existing service account (do not delete the old one until the new one is confirmed working — avoids a gap). 2. Update both Vercel env vars and the Bitwarden item. 3. Redeploy. 4. Confirm via `/api/health/drive`, then delete the old key in Google Cloud Console. |
| 4 | Resend API key | Vercel env · Supabase Auth custom SMTP config · Bitwarden | Account invitations and password-reset emails stop sending (Supabase Auth's built-in mailer is rate-limited to a couple of messages/hour and is **not** an acceptable fallback in production — ARCHITECTURE.md §1) | 1. Resend dashboard → API Keys → create new, do not revoke the old one yet. 2. Update the Vercel env var. 3. Update the Supabase custom SMTP setting (`supabase config push`, per `supabase/config.toml` — never click it into the dashboard). 4. Send one test invite; confirm delivery. 5. Revoke the old key in Resend. |
| 5 | `JOB_SHARED_SECRET` | Vercel env · GitHub Actions repository secret · Bitwarden | The scheduled jobs (`purge-abandoned-drafts`, `drive-health`) fail with 401 until both sides are updated together | 1. Generate a new random secret (`openssl rand -hex 32`). 2. Update the Vercel env var **and** the GitHub repository secret in the same sitting — these must match exactly, or every job call 401s until both are fixed. 3. Update Bitwarden. 4. Manually dispatch one job (`workflow_dispatch`) to confirm. |
| 6 | Backblaze B2 application key (`B2_KEY_ID` / `B2_APPLICATION_KEY` / `B2_BUCKET` / `B2_S3_ENDPOINT`) | GitHub Actions repository secrets **only** · Bitwarden | The `backup` job's upload step fails; preflight in the workflow fails loud if any of the four is missing | 1. B2 dashboard → App Keys → create a new key **scoped to the one bucket, `write` + `list` only, no `delete` permission on the `monthly/` prefix** (retention pruning needs delete on `daily/` and `monthly/` generally, but the *key itself* should not be able to bypass the 30/12 retention logic by deleting arbitrarily — match the existing key's exact scope). 2. Update all four GitHub repository secrets and Bitwarden. 3. Delete the old key in B2. 4. Manually dispatch `backup` and confirm the upload step succeeds. |
| 7 | `age` backup keypair | **Public half** committed at `keys/backup.age.pub`. **Private half** held offline by the CTO, escrowed with the faculty adviser. **Never in Bitwarden, never in any CI system.** | Every future backup encrypts to the **new** public key; every **past** backup remains readable only by the **old** private key. Rotating this key does **not** re-encrypt existing archives. | 1. `age-keygen -o backup.age.key` — run this **outside** the repository working tree. 2. Commit only the `age1...` public line into `keys/backup.age.pub` (see the placeholder-detection check in `.github/workflows/scheduled.yml`, which refuses to run if this file still reads the committed placeholder). 3. Move `backup.age.key` to offline storage; hand a copy to the faculty adviser for escrow — in person or via an equally out-of-band channel, never email or Slack. 4. **Keep the old private key** until every backup encrypted under the old public key has aged out of the 30-day/12-month retention window, or you will be unable to restore anything older than the rotation date. |
| 8 | Sentry DSN | Vercel env (not preview-scoped — same project, tagged by environment) · Bitwarden | New errors stop reaching Sentry; the app itself keeps working (Sentry failures never block a request) | 1. Sentry dashboard → Project Settings → Client Keys (DSN) → rotate. 2. Update the Vercel env var and Bitwarden. 3. Redeploy. 4. Trigger a test error and confirm it appears in Sentry, scrubbed correctly (see `docs/runbooks/05-INCIDENT_RESPONSE.md` for what "scrubbed correctly" means). |
| 9 | Better Stack API key / monitor config | Better Stack dashboard only — not read by application code | Uptime monitoring and alerting pause during rotation | 1. Better Stack dashboard → rotate the API key if one is in use for programmatic monitor management. 2. Confirm both monitors (`/api/health`, two regions) are still active and the Discord webhook / phone alert routing is unchanged. |
| 10 | Cloudflare / domain registrar credentials | Cloudflare dashboard · Bitwarden | DNS changes (SPF/DKIM/DMARC records for Resend deliverability) are blocked during rotation; the site itself keeps resolving | 1. Cloudflare dashboard → rotate the account password and any API tokens. 2. Confirm 2FA is still enrolled on the account. 3. Update Bitwarden. |

---

## How to verify it worked

Per-row above, but the general pattern: **rotate, confirm the new value works end to
end for the specific flow it serves, then and only then revoke the old value.** Never
revoke before confirming — a credential you cannot roll back to is a credential you
cannot use to diagnose a rotation gone wrong.

## If it fails

- **Any rotation that leaves a production flow broken for more than a few minutes**
  (invite flow, backups, uploads, or email) escalates to
  [`05-INCIDENT_RESPONSE.md`](05-INCIDENT_RESPONSE.md).
- **If you cannot find a secret's Bitwarden item**, do not create a new ad-hoc one —
  check this table for the exact item name expected, and if it genuinely does not
  exist, that is itself a finding: file it in `docs/issues/` before continuing.
