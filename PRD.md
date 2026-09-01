# PRD — START-SYS

**Centralized Membership Information Management System for START-DOST**
Implementing department: Community and Regional Relations Department (CRRD), in coordination with the Technology Department.
Project heads: Danielle Quiambao, Ethan Baltazar.
Aligned priority area: Research-focused and Data-driven Scaling.

> Scope authority: this file. Stack, schema and mechanism live in `ARCHITECTURE.md` and `DATA_MODEL.md`. Nothing here names a technology except where the source PDF itself does (Google Drive for proof of enrollment).

---

## 1. Problem Statement

START-DOST manages its membership semi-manually across Google Sheets and Tally, which leaves records fragmented across tools that must be reconciled by hand. Applications arrive through external forms and are copied into spreadsheets by administrators; member statuses, committee assignments and departmental roles are tracked in the same spreadsheets, so viewing or updating them is slow and error-prone; and because every update is manual, duplicate, stale and inconsistent records accumulate. The problem compounds over time — the workflow does not scale across multiple terms or a growing membership, and because the process lives in undocumented spreadsheet conventions rather than in a system, every annual leadership transition forces incoming officers to relearn it, delaying handover and introducing further inconsistency. START-SYS replaces that workflow with one centralized, role-restricted platform that owns the membership application, the member record, and the record's history across terms.

---

## 2. Target Users

### Primary users — seven access tiers

The PDF groups primary users into four: Members, Administrators, Officers, Regional Representatives — with "Administrators" already split into three permission sets (CEO & COO / CTO & DCTO-PD / CRRD Chiefs and Deputies), so six in all. The locked role model (project heads, 2026-09-01) then splits the PDF's "CRRD Chiefs and Deputies" into the CCDO alone and its two deputies, and moves the DCTO-PD out of the technical-admin pairing; those three deputies become a **Moderator** tier. So the system implements **seven** tiers. Every tier below is drawn verbatim from PDF §II unless marked *[extrapolated]*.

The **Who** column is the Constitution's, not ours. Every position named is a CBL position cited to its article: the Executive Board (CBL Art. III §2), the Deputy Board (Art. III §3), the Regional Representatives (Art. III §4.6) and the Committee Members (Art. III §5). Nobody holds a seat here that the CBL does not create, and **administrators are exactly the four the CBL's own department heads make them** — CEO, COO, CTO, CCDO — which is a database CHECK, not a convention (`DATA_MODEL.md` §6/0003).

| Tier | Who | CAN | CANNOT |
|---|---|---|---|
| **Executive Admin** | **CEO, COO** — the two Executive Board officers the CBL makes responsible for the organization as a whole (CBL Art. III §2.1–2.2; duties Art. IV §1.1–1.2). Also the only tier that may terminate a membership (Art. VII §3.2.3) or record a separation from office (Art. VI). | Oversee all START-DOST records. Access admin dashboard, member management, membership status, committee management, department management, term management, lifecycle tracking. | Run term rollover (Technical Admin only — project-head decision, see OQ-7). Delete records (no delete exists system-wide). Alter the audit log. *[extrapolated: the PDF grants "oversee the overall records", not deletion; §6 non-goals]* |
| **Technical Admin** | **CTO only** (CBL Art. III §2.3), who heads the Technology Department (Art. III §4.2) and is charged with *"the development and maintenance of organizational digital products and platforms"* (Art. IV §2.1.4) — START-SYS is one of them. | Oversee technical management and development of START-SYS. Configure the system. Control access: assign and revoke user roles, open/close application windows, define terms. Correct an archived term through the audited unfreeze path. **Run term rollover — sole authority.** The CTO leads rollover. **Single-occupancy: DCTO-PD is a Moderator, not a Technical Admin, so no second person holds this role — see OQ-13.** | Read members' sensitive personal data by default (birthdate, address, contact number, school ID). *[extrapolated from "configure the system and control access" — see Open Question OQ-5]* |
| **CRRD Admin** | **CCDO** — Chief Community Development Officer, head of the Community & Regional Relations Department and *"officer-in-charge for all matters relating to social impact, community engagement, and regional coordination"* (CBL Art. III §2.7, §4.6; duties Art. IV §6.1). Directly supervises the DCCDO-C, DCCDO-D and every Regional Representative (Art. IV §6.1.3). | Manage members, committees and departments via the admin dashboard. Create and rename committees and departments — **in practice committees only: CBL Art. III §4 fixes seven departments**, changeable only by constitutional amendment (Art. XII), so the seven are seeded, carried forward at rollover, and asserted by a CI invariant (`DATA_MODEL.md` §9). Manage (review / approve / reject) membership applications. Compose, filter and send forms and emails. Grant Regional Representatives permission to send. **Read every member record in full, including sensitive fields.** | Configure system settings or assign user roles. Run term rollover. |
| **Moderator** | **DCCDO-C, DCCDO-D** (CRRD deputies — CBL Art. III §3.9–3.10, duties Art. IV §6.2–6.3) and **DCTO-PD** (Art. III §3.2, duties Art. IV §2.2). The CBL puts membership operations in exactly these hands: the DCCDO-C runs *"membership recruitment, application, retention, and re-engagement"* (Art. IV §6.2.2) and *"the Regional Representative network"* (§6.2.1). | Day-to-day operations: review / approve / reject applications, update member records and status, assign members to existing committees and departments, compose and send campaigns. Read the records they operate on in full — application review is impossible otherwise. | Create or delete committees and departments. Grant Regional Representatives permission to send. Assign user roles, configure the system, define terms, or run rollover. Set a membership to Terminated, or record any change of standing in office — both are Executive Board acts (CBL Art. VII §3.2.3, Art. VI). The structural half of this split is the CBL's own: Art. III §5.1–5.2 routes every committee creation, restructuring or dissolution through a co-endorsement by the department's other officer, COO review and **CEO approval**, so it was never a deputy's to make. *[extrapolated: the project heads named deputies as moderators but did not enumerate the split against the CCDO; whether Moderators may issue Regional Rep send grants is still open — see OQ-14]* |
| **Officer** | Every other Chief and Deputy — **fourteen seats**. C-Suite: **CFO, CMO, CCO, CEvO** (CBL Art. III §2.4–2.6, §2.8) and the **Special Advisor** (§2.9). Deputy Board: **DCOO, DCTO-TE, DCFO-RMD, DCMO-SP, DCMO-CC, DCCO-P, DCCO-SMR, DCEvO-P, DCEvO-L** (Art. III §3). The Special Advisor is read-only *because* they sit high: Art. III §2.9 seats them with the Executive Board **without voting powers**, Art. X §3.1 makes them a DOST-SEI employee rather than a scholar, and Art. X §2.4–2.5 makes them the **independent** reviewer of appeals against impeachment and membership termination. An adjudicator with write access would be reviewing appeals against their own writes. | View organization information: member records, committee members. | Edit or manage anything. No write path exists for this tier. See contact details, addresses or birthdates. *[extrapolated: PDF says "view but cannot edit or manage"; the column restriction is the Data Privacy NFR applied — now also a constitutional one, since CBL Art. VIII §7.1.4 designates "private member data" confidential and Art. VIII §6 binds the org to RA 10173. See OQ-6]* |
| **Regional Representative** | **Regional Representatives**, who *"serve under the supervision of the DCCDO-C"* inside the CRRD and represent their regions in the national organization (CBL Art. III §4.6; duties Art. IV §6.4). Constitutionally a bona fide part of the org: Art. XII §2.2 gives them a vote on amendments. The CBL sets no headcount per region, so the schema does not either. | View scholars from their own region only. Send forms/emails to their own region **only after CRRD grants permission**. | View any other region. Delete or alter any record. Send without an active CRRD grant. |
| **Member** | Active START-DOST members — scholars meeting CBL Art. I §4, whose membership *"shall remain valid from the notice of their membership until the end of term as defined in Article V, Section 1"* (Art. VII §1). **Committee Members** sit here too (Art. III §5, Art. V §6): a committee seat is an assignment, not a system privilege. | Submit membership application. Receive forms by email and access them in-system. View their own current committee, department or organizational role. | Access any organizational record, any other member's data, or any admin surface. Members can only access forms. |

**One CBL obligation cuts across every tier above.** Art. VIII §7.1: all elected and appointed officers, committee members and advisors *"shall sign a Confidentiality Agreement"* upon assuming their roles, and the agreement explicitly covers *"sensitive personnel matters, disciplinary proceedings, and private member data"* (§7.1.4). The system records the **acknowledgement** per person per term and makes it a precondition for reading any sensitive column (`DATA_MODEL.md` §8.4; US-J5); the signed document itself lives outside the system. Breach is not a policy matter — Art. VIII §7.3 routes it straight into impeachment (Art. VI §3, where *"breach of data privacy"* is a named ground at §3.1.3) or membership termination (Art. VII §3). The two state machines in MVP item 11 are the consequence side of this row.

### Secondary users

| Who | Need | System obligation |
|---|---|---|
| **Incoming Officers** *(CBL Art. V §1.2 folds "selection, election, appointment, transition" into the term of office, so handover happens **inside** a term, not in a gap between two)* | Access existing organizational records during the transition period; update current-year assignment and membership information; maintain continuity. | Prior-term records remain queryable after rollover. Role reassignment is a data change, not a code change. Documented handover runbooks. |
| **External Parties** | Receive membership forms sent by START-DOST. | Public application form reachable by link without an account, active only while an application window is open. Nothing else in the system is publicly reachable. |
| **Applicants** *(implied by PDF §V, not listed in §II)* | Submit an application, upload proof of enrollment, see a pending status, receive an acceptance decision. | Accountless submission; success + pending confirmation on submit; acceptance email after the application period. |

---

## 3. MVP Scope

The PDF describes the whole system. This section says what ships **first**, and in what order. Slices are sequenced against the org's own calendar, because that is what makes them non-negotiable.

### v1.0 — Records Spine
*Ship deadline: before the application period opens. Nothing below is optional; the org cannot run an application period without all of it.*

1. **Authentication.** No page other than the public application form is reachable without login. Encrypted password storage. Email-based account invitation (no public signup).
2. **Two-factor authentication.** TOTP enrolment mandatory for every account above Member tier. 2FA required to complete a password reset.
3. **Role-based access control.** Seven tiers enforced on every function and every record, at the data layer, not only in the UI. Roles are term-scoped assignments, not permanent attributes of a person.
4. **Term model.** One membership record per person per term. Exactly one active term at any time. Records are scoped to a term from day one, so no later migration is required to introduce history.
5. **Public membership application portal.** Personal + academic + membership information; validation of required fields and formats before submission; accountless; reachable only while an application window is open.
6. **Proof-of-enrollment upload.** Certificate of Registration, scholar ID or equivalent, uploaded as part of the application, stored via Google Drive integration, with the file link stored against the applicant's record. Documents are never stored in the core database and are never publicly shared.
7. **Applicant confirmation.** Success notification and pending status shown immediately on submit.
8. **Application management dashboard.** CRRD/Exec admins list, filter, open, and read applications including the uploaded proof document; approve or reject with a reason.
9. **Member ID assignment.** On approval the system generates `joinYear-sequence` (e.g. `2024-001`), unique, never reassigned, never renumbered on renewal.
10. **Member records.** Admins view and update member records; officers view them; every record carries status, region, year level, department and committee.
11. **Membership status tracking.** Admins assign and update status: **Renewal Pending, Active, Graduated, Resigned, Left, Terminated** (`DATA_MODEL.md` §3.1). The first five are unchanged; **Terminated is new, and forced by CBL Art. VII §3** — removal from the organization on named grounds (§3.1.1–3.1.4), enacted only by a majority (50%+1) vote of the Executive Board (§3.2.3) and reversible only on a written appeal to the Special Advisor (§3.2.5–3.2.6). It is deliberately **not** collapsed into `Left`: `Left` is the quiet, non-adjudicated exit, and collapsing them would make an Executive Board ruling indistinguishable from an unreturned renewal form in the audit log. Executive Admins alone may set or reverse it (US-D5, US-D6), narrower than every other status.
    **Standing in office is a second, separate machine.** CBL Art. VI is titled *Separation from **Office*** and covers leave of absence (§1), AWOL dismissal (§1.7), resignation (§2) and impeachment (§3). It is tracked on the officer assignment, never on the membership: an impeached CTO is still a member — Art. VI §3.3 disqualifies them from *holding any position*, not from the organization — and a two-week leave must not revoke a member's portal access. Values: Active, On Leave, Suspended, Resigned, Dismissed, Impeached, Ended (US-E5, US-E6, US-E7). Merging the two machines is the single most likely future mistake in this system.
12. **Search and filtering.** Authorized users search by name and member ID and filter by status, region, term, committee and department. Filters are shareable as links.
13. **Admin dashboard.** Organization overview for the current term: headcounts by status, region and committee; pending application count.
14. **Regional Representative dashboard.** Scoped to the rep's own region. Read-only.
15. **Officer dashboard.** Read-only member and committee views.
16. **Audit log.** Every significant administrative action — membership status updates, officer role changes, application decisions, document views — recorded with the responsible user and timestamp. Append-only; not editable by any role.
17. **Database backups.** Automated, on a schedule, with a written and drilled restore procedure.

### v1.1 — Outreach
*Ship deadline: before acceptance emails are sent, i.e. before the application period closes.*

18. **Committee management.** Create/edit committees; assign and remove committee members.
19. **Department management.** Create/edit departments; assign and remove departmental roles.
20. **Email composition.** CRRD composes emails with HTML formatting from reviewed templates plus a freeform body.
21. **Recipient filtering.** Filter by year of membership, role, region, island group, and affiliation (e.g. "START x DataCamp members"). Live recipient count and sample preview before send.
22. **Mail merge.** Merge fields drawn from a whitelist of non-sensitive database columns. Unknown merge tokens fail the send rather than shipping broken text.
23. **Form sending — external.** Membership Application Form sent to external recipients.
24. **Form sending — internal.** Committee Application Form sent to current-term members, delivered both as an in-system notification and by email.
25. **Delivery reporting.** Per-recipient sent/failed/bounced status for each campaign.
26. **Acceptance emails.** CRRD sends acceptance emails to approved applicants after the application period.

### v1.2 — Lifecycle
*Ship deadline: before the second term begins. Cannot slip past the first rollover.*

27. **Membership Renewal Form.** Sent at the start of a new term to previous-term members **if and only if** the member is Active and is not graduating. Eligibility is computed server-side and cannot be overridden by hand.
28. **Term-end transition.** One operation: archive the current term, create the new term's record, carry the seven constitutional departments forward, wipe the dashboards clean. Idempotent — running it twice does nothing. The term runs **1 June to 31 May** — CBL Art. V §1 ends every officer's term "until May of the succeeding year", and Art. VII §1 defines membership validity by that same clause, so one term serves both. It is **not** the school year; see OQ-7.
29. **Historical retrieval.** Admins select any prior term and read its records, unchanged.
30. **Membership end.** Graduate / resign / leave terminates membership, revokes access to every part of the system except the renewal form, and leaves the record archived.
31. **Renewal without renumbering.** A renewing member keeps their original member ID (`2024-001` does not become `2025-001`).

### v2 — Deferred but committed
32. Affiliation management UI (create/rename affiliations without a code change).
33. Automated 5-year deletion of sensitive information from archived records, on both the database and the Drive side.
34. Committee-scoped contact access for committee heads, if OQ-6 is answered yes.
35. Public uptime/status reporting against the 99.9% availability target.
36. In-system notification centre beyond form delivery.

---

## 4. Non-Goals

### Explicitly excluded by the source PDF (§VI Constraints)
| Out of scope | Note |
|---|---|
| Operations management | Not built, not planned. |
| Event management | Not built, not planned. |
| Financial management | No dues, no budgets, no payments. |
| General file storage | The **only** files the system handles are proof-of-enrollment documents, and those live in Google Drive, not in the core database. |
| Advanced analytics | Dashboards show counts and lists. No trend analysis, cohort modelling, forecasting or BI. |
| Public accessibility | Other than the forms it sends out, the system is not accessible to the general public. |
| Offline operation | An internet connection is required. |

### Consciously deferred by this PRD (not in the PDF; called out so nobody assumes them)
| Deferred | Why |
|---|---|
| Bulk CSV import of legacy spreadsheet members | The spine must be correct before historical data is poured into it. A one-off import is a v1.2 task once the schema is proven against one real application period. <!-- decision: boring option — a one-time admin-run import over a permanent import UI. --> |
| Applicant self-service edit after submission | Adds a whole state machine (resubmission, versioning, re-review). v1 answer: applicant contacts CRRD, CRRD edits the application. <!-- decision: boring option. --> |
| Member self-service profile editing | v1 members see their own role/committee/department but do not edit their own record; CRRD owns the record. Revisit once the record is stable. |
| Multi-file / multi-document uploads per applicant | The PDF requires *proof of enrollment*, singular. One document per application. |
| SMS, push, or chat notifications | The PDF names email and in-system notifications only. |
| Data deletion of any kind by any user | Removing a member is a status change. Archival is a flag. Genuine data-privacy erasure runs as a deliberate, audited, technical-admin operation. This is a feature, not a gap. |
| Contractual 99.9% uptime SLA | 99.9% is a **measured and reported** target with alerting and a monthly figure, not a purchased guarantee. Stated plainly rather than claimed. |
| Native mobile applications | Responsive web on commonly used browsers only (PDF: Compatibility NFR). |

### Assumptions carried from the PDF (§VI)

These are stated so that a later failure can be attributed to a broken assumption rather than to a missing requirement. Each names what the system does about it, because "we assumed it" is not a design.

> **One of the PDF's assumptions is no longer an assumption.** The *Constitution and By-Laws 2026* is in hand (extraction at `scratchpad/cbl-raw.txt`), so *"the system will follow the CBL in terms of member status and organizational structure"* is now a **statement of fact about the build**, not a risk carried forward. Concretely: seven departments (CBL Art. III §4), 23 positions (Art. III §2, §3, §4.6, §5), exactly four administrators (a database CHECK), a term ending in May (Art. V §1, two CHECK constraints), membership validity defined by that same clause (Art. VII §1), and two distinct separation regimes — office (Art. VI) and membership (Art. VII) — are **seeded rows and constraints with the article cited inline**, per `DATA_MODEL.md` §6/0016. The Constitution is seeded, not paraphrased.
>
> **What happens when the CBL is amended.** Art. XII: a written motion to the CEO (§1), consultation, then a majority (50%+1) affirmative vote of the incumbent Executive Board, Deputy Board, Committees and Regional Representatives (§2.2–2.3). Because the Constitution is data, an amendment lands as **one migration that cites the amendment** — not a redesign and not a redeploy of application code. Two wrinkles the system must survive: an **emergency amendment** takes effect *immediately* on a 2/3 Executive Board vote (§4.1, §4.3) but **automatically expires after 90 days unless ratified** (§4.4), so org rows may have to be rolled back — the audit log is what makes that reversible; and a newly accredited academic program is only folded in *"in the succeeding amendment"* (Art. VII §2.4), which is why the program list is amendment-paced reference data rather than an operational table (OQ-17).

| PDF assumption | What the system does about it |
|---|---|
| Users have an internet-connected device and a supported browser. | Responsive web only; no offline mode (see Non-Goals). Compatibility is tested on current Chrome, Edge, Firefox and Safari. |
| Members provide accurate personal and academic information. | Format and presence validation is enforced on submit (US-B1) and again server-side. The system cannot verify *truth* — that is what the proof-of-enrollment upload (US-B2) and CRRD review (US-C1) exist for. |
| Authorized administrators regularly manage records and maintain the system. | The system does not self-heal. Nothing expires or auto-corrects except the renewal sweep at rollover and the 5-year purge. Admin inaction shows up as stale status, not as data loss. |
| ~~The system follows the CBL for member status and organizational structure.~~ **Not an assumption any more — see the note above.** | Statuses, positions, committees and departments are **data with the CBL article cited inline**, not code (US-E1, US-E2, US-E3). Where the Constitution fixes something it is seeded or CHECKed, so an Art. XII amendment is a cited migration. Where the PRD and the CBL disagree, the CBL wins on org structure, tenure, separation from office and membership termination — the PRD said so itself. |
| The CBL's organizational structure and administrative roles stay sufficiently consistent across terms. | **Still an assumption**, and CBL Art. XII is the named mechanism that can break it — including a 2/3 emergency amendment effective immediately (Art. XII §4.3). Roles are term-scoped assignments (US-E3), so a restructure is a new term's rows. Two things would need code rather than rows: a change to the *number of access tiers*, and a change to *which positions are administrators* — the CEO/COO/CTO/CCDO set is a database CHECK, so widening it is a reviewed migration, never a quiet row edit. |
| Incoming officers continue to use START-SYS. | Addressed by Epic K, not assumed: org-owned accounts, five runbooks, and an annual handover drill (Success Metric 7). |
| Administrative functions depend on administrators properly maintaining records. | Every significant action is audited with its actor (US-I1), so "properly maintained" is checkable after the fact rather than assumed. |

---

## 5. User Stories

Format: `As a <role>, I can <action> so that <outcome>.` Every story is testable. Story IDs are stable: cite the `US-*` id in the migration header, the pgTAP plan name and the Playwright test title so a requirement can be traced to the test that proves it (`CONVENTIONS.md` §8). A separate `TEST_STRATEGY.md` is deliberately not created yet — the build framework adds a doc when the pain appears, and §8 currently carries the rules.

### Epic A — Access & Identity
*(PDF: Security NFR, Role-based Access Control FR)*

**US-A1 — Login required.** As any user, I cannot reach any page other than the public application form without logging in, so that member information is never exposed to an anonymous visitor.
- Requesting any admin, officer, RR or member URL while logged out redirects to login.
- After login the user lands on the page they originally requested.
- No API or data path returns organizational records to an unauthenticated caller, even when called directly.

**US-A2 — Role-restricted surface.** As a logged-in user, I see only the functions and records my role permits, so that access matches my responsibilities.
- Each of the seven tiers has a defined, enumerated capability set; an automated authorization test asserts the full role × resource matrix.
- A denied read returns nothing rather than a partial or redacted record.
- Removing a role from a user takes effect on the user's next request, not after a delay.

**US-A3 — Mandatory 2FA for privileged accounts.** As a Technical Admin, I require every account above Member tier to enrol in TOTP two-factor authentication, so that a stolen password alone cannot reach member data.
- An officer-or-above account without an enrolled second factor sees an enrolment screen and no organizational data.
- Enrolment issues one-time recovery codes, displayed exactly once.
- Lost-device re-enrolment is performed by a Technical Admin and is itself written to the audit log.

**US-A4 — 2FA on password reset.** As a privileged user resetting my password, I must pass a second factor before the new password is accepted, so that mailbox access alone cannot take over my account. *(PDF: "2FA is required when resetting passwords.")*
- The reset link alone does not permit a password change.
- The password change is rejected unless the session has satisfied the second factor, checked server-side and not bypassable by calling the endpoint directly.
- Members — who hold no organizational data — reset by emailed one-time code alone; this exception is documented, not implicit. *[extrapolated: risk-proportionate reading of the PDF's blanket 2FA rule]*

**US-A5 — Credentials at rest.** As the org, I require passwords to be stored irreversibly hashed, so that a database disclosure does not disclose passwords. *(PDF: "Vital information such as passwords must remain encrypted.")*
- No plaintext or reversibly-encrypted password exists anywhere in the system.
- Password reset issues a new credential; it never reveals the old one.

### Epic B — Membership Application
*(PDF: Membership Application FR, §V user flow, Addendum)*

**US-B1 — Submit an application.** As an applicant, I can submit my personal, academic and membership information through a form in START-SYS, so that I do not have to use an external form. *(PDF Specific Problem 1)*
- The form is reachable without an account, by link.
- All required fields are validated for presence and format before the submission is accepted.
- A submitted application is persisted with status **Pending** and is visible to CRRD immediately.
- No third-party form tool is involved in the path.

**US-B2 — Upload proof of enrollment.** As an applicant, I can upload my Certificate of Registration, scholar ID or equivalent as part of the application, so that CRRD can verify my scholar status. *(PDF Addendum)*
- Accepted formats and a maximum size are enforced, and enforcement is server-side — a client that claims a different type or size is rejected.
- The file is stored via the Google Drive integration; the record stores the resulting file link, not the file.
- A typical phone photo of a Certificate of Registration uploads successfully.
- The upload happens between entering academic data and the application being saved, per the updated user flow.

**US-B3 — Confirmation and pending status.** As an applicant, I see a success notification and a pending status immediately after submitting, so that I know my application was received. *(PDF §V)*
- The confirmation screen appears on successful submission and names the applicant's submission.
- The confirmation states that a decision follows after the application period.

**US-B4 — Application window enforcement.** As a CRRD Admin, I can open and close the application period, so that submissions are only accepted while applications are open.
- With the window closed, the public form refuses submissions — a forwarded or bookmarked link is inert.
- Enforcement is at the data layer, not by hiding the link.
- Opening and closing a window is written to the audit log with the responsible user.

### Epic C — Application Review & Member ID
*(PDF: Application Management FR, §V)*

**US-C1 — Review applications.** As a CRRD or Executive Admin, I can view and filter the list of applications and open any one of them, so that I can assess applicants. *(PDF: "admin reviews application via the management dashboard")*
- The list filters by status (Pending / Approved / Rejected) and by term, and sorts by submission time.
- The detail view shows every submitted field.
- The proof-of-enrollment document is viewable in-browser by authorized reviewers only.
- Each document view is recorded in the audit log with viewer and timestamp.

**US-C2 — Approve or reject.** As a CRRD or Executive Admin, I can approve or reject an application, so that the membership roll reflects the org's decision.
- Approval creates the member's membership record for the current term with status Active.
- Rejection records a reason and leaves no membership record.
- Both outcomes write an audit entry naming the deciding officer.
- An already-decided application cannot be silently re-decided; a change of decision is a new audited action.

**US-C3 — Member ID generation.** As the system, I generate a member ID of the form `joinYear-sequence` on approval, so that every member has a stable identifier. *(PDF: "system generates member ID"; "e.g. 2024-001")*
- The ID matches the year-dash-sequence format and is unique across the whole system.
- Two admins approving at the same moment produce two different IDs — never a duplicate, never a gap caused by a lost update.
- A retried or double-submitted approval returns the existing ID rather than issuing a second one.
- No approval can produce a member without an ID, or an ID without a member.

**US-C4 — Member ID immutability.** As the org, I require a member's ID to never change once issued, so that historical references remain valid. *(PDF: "2024-001 will not become 2025-001")*
- Renewal into a new term leaves the member ID unchanged.
- Any attempt to change an existing member ID is refused at the data layer, including by an administrator.

**US-C5 — Acceptance emails.** As a CRRD Admin, I can send acceptance emails to approved applicants after the application period closes, so that verified members are notified. *(PDF §V, final step)*
- The recipient set is exactly the applicants approved in the current term.
- Each recipient receives their own member ID via mail merge.
- The send produces a per-recipient delivery report.

### Epic D — Member Records & Status
*(PDF: Member Management FR, Membership Status Tracking FR, Dashboard FR. CBL: Art. VII §3 Termination of Membership, Art. X §2.4–2.5 appeals)*

**US-D1 — View and update member records.** As a CRRD or Executive Admin, I can view and update member records, so that the roll stays accurate without spreadsheet edits. *(PDF Specific Problem 3)*
- Every editable field is validated for format before the record is written.
- Each update writes an audit entry with the responsible user and the before/after values.
- Concurrent edits do not silently overwrite one another.

**US-D2 — Officers view member records.** As an Officer, I can view member records, so that I can do my job without being able to damage the data. *(PDF: "Officers have view-only access")*
- No update, create or delete path exists for the Officer tier on any record.
- The officer view excludes sensitive personal data (contact number, address, birthdate, school ID, proof document).

**US-D3 — Assign and update membership status.** As an Admin, I can set a member's status to Active, Graduated, Resigned or Left, so that lifecycle state is tracked. *(PDF §V Membership Updates)*
- Status changes are audited with the responsible user.
- Changing status to Graduated, Resigned or Left immediately ends system access per US-H4.
- Status is scoped to a term; changing this term's status does not rewrite last term's.
- **Terminated is not reachable from this path.** CBL Art. VII §3.2.3 reserves removal from the organization to a majority vote of the Executive Board, so it is a separate, narrower action (US-D5) — a CRRD Admin or Moderator attempting it is refused at the data layer, not merely hidden from.

**US-D4 — Admin dashboard overview.** As an Administrator, I see an overview of the organization on login, so that I can assess the org at a glance. *(PDF: Dashboard FR)*
- Shows current-term headcount by status, by region and by committee, plus the pending-application count.
- Every number links through to the filtered list that produced it.
- The dashboard loads within 3 seconds under normal conditions. *(PDF: Performance NFR)*

**US-D5 — Terminate a membership.** As an Executive Admin, I can record the termination of a member's membership after an Executive Board vote, so that a removal decided under the Constitution is visible in the roll and distinguishable from a member who simply left. *(CBL Art. VII §3: grounds at §3.1.1–3.1.4, majority vote at §3.2.3)*
- Only the Executive Admin tier can set status to Terminated. CRRD Admins, Moderators, Officers and Regional Representatives are refused at the data layer, even though Moderators own every other status transition.
- Recording a termination requires a written ground; the audit entry names the deciding officer, the ground, and the timestamp.
- Terminated is a distinct status from Left. A query for "members removed by the Executive Board this term" returns terminations only, and never picks up a member who declined to renew.
- Termination ends the member's active sessions and revokes access on the same terms as US-H4.
- The system records the **outcome** of the Art. VII §3.2 procedure. It does not run the procedure: the five working days to respond, the hearing, the three working days to notify and the escalation to DOST-SEI are notice periods between people, and the audit log answers "was this done on time?" after the fact. *[extrapolated: the CBL prescribes the procedure but does not require a system to conduct it; see OQ-16 for the one place this bites]*

**US-D6 — Reinstate a member whose appeal succeeds.** As an Executive Admin, I can return a terminated member to Active when the Special Advisor's review upholds their appeal, so that a successful appeal does not require inventing a second person. *(CBL Art. VII §3.2.5–3.2.6; the Special Advisor's independent-reviewer role is Art. X §2.4–2.5)*
- Terminated → Active is available to the Executive Admin tier and to nobody else. It is the only status reversal anywhere in the system, and it is deliberate.
- Reinstatement restores the existing membership record. It never creates a second person record and never issues a second member ID — a member who is reinstated keeps `2024-001`.
- The audit log shows the termination and the reinstatement as two separate attributable actions, with the original ground still readable.
- The Special Advisor holds no write path. They review and recommend (Art. X §2.5); an Executive Admin records the result.

### Epic E — Committees, Departments & Roles
*(PDF: Role Management FR, §V Committee/Department Management. CBL: Art. III §4 seven departments, §5 committees, Art. VI Separation from Office)*

**US-E1 — Manage committees.** As a CRRD Admin, I can create and edit committees and manage their membership, so that committee information stops living in a spreadsheet. *(PDF Specific Problem 2)*
- Committees are term-scoped; last term's committee roster is not altered by this term's edits.
- Adding or removing a committee member is audited.

**US-E2 — Manage departments.** As a CRRD Admin, I can create and edit departments and assign members to departmental roles, so that the org structure is recorded in one place.
- Department assignments are term-scoped.
- Assignment changes are audited.
- **There are seven departments and they are constitutional** — Executive Leadership, Technology, Finance, Marketing, Communications, Community & Regional Relations, Events, each headed by the Chief the CBL names (Art. III §4.1–4.7). They are seeded, carried forward unchanged at every rollover, and a CI-blocking invariant asserts that every active term has exactly seven. In practice "create a department" is only ever exercised after an Art. XII amendment. *(CBL Art. III §4)*
- Committees, by contrast, are fully discretionary and may be created, restructured or dissolved per term (CBL Art. III §5) — that asymmetry is the Constitution's, not ours. The Art. III §5.1–5.2 approval chain (co-endorsement, COO review, CEO approval) happens outside the system; the system records the resulting committee and audits who created it.

**US-E3 — Assign officer roles.** As a Technical Admin, I can assign and revoke system roles, so that access control reflects the current leadership. *(PDF: "CTO & DCTO-PD — configure the system and control access"; narrowed to the CTO alone by the project heads, 2026-09-01 — DCTO-PD is a Moderator)*
- Assigning a role grants exactly that tier's capabilities, effective on the user's next request.
- Revoking a role removes access on the user's next request.
- Every officer role change is written to the audit log with the responsible user. *(PDF: History NFR names officer role changes explicitly)*

**US-E4 — Member sees their own assignment.** As a Member, I can view my current committee, department or organizational role, so that I know where I sit in the org. *(PDF §II Primary Users)*
- The member sees only their own assignment, never anyone else's.
- No organizational roster is reachable from the member view.

**US-E5 — Record a leave of absence.** As an Executive Admin, I can mark a sitting officer as on leave for an approved period and return them to active on their notice of return, so that the org chart says who is actually available without pretending the seat is empty. *(CBL Art. VI §1: LOA is filed with the CEO, who approves and issues the notice — §1.2; return is by formal notice to the immediate Chief or Deputy — §1.3)*
- Leave is recorded on the **officer assignment**, never on the membership record. An officer on leave keeps their member portal access, their member ID and their Active membership status.
- The leave note records who approved it and why, and the change is audited.
- Returning from leave restores the assignment to Active. An early return is permitted and is not a separate concept — CBL Art. VI §1.4 says unused days are simply not counted.
- The person's **system role is not silently revoked by going on leave**; delegation of duties (Art. VI §1.2) is recorded as an acting designation under US-E7 if anyone needs the powers.
- The 30-day-per-term cap (Art. VI §1) is **deliberately not enforced.** Leave is counted "from Monday to Saturday, excluding national holidays", and Philippine national holidays are set by annual presidential proclamation — enforcing the cap needs a per-day leave ledger and a holiday calendar maintained every year by someone who will have graduated. A cap that is silently wrong rejects a legitimate leave and gets debugged by switching it off. *[extrapolated: the CBL states the cap; not enforcing it in software is our decision, recorded in `DATA_MODEL.md` §3.4]*

**US-E6 — Record a separation from office.** As an Executive Admin, I can record that an officer has resigned, been dismissed for AWOL, been suspended pending impeachment, or been impeached, so that a person who no longer holds a position no longer holds its access. *(CBL Art. VI §1.7 AWOL dismissal, §2 Resignation, §3 Impeachment; Art. V §1.3 also ends a term on constitutional violation, dismissal, impeachment or death)*
- Each outcome is a distinct recorded value — Resigned, Dismissed, Suspended, Impeached — not one "inactive" flag. They are four different constitutional processes with four different deciders and they must stay tellable apart in the audit log.
- **Suspended is not a leave of absence.** CBL Art. VI §3.2.3 puts an accused member on indefinite LOA *"without going through the processes defined in Article VI, Section 1"* — it is indefinite, it is not requested by the officer, and it must not consume their 30-day entitlement.
- **Impeached is terminal and has no way back.** CBL Art. VI §3.2.8: the Executive Board's ruling *"shall be deemed final and irrevocable"*, and §3.3 disqualifies the person from holding any position in the organization. This is the one state the Constitution itself declares irreversible — contrast US-D6, where the CBL explicitly provides an appeal.
- **Separation from office does not end membership.** An impeached CTO remains a member with their member ID and Active status unless the Executive Board separately terminates their membership under Art. VII §3 (US-D5). The two are different Articles, different bodies and different records.
- Recording any of these revokes the person's officer-tier system role on their next request and is audited with the responsible officer and a note naming the constitutional basis.
- The AWOL notice itself (CBL Art. VI §1.6, issued by the DCOO) is produced outside the system, because the locked role model gives the DCOO read-only access. The resulting dismissal is recorded by an Executive Admin with the DCOO named in the note. **This is a live divergence, not a settled design — see OQ-16.**

**US-E7 — Vacancy and acting designation.** As an Executive Admin, I can see which positions are vacant and record an acting officer, so that a mid-term departure does not leave a power nobody can exercise. *(CBL Art. VI §4: vacancy arises from "LOA, dismissal, resignation, impeachment, permanent incapacity, or any analogous cause"; §4.1 COO assumes the CEO's duties, §4.2 the CEO designates an acting officer from the department's deputies, §4.3 the Chief absorbs a vacant deputy)*
- **Vacancy is a query, not a stored status.** A position is vacant when no sitting officer holds it this term. There is no "vacant" record, because a record claiming someone holds a position nobody holds is a lie the schema should not be able to tell.
- At most one sitting officer and at most one acting officer may hold a given position in a term. Regional Representative and Committee Member are excluded — the CBL creates many of each.
- An acting designation is recorded as such, names the designating officer and the constitutional basis, and is distinguishable from a substantive appointment in every list and export.
- **An acting officer gets the powers, not just the title.** If the CTO resigns in November, the acting CTO must be able to run the May rollover (US-H2) without a migration — that is the whole point of the designation, and it is the mitigation OQ-13 asks for.
- A mid-term appointee's term still ends in May of the incumbents' year (CBL Art. V §1.1), so a mid-term appointment never creates a second, offset term.
- Willful vacancy is legitimate and must not read as an error: CBL Art. VI §4.4 lets the CEO leave a seat empty when it falls vacant within 45 days of term end, or when a Chief has absorbed a deputy's duties for the rest of the term.

### Epic F — Scoped Dashboards
*(PDF: Regional Representative Dashboard FR, Officer Dashboard flow)*

**US-F1 — Regional Representative scoped view.** As a Regional Representative, I can view scholars from my own region, so that I can support them. *(PDF §V RR Dashboard)*
- Members outside the rep's region are not returned, including via direct record access, search, filters or exports.
- Two reps of different regions see disjoint member sets.

**US-F2 — Regional Representatives cannot alter records.** As the org, I require that Regional Representatives cannot delete or alter any record, so that regional access does not become regional editing. *(PDF: "RRs cannot delete or alter records")*
- No create, update or delete path exists for the RR tier on any record.
- This is enforced at the data layer, so it holds even if a UI control is mistakenly rendered.

**US-F3 — Regional Representative send permission.** As a Regional Representative, I can send forms or emails to my region only after CRRD grants me permission, so that regional outreach stays coordinated. *(PDF: "must be given permission by CRRD officers")*
- Without an active grant, the send action is refused.
- A grant names the granting officer, the region, and an expiry, and is recorded in the audit log.
- An RR send whose recipient list includes anyone outside their region is refused in full — never partially sent.

### Epic G — Email & Form Sending
*(PDF: Email Sending FR, Form Sending FR, §V Custom Emailing)*

**US-G1 — Compose an HTML email.** As a CRRD Admin, I can compose and send an email with HTML formatting, so that org communication looks professional. *(PDF: "send emails with an HTML format attached")*
- The composer offers reviewed templates plus a freeform rich-text body.
- The email renders correctly in the browsers and mail clients members actually use.
- A preview of the exact rendered email is available before sending.

**US-G2 — Filter recipients.** As a CRRD Admin, I can filter recipients by year of membership, role, region, island group and affiliation, so that the right people get the right message. *(PDF names all five axes; "e.g. START x Datacamp members")*
- Each of the five axes filters independently and in combination.
- Affiliations are managed as data — a new partnership requires no code change.
- The composer shows a live recipient count before the send button is enabled.
- The count shown in the preview is the same set the send actually uses.

**US-G3 — Mail merge from database columns.** As a CRRD Admin, I can merge fields from the system's database into the email body, so that a bulk send reads as a personal message. *(PDF §V Custom Emailing)*
- Merge fields are limited to a whitelist of non-sensitive columns; no sensitive personal data can be merged into a bulk send.
- An unrecognized merge token fails the send with a clear error rather than shipping literal placeholder text to recipients.
- A sample of merged output for real recipients is shown before sending.

**US-G4 — Send and track a campaign.** As a CRRD Admin, I can send to hundreds of recipients and see what happened, so that I know the message landed. *(PDF: Reliability NFR)*
- A 600-recipient send completes without manual intervention and shows progress while running.
- Each recipient has a status: queued, sent, failed, bounced.
- Clicking Send twice does not send twice.
- A send interrupted mid-way resumes and does not re-send to recipients already sent.

**US-G5 — Send the Membership Application Form externally.** As a CRRD Admin, I can send the Membership Application Form to external (non-member) recipients, so that the org can recruit. *(PDF: Form Sending FR)*
- The email carries a link to the public application portal.
- The link only accepts submissions while an application window is open (US-B4).
- Source of the external address list is **OQ-4** and must be resolved before this ships.

**US-G6 — Send the Committee Application Form internally.** As a CRRD Admin, I can send the Committee Application Form to START members through the system, so that internal calls reach members reliably. *(PDF §V: "through notifications from the system (e.g. Call for Committee Members)")*
- Delivered both as an in-system notification and as an email.
- Recipients are current-term members with Active status.
- Non-members cannot open the internal form.

**US-G7 — Send the Membership Renewal Form.** As a CRRD Admin, at the start of a new term I can send the Membership Renewal Form to previous-term members, **if and only if** the member is Active and is not graduating. *(PDF: Form Sending FR, §V Term End Transition)*
- Eligibility is computed by the system from the member's prior-term status and expected graduation, not chosen by hand.
- A graduating member cannot be added to the renewal recipient list by any user, including an Executive Admin.
- An eligible member cannot be silently omitted; the resolved list is shown and counted before sending.
- The definition of "is not graduating" is **OQ-3** and must be resolved before this ships.

### Epic H — Lifecycle, Terms & Renewal
*(PDF: Lifecycle Tracking FR, §V Lifecycle Tracking)*

**US-H1 — One membership record per term.** As the org, I require the system to create a membership record per term, so that a member's history is a sequence rather than an overwrite. *(PDF §V Yearly Membership Record)*
- A person has at most one membership record per term.
- Creating this term's record does not modify last term's.

**US-H2 — Term-end transition.** As a Technical Admin (the CTO), I can end the current term, so that the new term starts clean while the old one is preserved. *(PDF §V Term End Transition; owner set by OQ-7 resolution — the CTO leads rollover. Term boundary: CBL Art. V §1, read with Art. VII §1)*
- The current term's records are preserved as historical data, unchanged.
- A new record is created for the new term, running 1 June to 31 May.
- Rollover runs at the **end of May** — after Executive Board selection opens in the first week of May inside the outgoing term (CBL Art. V §2.1) and before Deputy Board selection opens in the last week of June inside the new one (§2.2). That ordering is what makes 1 June the boundary rather than 1 May.
- The seven CBL Art. III §4 departments are carried into the new term with their head positions intact. Committees are not — Art. III §5 makes them per-term and they start empty.
- Dashboards show zero members for the new term until members renew or are admitted — "wiped clean" is true of the view, never of the data.
- The operation is all-or-nothing and running it twice changes nothing.
- The operation is audited with the responsible user.
- **Executive Admins and CRRD Admins are refused**, with the denial surfacing as a permission error, not a silent no-op.

**US-H3 — Historical retrieval.** As an Administrator, I can select a previous term and view its records, so that the org keeps institutional memory. *(PDF §V Historical Tracking)*
- Any archived term is selectable and returns that term's member roster, statuses, committees and departments as they were.
- Officers and Regional Representatives do not gain access to prior terms they could not see at the time. *[extrapolated: prior-term access follows the same tier rules as current-term access]*

**US-H4 — Membership end revokes access.** As the org, I require that a member who graduates, resigns or leaves loses access to every part of the system except membership renewal, and that their records remain archived. *(PDF §V Membership End)*
- Setting status to Graduated, Resigned or Left ends the user's active sessions.
- The user can still access the renewal form while a renewal window is open, and nothing else.
- The member's historical records remain in the system, readable by Administrators.

**US-H5 — Renewal preserves the member ID.** As a returning member, I keep my original member ID when I renew, so that references to me stay valid. *(PDF §V On Membership Renewal)*
- A member who joined in 2024 and renews in 2025 still has `2024-…`.
- Renewal creates a new term membership record and does not alter the person's identity record.

### Epic I — History, Audit & Search
*(PDF: History NFR, Search and Filtering FR)*

**US-I1 — Audit significant admin actions.** As an Executive or Technical Admin, I can see who changed what and when, so that record changes are attributable. *(PDF: "log significant administrative actions such as updates to membership status and officer roles, including the user responsible")*
- Membership status updates, officer role changes, application decisions, permission grants and document views are all logged.
- Each entry names the acting user, the affected record, the action, the timestamp, and what changed.
- No user role can edit or delete an audit entry.
- The log is readable only by Executive and Technical Admins.

**US-I2 — Search members.** As an authorized user, I can search for a specific member record by name or member ID, so that I can find a person in seconds instead of scrolling a spreadsheet. *(PDF Specific Problem 2)*
- Partial-name search returns matches; search is case- and accent-tolerant.
- Search results respect the searcher's tier — a Regional Representative's search never returns another region.
- Results return within 3 seconds at full scale. *(PDF: Performance NFR)*

**US-I3 — Filter member lists.** As an authorized user, I can filter member records by status, region, term, committee and department, so that I can answer questions without exporting data.
- Filters combine, and the active filter set is visible.
- A filtered view is shareable as a link and survives the browser back button.

### Epic J — Data Privacy & Retention
*(PDF: Data Privacy NFR, Backup & Recovery NFR. CBL: Art. VIII §6 Compliance with the Data Privacy Act, §7 Confidentiality Agreements)*

**US-J1 — Sensitive information is restricted.** As the org, I require sensitive member information to be visible only to roles that need it, so that we comply with the Data Privacy Act. *(PDF: "restrict access to sensitive information")*
- Contact numbers, addresses, birthdates, school ID numbers and proof documents are not returned to Officer or Regional Representative tiers.
- Restriction is enforced at the data layer, not by omitting a column from a page.

**US-J2 — Proof documents are never public.** As an applicant, I require that my uploaded Certificate of Registration is never reachable by an unauthenticated link, so that my student number and address are not exposed. *[extrapolated from the Data Privacy NFR applied to the Addendum]*
- No "anyone with the link" sharing exists on any uploaded document.
- Viewing a document requires an authorized session and is audited.

**US-J3 — Five-year deletion from archive.** As the org, I require sensitive information to be deleted after 5 years in the archive, so that we do not retain personal data indefinitely. *(PDF: Data Privacy NFR)*
- After the retention period, sensitive fields on qualifying archived records are cleared.
- The corresponding proof-of-enrollment document is deleted from Drive in the same operation — the record and the document expire together.
- Non-identifying data (member ID, join year, region, term, status) survives so historical headcounts still work.
- The start of the five-year clock is **OQ-8** and must be resolved before the privacy notice is published.

**US-J4 — Backups and restore.** As a Technical Admin, I can restore the database from a backup, so that accidental deletion, failure, corruption or attack does not lose the org's records. *(PDF: Backup & Recovery NFR)*
- Backups run automatically on a schedule with no human step.
- At least one backup copy exists outside the primary provider.
- A restore has actually been performed and recorded, not merely configured. An untested backup does not count.

**US-J5 — No sensitive read without a signed confidentiality agreement.** As the org, I require that nobody reads a member's sensitive fields in a term in which they have not acknowledged the confidentiality agreement, so that the Constitution's precondition is a precondition and not a reminder. *(CBL Art. VIII §7.1: officers, committee members and advisors "shall sign a Confidentiality Agreement" upon assuming their roles, covering "sensitive personnel matters, disciplinary proceedings, and private member data" — §7.1.4)*
- The acknowledgement is recorded per person **per term**, because Art. VIII §7.1 attaches it to assuming a role and roles are assumed each term. A 2024 signature does not authorize a 2026 read.
- A sensitive-column read by a user with no current-term acknowledgement is refused, and the refusal is an error, not an empty result.
- The signed document itself is out of scope; the system records that it was signed, by whom, and when.
- **Known day-one failure mode, stated rather than discovered:** on the morning a new term opens, nobody has acknowledged, so every sensitive read fails until the acknowledgements are collected. This is the correct behaviour and it belongs in the rollover runbook (US-K1). See OQ-18 for who collects them.
- Breach of confidentiality is not handled by the system, but its consequence is modelled: Art. VIII §7.3 routes a breach into impeachment (US-E6, where Art. VI §3.1.3 names "breach of data privacy" as a ground) or membership termination (US-D5).

### Epic K — Handover & Maintainability
*(PDF Specific Problem 5, Goal 7, Maintainability NFR)*

**US-K1 — Documented handover.** As an incoming officer, I can operate the system from written runbooks without the outgoing officer, so that transitions do not depend on one graduating person. *(PDF Specific Problem 5)*
- Runbooks exist for term rollover, restore-from-backup, credential rotation, 2FA recovery and incident response.
- Every runbook is written for someone with no prior context and has been executed once by someone who did not write it.
- All system accounts are owned by org-owned identities, never a student's personal account.

**US-K2 — Documented changes.** As a maintainer, I can read a written record of every system change or issue, so that the codebase remains understandable across leadership terms. *(PDF: Maintainability NFR)*
- Every change ships with a written description.
- Documentation lives with the code, not in a separate tool that will be abandoned.

---

## 6. Success Metrics

The PDF's eight goals, restated as things that can be checked. Baseline for "previous workflow" comparisons is the Google Sheets + Tally process in the term before launch.

| # | PDF Goal | Measurable check | How verified |
|---|---|---|---|
| 1 | Digitization of Membership Application | 100% of applications for the first launch term are submitted through START-SYS; **0** applications manually re-encoded from an external form; **0** external form tools in the path. | Count of application records vs. count of accepted applicants; CRRD confirms no external form was used. |
| 2 | Centralization of Membership Information | A member's status, region, committee, department, and term history are all readable from one member detail page. **0** spreadsheets in active CRRD use for membership data by end of the launch term. | Manual walkthrough; CRRD sign-off. |
| 3 | Reducing manual data entry and inconsistencies | **0** duplicate member IDs (structurally impossible). **0** records saved with a missing required field. Producing a filtered recipient list takes **< 1 minute** vs. manual spreadsheet filtering. | Data-layer uniqueness constraint; validation test suite; timed side-by-side task. |
| 4 | Improving administrative monitoring | Admin dashboard and member list load within **3 seconds** at full scale (PDF Performance NFR). An officer can find any member's current status in **≤ 3 clicks** from login. | Automated performance check against a seeded full-scale dataset; usability walkthrough. |
| 5 | Supporting lifecycle tracking | After a term rollover, **100%** of the prior term's member records remain retrievable and unchanged, and **100%** of renewing members keep their original member ID. | Automated rollover test asserting record counts and ID stability before/after. |
| 6 | Scalability | System holds **≥ 600 member records and 70 officers across ≥ 5 terms** with search, list and dashboard queries still inside the 3-second budget. | Seeded dataset at 5-year volume; timed query suite in CI. |
| 7 | Improved administrative transitions | An incoming officer completes term rollover, a backup restore, and a credential rotation using only the runbooks, with **zero** questions to the outgoing officer. | Annual handover drill, result recorded in the handover document. |
| 8 | Protect membership information | The full role × resource authorization matrix passes automatically on every change; **0** routes reachable without login; **0** sensitive fields returned to Officer or RR tiers. | Automated authorization test suite, blocking on merge. |

**Additional operational targets** (from NFRs, not from the goals list):
- Availability: 99.9%, **measured and reported monthly**, with alerting on failure. Not a contractual SLA — stated plainly.
- Compatibility: correct operation on current Chrome, Edge, Firefox and Safari, desktop and mobile.
- Reliability: no user-facing operation can delete a membership record; data loss during normal operation is structurally prevented.

### Non-functional requirement register (PDF §IV — all twelve)

Every NFR the PDF states, its acceptance criterion here, and where the enforcing mechanism is documented. Nothing in this table is optional; an NFR without a named mechanism is a wish.

| # | PDF NFR | Acceptance criterion | Mechanism documented in |
|---|---|---|---|
| 1 | **Usability** — consistent, intuitive, easy to learn and navigate without technical knowledge | A DCCDO completes application review, a filtered send and a status update unaided after one walkthrough. Consistent table/dialog primitives; filters visible and shareable; email preview before any bulk send. | `ARCHITECTURE.md` §8; `CONVENTIONS.md` §2 |
| 2 | **Performance** — common actions and page loads under 3s | Dashboard, member list and search return < 3s against a seeded full-scale dataset. | `ARCHITECTURE.md` §8; Success Metric 4 |
| 3 | **Security** — RBAC on functions and records, encrypted passwords, no access without login, 2FA on password reset | Epic A in full; seven tiers enforced at the data layer. | `ARCHITECTURE.md` §5 |
| 4 | **Reliability** — preserve records, prevent data loss in normal operation | No user-facing delete path exists at all. | `ARCHITECTURE.md` §7; `DATA_MODEL.md` §7 |
| 5 | **Maintainability** — modular structure; documentation for every change or issue | Feature-folder modules; every merged change names the doc it updated or why none. | `CONVENTIONS.md` §1.2, §9; US-K2 |
| 6 | **Data Integrity** — validate required fields and formats before modifying membership records | One validation schema per entity, authored once and enforced on both client and server, plus database CHECK / NOT NULL / UNIQUE constraints. | `ARCHITECTURE.md` §8; `CONVENTIONS.md` §6 |
| 7 | **Availability** — 99.9% for authorized users | Measured and reported monthly with alerting; explicitly **not** a contractual SLA (see Non-Goals). | `ARCHITECTURE.md` §8 |
| 8 | **Compatibility** — correct operation on commonly used browsers | Current Chrome, Edge, Firefox, Safari; desktop and mobile. | `ARCHITECTURE.md` §8 |
| 9 | **Data Privacy** — restrict sensitive information, abide by the Data Privacy Act, delete sensitive information after 5 years in the archive | Epic J in full, including the organizational RA 10173 deliverables (DPO, processing register, DPAs, privacy notice with consent capture, breach procedure) that no technology provides. | `ARCHITECTURE.md` §8; `DATA_MODEL.md` §8 |
| 10 | **Scalability** — ≥ 600 members and 70 officers across ≥ 5 years without significant degradation | Seeded 5-year dataset stays inside the 3s budget. | `DATA_MODEL.md` §10; Success Metric 6 |
| 11 | **Extensibility** — upgradable without complete redevelopment | New capability = a new feature folder plus a migration. Reference data (regions, affiliations, positions, committees, departments) is rows, so most org changes need no deploy at all. | `ARCHITECTURE.md` §8; `DATA_MODEL.md` §13 |
| 12 | **Backup & Recovery** — regular backups against accidental deletion, failure, corruption, attack | Automated, scheduled, at least one copy outside the primary provider, and a restore actually performed and recorded. | US-J4; `DATA_MODEL.md` §11 |


---

## 7. Open Questions Blocking Scope

These are not engineering unknowns — each is a fact about the organization that changes what gets built. Each names the requirement it blocks and the deadline it must beat.

| ID | Question | Blocks | Must be answered by |
|---|---|---|---|
| **OQ-1** | Does START-DOST have a Google Workspace tenant that supports Shared Drives? | Proof-of-enrollment storage design (US-B2). | Before the first real document is uploaded. |
| **OQ-2** | Who is the org's Data Protection Officer, and will START-DOST register with the National Privacy Commission? Privacy notice + consent capture on the application form. | Epic J, and legal launch of the application portal. | Before the application form goes live — consent must be captured at collection. |
| **OQ-3** | How does the system know a member is graduating? (Self-declared on application? Recomputed from year level? CRRD-confirmed at renewal?) | US-G7, the one rule the PDF states as "if and only if". | Before the renewal form ships (v1.2). |
| **OQ-4** | Where does the external recipient list for the Membership Application Form come from — pasted list per campaign, a stored prospects table, or a link published on org social channels? A stored prospects table is itself personal data and needs its own retention basis. | US-G5. | Before v1.1 outreach ships. |
| **OQ-5** | Should the CTO be able to read members' sensitive fields? Default answer here is **no** (least privilege). If yes, it must be a distinct audited role, not a quiet widening. *(The CCDO and Moderators **can** — resolved 2026-09-01. DCTO-PD is covered by the Moderator answer, not this one.)* | Technical Admin tier definition, US-J1. | Before v1.0 role config. |
| **OQ-6** | Should Officers (non-CRRD chiefs/deputies) see member contact information? Default is **no**. If committee heads need it, the answer is a committee-scoped view, not widening all Officers. | US-D2, US-J1, v2 item 34. | Before v1.0 role config. |
| **OQ-7** | ~~Is it CEO/COO or CTO who executes rollover?~~ **RESOLVED 2026-09-01: the CTO leads it — `tech_admin` only.** ~~What are the exact term boundary dates (school year? CBL officer term? do they coincide?)~~ **RESOLVED by the CBL.** Art. V §1: officers serve *"until May of the succeeding year by which they were appointed."* Art. VII §1: membership *"shall remain valid … until the end of term as defined in Article V, Section 1"* — the Constitution defines membership validity by pointing at the officer clause, so **one term serves both** and there is no second academic term to model. And it is **not** the school year: the CBL never mentions the academic calendar, and a May boundary is not the Philippine school year — academic timing rides on `expected_grad_year` instead. The term is 1 June – 31 May; 1 June is the only boundary that puts Exec Board selection (Art. V §2.1, first week of May) inside the outgoing term and Deputy Board selection (§2.2, last week of June) inside the new one. **Residual, and now a scheduling question rather than a schema one:** the exact *day* in May. "May" is a month; 31 May is our reading, and nothing is derived from the day except when rollover is run — one `UPDATE` to change if the CEO prefers the turnover ceremony date. | US-H2 — the highest-stakes operation in the system, run at peak officer turnover. | The day, before the first rollover. |
| **OQ-13** | **Rollover is now single-occupancy.** Only `tech_admin` can roll over a term, and only the CTO holds it. If that seat is vacant at a term boundary — the likeliest moment for it to be vacant — rollover is blocked until someone ships a migration. Do we add an audited, alarmed break-glass path for Executive Admin, or a hard handover gate forbidding the outgoing CTO from vacating before granting? | US-H2; the highest-stakes operation in the system. | Before the first rollover. |
| **OQ-14** | **What exactly can a Moderator do?** The project heads named the DCCDO-C, DCCDO-D and DCTO-PD as moderators but did not enumerate the split against the CCDO. The docs assume: operations yes, structure and access control no. Confirm or correct — in particular whether Moderators may issue Regional Rep send grants, which the PDF phrases as "CRRD officers" (plural). | Moderator tier definition; the `rr_send_grants` policy. | Before v1.0 role config. |
| **OQ-8** | Does the 5-year retention clock start at term end, at record creation, or at the member's last active term? | US-J3 and the wording of the published privacy notice. | Before the privacy notice is published. |
| **OQ-9** | Who holds the budget and the org payment method for recurring costs? A personal card fails at the first graduation. | Continuity of the whole system. | Before launch. |
| **OQ-10** | Does the org own a domain, and what is it? Org email identities (`sys@`, `cto@`, `files@`) must exist before any service account is created. | US-K1 org-owned accounts; email deliverability. | Before any account is created. |
| **OQ-11** | What is the affiliation list at launch, who can create new affiliations, and does an affiliation attach to the person permanently or to the term membership? Default: attaches to the term membership, created by CRRD Admins. | US-G2. | Before the first filtered campaign. |
| **OQ-12** | Do approved members get an account automatically at approval, or only when first needed? Default here: at approval, so acceptance email and portal access arrive together. | US-C5, account volume and credential surface. | Before v1.1 outreach ships. |

**New questions the Constitution itself raises.** These did not exist while the CBL was an assumption. Each is a gap or a collision in the text, not an engineering unknown, and none of them can be settled by editing a document.

| ID | Question | Blocks | Must be answered by |
|---|---|---|---|
| **OQ-15** | **Does Article VI apply to Regional Representatives?** CBL Art. VI opens every section — LOA (§1), Resignation (§2), Impeachment (§3), Vacancy (§4) — on *"members of the Executive Board, Deputy Board, and Committees."* **Regional Representatives are in none of those three bodies.** Art. III §4.6 places them in the CRRD, Art. IV §6.4 gives them substantive duties, Art. V §4.1 counts RR service toward Executive Board eligibility and Art. XII §2.2 gives them a **vote on constitutional amendments** — but no clause lets an RR take a leave of absence, resign a seat, or be dismissed or impeached from one. As written, an absent RR cannot be removed. The system models RR as an officer assignment with a standing, so it *can* record these; the question is whether it constitutionally may. | US-E5, US-E6, US-E7 for the `REGIONAL_REP` position; the RR half of US-F1/F3. | Before v1.0 role config. Fixing it properly is an Art. XII amendment. |
| **OQ-16** | **The DCOO issues AWOL notices but has read-only access.** CBL Art. VI §1.6.1–1.6.2 makes the DCOO — and only the DCOO — the officer who *"shall proceed with the issuance of a formal notice"* of AWOL, which is the step that leads to automatic dismissal under §1.7. The locked role model (2026-09-01) puts the DCOO in the read-only Officer tier. Today the notice is issued outside the system and an Executive Admin records the dismissal with the DCOO named in the note. Do we (a) accept that, (b) give the DCOO a narrow, audited write on officer standing only — which creates a quiet fifth administrator the 2026-09-01 decision forecloses, or (c) amend the role model? Same shape applies to Art. IV §1.3.5, which makes the DCOO the custodian of *"a centralized records management system."* | US-E6; the officer-standing write policy. | Before v1.0 role config. |
| **OQ-17** | **Is the application form's academic-program field constrained to the accredited list?** CBL Art. I §4 enumerates twelve technology-related programs *"or similar in spirit"*, Art. V §3.2 makes enrolment in one a qualification for any position, and Art. VII §2 gives the CRRD a real accreditation workflow (curriculum review, a ≥12-unit threshold, a memorandum co-signed by the Executive Board) whose output lands *"in the succeeding amendment of this Constitution"* (§2.4). So: does the form offer a closed list of twelve, a list plus free text for "similar in spirit", or free text with CRRD adjudicating at review? And does the system run accreditation, or only record the outcome? Default here: **record only** — the PRD asks for no accreditation workflow, and an amendment-paced list is reference data, not an operational table. | US-B1 field design; US-C1 review criteria. | Before the application form goes live. |
| **OQ-18** | **Who collects the confidentiality agreements, and when?** CBL Art. VIII §7.1 requires every officer, committee member and advisor to sign one *"upon assuming their roles"*, and the system makes a current-term acknowledgement a hard precondition for reading any sensitive column (US-J5). On the morning a new term opens, nobody has signed, so every sensitive read fails — correctly, but someone has to own unblocking it inside a day. Who collects and records them (the DCOO as secretariat under Art. IV §1.3, or the CCDO whose department the readers sit in)? Does the org keep a countersigned document, and where? And is the acknowledgement collected before or after roles are granted? | US-J5; the term-rollover runbook (US-K1). | Before the first rollover, and before any real member data exists. |

---

## 8. Traceability

**Two sources of record, and they are not peers.**

| Source | Extraction | Authority over |
|---|---|---|
| START-SYS **Product Requirements Document** PDF (13 pages) | `scratchpad/prd-raw.txt` | **Scope.** What gets built, what does not, and the acceptance bar. |
| START-DOST **Constitution and By-Laws 2026** (39 pages) | `scratchpad/cbl-raw.txt` | **Organizational structure, tenure, separation from office, membership termination and compliance obligations.** |

Where the two touch, the **CBL wins** — on the PRD's own instruction: *"The system will follow the CBL in terms of member status and organizational structure"* (PDF §VI Assumptions). The PRD says what to build; the Constitution says what the org **is**. A CBL provision is not a requirement we chose and can trade away — changing one takes an Art. XII amendment, not a scope call.

This file is a **scope document derived from** those two sources, not a transcription of either.

### 8.1 PDF → this document

| PDF section | Where it lands here |
|---|---|
| §I Problem Statement (general + 5 specific) | §1 |
| §II Target User (primary + secondary) | §2 |
| §III Goals & Success Metrics (8 goals) | §6, one row each |
| §IV Functional Requirements (13) | §3 MVP scope; §5 user stories, each story citing its FR |
| §IV Non-Functional Requirements (12) | §6 NFR register (one row each, all twelve); §5 Epics A, I, J, K; enforcement mechanisms in `ARCHITECTURE.md` §8 |
| §V User Flows (6) | §5 Epics B, C, E, F, G, H |
| §VI Constraints (explicit exclusions) | §4 Non-Goals, first table |
| §VI Assumptions | §4 "Assumptions carried from the PDF", one row each, with what the system does about it. The CBL-consistency assumption is why roles and committees are term-scoped data rather than hardcoded — and the CBL-adherence assumption is **no longer an assumption at all**, since the Constitution is now in hand; see §8.2 and the note above that table |
| §VII Addendum (Proof of Enrollment Upload) | MVP item 6; US-B2; US-J2; US-J3 |

### 8.2 CBL → this document

Every article, including the ones deliberately not acted on, so a reviewer can check the Constitution end to end rather than trusting that nothing was skipped.

| CBL article | What it settles | Where it lands here |
|---|---|---|
| **Art. I §4** — Composition (12 accredited programs, "or similar in spirit") | Who is eligible to be a member at all | OQ-17 (the application form's program field). Deliberately **not** a table — Art. VII §2.4 makes the list amendment-paced. |
| **Art. III §2** — Executive Board (C-Suite), §2.1–2.8 officers, §2.9 Special Advisor | The eight Chiefs, and the Special Advisor as a non-voting seat | §2 Who column, all seven rows. The Special Advisor's read-only tier is justified against Art. III §2.9 + Art. X §2.4–2.5 + Art. X §3.1. |
| **Art. III §3** — Deputy Board, §3.1–3.12 | The twelve Deputies | §2 Moderator tier (DCTO-PD, DCCDO-C, DCCDO-D) and Officer tier (the other nine). |
| **Art. III §4** — Seven Departments, §4.1–4.7 with their Chiefs | Seven departments, fixed, each headed by a named position | MVP items 19 and 28; US-E2; §2 CRRD Admin row (why "create a department" is near-dead in practice). |
| **Art. III §5** — Committees, §5.1–5.4 | Committees are discretionary and per-term; creation runs co-endorsement → COO review → CEO approval; dissolution only with no incumbents | US-E1, US-E2. The approval chain is **not** enforced in software — the PRD asks for no approvals workflow; the system records the committee and audits who created it. |
| **Art. IV §1–§7** — Powers and Duties | Which officer actually owns which function | §2 Who column (CTO ↔ Art. IV §2.1.4; CCDO ↔ §6.1; DCCDO-C ↔ §6.2.1–6.2.2; RR ↔ §6.4); OQ-16 (DCOO ↔ Art. IV §1.3.5). |
| **Art. V §1** — Term of Office ("until May of the succeeding year"), §1.1 mid-term appointees, §1.2 transition inside the term, §1.3 early termination | The term boundary, and that a mid-term appointment never creates an offset term | **OQ-7 resolved.** MVP item 28; US-H2; US-E7; §2 secondary users. |
| **Art. V §2** — Selection (Exec Board ≤ first week of May, Deputy Board ≤ last week of June) | Why the boundary is 1 June and not 1 May | US-H2 (rollover runs end of May). |
| **Art. V §3–§6** — Qualifications | Eligibility to hold a position | Not modelled. The system records who holds a seat, not whether they qualified — that is a selection process, and the PRD asks for none. Touches OQ-17 via §3.2. |
| **Art. VI §1** — Leave of Absence, §1.1–1.4 grounds and process, §1.5–1.6 AWOL, §1.7 dismissal | Standing in office ≠ membership | **US-E5, US-E6.** The 30-day cap is deliberately unenforced (US-E5, last criterion). The DCOO notice-issuer collision is **OQ-16**. |
| **Art. VI §2** — Resignation | A recorded outcome, approved by the CEO | US-E6. |
| **Art. VI §3** — Impeachment, §3.1 grounds (incl. §3.1.3 breach of data privacy), §3.2 process, §3.2.8 "final and irrevocable", §3.3 consequences | Suspension ≠ leave; impeachment is terminal; an impeached officer is still a **member** | US-E6; US-J5 (the consequence side of confidentiality). |
| **Art. VI §4** — Vacancy, §4.1–4.3 acting designations, §4.4 willful vacancy | Vacancy is an absence, not a state; acting officers carry real powers | **US-E7**, and the mitigation OQ-13 was asking for. |
| **Art. VII §1** — Membership Rights and Responsibilities | Membership validity is defined **by the officer-term clause** | OQ-7 resolved; §2 Member row; US-H1. |
| **Art. VII §2** — Program Accreditation | CRRD runs accreditation; output lands in the next amendment | **OQ-17.** Not modelled, not built. |
| **Art. VII §3** — Termination of Membership, §3.1 grounds, §3.2.3 Exec Board vote, §3.2.5–3.2.6 appeal to the Special Advisor | A sixth membership status, and the only reversal in the system | **MVP item 11; US-D3, US-D5, US-D6.** |
| **Art. VIII §6** — Compliance with the Data Privacy Act (RA 10173) | RA 10173 is a **constitutional** obligation here, not only a statutory one | Epic J; NFR register row 9; US-J1, US-J2, US-J3. |
| **Art. VIII §7** — Confidentiality Agreements, §7.1.4 private member data, §7.3 breach → Art. VI §3 or Art. VII §3 | A signed agreement is a precondition for sensitive access, per person per term | **US-J5**; §2 cross-cutting note; **OQ-18**. |
| **Art. VIII §1–§5** — Anti-hazing, drugs, gender inclusivity, VAWC, anti-sexual-harassment | Conduct obligations on members | No system impact. Read and deliberately not acted on — none of them is a record the system keeps. |
| **Art. IX** — Meetings Quorum; **Art. XI** — General Assembly | Meeting mechanics and quorum | No system impact — operations and event management are explicit PRD non-goals (§4). |
| **Art. X** — Advisor, §2.4–2.5 independent review of appeals, §3.1 DOST-SEI employee | Why the Special Advisor is read-only despite sitting with the Executive Board | §2 Officer row; US-D6. |
| **Art. XII** — Amendments, §2.2–2.3 voting body, §4 emergency amendments (2/3, effective immediately, expiring in 90 days) | What happens when the Constitution changes | §4 Assumptions note; §2 CRRD Admin row; OQ-17. An amendment is a **migration that cites the amendment**. |
| **Art. XIII** — Separability and Repealing | — | No system impact. |

**Everything marked *[extrapolated]* is an interpretation, not a requirement from the PDF**, and is listed here so a reviewer can reject any of them without hunting:
- Seven access tiers rather than the PDF's six (Administrators split into Executive / Technical / CRRD, and the CRRD deputies plus the DCTO-PD split out as Moderators).
- Executive Admins cannot delete records (PDF grants oversight, not deletion).
- Technical Admins do not read sensitive fields by default (OQ-5).
- Officers do not see contact details (OQ-6).
- Members reset passwords by emailed one-time code rather than TOTP (US-A4).
- Prior-term visibility follows the same tier rules as current-term visibility (US-H3).
- Proof documents are never publicly shared (US-J2) — implied by the Data Privacy NFR, not stated in the Addendum. **Now also backed by CBL Art. VIII §6 (RA 10173 as a constitutional obligation) and §7.1.4 ("private member data" designated confidential)**, so the interpretation stands on the Constitution as well as on an NFR.
- "Applicant" as a distinct user type; the PDF's §II does not list them, but §V requires their flow.
- The 30-day LOA cap is stated by CBL Art. VI §1 but deliberately **not enforced** in software (US-E5) — that non-enforcement is our decision, not the Constitution's.
- The Art. VI and Art. VII notice periods, hearings and deadlines are recorded as outcomes rather than run as workflows (US-D5, US-E6) — the CBL prescribes the procedure but does not require a system to conduct it.

**Retired by the Constitution.** These carried an *[extrapolated]* marker before the CBL was available and no longer do: the org's positions and their titles (now CBL Art. III §2, §3, §4.6, §5, seeded verbatim); the seven departments and which Chief heads each (Art. III §4); the term boundary (Art. V §1 with Art. VII §1 — OQ-7); the fact that the officer term and the membership term are the same term (Art. VII §1); and that structure and access control sit above the deputy tier (Art. III §5.1–5.2 routes committee creation through the COO and CEO).

**Sibling documents:** `ARCHITECTURE.md` (stack, boundaries, flows), `DATA_MODEL.md` (28 tables, relations, the seeded Constitution, RA 10173 classification), `CONVENTIONS.md` (naming, structure, test placement), `CLAUDE.md` (the working contract), `SCRATCH.md` (disposable LLM scratchpad — never a decision record).
