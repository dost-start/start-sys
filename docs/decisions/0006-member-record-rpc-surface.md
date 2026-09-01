# ADR 0006 — The member-record RPC surface: one invoker read, two definer doors

**Date:** 2026-09-05
**Author:** S5 database lane (BUILD_PLAN S5-T5, S5-T6, S5-T7, S5-T32)
**Status:** Accepted
**Supersedes / superseded by:** none

---

## Context

Slice S5 has to deliver three things that all touch `public.people`:

1. `/members` — a searchable, filterable, paginated grid over the member directory, scoped
   correctly for seven tiers (PRD §3 v1.0 item 12; US-I2, US-I3, US-F1).
2. The member detail page — the full record, sensitive columns included, for the three tiers
   the locked role model admits (US-D1, US-J1).
3. The edit form — a validated, audited, concurrency-safe write (US-D1).

Two facts from earlier slices constrain every option:

- **`0015_grants.sql` revokes `ALL` on `public.people` from `authenticated` and grants back a
  six-column `SELECT`** (`id, member_id, given_name, family_name, join_year, created_at`).
  There is **no table `UPDATE` on `people` for any role**, and no `SELECT` on any of the
  thirteen other columns. `people_update` (0014) exists and names three roles, but a policy
  cannot grant a privilege that was revoked — it is the second lock on a door whose first
  lock is a missing GRANT.
- **`v_member_directory` (0013) is `security_invoker = true`** and exposes exactly thirteen
  non-sensitive columns, but it exposes `region_name`, `committee_name` and `department_name`
  — **render values, not ids** — so it cannot serve a facet filter keyed on `region_id`.
  Its two `LEFT JOIN`s also fan a scholar on two committees into two rows, which silently
  miscounts anything that paginates over it.

The tempting single answer is one `SECURITY DEFINER` RPC that takes the filters, checks
`auth_role()` itself, and returns everything the caller is entitled to. It reads well, it is
one function, and it would work today.

## Decision

**Three functions, split on one criterion: elevation is taken only where the GRANT makes it
unavoidable, and never for convenience.**

| Function | Security | Why |
|---|---|---|
| `search_member_directory(p_term_id, p_q, p_statuses, p_region_ids, p_committee_ids, p_department_ids)` | **INVOKER** | Reads only the six granted `people` columns plus `memberships`, `regions`, `committees`, `departments` — all readable by every authenticated tier. It needs no elevation, so it takes none. |
| `get_member_record(p_person_id) → jsonb` | **DEFINER** | Must reach the sensitive ten, which no session may read. |
| `update_member_record(p_person_id, p_patch, p_expected_updated_at) → void` | **DEFINER** | Must write `people`, which no session may write. |

Concretely:

- **`search_member_directory` restates no scoping whatsoever.** An officer gets every row and
  a regional rep gets one region because `memberships_read` and `people_read` say so, applied
  to this function exactly as they are applied to a hand-written `select`. The function
  contains no `auth_role()` branch for visibility. It does contain one role check — for the
  `p_term_id` argument (below) — and that is a *scope-of-argument* decision, not a
  row-visibility one.
- **It reads the base tables rather than `v_member_directory`**, because the facets need ids
  the view does not expose. The RLS surface is identical: same relations, same policies, same
  column GRANT. It returns the same thirteen concepts with `committee_name` and
  `department_name` pluralised into `text[]` by `GROUP BY … array_agg(distinct …) filter (…)`.
- **Sorting and pagination are not parameters.** PostgREST applies `?order=` and `Range`
  headers to a set-returning function, so `.rpc(...).order(...).range(0, 24)` works with no
  dynamic SQL in the body. A `p_sort text` argument would be a string concatenated into an
  `ORDER BY`.
- **`p_term_id` is honoured only for `exec_admin`, `crrd_admin`, `moderator` and
  `tech_admin`**; every other tier is forced to `current_term_id()`. `memberships_read`
  carries *no* term predicate, so without this an officer could page through history by
  editing a URL (PRD US-H3).
- **Both definer functions open with the same two guards in the same order** — role
  (`exec_admin` / `crrd_admin` / `moderator`; `tech_admin` excluded per OQ-5), then a
  current-term confidentiality acknowledgement (CBL Art. VIII §7.1, PRD US-J5) — and
  `get_member_record` writes its `VIEW_RECORD` audit row **before** it builds the return
  value. A refused call writes nothing.
- **`update_member_record` refuses `status`.** Membership status is a term-scoped fact on
  `memberships` and moves through a plain table `UPDATE`, so that `memberships_update` (0014)
  and `enforce_membership_transition` (0028) both stay in the path.

## Consequences

**What this buys.**

- There is exactly **one** authorization model for member visibility. Adding a tier, changing
  a region predicate or narrowing `people_read` changes the grid, the detail page and the
  export in one edit, with no second place to remember.
- The scoping is *testable as inheritance*: `063_member_search_scope.sql` asserts a rep sees
  3 rows and an admin 14 from the identical call, and asserts separately that the function is
  **not** `prosecdef`. If someone converts it to a definer, assertions 2–5 stay green and
  assertion 22 goes red — which is precisely the signal wanted, because a definer *can* be
  written to return today's right answer and then drift.
- PII has two doors, both audited, both acknowledgement-gated, and neither reachable by
  widening a GRANT.

**What it costs, stated plainly.**

- `search_member_directory` cannot return a sensitive column even to an admin. The detail page
  therefore makes a second call (`get_member_record`) rather than getting everything in one
  round trip. Accepted: a grid that could return contact numbers is a grid one careless
  `select` away from a bulk export of them.
- Two definer functions now sit beside `get_person_sensitive` (0012) with near-identical
  guards. The duplication is deliberate — they write different audit operations
  (`VIEW_SENSITIVE` for the application-review surface, `VIEW_RECORD` for the member detail
  page) and `/audit` must answer those questions separately (PRD US-I1). If a third appears,
  factor the guard pair into one helper; do not factor the audit operation.
- `people.updated_at` is not granted to `authenticated`, so the optimistic-concurrency token
  the edit form submits has to arrive via `get_member_record`. That is a real ergonomic cost
  and it is why `064_member_update_rpc_authz.sql` reads the value as the session role.

**The rejected alternative, recorded so it is not re-proposed.** A single `SECURITY DEFINER`
directory RPC that checks `auth_role()` internally. It would have been one function instead of
three and would have returned sensitive columns in the same round trip. It is rejected for the
same reason `ARCHITECTURE.md` §5 rejects a TypeScript capability matrix as the primary
boundary and ADR 0008 rejects definer dashboard aggregates: **it is a second permission model,
and a second model drifts from the first silently, in the direction of over-disclosure.** The
first officer screen that "needs one more field" is added to the definer, not to the policy,
and nothing goes red.

## Related

- ADR 0002 — RLS policies live in `0014_rls.sql`
- ADR 0008 — dashboard aggregates are `security_invoker` views, same reasoning
- `docs/issues/2026-09-05-accent-tolerant-search.md` — PRD US-I2's accent criterion is unmet
- `docs/issues/2026-09-05-session-revocation-deferred.md` — US-H4 forced sign-out deferred
