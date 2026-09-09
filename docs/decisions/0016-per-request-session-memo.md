# ADR 0016 — The session context is memoised per request, and the middleware read stays

**Date:** 2026-09-09
**Status:** Accepted
**Supersedes nothing.** Refines the performance note in `ARCHITECTURE.md` §8.

## Context

After the database moved from `ap-southeast-2` (Sydney) to `ap-southeast-1` (Singapore) on
2026-09-09, a warm `db_latency_ms` fell from 214–281 to 24–26 and `/apply` TTFB from
2.0–3.6s to 0.33–0.54s. That removed the dominant cost. What it exposed was the next one:
**an authenticated page makes the same authorization reads several times before it renders
anything.**

Counted on `/system/user-roles`, the worst case:

| Where | `auth.getUser()` | `user_roles` read |
|---|---|---|
| `middleware.ts` | 1 | 1 |
| `app/(admin)/layout.tsx` | 1 | 1 |
| `app/(admin)/system/layout.tsx` | 1 | 1 |
| `app/(admin)/system/user-roles/page.tsx` | 1 | 1 |

Eight network round trips, ~200ms, before a byte of HTML exists — to answer one question
four times. `auth.getUser()` is not a local decode: it revalidates against the auth server,
which is exactly why the codebase uses it instead of `getSession()`.

Three things were on the table.

## Decision

**1. Memoise `getSessionContext()` per request with React `cache()`. Done.**

One render, one answer. The three RSC callers collapse to a single pair of round trips.
This does not weaken instant revocation, which is the reason the role is read live at all
(`ARCHITECTURE.md` §5): the memo lives for one render of one request, and the next request
reads `user_roles` again. It is arguably *more* correct — a role revoked mid-render can no
longer leave a layout and its page disagreeing about who is calling.

It is also not a security boundary and does not pretend to be. RLS re-evaluates
`auth_role()` per statement regardless of what this function returns.

**2. The middleware read STAYS. Deliberately not removed.**

Middleware runs in a separate context from the RSC render; its result cannot be handed to
the render without smuggling it through a request header, and a header the app trusts for
authorization is a header an attacker will try to set. Middleware is where the "no page but
`/apply` without login" redirect happens (PRD US-A1), and it needs the role to decide
`canAccess()`. Two round trips there is the honest price of that redirect.

**3. Local asymmetric JWT verification is REJECTED for now, and it is the one worth
re-reading later.**

Supabase's asymmetric signing keys allow `getClaims()` to verify a token locally, removing
the `getUser()` round trip in both middleware and the render. It is genuinely faster. It is
rejected today for the same reason the Custom Access Token Hook was rejected in
`ARCHITECTURE.md` §7: a locally-verified token is only as fresh as its own lifetime, and
this system's whole premise is that graduation, resignation and impeachment revoke access
*now*. Verifying the token locally would still be safe if the `user_roles` read stayed —
that read is what actually carries the revocation — but it is a change to the auth path,
which is the one path in this codebase where being wrong is unrecoverable, and it is not
worth spending on the week of a reviewer walkthrough.

**Revisit when:** the org has real scholar data and a measured page-load problem that this
memo did not fix. The change is confined to `lib/supabase/middleware.ts` and
`lib/auth/queries.ts`, and it needs its own pgTAP-adjacent proof that a revoked role still
loses access on the next request.

## Consequences

- `getSessionContext` is now a memoised function object rather than a plain `async
  function`. It is still awaited identically at all 36 call sites; nothing else changed.
- Server Actions each run in their own request, so `withRole()` gets a fresh read every
  time. That is correct and is not affected by this memo.
- The remaining floor for an authenticated page is four round trips (two in middleware, two
  in the render), down from six to eight.
- Anyone measuring this again should measure `/api/health`'s `db_latency_ms` first. If it
  is above ~50ms warm, the database has moved region again and no amount of memoising will
  matter — that was the actual bug on 2026-09-09.
