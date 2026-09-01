# Runbook 02 — Restore From Backup

**Owner:** `tech_admin` (the CTO).
**Status:** STUB. Filled in and executed in BUILD_PLAN.md S7-T16, which
requires the restore to be actually performed once by someone who did not
write the restore script, with the result recorded below.

## When to run this

- Drilled **quarterly**, whether or not anything is wrong — an untested
  backup is not a backup (ARCHITECTURE.md §11).
- On real data loss, corruption, or a suspected attack (PRD Backup &
  Recovery NFR).

## Preconditions

*(TODO(tech_admin))*

## Steps

*(TODO(tech_admin) — decrypt the nightly `age`-encrypted B2 dump, load into
a local Docker Postgres 17, and run the fixed assertion set: 18 regions, 4
administrators, expected `people` count, `pg_policies` count > 0 — a dump
missing its RLS policies restores an open database — and both RLS flags on
every table. Then re-run the full pgTAP suite against the restored
database.)*

## How to verify it worked

*(TODO(tech_admin) — all five fixed assertions PASS and the pgTAP suite is
green against the restored database.)*

## If it fails

*(TODO(tech_admin) — link to runbook 05.)*

## Drill record

| Date | Operator | Backup object restored | Elapsed time | Result |
|---|---|---|---|---|
| | | | | |
