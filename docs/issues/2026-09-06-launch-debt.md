# 2026-09-06 — Launch debt: what must be true before START-SYS holds one real scholar's record

**Status:** Open — every item is a **launch blocker**, not a backlog entry
**Severity:** High in aggregate. Individually ranked in the tables below.
**Owner:** project heads (Danielle Quiambao, Ethan Baltazar) for items 1, 2, 6, 7 and 9;
`tech_admin` (CTO) for items 3, 4, 5 and 8
**Raised by:** BUILD_PLAN S7-T1, and extended by S7-T8/S7-T11 (ADR 0008) and S7-T15
**Related:** [ADR 0008](../decisions/0008-sentry-sdk-deferred.md),
[ADR 0005](../decisions/0005-document-store-fallback.md),
[`docs/RUNBOOK.md`](../RUNBOOK.md),
[`docs/runbooks/03-CREDENTIAL_ROTATION.md`](../runbooks/03-CREDENTIAL_ROTATION.md)

---

## Why this file exists

The seven-day window built a system. It did not provision an organization.

Almost everything below is cheap **today** and expensive **later**, and the reason is the
same in every case: each one is a piece of ownership. Right now there are few accounts, no
real data and two people who remember why. After launch there are nine vendor consoles, ~600
scholars' personal data, and an annual handover to officers who were not in the room. Moving a
Vercel project between accounts before it has a production deployment is a five-minute task;
doing it after, with DNS, environment variables and a live application period, is an outage
someone has to schedule.

**The single most important line in this file:** the system must not collect a real
applicant's data until items 1, 2, 3 and 6 are done. Everything the build can enforce, it
enforces — RLS with FORCE on every table, no DELETE policy anywhere, an append-only audit log
with values masked before they are written, consent captured against an immutable notice
version. **None of that substitutes for a Data Protection Officer, an executed processing
agreement, or a backup that has an owner.** No document in this repository claims RA 10173
compliance, and this file is why.

---

## 1. Every console is owned by a personal identity ⚠️ **highest**

**Blocks:** everything. **Owner:** project heads. **OQ-9, OQ-10.**

`ARCHITECTURE.md` §10 makes this the first line of the handover document:

> every console — Vercel, Supabase, GitHub, Resend, GCP, Cloudflare, Backblaze, Sentry,
> Better Stack, Bitwarden — is created under an **org-owned account** (`sys@<org domain>`),
> **never a student's personal Gmail.**

Today that is false for every console that exists, because there is no org domain to create
`sys@` under (OQ-10) and no org payment method to attach (OQ-9).

| Console | State today | Migration cost after launch |
|---|---|---|
| GitHub | personal account; repository under a personal namespace | Transfer + re-point Vercel + re-issue Actions secrets |
| Vercel | personal account, preview deployments only | Project transfer; DNS and env re-entry; a deploy freeze |
| Supabase | **not provisioned** — CI-ephemeral Postgres only (see item 3) | n/a if done right the first time |
| Google Cloud / Drive | **not provisioned** (OQ-1 unresolved) | Re-consent + re-key + a document copy job |
| Resend, Cloudflare, Backblaze B2, Better Stack, Sentry, Bitwarden | **not provisioned** | n/a if done right the first time |

**The asymmetry to act on:** most of these do not exist yet, which is the cheapest possible
moment. GitHub and Vercel are the two that already carry personal ownership, and they are the
two to move first.

**Done when:** an org domain exists; `sys@`, `cto@` and `files@` identities exist under it;
every console listed above is owned by one of them; an org payment method is attached; and all
credentials are in the Bitwarden Teams vault with a rotation owner named in runbook 03.

---

## 2. No Data Protection Officer, no NPC registration, no executed DPAs ⚠️ **highest**

**Blocks:** collecting any real applicant data. **Owner:** project heads. **OQ-2, OQ-8.**

This is **organizational work that engineering cannot do on the org's behalf**, and it is the
reason nothing in this repo claims compliance.

| Deliverable | State | Blocked on |
|---|---|---|
| DPO designated | **not done** — `/privacy` names the CCDO as *interim* contact | an org decision |
| Registered with the National Privacy Commission | **not done** | the DPO designation; an external filing that takes weeks |
| DPAs executed with each processor (Supabase, Vercel, Resend, Google, Backblaze, Sentry, Better Stack) | **none executed** | a DPO and an authorised org signatory |
| Retention clock start date signed off | **not decided** (OQ-8) | project heads |
| Data-privacy training for members (CBL Art. VIII §6) | **not done** | project heads |

**What is built and tested, so that the gap is precisely located:** sensitive-column
classification as data; column GRANTs plus `v_member_directory`; RLS enabled *and forced* on
every table with no DELETE policy anywhere; an audit log whose sensitive values are masked
before they are written, so the log is not itself a PII store; an audit row for every
proof-document view; the CBL Art. VIII §7 confidentiality-acknowledgement gate on every
sensitive read; the five-year purge on both sides of the document boundary; the error-event
scrub (item 4); consent captured at collection against an immutable notice version; and a
pre-drafted 72-hour breach notification.

**The mechanisms are built. The paperwork has not started.** Those are different things and
this file will not blur them.

⚠️ **`/privacy` must match reality.** Its retention sentence must state the same rule
`redact_expired_pii()` implements, and its processor list must name the document store that is
actually active — `GET /api/health/drive` reports the live driver for exactly this reason
(ADR 0005). A notice that misstates where personal data lives is worse than no notice.

---

## 3. No Supabase project exists; Tier-1 backups therefore do not exist

**Blocks:** any deployment holding real data. **Owner:** CTO. **S7-T15.**

Every migration in `supabase/migrations/` has only ever been applied to the **ephemeral
Postgres CI spins up per run**. There is no hosted project, no `SUPABASE_DB_URL`, and no
`.github` secret to put it in.

Two consequences, and the second is the one that gets missed:

- **`ARCHITECTURE.md` §8 specifies two independent backup tiers.** Tier 1 is Supabase's own
  daily automated backup, which **exists only on the Pro plan**. Free has no automated backups
  at all, and auto-pauses after 7 days idle — and this system is idle for months between
  application periods, so a pause would show up as downtime in the very availability figure
  S7-T6 exists to report. **On Free, PRD item 17 is met by one tier, not two.**
- **The nightly B2 dump (Tier 2) fails loudly today, by design.** `scheduled.yml` preflights
  its secrets and exits non-zero naming this file rather than skipping. That is correct: a
  backup job that is quietly green while writing nothing manufactures confidence in a restore
  that will not work, and nobody discovers it until the day they need it.

⚠️ **If `DOCUMENT_STORE=supabase_storage` (ADR 0005 cost 3): storage objects are NOT included
in `supabase db dump`.** Without an object-sync step in `scheduled.yml`, every proof-of-
enrollment document falls outside the Backup & Recovery NFR entirely, with nothing failing to
say so.

**Done when:** a Pro project exists in `ap-southeast-1` under org ownership; Tier-1 retention
is recorded in runbook 02; `SUPABASE_DB_URL` and the B2 credentials are in GitHub Actions
secrets and Bitwarden **and nowhere else** — never as Vercel environment variables, because
that URL bypasses RLS entirely; the nightly job has run green; and a restore has been drilled
by someone who did not write the script (US-J4 — an untested backup is not a backup).

---

## 4. The Sentry SDK is not installed — there is no error tracking in production

**Blocks:** nothing from launching; **guarantees** that a production failure is invisible.
**Owner:** CTO. **See [ADR 0008](../decisions/0008-sentry-sdk-deferred.md).**

`ARCHITECTURE.md` §1 locks `@sentry/nextjs` 10.x. It is deferred because the SDK wraps
`next.config.ts` and hooks the build, on the last build day, for a service with no project to
send to (item 1).

**What ships instead, and what it does not cover:**

- ✅ `lib/observability/scrub.ts` — the six-rule PII scrub, 104 assertions, wired into
  `instrumentation.ts` so that `deliver` is the only exit and it is the caller of `scrubEvent`.
  There is no path from a raw event to a transport.
- ✅ `reportError` is the API call sites already use, so adopting the SDK moves no call site.
- ❌ **No aggregation, no deduplication, no alerting on an application exception.** A failure
  in the Drive upload or the proof proxy is invisible unless a person reports it. Better Stack
  covers `/api/health` only; the scheduled jobs alert on their own failure only.
- ❌ No browser-side reporting at all.
- ❌ The hand-built envelope POST in `postEnvelope` has never been exercised against a real
  ingest endpoint. **Verify it by hand once** if the DSN is switched on before the SDK lands.

**Done when:** ADR 0008's three adoption steps are complete, `beforeSend: scrubEvent` is wired,
Session Replay is confirmed **off**, and `scrub.integration.test.ts` is green against the SDK
path.

---

## 5. The Content-Security-Policy does not enforce

**Blocks:** nothing; leaves a real gap. **Owner:** CTO. **S7-T11, ADR 0008.**

`next.config.ts` sends the full policy as **`Content-Security-Policy-Report-Only`**, with only
`frame-ancestors 'none'` enforcing.

The reason is the upload flow: the browser PUTs proof bytes **directly** to Google or Supabase
Storage (Vercel caps request bodies at 4.5MB; a Certificate-of-Registration photo exceeds it),
so a `connect-src` wrong by one origin breaks the highest-risk flow in the system, in a real
applicant's browser, where no test here would catch it. Report-Only cannot break it and
produces the violation reports that make enforcement safe.

`script-src 'unsafe-inline'` is tolerable **only** while the header does not enforce. Nonce
work and enforcement must land **together** — a nonce CSP that is not enforcing buys nothing,
and an enforcing CSP with `'unsafe-inline'` buys almost nothing.

**Done when:** middleware mints a per-request nonce; the policy is built per response; the
6MB-upload E2E flow passes against a deployed build on Chromium, WebKit and Firefox; and the
header is promoted from Report-Only.

---

## 6. Google Drive is unresolved (OQ-1), so where documents live is undecided

**Blocks:** the first real document upload. **Owner:** project heads → CTO. **ADR 0005.**

No Google Cloud project, no service account, and no confirmation the org has a Workspace
tenant supporting Shared Drives — the Workspace for Nonprofits base tier does **not** include
them. The fallback (`DOCUMENT_STORE=supabase_storage`) is implemented, tested and its bucket
migrated, so the swap is one environment variable.

⚠️ If Drive is used via an org-owned `files@` account rather than a Shared Drive, **the OAuth
consent screen must be moved from Testing to In production.** Refresh tokens issued in Testing
expire after **7 days**, so the integration would die silently every week — the single most
likely way this feature breaks after handover.

**Done when:** OQ-1 is answered; the active driver is confirmed by `GET /api/health/drive`; and
the privacy notice, processing register and DPA register all name that driver (item 2).

---

## 7. Email is not provisioned — no domain, no DKIM/SPF/DMARC, no Resend

**Blocks:** v1.1 outreach and, before that, **auth email today**. **Owner:** project heads. **OQ-10.**

Supabase's built-in mailer is rate-limited to a couple of messages per hour and is unusable in
production, so invitations, password resets and MFA mail all depend on Resend as custom SMTP —
which depends on a verified domain, which depends on item 1.

⚠️ **Without SPF, DKIM and DMARC on `mail.<org domain>`, acceptance emails land in spam and the
application flow fails _silently_** — which is worse than failing loudly, because nobody is
told.

**Cost note for the calendar, not for now:** Resend's free tier is 3,000/month but **hard-capped
at 100/day**, so a single 600-person acceptance blast is impossible on it. Pro is $20/month with
no daily cap; the plan is to upgrade for the ~2 months of application and renewal season and
cancel afterwards (~$40/yr). This belongs in runbook 01 as a term-start calendar item.

---

## 8. Uptime monitoring is not provisioned, so the availability figure has no source

**Blocks:** the Availability NFR being a number rather than a claim. **Owner:** CTO. **S7-T6.**

`/api/health` exists and runs a real `SELECT` through `health_ping()`; nothing polls it. Until
Better Stack has two monitors matching on **both** the 200 **and** `"status":"ok"` in the body
— a 200 carrying an error body must count as down, or the figure is measuring the CDN — there
is no uptime figure to report and no alert on an outage.

**Done when:** two monitors from two regions are UP for 60 unbroken minutes; a **test alert**
has actually arrived on the CTO's phone and in Discord; and the confirmation is pasted into
`docs/uptime/2026-09.md` with a timestamp.

---

## 9. ~~`DEV_DISABLE_MFA` is set on the demo deployment~~ ✅ **RESOLVED 2026-09-10** — ⚠️ **REOPENED 2026-09-11, see item 13**

> **Superseded.** This was closed on 2026-09-10 and deliberately reversed on 2026-09-11: the
> project head turned 2FA off org-wide, in both layers (`DEV_DISABLE_MFA=1` plus migration
> `0065`, which forces `has_aal2()` true). **Item 13 is the current state**; everything below
> describes the position on 2026-09-10 and is kept as the record of what "resolved" meant.

> **Closed.** The flag is removed from the Vercel Production *and* Preview scopes, and all
> six accounts hold a verified TOTP factor (`scripts/enrol-demo-mfa.mjs`). Signing in now
> lands on `/auth/mfa/verify` before any org data is reachable.
>
> **It was not only a security gap — it was breaking the product silently.** `has_aal2()`
> guards writes to `user_roles`, `terms`, `application_windows`, `rr_region_grants` and
> `privacy_notice_versions`, and an aal1 session gets `HTTP 200, 0 rows affected` rather
> than an error. Measured on 2026-09-10, same account, same statement:
>
> ```
> aal1 -> application_windows write: 0 row(s) affected
> aal2 -> application_windows write: 1 row(s) affected
> ```
>
> So assigning a role, opening the application period and running a term rollover had
> never worked through the app on this deployment; the window was only ever opened with
> the service-role key. Enrolment fixed that as a side effect. PR #27 separately made
> `assignRole` report the refusal instead of saying "Updated."
>
> Enrolment was done BEFORE the flag was removed, so nobody was locked out at any point —
> including the CTO, who is the only role that can hand out roles.

Original entry follows.

### ~~`DEV_DISABLE_MFA` is set on the demo deployment~~ ⚠️ ~~must be unset before real data~~

**Blocks:** PRD MVP item 2 / US-A3 — TOTP enrolment mandatory above Member tier.
**Owner:** CTO. **Added 2026-09-03 at the project heads' request, for demo ergonomics.**

Trying seven role tiers meant seven authenticator enrolments, which made the demo
unusable. `DEV_DISABLE_MFA=1` switches off the middleware's mandatory-TOTP gate so an
above-Member account signs in with a password alone. It is set in the Vercel Production
scope of the **scratch demo project** (`krizhwugzrnlkxsixnde`), which holds no real
scholar data.

Scope of the flag, precisely:

- It reaches **one** `if` in `middleware.ts`. Nothing else reads it.
- The database is untouched. `has_aal2()` still guards `user_roles`, `terms`,
  `application_windows`, `rr_region_grants` and `privacy_notice_versions`, so an aal1
  session cannot write any of them. **Consequence while the flag is set: role
  assignment and opening/closing an application window silently do nothing** — an RLS
  refusal is zero rows affected, not an error. That is the security model holding.
- US-A4 is untouched: `/auth/reset` still demands the second factor before a
  privileged password change, because the reset page reads `requiresMfa` directly.
- Default is ON, and only the exact string `"1"` disables it — `"true"`, `"yes"` and a
  half-written value all fail closed (`route-access.test.ts` asserts each one).

**Done when:** the variable is absent from every Vercel scope on the org's real project,
and an above-Member account is confirmed to hit the enrolment screen there. Deleting the
env var and redeploying is the whole revert; no code change.

---

## 11. The scheduled jobs have never run — `APP_BASE_URL` was never set ⚠️ **RA 10173**

**Found 2026-09-09 (PR F), in QA of the org deployment.** An aborted application run left
exactly the state the nightly sweep exists to clear: a `draft` row holding a real
birthdate, address and contact number, plus two 7.4MB uploaded objects with no database
pointer to them, because the upload succeeded and `finalizeApplication` never did.

`purge_abandoned_drafts()` (migration `0020`), its renewal counterpart (`0044`), the orphan
reconciliation pass and the job endpoint at `/api/jobs/purge-abandoned-drafts` all exist and
are complete. **Nothing calls them.** `.github/workflows/scheduled.yml` reads `APP_BASE_URL`
and `JOB_SHARED_SECRET` from repository secrets, and neither has ever been set on
`dost-start/start-sys`.

The failure mode is the quiet kind. The job fails its own preflight and exits non-zero — by
design, it never skips silently — but if nobody is watching the Actions tab, the visible
symptom is nothing at all. Meanwhile the privacy notice tells every applicant, in writing,
that *"an application you start but do not finish is cleared after 30 days"*, and it is not.
That is a published RA 10173 retention commitment the system is not keeping.

**The fix is two repository secrets and one manual dispatch**, spelled out with the exact
commands and the three things to check in the run log in
`docs/runbooks/03-CREDENTIAL_ROTATION.md` → "`APP_BASE_URL` — not a secret, and that is
exactly why it was missed".

⚠️ **Set the host to the LIVE deployment.** The org moved from `start-sys.vercel.app` to
`start-sys-pi.vercel.app`, and to a new Supabase project, on the same day. A stale
`APP_BASE_URL` sweeps the *old* project and returns a healthy 200; the job now prints the
host it swept precisely so that a wrong sweep and a clean one are not the same log.

Once this is set, verify the same day that the aborted QA run's draft and its two orphaned
objects are gone. That is the check that proves the wiring, not the green run.

---

## 12. Migrations are pushed by hand, and three documents claimed otherwise

**Found 2026-09-09,** when PR #22 merged seven migrations (`0053`–`0059`) to `main` and the
live schema did not move. `ARCHITECTURE.md` §8 stated *"Migrations apply automatically on
merge to main"*, and `DATA_MODEL.md` and `CLAUDE.md` repeated it. None of it was true:
`ci.yml` runs on push to `main` but only against an ephemeral container, and neither workflow
file contains `supabase db push`, `supabase link`, or a deploy step. Nothing in CI holds a
credential for the production database.

The documents are corrected and `docs/RUNBOOK.md` now carries the real sequence. **The
automation itself is still owed**, and it is worth building rather than living with:

- **The failure mode is silent and ordered.** Deploying before the schema is pushed leaves the
  app calling columns and functions that do not exist. It surfaces as a form refusing to save,
  never as anything naming a missing migration.
- **It depends on one person remembering, at the moment they are most likely to be tired** —
  the end of a merge, often late, often the same person who wrote the change.
- **It is exactly the class of undocumented manual step the handover NFR exists to remove**
  (PRD Success Metric 7: an incoming officer completes the work from runbooks alone).

What it needs: a `deploy.yml` gated on `ci.yml` going green, with `SUPABASE_ACCESS_TOKEN` and
the project ref as repository secrets. Related debt: the database password currently lives
only in the CTO's macOS Keychain (item 1), so today nobody else could run the manual push
either.

---

## 13. Two-factor authentication is switched OFF org-wide ⚠️ **highest**

**Decision:** project head (Ethan), 2026-09-11 — *turn 2FA off for now, re-implement soon.*
**Owner:** CTO. **Supersedes item 9, which closed this same gap on 2026-09-10.**

Two changes, one in each layer, so the app actually works rather than failing silently:

- `supabase/migrations/0065_disable_second_factor_temporarily.sql` makes `public.has_aal2()`
  `select true`. Every predicate that gates on it — `is_user_roles_writer()` and the write
  policies on `user_roles`, `terms`, `application_windows`, `rr_region_grants`,
  `privacy_notice_versions` — therefore stops requiring a second factor.
- `DEV_DISABLE_MFA=1` on Vercel turns off the middleware gate (`mfaGateEnabled()`).

Middleware alone would not have been enough: `has_aal2()` guards WRITES at the data layer,
so an aal1 session gets `HTTP 200, 0 rows affected` on role assignment, opening the
application window and rollover — the exact silent breakage item 9 documented.

### ⚠️ What this costs, stated plainly

The 2026-09-11 QA found that **MFA was the only thing standing between a password and real
scholar PII**, because the database has no aal2 check on any PII-returning RPC
(`get_member_record`, `get_application_detail`, `list_region_member_contacts`,
`resolve_recipients`) and none on most privileged writes. With 2FA off, **a password alone
reads and writes real member data through PostgREST.**

That is only survivable if the password half is closed, and **as of 2026-09-11 it is not, by
decision**: the six demo accounts' passwords were committed to this **public** repo before
2026-09-11 and remain valid on the production project, and the project head has decided the
demo accounts **stay as they are** rather than being rotated or deleted.

**So this is an accepted risk, recorded rather than mitigated.** With 2FA off in both layers
and those credentials recoverable from this repository's history, an account holding
`exec_admin` or `crrd_admin` on the production project can be reached by anyone who reads
the repo, and those roles read and write real scholar PII — birthdates, addresses, contact
numbers — under RA 10173. Nothing in the code prevents it; the only remaining controls are
that the accounts are not advertised and that the audit log attributes every read.

Two ways to close it whenever the decision changes, in order of cost:

1. **Rotate or delete the six accounts** on the production project. Cheapest, no code.
2. **Re-enable 2FA** (the revert below), which restores the second factor as the barrier.

Until one of them happens, treat any `VIEW_RECORD` / `VIEW` / `VIEW_CONTACTS` audit row from
a demo account as worth checking, and do not widen what those roles can reach.

### What was parked, and what moved

| Parked / changed | Why |
|---|---|
| `supabase/_parked/0064_second_factor_backstop.sql` | The aal2 backstop (restrictive write policies + definer wrappers on the PII and decision RPCs). Written 2026-09-11, deliberately **not** applied. |
| `supabase/_parked/031_aal2_rls.sql` | The pgTAP suite proving aal1 writes are refused. Its subject is off, so it is parked verbatim rather than inverted. |
| `022_identity_rls.sql` | The `tech_admin at aal1 cannot write user_roles` assertion removed; `plan()` 32 → 31. |
| `023_terms_rls.sql` | Two aal1 expectations flipped from refusal to success, each labelled ⚠ TEMPORARY. |

### Re-enable (the whole revert)

1. New migration restoring the 0014 body verbatim:
   `select (select auth.jwt() ->> 'aal') = 'aal2';`
2. Re-home `_parked/0064_second_factor_backstop.sql`, renumbered to follow it.
3. Re-home `_parked/031_aal2_rls.sql`; revert the 022/023 edits above.
4. Remove `DEV_DISABLE_MFA` from every Vercel scope; confirm every account holds a verified
   TOTP factor **before** removing it, so nobody is locked out (the 2026-09-10 order).

**Done when:** either 2FA is back on, or the demo accounts are gone and no account can reach
PII with a password alone.

---

## 10. Open questions that gate real data

Restated from `PRD.md` §7 with only the launch-gating subset. Each is a fact about the
organization, not an engineering unknown — **none can be closed by editing a document.**

| OQ | Question | Gates |
|---|---|---|
| **OQ-1** | Shared Drive tenant, or the `files@` OAuth fallback? | item 6; the first real upload |
| **OQ-2** | Who is the DPO; will the org register with the NPC? | item 2; `/apply` going live |
| **OQ-8** | Does the five-year clock start at term end, record creation, or last active term? | item 2; the privacy notice's wording |
| **OQ-9** | Who holds the budget and the org payment method? | item 1. *A ~$400/yr subscription on a student's personal card fails at the first graduation — a likelier cause of system death than any technical risk here.* |
| **OQ-10** | Does the org own a domain, and what is it? | items 1, 7 |
| **OQ-13** | Break-glass or handover gate for the single-occupancy `tech_admin` seat? | the first rollover. CBL Art. VI §4.4.1 expressly permits the CTO seat to sit empty in the 45 days before term end — i.e. across the exact window rollover runs. |
| **OQ-18** | Who collects the confidentiality acknowledgements, and when? | the first rollover. On the morning a term opens nobody has signed, so **every sensitive read fails** — correct behaviour, and it needs an owner who can unblock it inside a day. |

---

## The order to do these in

1. **OQ-10 and OQ-9** — domain and payment method. Everything else is downstream of these two.
2. **Item 1** — org identities; move GitHub and Vercel before they carry production.
3. **Item 3** — the Supabase Pro project, then the nightly backup green, then a drilled restore.
4. **Item 2** — DPO, NPC registration, DPAs. The long pole; start it in parallel with 1 and 3.
5. **Items 6 and 7** — document store and email, both downstream of item 1.
6. **Item 8**, then **items 4 and 5** — monitoring, then error tracking, then CSP enforcement.
7. **Item 9** — unset `DEV_DISABLE_MFA`. Last, because it is one env var and no code, but
   it must happen before the first real account exists, not after.

Items 1–3 and 6 are the set that must be complete **before one real scholar's record enters
this system.**
