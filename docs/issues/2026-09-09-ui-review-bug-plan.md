# 2026-09-09 — UI review findings and the fix plan

**Sources.** (1) `Chat S2026 05003 START SYS.pdf` — reviewer notes from CJ, Danielle and Aira
against the deployment of commit `2ac84de`. (2) A QA pass I ran the same day against
`https://start-sys-pi.vercel.app` on commit `5e932d7`, after the database moved to
`ap-southeast-1`.

**Status — updated 2026-09-09, end of the implementation pass.**

| | |
|---|---|
| **PR A** — bug pack (A1–A10) | **shipped** |
| **PR B** — audit log readable by CRRD | **shipped** (`0053`, ADR 0015) |
| **PR C1** — optional social links | **shipped** (`0055`) |
| **PR C2** — PSGC address cascade | **BLOCKED** — see below. The region → university half shipped under PR E. |
| **PR D** — draft autosave | **shipped** (+ privacy notice `v3`, `0056`) |
| **PR E** — performance | **shipped** (the three remaining code items) |
| **PR F** — orphan reconciliation | **code was already complete; the gap is two GitHub secrets.** Documented, and the job now logs which host it swept. |
| **A9** — Special Advisor | **shipped**, and enforced in the database (`0054`), not only hidden |
| Design / canvas items | untouched — they need the canvas approval, per the rule set 2026-09-08 |

Local gate green on every commit: `pnpm typecheck`, `pnpm check`, `pnpm test` (885
passing), `pnpm build`, and `scripts/audit-client-bundle.mjs`. **`pnpm db:lint` and
`pnpm test:rls` could NOT be run** — this machine has no Docker, so there is no local
Postgres to apply `0053`–`0056` against. CI runs both against an ephemeral database; the
pgTAP expectations that had to move are listed under each PR below.

---

## What the QA pass already proved works

Verified end to end on the org deployment, new Singapore project:

| step | result |
|---|---|
| `startApplication` | 200, 1.6s |
| two 7.4MB PUTs direct to Supabase Storage | 200, 7.1s and 8.6s |
| `finalizeApplication` | 200 |
| applicant screen | "Application received" |
| stored row | `proof 7736747 image/jpeg · noa 7736747 · verified true` |
| stored objects | both `7736747B image/jpeg` |
| consent | `v2`, server-stamped |
| reviewer path | `/applications` → detail → proxy `200, 7742943B` → `VIEW_DOCUMENT · crrd_admin` in `audit_log` |

`7736747` is the exact byte count of the source file, so the size came from provider
metadata rather than the browser's claim, and 7.4MB reached storage without passing
through a Vercel function. The 4.5MB body cap is genuinely bypassed (BUILD_PLAN S3-T19).

Members reads 28 on the new database against 29 in the reviewers' screenshots, which is
how the cutover was confirmed.

---

## PR A — bug pack, no database ✅ shipped

| # | Finding | Root cause | Source |
|---|---|---|---|
| A1 | **Login form can put a password in the URL** | `components/auth/login-form.tsx` renders a `<form>` with no `method` and no `action`. Submitting before React hydrates does a native GET, and the observed URL was `…/login?email=demo.ccdo%40start-sys.test&password=ccdo123`. The password then lives in the address bar, browser history, the `Referer` of the next navigation and Vercel's access logs. Reachable whenever someone submits fast on a slow connection — which is what Aira described. Fix: `method="post"`, and keep submit disabled until hydrated. | QA pass |
| A2 | `/audit` 404s for `crrd_admin` | `components/layout/nav-links.ts:7` — `ADMIN_NAV_LINKS` is role-agnostic, so CRRD is shown a link the `audit_log_read` policy will never serve. Also `TECH_ADMIN_NAV_LINKS` has no Audit entry at all, so the CTO can read the log and has no way to reach it. **Superseded in part by PR B** — CRRD gains read access, so this becomes "add the link for tech_admin, keep it for CRRD". | PDF p4 + QA |
| A3 | No pointer cursor on any button | `components/ui/button.tsx:15` — the base `cva` string has no `cursor-pointer`, and Tailwind v4's reset leaves `button` at `cursor: default`. Whole app. | PDF p5–p7 |
| A4 | Required fields carry no asterisk | `components/ui/field.tsx:13` — `FieldLabel` marks `optional` but never marks required. One primitive covers every form. | PDF p4 (Danielle, Aira) |
| A5 | `facebook.com/name` rejected | `lib/applications/schema.ts:63` and `lib/members/schema.ts:50` require a scheme. Normalize by prepending `https://` before the regex; `https://twitter.com/x` must still fail. | PDF p1 |
| A6 | Year of award offers 2016–2026 | `components/applications/academic-section.tsx:54` returns `current-10`; `AWARD_YEAR_MIN` is 2000. Wanted: a rolling five-year window that turns over on **1 July** — `windowEndYear = (today ≥ Jul 1) ? year : year − 1`, `min = end − 4`. 2026 → 2022–2026; 2027-07-01 → 2023–2027 with no code edit. | PDF p1 + Ethan 2026-09-09 |
| A7 | Contact address is a domain the org does not own | `lib/brand/org.ts:15` `crrd@start-dost.org`, rendered on `application-closed`, `application-success`, `renewal-closed` and the footer. Replace with the real Gmail addresses plus Facebook / Instagram / LinkedIn. **Blocked on exact URLs from Ethan.** | PDF p1 |
| A8 | Copy | Consent line says "START-DOST CRRD" → "START-DOST" (`consent-section.tsx:60`), and states the five-year retention without its basis — add that it is the RA 10173 period (Danielle asked why). Login loses "Officer accounts are created by invitation." and gains a link to `/apply` for lost applicants. Section titles to title case. | PDF p1–p3 |
| A9 | Special Advisor in the CRRD position picker | Hide `SPECIAL_ADVISOR` for `crrd_admin`, keep it for `exec_admin` — removing it everywhere would make a CBL Art. III §2.9 seat unrecordable. The seeded position row is untouched. | PDF p3 + Ethan |
| A10 | Submit hangs with no error path | When `finalizeApplication` fails, the screen sits on "Finishing up…" forever. Observed live when a deploy landed mid-flow and the Server Action POST 404'd. Needs a timeout, a visible error and a retry that does not lose the form. | QA pass |

---

## PR B — audit log readable by CRRD ✅ shipped

Ethan's decision, 2026-09-09, against the note in `0014_rls.sql:235` which excludes CRRD
deliberately ("the watched read the watcher"). Ships as a cited decision, not a quiet edit.

- `0053_audit_log_crrd_read.sql` — drop and recreate `audit_log_read` adding `crrd_admin`.
  No INSERT/UPDATE/DELETE policy, ever; append-only stays at the GRANT level.
- `lib/audit/queries.ts:121` `canReadAuditLog` gains `crrd_admin`.
- pgTAP `068_audit_read_matrix`, `028_role_matrix_rowcounts`, `021_reference_rls` assert
  crrd_admin sees **exactly 0** audit rows today — those flip to the full count.
- ADR `0015-crrd-reads-audit-log.md`, plus the PRD US-I1 line and ARCHITECTURE §5/§8.

---

## PR C1 — optional social links ✅ shipped

`facebook_account` stays required. Add optional `instagram_account`, `github_account`,
`linkedin_account`. Rejected alternative: a generic "add a link, pick a type" repeater.

Each is a contact channel, so each gets a `sensitive_column_registry` row, is nulled by
`redact_expired_pii()`, and is masked in the audit log — the treatment `facebook_account`
already has. The RR contact view keeps Facebook only (ADR 0011 scope) unless asked.

---

## PR C2 — addresses become a PSGC cascade ⛔ blocked

Replaces the typed City and Province fields:

```
Region ▾ → Province ▾ → City / Municipality ▾ → Barangay ▾    then typed: street, postal code
```

NCR collapses to three levels (no provinces; PSGC puts districts there and no Manila
resident thinks in districts). **Home and current address**, with a "same as home" box.

- Source: PSA PSGC, fetched and pinned with its release date. **PSA blocks automated
  fetch (403 even with a browser UA)** — fallback is Ethan downloads the workbook once.
- ~18 regions, ~82 provinces, ~1,650 cities, **~42,000 barangays**, loaded with
  `COPY … FROM stdin`. The browser only ever receives the children of the selected
  parent. Anon-readable, like `regions` already is.
- `people` gains PSGC code columns beside the existing name columns, so exports, mail
  merge and the RR contact view need no join and a later PSGC rename cannot rewrite
  history.
- Touches `approve_application`, `approve_renewal`, `update_member_record`,
  `get_member_record`, **`redact_expired_pii`**, `sensitive_column_registry`, the
  `APPLICATION_PAYLOAD_KEYS` parity test, three forms, pgTAP, e2e, `database.types.ts`.
- Backfill: exact normalized matches only (`City of Manila` ≡ `Manila`), unique hit
  required, ambiguous left null with a printed report. Old rows have no barangay stored,
  so the backfill can only ever fill province and city.

### Why this is blocked, and what it is blocked ON

**psa.gov.ph still answers 403 to a scripted request** (re-checked 2026-09-09 with a
browser user-agent; unrelated hosts answer 200 from the same machine, so it is the PSA
refusing automation, not a network problem). There is no dataset to load.

**This will not be worked around.** The alternatives are to fabricate the rows or to pull
them from an unofficial mirror and pin it as the org's authoritative national geography.
Both are worse than waiting: a wrong barangay list is invisible to every test in this repo
— it type-checks, it renders, the cascade works — and surfaces years later as a scholar
whose address does not exist. Which mirror (if any) is trustworthy is a data-quality call
for the project head, not an implementation detail.

**What is needed:** the PSGC publication downloaded once by hand from psa.gov.ph, dropped
in the repo with its release date, and the migration generated from it.

**What shipped in the meantime**, because it is the same pattern and needed no new data:
the `/apply` and `/renew` university select is now filtered by the region chosen on the
same step — 445 options down to ~20, and the region moved above the school so the cascade
reads in order (PR E below). PR C2 extends that shape rather than replacing it.

---

## PR D — draft autosave ✅ shipped

localStorage, per Ethan's call. Files are not stored (a `File` cannot be serialized), so
documents are re-picked. Versioned key, cleared on submit and on "start over", a visible
"clear the draft on this device" control, and one sentence added to the privacy notice —
this puts a birthdate and an address on what may be a shared campus PC.

---

## PR E — performance ✅ shipped

Root cause of "very, very slow" was **the database was in `ap-southeast-2` (Sydney)** while
functions ran in `sin1`. Fixed 2026-09-09 by rebuilding in `ap-southeast-1`:

| | before (Sydney) | after (Singapore) |
|---|---|---|
| `db_latency_ms`, warm | 214 · 227 · 281 | 25 · 24 · 26 |
| `/apply` TTFB | 2.0–3.6s | 0.33–0.54s |

Roughly 8× per round trip, and an authenticated page makes four or more before it renders.

What remains, all still code:

1. Cache the reference reads. Regions, universities and programs change in a migration,
   never per request; `/apply` is `force-dynamic` + `force-no-store` and re-reads all
   three on every hit.
2. Stop shipping 445 universities to the browser — serialized once as `<option>` elements
   and again in the RSC payload. PR C2's cascade removes this outright.
3. Collapse the doubled auth round trip: `middleware.ts` does `getUser()` + a `user_roles`
   read, then the layout's `getSessionContext()` does both again. Worth an ADR, not a
   quiet edit — the current code is deliberate (`getUser()` over `getSession()`), and the
   safe modern alternative is local asymmetric JWT verification.

---

## PR F — orphan reconciliation ⚠️ code complete, two secrets missing

The aborted QA run left exactly the state the sweep exists for: **a draft row holding PII
and two 7.4MB objects with no database pointer**, because the upload succeeded and
finalize never ran. `purge_abandoned_drafts()` and `/api/jobs/purge-abandoned-drafts`
exist (migration `0020`, BUILD_PLAN S3-T22) but **nothing calls them on the org project** —
`.github/workflows/scheduled.yml` is not pointed at it. Until it is, abandoned drafts keep
their PII indefinitely and orphaned objects accumulate. Needs `APP_BASE_URL` and
`JOB_SHARED_SECRET` as GitHub repository secrets.

**Investigated and closed on the code side.** The endpoint is complete: it redacts
abandoned application drafts AND renewal drafts, deletes each stored document, and then
runs a real orphan pass against every ref the database still references — including the
`noa_*` columns and `renewal_submissions`, the two that a naive version would have deleted
as false orphans. Nothing was missing in the sweep itself.

**The entire gap is operational, and it is one Ethan has to close** — I cannot set a
GitHub repository secret, and should not. Exact commands and the three things to check in
the run log are in `docs/runbooks/03-CREDENTIAL_ROTATION.md` → "`APP_BASE_URL` — not a
secret, and that is exactly why it was missed", and the finding is recorded as item 11 of
`docs/issues/2026-09-06-launch-debt.md`.

**One code change did land here:** the job now prints the host it is sweeping. The org
moved deployment *and* Supabase project on the same day; a stale `APP_BASE_URL` sweeps the
old project and returns a healthy 200, and without that line a wrong sweep and a clean one
produce identical logs.

---

## Design items — canvas first

Per the rule set 2026-09-08, these go to `docs/design/canvas` for approval before any
restyle PR: title gradient `#FFDD00 → #F4F4F4 → #0099FF`, logo tilt with backdrop shadow,
an apply cue or hover on the landing CTA, 1px card outlines, a filler card beside PENDING
REVIEW, the applications-window text width, Members filters (Regions and Committee to
dropdowns; Status and Department stay pills), the campaigns university picker, and equal
upload card heights that collapse to "Replace file" once a file is attached.

The `/apply` region→university cascade and the campaigns picker are 445-row usability
problems as much as visual ones; they can be pulled forward on request.

---

## Open, blocking their items

1. **Contact block** — both Gmail addresses, which is reply-to, and the exact Facebook /
   Instagram / LinkedIn URLs. Blocks A7.
2. **PSGC workbook** — PSA blocks scripted download; Ethan may need to fetch it once.
3. **OQ-1 Drive** — Dani has not answered. Until then `DOCUMENT_STORE=supabase_storage`,
   which is what production runs and what the QA pass verified.

## Launch debt recorded today

- Demo accounts with fixed `<name>123` passwords must be **deleted**, not rotated, before
  one real scholar record exists.
- `DEV_DISABLE_MFA=1` is set on the org deployment. PRD MVP item 2 requires TOTP above
  member tier.
- The new project's database password lives only in Ethan's macOS Keychain. The org
  cannot run a restore or a `db push` without him.
- Vercel deploys are manual `vercel --prod`; the GitHub repo cannot be connected because
  Ethan is not an owner of the org's GitHub.
- Sydney project `krizhwugzrnlkxsixnde` still holds the reviewers' real test submissions
  and their uploaded documents. Delete it once the org deployment is confirmed.
