# Runbook 05 — Incident Response

**Owner:** `tech_admin` (the CTO).
**Status:** STUB. Filled in in BUILD_PLAN.md S7 (monitoring, deploy
hardening) and alongside `docs/privacy/BREACH_NOTIFICATION_TEMPLATE.md`
(S7-T21).

## When to run this

Any suspected security incident (unauthorized access, a leaked credential,
an RLS policy found to be wrong in a way that exposed data) or an
availability outage caught by Better Stack.

## Severity ladder

*(TODO(tech_admin) — define, at minimum: SEV1 (confirmed or suspected PII
disclosure — triggers the RA 10173 72-hour NPC breach-notification clock,
see the pre-drafted template below), SEV2 (site down / data-loss risk, no
confirmed disclosure), SEV3 (degraded but functioning). Each level names who
is paged, what the first response is, and when the faculty adviser and
project heads are looped in.)*

## First response to a bad production deploy

**The response to a bad production state is the Vercel rollback button to
the last known-good build — not a hotfix pushed straight to `main`.** Fix
properly afterward, during slack time, with the fix re-verified before it
ships again (BUILD_PLAN.md S7 risk table).

## Steps

*(TODO(tech_admin) — numbered incident playbook: contain, assess scope
using the audit log, notify per the severity ladder, and if PII disclosure
is confirmed or suspected, follow the pre-drafted breach notification at
`docs/privacy/BREACH_NOTIFICATION_TEMPLATE.md` — the RA 10173 72-hour NPC
notification clock starts at confirmed or reasonable suspicion of
disclosure, not at full investigation.)*

## How to verify it worked

*(TODO(tech_admin))*

## If it fails

Escalate to the faculty adviser and the project heads (Danielle Quiambao,
Ethan Baltazar) immediately; do not attempt an unreviewed fix under time
pressure.
