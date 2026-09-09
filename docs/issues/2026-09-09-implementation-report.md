# 2026-09-09 — Implementation report: PR A through PR F

Companion to [`2026-09-09-ui-review-bug-plan.md`](./2026-09-09-ui-review-bug-plan.md), which
holds the findings and the evidence. This file is what actually changed, what was verified
and how, and what is still owed.

**Scope:** the reviewer notes from CJ, Danielle and Aira (`Chat S2026 05003 START SYS.pdf`)
plus the QA pass against `https://start-sys-pi.vercel.app`, worked through as PRs A–F.

---

## Verdict, up front

| PR | State | Notes |
|---|---|---|
| **A** — bug pack (A1–A10) | **shipped** | Includes the credential-leak fix |
| **B** — audit log readable by CRRD | **shipped** | `0053` + ADR 0015. **Needs the migration applied before it takes effect.** |
| **A9** — Special Advisor | **shipped** | Enforced in the database (`0054`), not just hidden |
| **C1** — optional social links | **shipped** | `0055` |
| **C2** — PSGC address cascade | **BLOCKED** | psa.gov.ph refuses scripted download. The university half shipped under PR E. |
| **D** — draft autosave | **shipped** | + privacy notice `v3` (`0056`) |
| **E** — performance | **shipped** | Three code items; the region move already fixed the big one |
| **F** — orphan reconciliation | **code was already complete** | The gap is two GitHub secrets only Ethan can set |
| Design / canvas | untouched | Needs canvas approval first, per the 2026-09-08 rule |

Local gate green: `pnpm typecheck`, `pnpm check`, `pnpm test` (**885 passing**),
`pnpm build`, `node scripts/audit-client-bundle.mjs` (PASS).

**Not runnable on this machine: `pnpm db:lint` and `pnpm test:rls`** — there is no Docker
here, so migrations `0053`–`0056` were never applied to a Postgres locally. CI ran both
against an ephemeral database on [PR #22](https://github.com/dost-start/start-sys/pull/22).

**CI is green on all four jobs**, second run: `db` (supabase lint + the full pgTAP suite +
the member-ID race), `e2e` (Playwright smoke), `js`, and `types-drift`.

The first run found six failures and every one of them was an expected count this branch's
own additions had moved — worth recording, because they are the checks earning their keep:

- `028` and `033` — `sensitive_column_registry` is 26 rows, not 23 (`0055` registers three).
- `093` — three privacy notice versions, not two, and the server now stamps `v3` over a
  client-supplied `v0` (`0056`).
- `e2e` — **the interesting one.** A4's visually-hidden " (required)" changes each required
  field's *accessible name*, which is what `getByLabel` matches on, so `/^sex$/`,
  `/^province$/`, `/^university$/` and `/^program$/` stopped matching and the spec failed
  three helpers later as a bounced submission rather than at the field it could not find.
  The four matchers lost their trailing `$` and kept the leading anchor, which is the half
  actually doing work. The claim in `field.tsx` that e2e was unaffected was wrong and is
  corrected there.

`068`, `075` and `021` — the audit-log widening and the Special Advisor narrowing — passed
on the **first** run, as did `types-drift` against the hand-edited `database.types.ts`.

---

## PR A — the bug pack

### A1 — the login form could put a password in the URL ⚠️ the serious one

`components/auth/login-form.tsx` rendered a `<form>` with no `method`. A submit that lands
before React hydrates does the HTML default — a **GET** — so the credentials go into the
address bar, browser history, the `Referer` of the next navigation, and the hosting
provider's access log. Observed live during QA as:

```
/login?email=demo.ccdo%40start-sys.test&password=ccdo123
```

This is what Aira described as the login "acting strange" on a slow connection.

**Fixed:** `method="post"`, so the pre-hydration fallback posts to a page route with no POST
handler and fails with a 405 — loud, and with the credentials in the body where they belong.
The submit button is additionally disabled until hydration, but that is UX: a keyboard Enter
can submit a form whose button is disabled, so the attribute is the actual guarantee.

**Applied to every other JS-handled form too**, because the same defect was everywhere and
the payloads are worse than a password on some of them: password reset, TOTP enrol and
verify, the invite dialog, the member edit form, both reject dialogs, both officer dialogs,
and — carrying a birthdate, an address and a contact number — `/apply` and `/renew`.

Verified in the browser: `document.querySelector('form')` on `/login` now reports
`method: "post"`.

### A2 — `/audit` 404'd for CRRD, and the CTO had no link at all

`ADMIN_NAV_LINKS` was role-agnostic, so CRRD saw a link the policy would never serve; the
`tech_admin` set had no Audit entry although that tier has held the read since `0014`.
Resolved together with PR B: the policy widened to CRRD, and `TECH_ADMIN_NAV_LINKS` gained
the link. Verified: signed in as `demo.ccdo`, `/audit` now renders instead of 404ing.

### A3 — no pointer cursor

Tailwind v4's reset leaves `button` at `cursor: default`. Added `cursor-pointer` to the
`Button` base and to the native `<select>` (also a click target, also missed). The checkbox
already had it. Verified: `getComputedStyle(submit).cursor === "pointer"`.

### A4 — required fields carried no asterisk

`FieldLabel` gained a `required` prop: a red `*` that is `aria-hidden`, paired with
visually-hidden `(required)` text — so a screen reader hears the word rather than "star",
and every `getByLabel("First name")` in `e2e/` still matches because the substring is
unchanged. Applied to all 19 required fields on `/apply` and `/renew`.

Verified live: 11 labels on step 1 carry the asterisk and the screen-reader text; the two
genuinely optional ones still read `(optional)`.

### A5 — `facebook.com/name` was refused

The check demanded a scheme nobody types. New `lib/validation/social.ts` normalizes first
(adds `https://` when there is no scheme, resolves a protocol-relative paste) and validates
second, by parsing with `URL` and checking the host — so `facebook.com/juan` is accepted and
stored absolute, while `twitter.com/juan`, `facebook.com.evil.example/juan` and
`javascript:alert(1)` are all still refused. Shared by `/apply` and the member edit form, so
a link CRRD can type is a link CRRD can save.

### A6 — award years offered 2016–2026

Replaced the "ten years back from now" helper with a **rolling five-year window that turns
over on 1 July**, computed in Asia/Manila (`lib/validation/award-year.ts`). It rolls forward
by itself — nobody edits a constant next July.

The bounds are read **inside** the zod refine rather than captured at module load, because a
warm Vercel function can outlive a turnover and a module constant would keep offering last
season's window until the next deploy.

Verified live: the select offers exactly **2026, 2025, 2024, 2023, 2022**. Unit tests pin
2027-06-30 (old window), 2027-07-01 (new window), and the Manila-vs-UTC boundary at
`2027-06-30T16:00Z`.

### A7 — the contact address was on a domain the org does not own

`crrd@start-dost.org` appeared in the footer, the privacy notice, the success screen and
both closed-window screens. START-DOST does not own `start-dost.org` (OQ-10), so mail to it
never arrived and an applicant needing a typo fixed concluded they were ignored.

It is now **derived from the mail environment at request time** (`lib/brand/org-contact.ts`,
`server-only`): `MAIL_REPLY_TO`, else `GMAIL_SMTP_USER`. That means the address a scholar is
told to write to is the address the org actually reads, by construction — and it follows the
org automatically if it moves to a domain.

Verified live: the footer now renders **`startdost.community@gmail.com`**.

`ORG_SOCIAL_LINKS` exists and is **empty**. The footer renders nothing while it is empty
rather than showing dead icons. **Still owed: the exact Facebook / Instagram / LinkedIn
URLs.** A guessed link on the org's own footer sends scholars to somebody else's page.

### A8 — copy

- Consent now says "START-DOST", not "START-DOST CRRD" — the organization is the personal
  information controller; naming a department invites Danielle's exact question.
- The five-year retention sentence now states its basis inline: *"the retention period
  START-DOST applies under the Data Privacy Act of 2012 (RA 10173), and is then deleted."*
- Login drops "Officer accounts are created by invitation." and gains a link to `/apply`.
  It is not a signup affordance and the wording avoids every word `e2e/login.spec.ts` greps
  for — verified: `bodyHasSignup: false`.
- Public form headings to Title Case ("Personal Information", "Review & Submit"). The admin
  screens keep sentence case; mixing the two in one app is what actually read as untidy.

### A9 — Special Advisor removed from the CRRD picker

Ethan: *"CRRD cannot assign that."* The Constitution agrees twice — Art. X §3.1 makes the
Special Advisor a DOST-SEI employee rather than a member, and Art. X §2.4–2.5 makes them the
**independent** reviewer of appeals against the disciplinary outcomes CRRD records. A tier
that can seat its own appeal reviewer is not being reviewed independently.

**Enforced in the database**, not hidden: migration `0054` narrows
`officer_assignments_insert` / `_update` so `crrd_admin` is refused on that one position
while keeping every other seat as ADR 0012 left it. The row still renders and `exec_admin`
still seats it — deleting the position would make a seat the CBL creates unrecordable.

Verified live as `demo.ccdo`: the Special Advisor row shows "Executive Admin only" with no
Appoint control, while other vacant rows keep theirs.

### A10 — submit could hang on "Finishing up…" forever

The finalize call could **reject** rather than resolve — a redeploy invalidates the
build-scoped Server Action id, and a dropped mobile connection does the same — and every
error branch tested `isErr(result)` on a value that never arrived. Nothing reset the phase.

New `lib/applications/call-action.ts` wraps both public-form Server Actions: it catches the
rejection, imposes a 45-second deadline, and returns an ordinary `ActionResult` failure the
existing branch already handles. A visible error appears with Submit right below it.

**Retry resumes rather than restarts.** The documents are already uploaded and the submit
token is still held, so pressing Submit again re-runs finalize — which is idempotent on the
same token. Calling `startApplication` again would have created a *second* draft holding the
same person's PII plus another pair of orphaned objects.

The rejection itself is never logged: framework error text can carry the request body, and
this form's body is a scholar's birthdate, address and contact number.

---

## PR B — the audit log opens to CRRD

Migration `0053` drops and recreates `audit_log_read` with `crrd_admin` added.
`canReadAuditLog()` mirrors it. **ADR 0015** records the decision — including the objection
in `0014`'s own comment ("the watched read the watcher"), kept rather than deleted.

What makes it survivable is that **immutability did not move**: no INSERT, UPDATE or DELETE
policy for any tier, the GRANT-level revocations stand, and `mask_sensitive()` still redacts
every registered column before the row is written — so widening the *read* widens no PII. A
CRRD officer can now see the record of their own document view; they still cannot remove it.

pgTAP flipped in three files: `021_reference_rls`, `028_role_matrix_rowcounts`,
`068_audit_read_matrix`. `068` asserts **both** CRRD fixtures against the captured total,
including `crrd_deputy` — a second `crrd_admin` seeded deliberately without a confidentiality
acknowledgement, which proves audit read is gated on the tier alone and does not accidentally
inherit the CBL Art. VIII §7.1 precondition. It should not: the log holds no PII to
acknowledge for.

`PRD.md` US-I1 and `ARCHITECTURE.md` §8 are amended in the same change rather than left to
contradict the schema.

⚠️ **`/audit` shows an empty table for CRRD until `0053` is applied.** The app-side gate is
open; the policy still refuses. That is the expected interim state and it resolves when CI
applies the migration.

---

## PR C1 — optional social links

`instagram_account`, `github_account`, `linkedin_account` on `people` (`0055`), optional,
beside the required `facebook_account`.

**The generic "add a link, pick a type" repeater stays rejected**, and the reason is
recorded in the migration: `sensitive_column_registry` is keyed `(table, column)`. Rows in a
child table would be sensitive by *value*, so audit masking and the five-year purge would
both need a second bespoke mechanism, and "register the column in the same migration" would
stop meaning anything for this data.

All three are registered sensitive, ungranted by `0015`, absent from `v_member_directory`,
and added to the Sentry scrub list in the same pass — a registered column missing from that
list is masked in the audit log but **not** in an exception.

The RR contact view is deliberately **not** widened: ADR 0011 scoped it to email, contact
number, Facebook and university, and adding to it is a privacy decision for the team.

Three functions were replaced with the new keys added in the same shape as
`facebook_account`: `approve_application()`, `update_member_record()`, `approve_renewal()`.
Each body was **extracted verbatim** from `0041`/`0045` and patched, so the diff against
those files is exactly the added lines and nothing accidental.

The payload contract went 15 → 18 keys; `schema.test.ts` transcribes the SQL independently
and asserts set equality, and `MEMBER_PATCHABLE_KEYS` (19 → 22) is parsed straight out of
`0055` so it cannot drift from the function's own whitelist.

⚠️ **`database.types.ts` was hand-edited**, mirroring the generator's alphabetical
Row/Insert/Update output, because there is no local Postgres to regenerate from. CI's
`types-drift` job is the check — if any of it is wrong, that job goes red and names it.

---

## PR C2 — the PSGC address cascade: BLOCKED

**psa.gov.ph still answers 403 to a scripted request** (re-checked 2026-09-09 with a browser
user-agent; unrelated hosts answer 200 from the same machine). There is no dataset to load.

**This will not be worked around.** The alternatives are to fabricate ~44,000 barangay rows
or to pull them from an unofficial mirror and pin it as the org's authoritative national
geography. Both are worse than waiting: a wrong barangay list type-checks, renders, and
passes every test in this repo, then surfaces years later as a scholar whose address does
not exist.

**Needed:** the PSGC publication downloaded once by hand, dropped in the repo with its
release date. The migration is generated from it.

**What shipped instead**, being the same pattern and needing no new data: the university
select is now filtered by the region chosen on the same step (see PR E). PR C2 extends that
shape rather than replacing it.

---

## PR D — draft autosave

`localStorage`, per Ethan's call. Restores on mount, saves debounced, cleared on submit and
by a visible **Clear the saved draft** button on the form.

**What is deliberately never saved**, each a decision rather than a limitation:

- **The two documents.** A `File` cannot be serialized, and storing the bytes would put a
  Certificate of Registration on what may be a shared campus PC.
- **The consent boxes.** RA 10173 requires an affirmative act at collection. Restoring a
  ticked box *is* pre-ticking it.
- **The member ID on `/renew`** — with the email on file, it is the credential that
  authorizes a renewal.

Every read and write is wrapped: a private window, blocked site data or a preview context
means "no draft", never a broken form. Expired, malformed and unreadable entries are
**deleted** on the way out, not merely ignored.

**Disclosed in the privacy notice**, which is a new version (`v3`, migration `0056`), because
`privacy_notice_versions` is append-only by design — the applicants who ticked the box under
v2 consented to *those bytes*. The digest guard in CI was checked by hand and matches.

That version also **corrects a real error**: the notice said the uploaded documents live in
START-DOST's Google Drive. They do not and never have on this deployment —
`DOCUMENT_STORE=supabase_storage` while OQ-1 is open, so they are in the same Singapore
project as the database. A privacy notice that misstates where personal data lives is a
defect in the notice.

Verified live: typed into `/apply`, reloaded, fields restored, notice changed to "We restored
what you had already filled in on this device", and the stored JSON contained **no** consent
keys.

---

## PR E — performance

The big one was already fixed on 2026-09-09 by rebuilding the database in `ap-southeast-1`:
warm `db_latency_ms` **214–281 → 24–26**, `/apply` TTFB **2.0–3.6s → 0.33–0.54s**. What that
exposed was the next layer.

**1. The session context is now memoised per request** (React `cache()`). Every admin screen
called `getSessionContext()` from its layout *and* its page — and `/system/*` from a nested
layout as well — each making two round trips (`auth.getUser()` revalidates against the auth
server, then a `user_roles` read). Eight round trips, ~200ms, to answer one question four
times. Now one.

It does not weaken instant revocation, which is why the role is read live at all: the memo
lives for one render of one request. It is arguably more correct — a role revoked mid-render
can no longer make a layout and its page disagree about who is calling.

**ADR 0016** records the two things deliberately *not* done: the middleware read stays
(smuggling its result through a header the app trusts for authorization is worse), and local
asymmetric JWT verification is rejected for now, with the conditions to revisit it written
down.

**2. Reference reads are memoised per process** (`lib/applications/reference-cache.ts`). The
18 regions, 445 universities and 13 programs change only in a migration, which is a deploy,
which starts a new process — yet every anonymous `/apply` hit paid three round trips for
them. `getPublicWindowState()` is deliberately **not** cached: that is the one read whose
answer is allowed to change between two requests, and caching it is exactly the bug the
page's `force-dynamic` exists to prevent. An empty or thrown load is never cached, so a
transient blip cannot become five minutes of an unfillable form.

**3. The university select is filtered by the chosen region**, and the region now renders
first on step 2. 445 `<option>` elements (~27KB of markup, shipped twice) down to the ~20 for
one region, and it is the cascade Ethan asked for. A university chosen under a previous
region is cleared when the region changes, so the form cannot submit a school from a region
the applicant moved away from.

Verified live: before a region is chosen the select is disabled and reads "Choose your region
first…"; after picking NCR it holds 72 schools.

`e2e/apply-with-upload.spec.ts` was reordered to pick the region first, with a note saying
the order is now load-bearing.

---

## PR F — orphan reconciliation

**Investigated and closed on the code side.** The endpoint is complete: it redacts abandoned
application *and* renewal drafts, deletes each stored document, then runs a real orphan pass
against every ref the database still references — including the `noa_*` columns and
`renewal_submissions`, the two a naive version would delete as false orphans.

**The entire gap is operational.** `.github/workflows/scheduled.yml` reads `APP_BASE_URL` and
`JOB_SHARED_SECRET` from repository secrets and **neither has ever been set** on
`dost-start/start-sys`. The job fails its preflight — by design it never skips silently — but
if nobody watches the Actions tab the visible symptom is nothing at all, while the privacy
notice promises in writing that an unfinished application is cleared after 30 days.

**Ethan has to close this**; I cannot set a GitHub secret and should not. Exact commands and
the three things to check in the run log are in `docs/runbooks/03-CREDENTIAL_ROTATION.md`,
and it is item 11 of the launch-debt issue.

One code change did land: **the job now prints the host it swept.** The org moved deployment
*and* Supabase project on the same day; a stale `APP_BASE_URL` sweeps the old project and
returns a healthy 200, and without that line a wrong sweep and a clean one produce identical
logs.

---

## Migrations added

| | |
|---|---|
| `0053_audit_log_crrd_read.sql` | `audit_log_read` gains `crrd_admin` (ADR 0015) |
| `0054_special_advisor_exec_only.sql` | `SPECIAL_ADVISOR` narrows back to `exec_admin` (CBL Art. X) |
| `0055_optional_social_accounts.sql` | Three optional social columns, registered sensitive; three functions replaced |
| `0056_privacy_notice_v3.sql` | Privacy notice `v3` — storage correction + the device-draft disclosure |

⚠️ **Deploy order matters.** `0055` must be applied **before** the app is deployed. The
member edit form now sends the three new keys, and the pre-`0055` `update_member_record()`
refuses an unknown patch key with `22023`. The repo's normal order already does this —
CI applies migrations on merge to `main`, and the Vercel deploy is a separate manual step
afterwards — but do not reverse it.

## Decisions recorded

- **ADR 0015** — CRRD Admin reads the audit log, with the overruled objection kept
- **ADR 0016** — per-request session memo; the middleware read stays; local JWT verification
  rejected for now, with revisit conditions

## Also fixed along the way

- `pnpm test` was collecting a stale agent worktree under `.claude/` — a second copy of the
  suite plus zod's internal tests, reporting ~13 failures unrelated to the working tree.
  Excluded in `vitest.config.ts`; `eslint .` was OOM-crashing on the same directory and now
  ignores it; `.claude/` is gitignored.
- `server-only` is stubbed for Vitest (`test-stubs/server-only.ts`), which is what makes a
  server-only module's logic testable at all. The guard is enforced by the bundler at build
  time and by `scripts/audit-client-bundle.mjs`; Vitest never produces a client bundle.

---

## Still owed by Ethan

1. **The social URLs** — exact Facebook / Instagram / LinkedIn. `ORG_SOCIAL_LINKS` is one
   array; nothing else changes. Blocks the visual half of A7.
2. **The two GitHub secrets** — `APP_BASE_URL` (the **live** host) and `JOB_SHARED_SECRET`.
   Until then abandoned drafts keep their PII against a published retention promise.
3. **The PSGC workbook**, downloaded by hand. Blocks PR C2 entirely.
4. **Confirm `DOCUMENT_STORE=supabase_storage`** is set on the org deployment — the privacy
   notice now states it as fact.
5. **Delete the Sydney project** `krizhwugzrnlkxsixnde` once the org deployment is confirmed;
   it still holds the reviewers' real test submissions and their uploaded documents.
