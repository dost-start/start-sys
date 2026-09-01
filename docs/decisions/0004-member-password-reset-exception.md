# ADR 0004 — Members reset their password with an emailed code alone

**Date:** 2026-09-02
**Author:** START-SYS build, S2 MFA lane (BUILD_PLAN S2-T38)
**Status:** Accepted
**Affects:** `lib/auth/reset-actions.ts`, `app/(auth)/auth/reset/page.tsx`, `lib/auth/route-access.ts` (`requiresMfa`), `supabase/migrations/0014_rls.sql` (the `aal2` write predicates)

---

## Context

The PRD states the 2FA requirement twice, and the two statements are not the same rule.

**PRD MVP item 2** scopes *enrolment*: "TOTP enrolment mandatory for every account **above Member
tier**. 2FA required to complete a password reset."

**US-A4** then states the reset rule and, in its third criterion, carves out the same tier
explicitly:

> Members — who hold no organizational data — reset by emailed one-time code alone; **this
> exception is documented, not implicit.** *[extrapolated: risk-proportionate reading of the PDF's
> blanket 2FA rule]*

So the exception is the PRD's own, and this ADR exists because the PRD demands that it be written
down somewhere a reviewer can reject it, rather than discovered as an `|| role === 'member'` in an
action.

The source PDF's Security NFR says only "2FA is required when resetting passwords", without
qualifying by tier. Taken literally that would mandate TOTP enrolment for ~600 scholars.

## Decision

**A password change requires an `aal2` session, except for the `member` tier, which may change its
password on an `aal1` session established by a recovery link.**

Enforced in two independent places:

1. `app/(auth)/auth/reset/page.tsx` re-reads `getAuthenticatorAssuranceLevel()` **server-side** and
   renders the TOTP challenge before the password form for every role where `requiresMfa(role)` is
   true.
2. `lib/auth/reset-actions.ts` re-asserts the same predicate **before** calling
   `supabase.auth.updateUser`, so invoking the action directly — without ever loading that page —
   is refused. The unit test asserts the `updateUser` spy count is **0** in the denied case; a
   check placed after the write would pass a "returns unauthorized" test and still be worthless.

`requiresMfa(role)` returns `false` for `member` and `true` for the other six tiers. It is the one
place the tier split is expressed; both checks above read it rather than restating it.

## Why the exception is proportionate

- **A member account holds no organizational data.** Its RLS surface is its own `people` row, its
  own membership, and form submissions. Taking one over yields the victim's own record — which the
  attacker, holding the victim's mailbox, is already positioned to obtain by other means.
- **Every account that can reach *another person's* data is above Member tier**, and every one of
  those is covered by the rule with no exception.
- **The cost of the alternative is a failure mode, not just friction.** Mandating TOTP for ~600
  scholars means ~600 enrolments, ~600 lost-phone recovery paths, and a `tech_admin` re-enrolment
  queue during application season staffed by one student officer. The predictable outcome is
  members who cannot log in at all — a worse security posture than the one being avoided, because
  the workaround becomes an officer resetting accounts by hand.
- **The database backstop is unaffected.** The privileged write policies carry
  `(auth.jwt() ->> 'aal') = 'aal2'` regardless of what any of this code does (pgTAP 031). A member
  session cannot write `user_roles`, `terms` or `application_windows` at aal1 or at aal2, because
  the role predicate refuses it first.

## Consequences

- **A member's mailbox is a single factor for that member's own account.** Accepted, and stated
  plainly rather than left as an unexamined default.
- **A member who is later promoted to an officer role does not silently keep the exception.**
  `requiresMfa` reads the live role from `user_roles` on every request, so the promotion takes
  effect on the next request — the same instant-revocation property the whole role model rests on.
- **Widening this exception to any other tier requires a new ADR**, and would need the `aal2`
  predicates in `0014_rls.sql` revisited in the same PR, because the middleware and the policies
  would then disagree.
- **PRD §8 lists this among the marked extrapolations**, so a reviewer can reject it without
  hunting: "Members reset passwords by emailed one-time code rather than TOTP (US-A4)."

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Mandatory TOTP for all 600+ members | Contradicts PRD item 2's explicit "above Member tier" scope; produces a lockout and re-enrolment burden that one student officer cannot carry during application season. |
| Email OTP as a *second* factor for members, on top of the recovery link | Both factors are the same mailbox. It reads as two factors and is one — worse than the honest single factor, because it invites the belief that the account is protected. |
| No password reset for members at all (officer-mediated) | Puts ~600 scholars' credential resets in a queue owned by a graduating student. The handover cost the PRD's problem statement is about. |
