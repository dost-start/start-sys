# 2026-09-05 — Forced sign-out on a terminal membership status is NOT implemented (US-H4 deferred)

**Status:** Open — deferred to v1.2, and blocked on a documented contradiction between two authority documents
**Severity:** Medium (a real access-revocation gap, bounded by the access-token lifetime)
**Owner:** project heads (to resolve the contradiction) → then the v1.2 lifecycle slice
**Raised by:** BUILD_PLAN S5-T19, dropped per that task's own risk row

---

## Symptom

Setting a membership to `graduated`, `resigned`, `left` or `terminated` correctly changes what
the database will return to that person on their **next request** — but it does **not** end
their **current** sessions. A member who resigns at 10:00 keeps a working access token until
it expires.

`DATA_MODEL.md` §3.1 says the terminal transitions trigger
`auth.admin.signOut(user, 'global')` "in the same Server Action". `PRD US-H4` requires that
"setting status to Graduated, Resigned or Left **ends the user's active sessions**", and
`US-D5` requires the same of a termination. **Neither is implemented.** No code calls
`signOut`, and nothing in `supabase/migrations/0028_membership_status_transitions.sql` or
`lib/members/actions.ts` attempts to.

## Impact

Bounded, and worth stating precisely rather than either alarming or dismissing.

**What already works without any sign-out.** Roles are read live from `public.user_roles` per
statement by `auth_role()` — never stamped into the JWT, which is the whole reason
`ARCHITECTURE.md` §5 rejects a Custom Access Token Hook. So the moment a membership goes
terminal:

- the member portal's RLS requires an `active` membership in `current_term_id()` and returns
  nothing;
- `people_read`'s member branch still matches their own row, so they can see themselves and
  nobody else;
- every write path was already closed to the `member` tier.

**What does not work.** The stale token remains *valid as a session* for up to the access-token
lifetime (one hour, per `ARCHITECTURE.md` §5). During that window the person can still load
authenticated shells and any screen whose contents are not themselves RLS-empty. They gain no
organizational data — that is a policy boundary, not a session one — but the literal words of
US-H4 are not met, and a member who was **terminated by an Executive Board vote** under
CBL Art. VII §3 keeps a live session for an hour after the ruling is recorded. That is the
case that makes this Medium rather than Low.

**What is NOT affected.** Officer-tier access. `user_roles` is the live access-control answer
and is read per statement, so revoking a role takes effect on the very next request with no
sign-out at all — asserted in `supabase/tests/032_revocation_rls.sql`.

## Cause — a genuine contradiction between two authority documents, not an oversight

Ending a session requires `auth.admin.signOut()`, which requires the **service-role** client.
That client is confined to one file by an ESLint `no-restricted-imports` rule, and the two
documents that define its permitted use disagree:

- **`CLAUDE.md`, banned patterns:** *"Never import the service-role client outside
  `lib/server/admin-client.ts`. **It exists for the invite flow and the backup job only.**"*
  A membership status change is neither.
- **`CONVENTIONS.md` §10, drift trap 5,** shows the correct removal of a member as exactly
  this:
  ```ts
  await supabase.from('memberships').update({ status: 'resigned' }).eq('id', id);
  // …and in the same action: await adminAuth.signOut(userId, 'global')
  ```
  — i.e. it shows the service-role client being used for precisely this purpose, in the
  document's own worked example of the *right* way.

`DATA_MODEL.md` §3.1 and `ARCHITECTURE.md` §4.3 both assume the `CONVENTIONS.md` reading.
`CLAUDE.md` is the working contract and its enumeration is explicit.

This lane will not resolve a contradiction between two authority documents by picking one,
and it will not edit the ESLint rule — `CLAUDE.md` says *"if you find yourself editing that
rule, stop and ask."* Implementing it silently would widen the documented blast radius of the
most dangerous credential in the system (`ARCHITECTURE.md` §5: it exists in exactly one file)
without an ADR and without anyone deciding to.

## Fix (deferred to v1.2)

`PRD §3` places full access revocation in **v1.2 item 30 / US-H4**, alongside term rollover
and renewal, so the deferral is scope-aligned rather than convenient. Three things are needed,
in order:

1. **A project-head decision** on which document wins. The likely answer is that
   `CLAUDE.md`'s list gains a third permitted use, which is a one-line edit to an authority
   document and therefore a decision, not a refactor.
2. **ADR 0009**, recording the widened purpose of `lib/server/admin-client.ts` with its
   Context / Decision / Consequences / Date / Author, merged **before** the code
   (`CONVENTIONS.md` §9 D3).
3. **The implementation**: one narrowly-typed export from `lib/server/admin-client.ts` — the
   key never leaves that file, so the ESLint rule is untouched — called from
   `updateMembershipStatus` for `graduated | resigned | left | terminated` and **never** for
   `renewal_pending → active`. Plus the matching update to `ARCHITECTURE.md` §5's
   service-role paragraph in the same PR.

Two design notes for whoever picks this up:

- **`terminated` needs it most and is the easiest to get wrong.** It is the only status the
  Executive Board decides (CBL Art. VII §3.2.3) and the only one with a reversal edge
  (US-D6). The sign-out must fire on `→ terminated` and must **not** fire on
  `terminated → active`, or a successful appeal would log the reinstated member out of the
  session they were just given back.
- **The renewal carve-out must survive.** `PRD US-H4`: a person whose membership ended keeps
  access to the renewal form and nothing else. That is `renewal_submissions`' own policy
  (`ARCHITECTURE.md` §4.3), not an exception inside the sign-out — signing them out globally
  is compatible with it, because they log back in and the policy is what admits them.

## Prevention

The gap is recorded in three places rather than left to be discovered:

- this file;
- the header of `supabase/migrations/0028_membership_status_transitions.sql`, under "WHAT
  THIS FILE DELIBERATELY DOES NOT DO";
- `BUILD_PLAN.md`'s "Scope honesty" table, which already lists session revocation as
  deferred with the contradiction named.

`supabase/tests/060_membership_transitions.sql` asserts every transition this slice *does*
enforce and asserts nothing about sessions — so no test in the suite implies a guarantee the
system does not make.
