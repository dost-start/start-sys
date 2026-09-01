# 2026-09-02 — Multi-lens QA hunt: confirmed findings and fixes

**Method.** Six parallel review lenses (RLS boundary, application security, SQL
correctness, TS correctness, frontend integrity, CLAUDE.md banned-pattern sweep) over the
whole repo, every raw finding then adversarially verified by two independent reviewers
instructed to refute it (default-refuted when uncertain). 58 agents; 17 findings refuted,
9 confirmed. Every confirmed finding below is fixed in the same branch.

## Confirmed and fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | critical | `startApplication` used `.insert().select()` → `INSERT … RETURNING`; Postgres applies SELECT policies to the returned row, `applications` deliberately has **no anon SELECT policy** (anti-enumeration, 0008 §5), so **every real public submission raised 42501** — laundered into "The application period is not open". The pgTAP suite could not see it: its inserts carried no RETURNING. | Application id minted client-side (`crypto.randomUUID()`), plain INSERT, no `.select()`. Regression encoded: pgTAP 041 test 1b now asserts an anon `INSERT … RETURNING` **raises** 42501. |
| 2 | medium | Open redirect: `startsWith("/") && !startsWith("//")` admits `/\evil.example`, which browsers resolve off-origin (backslash = slash in authority position). Two independent copies (login action, TOTP verify client). | One shared allowlist `lib/auth/safe-next.ts` — rejects backslashes and accepts only what the URL parser itself keeps on a placeholder origin. Both call sites now delegate. |
| 3 | critical | 0035's `submitted_has_consent` CHECK + consent-immutability trigger invalidated every pre-existing non-draft application fixture (pgTAP 041/042/043/045/047/067, review-fixtures, Vitest race seed, Playwright review seed). | All fixtures now record consent **at the draft INSERT** (the production shape — the trigger stamps server values); promote UPDATEs no longer touch consent. |
| 4 | high | pgTAP 061 declared `plan(35)` with 34 assertions — and the missing one was the header's own "officer memberships update affects zero rows". | The missing assertion added (not the plan lowered): officer UPDATE on `memberships` affects exactly 0 rows via the missing-policy mechanism. |
| 5 | medium | `privacy_notice_versions` v1 seeded a sha256 that did not match `docs/privacy/PRIVACY_NOTICE.md` (the notice was edited after the migration hashed it) — "which text did this applicant agree to" would be recorded falsely. | Digest recomputed and updated in 0035 + pgTAP 093; a CI step now diffs the migration's digest against the file's live hash so the two can never drift silently again. |
| 6 | high→medium on verify | A *scheduled* window (opens_at in the future) was reported as "already open" by `openApplicationWindow`. (The claimed close/reschedule deadlock was refuted — Close cancels a scheduled row — but the message misled.) | The conflict message now distinguishes scheduled from open; both state the Close-then-Open escape hatch. |
| 7 | medium | `getPublicWindowState` treated row presence as "open" — correct for anon (policy-filtered) but a **signed-in** visitor to `/apply` reads through the authenticated policy (`using (true)`) and would see a live form for a closed window. | Timestamps now compared in the query too; the anon policy remains the enforcement. |
| 8 | medium | Audit-log keyset pagination ordered by `(created_at desc, id desc)` but paged with `.lt(id)` — out-of-order commits could silently skip rows across a page boundary. | Ordering switched to `id desc` alone (bigserial = insertion order on an append-only log), coherent with the id cursor. |
| 9 | high | `database.types.ts` missing the three 0032 dashboard views (and later additions) — fails the types-drift gate. | Resolved by replacing the hand-drafted file with the CI-generated artifact (types-drift job uploads it on failure) once the schema settled. |

Independently of the hunt, the pgTAP suite's first full CI run caught one more production
bug worth naming here: `lpad(seq::text, 3, '0')` **truncates** — member 1000 of a join
year would have been minted `2024-100`, colliding with member 100. `allocate_member_id()`
now pads below 1000 and passes the sequence through verbatim from 1000 up, exactly what
the `^\d{4}-\d{3,}$` CHECK always intended. A second: under `SET search_path = ''`,
citext's `=` operator (schema `extensions`) is unresolvable, so `approve_application()`'s
returning-scholar email match silently degraded to case-sensitive — `Liza@` vs `liza@`
minted a second person and a second member ID, the exact failure US-C4/US-H5 exist to
prevent. The match now uses `lower(…::text)` on both sides, with the reason in a comment.

## Refuted (17)

Recorded so the next reviewer does not re-litigate them; each was killed by two
independent verifiers with file:line evidence. Highlights: the storage-bucket SELECT
policy is not an unaudited bypass (path structure + RLS keeps it inert); the orphan sweep
does not delete mid-submission uploads (finalize follows the PUT within the same async
fn); `reject_write_to_archived_term()` does not fail open; recovery codes are redeemable;
the AAL gate is not middleware-only (pgTAP 031's aal2 write predicate is the backstop);
`rejected_has_reason`'s NULL pass-through is unreachable because the decision surface is
the RPCs alone (status is not in any UPDATE grant).

**Prevention.** The two production bugs the *suite* caught (lpad, RETURNING) both got
permanent assertions. The consent-fixture class now has the CI digest guard. The findings
themselves came from adversarial multi-agent review — the same shape as the BUILD_PLAN's
"verify the red" discipline, applied to code instead of tests.
