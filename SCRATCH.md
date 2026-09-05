# SCRATCH

LLM scratchpad for intermediate reasoning.

---

## 2026-09-05 — team meeting + CRRD "Questions Roles and Features" PDF: understanding, not yet built

Source of truth for this block: Ethan's meeting notes (2026-09-05) + `~/Downloads/Questions Roles and Features.pdf`
(from the CCDO). Where the two disagree, the meeting note is treated as newer, and flagged.
Everything must land before the demo; demo date is NOT fixed ("we'll demo it later").

### A. Role model — reverts to the PDF's tiers, plus DCOO-AA

| org_role | Positions | Source |
|---|---|---|
| `exec_admin` ("Executive Leadership", EL) | CEO, COO | Ethan 2026-09-06: "follow the pdf" — DCOO-AA stays officer, OQ-16 open |
| `tech_admin` | CTO, **DCTO-PD** | PDF ("CTO & DCTO-PD … configure the system, control access, create accounts") |
| `crrd_admin` | CCDO, **DCCDO-C, DCCDO-D** | PDF ("CRRD Chiefs and Deputies") |
| `officer` | every other chief + deputy, Special Advisor | PDF ("view but cannot edit") |
| `regional_rep` | RRs | PDF |
| `member` | **nobody** — members have no accounts, forms only | PDF ("Members cannot access the system") |
| `moderator` | **nobody** — "no moderator roles listed in the SRS" | PDF |

- **BUILT 2026-09-06 (slice 1, migration 0036, ADR 0009):** `moderator` retired via CHECK on
  `user_roles.role` (existing rows converted to crrd_admin); `member` KEPT as the revoked/no-surface
  state that `revokeRole` writes (members hold no accounts; portal deleted). Dead `'moderator'`
  clauses in 0014/RPCs left in place as named debt — no local Postgres to iterate a policy rewrite.
  pgTAP fixture 4 = `crrd_deputy` (crrd_admin, no ack); fixture 8 = revoked tier. Admin CHECK = 7.
- `officer_positions.grants_org_role` seed changes: DCOO→exec_admin, DCTO_PD→tech_admin,
  DCCDO_C/D→crrd_admin. COMMITTEE_MEMBER stays `member` (= no account).
- `admin_is_c_suite` CHECK widens from 4 codes to 8; pgTAP 027 "exactly four administrators" updated;
  ARCHITECTURE/DATA_MODEL/PRD text saying "exactly four" updated in the same PR.
- Side effects: OQ-13 (single-occupancy tech_admin) mitigated — CTO + DCTO-PD. OQ-16 resolved —
  DCOO gets exec_admin. OQ-14 moot — no moderator. Reverses the 2026-09-01 project-head decision.
- Delete: `(member)` route group + portal (US-E4 dropped), member + moderator demo accounts,
  member/moderator pgTAP fixtures (9 → 7). Committee members get no account (decision, boring).

### B. Member ID

`YYYY-####`, four digits (was three). YYYY = year the person JOINED the org = the approval term's
start year — same semantics as today's `join_year`, so `approve_application()` logic unchanged.
Regex `^\d{4}-\d{4,}$`, `lpad(...,4,'0')` (lpad truncates — see memory quirks). Re-seed demo IDs.
"Year of Award" (2022–2026, from the NOA) is a NEW separate field, NOT the ID year.

### C. Membership application form — field delta vs today

New columns/fields: `sex` (enum male/female/prefer_not_to_say), `facebook_account` (URL, required),
`scholarship_award` (enum: ra_7687, merit, jlss_ra_7687, jlss_merit, jlss_ra_10612), `award_year` (int),
`university_id` (FK → NEW `universities(id, name, region_id)` table), `program_id` (FK → NEW `programs`
table, 13 rows verbatim from PDF ≈ CBL Art. I §4 — closes OQ-17: closed list).
Kept: names, birthdate, email, phone, region, year_level (narrow CHECK 1–8 → 1–5), expected_grad_year.
Island group is derived from region — not stored. Age is computed — not stored.
No longer collected (PDF has no field): address_line/city/province/postal_code, school_id_no.
Keep columns nullable, stop collecting — CONFIRM.
Files: TWO — "Latest Registration Form" (= Certificate of Registration, COR) + "Notice of Award" (NOA).
→ replace the single `proof_*` column set with an `application_documents` table
(owner, kind enum {registration_form, notice_of_award, coc, grades}, store ref, mime, size,
verified_at). Committee form needs up to 4 docs × 3 departments, so a table is the right shape.
Tick boxes: existing privacy consent (immutable, DB-enforced) + NEW accuracy/falsification
certification. Meeting: "data privacy act checked per form" → consent on all three forms.

**BUILT 2026-09-06 (slice 2, migrations 0037–0041):** programs + universities tables (starter list),
people.sex/facebook_account/scholarship_award/award_year/university_id/program_id, year_level 1–5,
four-digit allocator (CHECK left at `{3,}` so existing IDs stay valid), NOA as four `noa_*` columns on
`applications` (NOT a documents table — the committee form gets its own multi-file table later),
finalize_application v2 (8 args), approve_application v2, update_member_record v2, get_application_detail v2,
form/review/proxy/fixtures/e2e updated, pgTAP 070 for the two tables. Accuracy certification tick added.

### D. Renewal form — accountless (new)

Identify by `member_id` + email, both must match one `people` row; uniform response either way
(anti-enumeration, same design as /apply). Anon INSERT into existing `renewal_submissions`, gated
by a `membership_renewal` window. Same personal block + COR + NOA. CRRD approves → new `memberships`
row in `current_term_id()`, status active, `member_id` untouched (US-H5). Review surface needed.

### E. Committee application form — accountless (new, biggest)

Sent to current members; PDF form has NO member-ID field — match on email at review like
`approve_application()` person reuse. Personal block + affiliations, then 1–3 repeatable department
choices (Events, Finance, Communications, CRRD, Marketing, Technology — EXEC excluded) each with
4 uploads (COC?, registration form, latest grades, NOA), a booking-form link + "have you booked"
tick, "apply to another department?". New tables: `committee_applications`,
`committee_application_choices`; docs in `application_documents`. Review surface with
pending/approved/rejected. Decision (boring): approval does NOT auto-assign; CRRD assigns via
committee/department management afterwards — CONFIRM.

### F. Regional Representative contact view — deliberate privacy widening (team decided)

RR sees for their own region: name, member ID, university, email, phone, Facebook. Officers unchanged
(name/ID/region/status only, least privilege). Mechanism: a SECURITY DEFINER RPC
(`list_region_member_contacts()`), region-scoped by `auth_region_ids()`, audited (one row per call),
gated on the CBL Art. VIII §7.1 confidentiality acknowledgement like `get_member_record()` — RRs are
appointed officers under the CBL, so the same precondition applies; demo seeder records the ack for
the demo RR. Column GRANTs and `v_member_directory` stay narrow — the widening is only in the RPC.
pgTAP 029/030/061/066 get RR assertions for the new RPC. "Remove committee and department" = from
the RR view only. University filter on RR view: cheap once `universities` exists — do it.
"Point person per university": deferred, nice-to-have.
Docs: CLAUDE.md banned-pattern line, PRD US-J1/US-F1/OQ-6, ARCHITECTURE §5, DATA_MODEL §8.1 all
currently say RR sees no contact data — update + ADR.

### G. Email — Gmail API behind a transport interface (decision, needs ADR)

Why not Resend (locked stack): Resend needs a verified domain and OQ-10 (org domain) is unresolved;
the onboarding sender only mails the account owner — useless for a demo. Gmail API sends from the
org's real Gmail to anyone. Costs to document: consumer Gmail ≈500 msgs/day (Workspace ≈2000) — a
600-member blast needs Workspace or two days; OAuth consent screen must be In Production or the
refresh token dies after 7 days (same trap as Drive); no bounce webhooks → per-recipient status is
sent/failed only. Build `lib/mail/` with `MailTransport` = `gmail | resend | fake` (mirrors
`lib/documents/`), so Resend is one env var later.
Composer: Telegram-style markdown (bold, italic, underline, strike, links, code, lists) → sanitized
HTML server-side (new deps, justify in PR). Merge tokens `{{given_name}}` from `v_email_merge_fields`
(not yet created — was deferred to v1.1). Filters: year of membership, role, region, island group
(+ affiliation per PRD). Queue = rows: `email_campaigns`, `email_recipients` (DATA_MODEL 0010, not yet
written). Sends: the three forms + freeform.

**Update 2026-09-05 (later):** START community email is a `@gmail.com` account. Decision: **SMTP +
Google App Password** via `nodemailer` (new dep, ADR), NOT the Gmail API — `gmail.send` is a
restricted scope and an unverified app gets blocked / 7-day tokens. Dani generates the App Password
herself (Google Account → Security → 2-Step Verification ON → App passwords → name "START-SYS");
Ethan puts it in Vercel Production env + `.env.local` + Bitwarden. Never pasted in chat, never in
the repo. Env: `MAIL_TRANSPORT=gmail_smtp|fake`, `GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`,
`MAIL_FROM_NAME`, `MAIL_REPLY_TO`. Limits to document in the ADR + runbook: ~500 recipients/day,
bulk sends from gmail.com risk spam flagging, no bounce webhooks (status = sent/failed only; bounces
land in the inbox). Real launch still wants Workspace or Resend + domain — env flip.
Composer default: markdown editor + live preview, plus "paste raw HTML" tab, both sanitized
server-side. Three templates + freeform unless told otherwise.

### H. Regions

PDF lists 17 (R1–R13 with 4A/4B, NCR, CAR, BARMM) — no NIR. Seed has 18 incl. NIR (RA 12000, 2024).
Default: keep 18. CONFIRM.

### I. Unclear / questions for Ethan or the CCDO

1. **COC** in the committee upload list = Certificate of Candidacy? Compliance? Completion?
2. **University list source** — CHED/DOST-SEI list or Dani's sheet? I can seed a starter list; CRRD edits.
3. **NIR** keep or drop (H).
4. **DCOO-AA as exec_admin** — meeting says yes, PDF says CEO & COO only.
5. **Committee approval outcome** — manual assignment afterwards (default) or auto department assignment?
6. **"Special appointment"** — crrd_admin already updates status + committees. What is blocked today?
   Guess: CRRD wants to create officer_assignments / COMMITTEE_MEMBER directly (today exec-only).
7. **Demo date** — drives build order.
8. **Address + school ID no longer collected** — keep columns, stop collecting (default)?
9. **Gmail account** — consumer Gmail or Google Workspace? Which address sends?
10. **Who approves** — PDF: CRRD chiefs and deputies (= crrd_admin) — same as today. The review
    dashboard exists: `/admin/applications` → open → view documents → Approve/Reject. Approve mints the ID.

Answered for Ethan: Certificate of Registration (COR) = the enrollment form the school issues each
semester listing enrolled subjects — the PDF's "Latest Registration Form". MIME rules = which file
types the upload accepts (pdf, jpeg, png, heic) and the 10 MB cap; the server checks the real bytes,
not the filename.

### J. Rough order and cost

1. Roles rewrite (seed, CHECK, policies, guards, tests, seeder, docs) — ½ day
2. Reference + columns (universities, programs, sex/fb/award/award_year, 4-digit ID, application_documents) — ½ day
3. Application form rebuild (fields, two uploads, accuracy tick) — ½ day
4. Renewal form + review + approve-renewal RPC — ½ day
5. Committee form + review — 1 day
6. RR contact RPC + view + university filter — ¼ day
7. Email: transport, composer, campaign tables, send loop, reporting, three form sends — 1 day
8. pgTAP/e2e/docs/ADRs throughout
≈ 4–5 days. Not reachable by Sept 7 — consistent with "demo later".
