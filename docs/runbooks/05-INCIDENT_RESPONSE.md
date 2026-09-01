# Runbook 05 — Incident Response

**Owner:** `tech_admin` (the CTO).
**Serves:** PRD Backup & Recovery NFR, Data Privacy NFR; `docs/privacy/BREACH_NOTIFICATION_TEMPLATE.md`.

## When to run this

Any suspected security incident (unauthorized access, a leaked credential, an RLS
policy found to be wrong in a way that exposed data) or an availability outage caught
by Better Stack.

## Severity ladder

| Level | Definition | Who is paged | First response | Escalation |
|---|---|---|---|---|
| **SEV1** | Confirmed or **reasonably suspected** disclosure of personal data to anyone not authorized to see it — a widened RLS policy, a leaked service-role key, a proof document reachable without authorization, or any finding from the S7 security review's middleware-off crawl that would apply in production. **This triggers the RA 10173 72-hour NPC breach-notification clock immediately, at suspicion, not at confirmation.** | `tech_admin` (CTO) pages the faculty adviser and project heads (Danielle Quiambao, Ethan Baltazar) within the hour | Contain first (see below), then start `docs/privacy/BREACH_NOTIFICATION_TEMPLATE.md` in parallel with containment — the two are not sequential | Faculty adviser and project heads are looped in immediately, not after triage |
| **SEV2** | Site down, or a data-loss risk with **no confirmed or suspected disclosure** — a failed deploy, a database connectivity issue, a backup job that has been silently failing | `tech_admin` (CTO); project heads notified within the day | Vercel rollback if the cause is a recent deploy (see below); otherwise diagnose against `/api/health` and `/api/health/drive` | Faculty adviser looped in if unresolved after a few hours |
| **SEV3** | Degraded but functioning — elevated latency, a non-blocking scheduled job failure (e.g. `drive-health` reporting a driver mismatch), a single Better Stack check flapping | `tech_admin` (CTO) | Investigate during normal working hours; no page | Log in `docs/issues/`; escalate to SEV2 if it worsens or persists past a day |

**When in doubt, treat it as one level more severe than you think it is.** A SEV2
classified as SEV1 costs an unnecessary page. A SEV1 classified as SEV2 costs the
72-hour notification clock — that direction of error is not recoverable.

## First response to a bad production deploy

**The response to a bad production state is the Vercel rollback button to the last
known-good build — not a hotfix pushed straight to `main`.** Fix properly afterward,
during slack time, with the fix re-verified before it ships again
(`BUILD_PLAN.md` S7 risk table). A rushed policy edit under time pressure is how a
security boundary gets silently widened while every existing test still passes — the
exact failure mode this system's whole RLS-as-boundary design exists to prevent.

1. Identify the last known-good deployment (Vercel dashboard → Deployments, or the
   canary record in `docs/issues/2026-09-06-deploy-canary.md` if this is the first
   production deploy).
2. Roll back via the Vercel dashboard (Promote to Production on the prior deployment).
3. Confirm `/api/health` returns `db_latency_ms` and `commit` matching the rolled-back
   build.
4. Only then investigate the root cause of the bad deploy, on a branch, with the fix
   going through the normal CI gate before it ships again.

## Steps — general incident playbook

1. **Contain.** Depending on the incident: roll back the deployment (above), rotate
   the specific compromised credential (`docs/runbooks/03-CREDENTIAL_ROTATION.md`),
   or revert the specific migration that widened a policy (a new forward-only
   migration, per CONVENTIONS.md §3.4 — never edit an applied one, even in an
   incident).
2. **Assess scope using the audit log.** `audit_log` is readable by `exec_admin` and
   `tech_admin` only, is append-only, and holds masked values — so it can answer *who
   read or changed what, and when* without itself becoming a second exposure. Query
   the affected table and time window; the `VIEW_DOCUMENT` and `VIEW_RECORD`
   operations are what answer "was this scholar's data actually read, or only
   exposed."
3. **Classify severity** per the ladder above. If SEV1 (confirmed or suspected
   disclosure), start step 4 immediately — do not wait to finish scoping first.
4. **If PII disclosure is confirmed or suspected:** open
   `docs/privacy/BREACH_NOTIFICATION_TEMPLATE.md` and begin filling it in with what is
   known so far. The 72-hour clock started at suspicion (see severity ladder), so a
   partial notification stating "investigation ongoing" filed on time beats a complete
   one filed late.
5. **Notify** per the severity ladder's paging column.
6. **Document.** Open a dated file in `docs/issues/` (symptom, impact, cause, fix,
   prevention — CONVENTIONS.md §9 D4) as soon as containment is stable, while details
   are still fresh. Update the matching runbook if the incident revealed a gap in it.
7. **Prevention.** Before closing the incident, name the specific test, policy, or
   process change that would have caught this earlier, and either land it or file it
   with an owner and a date.

## How to verify it worked

- The specific vector is closed: the credential is rotated and the old one confirmed
  revoked, or the policy is reverted and `supabase test db` is green again, or the
  deployment is rolled back and `/api/health` confirms the known-good commit.
- If SEV1: the NPC notification is filed (or in progress with a documented reason for
  delay) and, if applicable, affected individuals have been notified per the
  breach-notification template's step 2.
- A dated file exists in `docs/issues/` naming symptom, impact, cause, fix, and
  prevention.
- If the incident exposed a gap in a runbook (including this one), the runbook is
  updated in the same sitting, while the gap is still remembered clearly enough to
  describe precisely.

## If it fails

Escalate to the faculty adviser and the project heads (Danielle Quiambao, Ethan
Baltazar) immediately; do not attempt an unreviewed fix under time pressure. If the
incident is a confirmed or suspected personal-data breach and the DPO/NPC-registration
gap in `docs/issues/2026-09-06-ra10173-organizational-gaps.md` is still open, the
project heads are the ones who must decide who signs the NPC filing — that decision
cannot wait for the gap to be closed properly first.
