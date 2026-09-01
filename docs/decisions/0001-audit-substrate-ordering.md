# ADR 0001 — Audit substrate ordering (0011 before identity tables)

- **Date:** 2026-09-01
- **Author:** Ethan Baltazar

## Context

DATA_MODEL.md §6 numbers the migration ledger `0001`–`0016` in an order that
groups tables by subject (extensions, enums, reference, identity, terms,
membership, org structure, applications, regional, email, audit, functions,
views, RLS, grants, seed). Two constraints from Postgres itself do not respect
that grouping:

1. `CREATE TRIGGER` resolves the function it calls **at creation time**. A
   trigger cannot be attached to a function that does not exist yet.
2. A `LANGUAGE SQL` function body is **validated at `CREATE FUNCTION` time**
   (unlike `plpgsql`, whose body is only parsed, not resolved, until first
   call). `mask_sensitive()` is written as `language sql` and reads
   `sensitive_column_registry`, so that table must exist before
   `mask_sensitive()` is created.

BUILD_PLAN.md's Day-1 slice (S1) therefore ships `0011_audit.sql` — the
`audit_log` table, `mask_sensitive()`, and `audit_row()` — on Day 1, before
any per-person-forever or per-term identity table exists, and
`sensitive_column_registry` ships in `0003_reference.sql` rather than
alongside the rest of the audit substrate in `0011`, specifically because
`mask_sensitive()` needs it to already exist at `CREATE FUNCTION` time.

## Decision

- `sensitive_column_registry` is created in `0003_reference.sql`, immediately
  after `regions`/`affiliations`/`officer_positions` — not in `0011` where
  DATA_MODEL.md's table lists it, and not deferred until a table that
  actually has sensitive columns exists.
- `0011_audit.sql` ships the append-only `audit_log` table, `mask_sensitive()`,
  and the `audit_row()` trigger function, on Day 1, before `people`,
  `memberships`, or any other audited table exists.
- No `AFTER INSERT OR UPDATE ... EXECUTE FUNCTION audit_row()` trigger is
  attached to any table in `0011` — attachment happens per-table starting in
  `0012_functions.sql` (S2), once the audited tables themselves exist. `0011`
  ships the substrate only: the log, the masking function, and the trigger
  function definition.
- This is a **numbering divergence from DATA_MODEL.md §6's stated table list**
  for `sensitive_column_registry` only (table, not migration number, moves
  earlier); the migration *filenames* still match DATA_MODEL.md §6 exactly.

## Consequences

- A migration author reading DATA_MODEL.md §1's entity index and expecting to
  find `sensitive_column_registry` populated in `0011` will find it already
  created (empty) by `0003` and populated with rows in `0011`'s companion
  seed step or later — this ADR is the pointer to read when that surprises
  someone.
- Every later migration that adds a sensitive column must still register it
  in `sensitive_column_registry` in the **same** migration (CONVENTIONS.md
  §13 rule 4) — this ADR does not change that rule, only where the registry
  table itself was created.
- If DATA_MODEL.md is later edited to move `sensitive_column_registry` into
  `0003` explicitly, this ADR can be marked superseded rather than deleted.
