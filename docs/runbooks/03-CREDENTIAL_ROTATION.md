# Runbook 03 — Credential Rotation

**Owner:** `tech_admin` (the CTO).
**Status:** STUB. Filled in in BUILD_PLAN.md S7-T13 (the secret inventory)
and S2-T32/S7-T7 (Supabase auth config as code).

## When to run this

- On annual officer handover (every credential the outgoing CTO could have
  read gets rotated — this is the first line of `ANNUAL_HANDOVER.md`).
- On suspected compromise of any credential.
- On the schedule named in the (future) secret inventory table below.

## Preconditions

*(TODO(tech_admin) — Bitwarden Teams vault access, org-owned accounts on
every console named in ARCHITECTURE.md §1 "Ops, CI, infra".)*

## Steps

*(TODO(tech_admin) — one numbered, copy-pasteable step per credential:
Supabase service-role key (note: rotating it requires a Vercel redeploy to
take effect), `SUPABASE_DB_URL` (GitHub Actions + Bitwarden only, never a
Vercel env var), Google service-account key, Resend API key,
`JOB_SHARED_SECRET`, the B2 application key (scoped to one bucket,
write+list, no delete on `monthly/`), the `age` backup keypair (public key
committed, private key offline with the CTO, escrowed with the faculty
adviser), Sentry DSN, Better Stack API key, Cloudflare/domain registrar
credentials.)*

## How to verify it worked

*(TODO(tech_admin) — per-credential smoke check: e.g. after rotating the
service-role key, confirm the invite flow and the backup job both still
succeed post-redeploy.)*

## If it fails

*(TODO(tech_admin) — link to runbook 05.)*
