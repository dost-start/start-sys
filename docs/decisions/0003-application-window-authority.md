# ADR 0003 — Who may open and close an application window

**Date:** 2026-09-02
**Author:** START-SYS build, S2 authorization lane (BUILD_PLAN S2-T17)
**Status:** Accepted
**Affects:** `supabase/migrations/0014_rls.sql` §3 — `application_windows_insert`, `application_windows_update`

---

## Context

Two authority documents disagree about who writes `public.application_windows`, and the
disagreement is not cosmetic: it decides whether the org can open its own application
period without the CTO in the room.

**PRD US-B4** is unambiguous and is written from the CCDO's chair:

> **US-B4 — Application window enforcement.** *As a **CRRD Admin**, I can open and close the
> application period, so that submissions are only accepted while applications are open.*

**ARCHITECTURE.md §5** is equally unambiguous and is written from the CTO's:

> `tech_admin` — *Only role that can write `user_roles`, `application_windows`, `terms`.*

Both are locked documents. Neither is a draft. The conflict was not noticed earlier because
nothing in v1.0 wrote to the table until the RLS policies landed — up to that point the
window was a row somebody inserted by hand.

Three further facts bear on it:

1. **The window is not a schema change.** `terms` and `user_roles` are genuinely system
   configuration: defining a term is a state change over the whole database, and assigning
   a role is access control. An application window is a *date range on a form*. It is
   operational scheduling, and the CRRD owns the application period end to end — PRD §2
   puts "manage (review / approve / reject) membership applications" in the CCDO's column,
   and CBL Art. IV §6.2.2 makes membership recruitment and application the CRRD's
   constitutional job.

2. **A `tech_admin`-only gate has a specific, dated failure.** `tech_admin` is held by the
   CTO **alone** (project heads, 2026-09-01 — the DCTO-PD was moved to `moderator`). CBL
   Art. VI §4.4.1 expressly permits the CEO to leave a seat vacant when it falls vacant
   within 45 days of term end, and 45 days before 31 May is mid-April. So the Constitution
   itself sanctions a window in which there is no CTO. If opening the application period
   requires `tech_admin`, the org cannot recruit during a vacancy the Constitution allows.
   That is the same seat and the same hazard as PRD **OQ-13**, reached from a second
   direction.

3. **Either writer is audited identically.** `trg_application_windows_audit` (0012) fires on
   both, so US-B4's *"opening and closing a window is written to the audit log with the
   responsible user"* holds regardless of which role did it. Widening the writer set does
   not widen what is knowable after the fact.

---

## Decision

**Both `crrd_admin` and `tech_admin` may INSERT and UPDATE `public.application_windows`,
and both must be at `aal2`.**

```sql
create policy application_windows_insert on public.application_windows
  for insert to authenticated
  with check (
    public.auth_role() in ('tech_admin', 'crrd_admin')
    and public.has_aal2()
  );
-- application_windows_update carries the same predicate in USING and WITH CHECK.
```

`moderator` is **not** included. The DCCDO-C runs the application process day to day (CBL
Art. IV §6.2.2), which is an argument for it — but opening a recruitment period is the act
that turns on the only anonymous write path in the system, and that is a chief-level
decision. If it proves impractical during application season, adding `moderator` is a
one-policy migration plus a superseding ADR; the audit log already records the issuer
either way. This is the same narrow-first posture taken on `rr_send_grants` (ARCHITECTURE
§5), and for the same reason: widening later is a migration, narrowing later is a support
incident.

`exec_admin` is also not included, deliberately. The CEO and COO oversee *records*; nothing
in the PRD or the CBL puts the recruitment calendar in their hands, and adding a role
"because they are senior" is how a permission model stops meaning anything.

The `aal2` conjunct follows ARCHITECTURE §5's rule for privileged tables and PRD US-A3, and
matches `terms` and `user_roles`. BUILD_PLAN S2-T25 asserts the aal1/aal2 split for all
three tables, so this keeps `application_windows` in that family rather than making it an
exception.

---

## Consequences

**Good**

- PRD US-B4 is satisfiable by the role the story names, without a workaround.
- The OQ-13 vacancy case is survivable for recruitment. A vacant CTO seat still blocks
  `roll_over_term()` and `unfreeze_term()` — that is untouched by this ADR and remains the
  open question — but it no longer also blocks the org from opening applications.
- The anon-facing behaviour is unchanged. `application_windows_read_anon` still narrows
  anon to a currently-open window, and 0008's anon INSERT policy still EXISTS-checks this
  table as the anon role, so *"the application period is closed"* remains a database fact
  and a forwarded `/apply` link remains inert. This ADR widens who may **write** the
  schedule, never who may read or submit against it.

**Costs, stated plainly**

- ARCHITECTURE.md §5's `tech_admin` row is now inaccurate as written. It is corrected in
  the same PR that lands this ADR (BUILD_PLAN S3-T25 also touches that row); the row should
  read *"`user_roles`, `terms` — and `application_windows` jointly with `crrd_admin`, see
  ADR 0003"*.
- Two roles can now change the recruitment calendar, so two people can disagree about it.
  Mitigated by the audit trigger and by S4-T24's rule that a term already holding an open
  window is extended rather than given a second row — which keeps
  `application_windows_read_anon`'s predicate single-row and keeps "when do applications
  close" a question with one answer.
- The `unique (term_id, form_kind)` constraint in 0005 means the two roles cannot create
  competing windows for the same form in the same term. That is load-bearing for this
  decision and must not be relaxed.

**Rejected alternatives**

| Alternative | Why not |
|---|---|
| `tech_admin` only, per ARCHITECTURE §5 | Contradicts the user story the feature exists to satisfy, and fails outright during a CBL Art. VI §4.4.1 vacancy — mid-April, which is inside recruitment season. |
| `crrd_admin` only, per PRD US-B4 | Cleaner on paper, but the CTO is the one who runs the rollover that creates the term the window hangs off, and locking them out of the adjacent row buys nothing. It also makes a genuine emergency (CCDO unreachable, period must close) require a migration. |
| Add `moderator` as well | Defensible on CBL Art. IV §6.2.2, and it is where this may end up. Not now: turning on the system's only anonymous write path is a chief-level act, and this is the direction that is cheap to reverse. |
| Leave it unpoliced and open windows by hand in SQL | This is the status quo the PRD's problem statement is about. An operation with no screen is an operation the next officer cannot perform. |

---

## Verification

- `supabase/tests/023_terms_rls.sql` asserts that `crrd_admin` at `aal2` and `tech_admin` at
  `aal2` each affect one row on an `application_windows` INSERT, that either at `aal1`
  affects zero, and that `exec_admin`, `moderator`, `officer`, `regional_rep`, `member` and
  `anon` all affect zero.
- `supabase/tests/041_applications_anon_insert_rls.sql` (S3) asserts the downstream property
  this ADR must not disturb: an anonymous INSERT succeeds inside an open window and raises
  42501 once `closes_at` is in the past.
- `026_policy_invariants.sql` asserts that neither new policy names `officer` or
  `regional_rep`.
