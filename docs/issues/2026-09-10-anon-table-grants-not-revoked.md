# 2026-09-10 — `anon` holds SELECT on three tables it does not need (open)

**Status:** OPEN. Attempted, reverted, and left with the evidence — the fix is not the
one-line hardening it looks like.
**Severity:** low. **Nothing leaks today and nothing ever did.**
**Raised by:** QA 2026-09-10, ISSUE-011.

---

## The finding

Supabase grants ALL on every new table in `public` to `anon` and `authenticated` by
default. `0015_grants.sql` revoked that for `people` and `member_id_counters`, and revoked
DELETE everywhere — but three tables created in `0004`, `0006` and `0007` never had their
SELECT taken back:

| Table | Anon probe, 2026-09-10 |
|---|---|
| `memberships` | `200 []` |
| `user_roles` | `200 []` |
| `confidentiality_acknowledgements` | `200 []` |

RLS holds. No policy names `anon`, so every one returns zero rows. Contrast `people` and
`email_campaigns`, which return `401 42501` because the GRANT is gone.

## Why it looked worth fixing

A missing GRANT fails closed at the **privilege** layer, before a policy is consulted. A
present GRANT with no policy fails closed only for as long as the policy set stays
correct. One future policy widened a clause too far becomes reachable **by an anonymous
caller** on `user_roles` (who holds which role) or `confidentiality_acknowledgements` (who
may read PII). With the GRANT gone, the same mistake is a 401 to a stranger and a bug for a
logged-in user.

## Why it was reverted

Revoking the GRANT changes **observable behaviour for `anon` from "zero rows" to
`42501 permission denied`** — and four pgTAP files assert the current behaviour, including
the role matrix:

```
ERROR: permission denied for table memberships
ERROR: permission denied for table user_roles

tests/022_identity_rls.sql              planned 32, ran 18
tests/024_memberships_rls.sql           planned 39, ran  9
tests/028_role_matrix_rowcounts.sql     planned 155, ran 142
tests/040_anon_surface_grants.sql       planned 24, ran  4
```

`028_role_matrix_rowcounts.sql` is the file ARCHITECTURE.md calls the most important
artifact in the repo. Its anon row is `is(count, 0, …)`, which is a **statement about the
security model**, not an incidental assertion — and changing it to `throws_ok('42501')` is
a deliberate revision of what the model promises, not a mechanical test fix.

Two things made doing that here the wrong call:

1. **It is a contract change, not hardening.** `040`'s own header already documents that
   zero-rows-rather-than-42501 is deliberate for `applications` (anti-enumeration). Whether
   the same reasoning should extend to these three deserves a decision, not a migration
   that happens to make CI green.
2. **It could not be verified locally.** Docker is not installed on the machine this was
   attempted from, so `pnpm test:rls` cannot run and every attempt is a round trip through
   CI. Rewriting the role matrix by trial and error against a remote runner is exactly how
   an assertion gets weakened to pass.

## What doing it properly looks like

On a machine with Docker, in one change:

1. `revoke select, insert, update on public.{memberships,user_roles,confidentiality_acknowledgements} from anon;`
2. Update the anon expectations in `022`, `024`, `028` and `040` from "zero rows" to
   `throws_ok('42501')` — and read each one first, because a couple of them are asserting
   the *model*, not the plumbing.
3. Leave `applications` and `audit_log` alone. `0027:216-226` asserts anon's SELECT on
   `applications` at migration time and `0008`'s header explains why: a duplicate
   submission must stay indistinguishable from a first one. Revoking either turns the
   anti-enumeration design into an oracle.
4. `pnpm test:rls` green locally before pushing.

## Meanwhile

Nothing is exposed. The protection is RLS rather than the privilege layer, which is the
same protection every other table in the schema relies on — this would have been belt as
well as braces, not braces where there were none.
