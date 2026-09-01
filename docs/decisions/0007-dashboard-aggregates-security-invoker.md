# ADR 0007 — Dashboard aggregates are `security_invoker` views, not a definer RPC

**Date:** 2026-09-05
**Author:** S6 database lane (BUILD_PLAN S6-T17, S6-T1, S6-T2, S6-T3, S6-T4)
**Status:** Accepted
**Supersedes / superseded by:** none. Extends the reasoning of ADR 0006 (the member-record
RPC surface) to the aggregate surface, and shares its single criterion: *elevation is taken
only where a GRANT makes it unavoidable.*

---

## Context

PRD §3 v1.0 items 13, 14 and 15 ask for three counted surfaces over the same rows:

- **Admin dashboard** (US-D4) — current-term headcount by status, by region and by
  committee, plus the pending-application count, where *"every number links through to the
  filtered list that produced it."*
- **Regional Representative dashboard** (US-F1, US-F2) — the same counts, for one region,
  read-only.
- **Officer dashboard** (US-D2, US-J1) — the same counts, with no sensitive column anywhere
  near them.

Three audiences, one arithmetic, three different correct answers. The whole design question
is **where the difference between those three answers is computed.**

Two facts from earlier slices constrain the options, and both were read out of the live
migrations rather than assumed:

- **`memberships_read` (0014 §4) names `exec_admin`, `crrd_admin`, `moderator`, `officer`,
  a region-scoped `regional_rep` branch and a self-scoped `member` branch — and does not
  name `tech_admin`.** The scoping the dashboards need therefore already exists, in force,
  on the base table. It does not need to be written a second time; it needs to be *not
  bypassed*.
- **`v_member_directory` (0013) is already `security_invoker = true`** for exactly this
  reason, and its header says so in as many words: *"scoping is inherited from the policies,
  never restated in a second permission model that can drift from the first."* An aggregate
  surface that reached the same rows by a different route would make that sentence false.

The tempting implementation is one `SECURITY DEFINER` RPC — `get_dashboard_counts(term_id)`
— that reads `auth_role()` itself, branches on the tier, and returns the right numbers. It
is one function instead of three views, it is trivially indexable, it can pre-shape the
JSON the page wants, and **it would return today's correct answer for all nine fixtures.**

That last clause is the trap. A definer function is correct *by inspection of its own body*,
not by construction, and it is correct only against the policy set that existed on the day
it was written.

## Decision

**Every dashboard aggregate is a plain view declared
`with (security_barrier = true, security_invoker = true)`. Scoping is never restated — not
in SQL, not in TypeScript.**

`0032_dashboard_aggregate_views.sql` ships three:

| View | Grain | Counts |
|---|---|---|
| `v_membership_status_counts` | `(term_id, status)` | memberships |
| `v_membership_region_counts` | `(term_id, region_id)` + region render columns | memberships |
| `v_membership_committee_counts` | `(term_id, committee_id)`, `NULL` = unassigned | memberships |

Four subordinate decisions come with it, each recorded here because each is the kind of
thing a later maintainer would otherwise "fix":

### 1. No `SECURITY DEFINER` dashboard RPC. Ever.

`security_invoker = true` means the view executes with the **caller's** privileges, so
`memberships_read` is evaluated for every row the aggregate touches, exactly as it would be
for a hand-written `select count(*) from memberships`. A regional rep's totals are correct
because **the database refuses to compute anything else** — not because a branch in a
function remembered to filter.

The failure mode this avoids is specific and it is silent. A definer aggregate computes as
its owner, which holds `BYPASSRLS`. A rep would then see org-wide totals on a page whose
per-row list below it shows one region. **No error is raised, nothing fails a type check,
and the developer testing as an admin sees numbers that look exactly right.** It is the one
class of bug in this system that a normal development loop cannot surface, which is why
`065_dashboard_views_rls.sql` is written and verified red-then-green *before* any UI work
starts (BUILD_PLAN S6-T3), and why `066_dashboard_view_columns.sql` asserts
`security_invoker=true` in `reloptions` as a standing catalog invariant rather than a
one-time check.

**A future agent optimising this into a definer RPC has to delete this file first.**

### 2. The views do not call `current_term_id()`.

Each groups by `term_id` and leaves the filter to the caller. One definition then serves
both the current-term dashboards (`where term_id = current_term_id()`) and the admin-only
historical read (`where term_id = $1`, which RLS already restricts to the tiers permitted
to pass an explicit term — PRD US-H3). Embedding the current term would have meant a second
view, or a function, the first time anyone wanted last year's numbers.

### 3. No charting library.

PRD §4 excludes advanced analytics; the dashboards show counts and lists. Counts render as
stat tiles and CSS-width bars. Adding `recharts` or equivalent would be a new runtime
dependency a 2029 officer must upgrade, in service of a requirement the PRD explicitly does
not have — so it would need an ADR of its own, and this is that ADR refusing it in advance.

### 4. The committee panel does not sum to the headcount, and that is correct.

`v_membership_committee_counts` `LEFT JOIN`s `committee_memberships`, so a scholar sitting on
two committees is counted once under each. Its `member_count` column therefore sums to
**more** than the term's headcount whenever anyone holds two seats, and the `NULL`
(unassigned) bucket plus the named buckets do not reconcile to the status or region totals.

That is a property of committee membership, not a defect: CBL Art. III §5 places no limit on
how many committees a member may serve. The panel is **labelled** rather than reconciled.

**Do not "fix" it by picking one committee per member.** An arbitrary pick silently
understates every roster, and — unlike a total that visibly does not add up — nothing about
the resulting page looks wrong. A visible non-sum is a self-documenting property; a hidden
undercount is a bug that ships.

## Consequences

**Good**

- Regional scoping for every dashboard is delivered by zero lines of scoping code. The RR
  dashboard (S6-T12) renders correct, region-limited totals without importing an auth
  helper, which is also why it can be a pure Server Component with no Server Action anywhere
  in the route group (PRD US-F2 — read-only is the *absence* of a write path).
- A policy change lands in the dashboards automatically and lands in `065` as a test
  failure. There is exactly one place to fix, and CI names it.
- The views expose **no `people` column at all**, so the column-level GRANT of 0015 and the
  CBL Art. VIII §7.1 acknowledgement gate are not in the aggregate path and cannot be
  widened by way of a dashboard. `066` asserts this against
  `sensitive_column_registry` rather than against a hand-kept list, so a column classified
  in 2029 is checked against these views on the next CI run.
- Cheap to extend: a fourth facet is a fourth view and needs no new authorization reasoning.

**Costs, accepted**

- **`tech_admin` sees zeros.** `memberships_read` does not name `tech_admin` (PRD OQ-5,
  least privilege — *"configure the system and control access"* is not *"read everyone's
  address"*), so with `security_invoker` the CTO's dashboard totals are genuinely 0. This is
  the design working, not a bug, and it is why BUILD_PLAN S6-T13 lands `tech_admin` on
  `/system` rather than on an all-zero dashboard that reads as a broken system. `065` pins
  the zeros as expected values so the day someone "fixes" it, CI says what changed.
- **`moderator` sees everything**, because `memberships_read` names it. Also pinned in `065`
  rather than assumed.
- Aggregating under RLS costs a policy evaluation per row. At ~4,000 membership rows across
  five terms (DATA_MODEL §10) this is arithmetic, not architecture;
  `067_dashboard_performance.sql` holds each aggregate to 250 ms and the pending count to
  100 ms against a full five-year volume seed, leaving the bulk of the 3-second budget
  (PRD Performance NFR, Success Metric 4) to network and render.
- The views cannot pre-shape JSON, so zero-filling absent statuses and regions is the
  caller's job (`lib/dashboard/status-buckets.ts`, S6-T6). Deliberate: a term with no
  members must render `0` for every status, and a view cannot invent a row for a status
  nobody holds.

**Neutral**

- `security_barrier = true` rides along on all three, matching `v_member_directory`. It stops
  a caller pushing a cheap leaky function into a `WHERE` clause and having the planner
  evaluate it ahead of the view's own qualifiers.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| `SECURITY DEFINER` RPC with an internal `auth_role()` branch | A second authorization model. Drifts from the first silently, in the direction of over-disclosure, and its failure mode produces no error. §1 above. |
| `security_invoker = false` views (the Postgres default) | Same defect as the definer RPC, arrived at by omitting one clause rather than by writing one. This is the likelier accident of the two, which is why `066` asserts the clause from `reloptions` on every run. |
| Aggregating in TypeScript over `search_member_directory()` | Correct on scoping — it is invoker too — but it pulls every row into a function to count it, and the count would then disagree with the list any time pagination changed. Counting belongs where the rows are. |
| Materialized views | Cannot carry RLS at all: a matview is computed once, by its owner, and every caller reads the same pre-computed rows. It would hand a regional rep org-wide totals by construction. |
| One wide cube view `(term, status, region, committee, count)` | One object instead of three, but the `NULL`-vs-`GROUPING()` reading of a cube is exactly the kind of cleverness CLAUDE.md's handover rule exists to refuse, and the committee fan-out would contaminate the status and region totals rather than staying quarantined in one panel. |
