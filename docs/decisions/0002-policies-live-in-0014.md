# ADR 0002 — RLS policies live in 0014_rls.sql, not in each creating migration

- **Date:** 2026-09-01
- **Author:** Ethan Baltazar

## Context

CONVENTIONS.md §3.4 states: "A migration that creates a table in `public`
must, **in the same file**: enable + force RLS, create its policies, and
grant only what is needed." That rule is correct in general, but every
policy body in this schema calls at least one of `auth_role()`,
`auth_person_id()`, `auth_region_id()`, or `auth_region_ids()` — and those
helper functions are not defined until `0012_functions.sql` (DATA_MODEL.md
§6), which itself cannot exist before the tables it reads from
(`user_roles`, `rr_region_grants`) exist.

Writing policies inline in each creating migration (`0003` through `0009`)
would therefore require those functions to exist before their own
prerequisite tables do — an ordering that cannot be satisfied without
scattering table creation, function creation, and policy creation into an
interleaved, hard-to-follow sequence across many files.

## Decision

- Every `CREATE POLICY` statement in this repository lives in
  `supabase/migrations/0014_rls.sql`, authored as one strictly sequential
  file by one author at a time (BUILD_PLAN.md S2, "the policy chain does not
  parallelize").
- Every table-creating migration still ships `ALTER TABLE ... ENABLE ROW
  LEVEL SECURITY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY` in the same
  file that creates the table — **no table is ever unprotected in the gap
  between creation and `0014`**, because with RLS enabled+forced and zero
  policies, Postgres denies all access by default (deny-by-default). This is
  exactly what the meta-test (`001_meta_force_rls.sql`) checks, and it is
  satisfied at every migration in the sequence, not only at the end.
- Column-level `GRANT`s (`0015_grants.sql`) follow the same reasoning and
  ship separately from the creating migration for the same dependency
  reason.
- This ADR **supersedes CONVENTIONS.md §3.4's same-file policy rule for this
  repository**. CONVENTIONS.md is not edited; this ADR is the authoritative
  exception, cited from `0014_rls.sql`'s header comment.

## Consequences

- A reviewer looking for a table's policies must know to check
  `0014_rls.sql`, not the table's own creating migration. `0014`'s header
  comment and this ADR are both pointers.
- Because deny-by-default holds throughout, a table created on Day 1 or 2
  and not yet given policies is inaccessible to every role (including its
  own creator) until `0014` lands — this is the intended, safe failure
  direction, not a bug to work around by adding a temporary permissive
  policy.
- Any future table that does NOT need an `auth_*()` helper in its policies
  (rare) may still ship its policy in its own creating migration if that is
  clearer — but the default for this repo is `0014`, and a deviation should
  say why in that migration's header.
