# START-SYS — What changed, and why (for the CCDO)

**How to read this.** "Built" means it exists in the system right now, ready to review. "Agreed, being built next" means Ethan and the CCDO's team already decided it on 2026-09-06, but the engineering work has not started. Everything here traces back to one of three moments: the team meeting on 2026-09-05, the CCDO's "Questions Roles and Features" document from that same day, or Ethan's written answers on 2026-09-06 after relaying the CCDO's replies. Where a decision has a name attached (an "ADR"), that is a short written record of who decided it and why — ask Ethan if you want to read the full version. Nothing below has gone live for real scholars yet; this is all in development.

---

## Built since 2026-09-05

### 1. Who has access to the system (roles)

**What it is.** The system now matches the access levels the CCDO's own document described, instead of the earlier plan the project heads had drawn up on their own.

**How it works from the user's side.**
- Seven people now count as "administrators": the CEO and COO, the CTO and the Deputy CTO for Product Development, and the CCDO with both her deputies (Community and Development).
- Every other Chief and Deputy — plus the Special Advisor — can log in and look at member and committee information, but cannot edit or approve anything.
- Regional Representatives keep their own separate access, scoped to their own region.
- Members still do not get logins at all. They only ever interact with the system through the public forms (apply, renew).
- The in-between "Moderator" level that used to exist for the two CRRD deputies and the Deputy CTO has been removed — those three people now simply hold the same access as the officer above them (CRRD admin or Technical admin), matching the CCDO's document, which said plainly there is no such thing as a moderator role.

**What CRRD must do or know.** The CCDO's two deputies (Community and Development) now have the same access the CCDO has — they can review and decide applications and renewals, manage committees and departments, and send emails, exactly as she can. Any account that used to be a "moderator" became a CRRD admin automatically — nobody needs to be re-invited. The Deputy CTO's access is set by the CTO.

**Decided by:** Team meeting, 2026-09-05, following the CCDO's "Questions Roles and Features" document; written up 2026-09-06 (decision record ADR 0009). One note from the meeting — that the Deputy COO for Administrative Affairs would also be an administrator — was **not** applied: Ethan decided on 2026-09-06 to follow the CCDO's document, which lists the seven above and nobody else.

---

### 2. The membership application form

**What it is.** The public application form (`/apply`) was rebuilt to match the fields on the CCDO's document, instead of the older, shorter form.

**How it works from the user's side.** An applicant now fills in:
- Sex (male / female / prefer not to say)
- A Facebook profile link
- Their DOST scholarship award type and the year it was awarded
- Their university and their program, both chosen from lists (not typed freely)
- Year level, 1st through 5th year only (previously allowed up to 8th year)
- **Two** documents instead of one: their latest registration form (Certificate of Registration) **and** their DOST Notice of Award
- Two tick boxes: the privacy notice (as before) **and** a new one certifying that everything they entered is accurate, and that giving false information can get them banned from future START activities

Home address and school ID number are **not** currently on the form — see "Agreed, being built next" below, where address is coming back.

**Member IDs changed shape.** A new member's ID is now four digits after the year, for example `2026-0001` instead of the old `2026-001`. The year in the ID is still the year the person **joins START-DOST** — not the year they received their DOST scholarship award, which is now tracked as a separate, new piece of information.

**What CRRD must do or know.**
- The list of universities is a **starter list only** — it was seeded from a general sense of major schools per region because neither the official DOST-SEI list nor a CHED list was available yet. CRRD can and should review and correct it; nothing else in the system depends on the exact list being right on day one.
- The list of 13 eligible programs is the CCDO's own list, entered exactly as given, and closes an old open question about whether the form should offer a fixed list. CRRD can retire a program later (it is never deleted, just marked inactive) if it stops being accredited.
- Everything an applicant submits is visible only through the review screen, and only to CRRD admins and the executive admins (CEO, COO). The technical admins cannot read application details.

**Decided by:** the CCDO's "Questions Roles and Features" document, and the team meeting of 2026-09-05. Built 2026-09-06.

---

### 3. Sending emails and forms

**What it is.** CRRD can now compose and send an email — or send one of the three forms (application invite, committee call, renewal) as a link inside an email — directly from the system, to a filtered list of people.

**How it works from the user's side.**
1. Open the campaigns screen, pick one of the four starting templates (the three form links, or a blank freeform message) or write from scratch.
2. Type the subject and message. Simple formatting is supported (bold, italic, links, lists), typed the way people type it in chat apps like Telegram — no need to know HTML.
3. Personal touches are limited on purpose: you can only insert a person's first name, last name, member ID, year joined, region, island group, term, year level, committee, or department into the message. Nothing more sensitive — like a phone number or birthday — can ever be inserted into a mass email, even by accident.
4. Choose who receives it, by status, year joined, island group, region, role, or affiliation. The system shows exactly how many people match before you send.
5. Lock in the recipient list, then click Send. It sends in batches and shows progress; you can leave and come back, and it will never send the same person twice.
6. Afterward, you see a report of who the message reached and who it failed to reach.

**What CRRD must do or know.**
- The system currently sends through the **START community Gmail account** using something called an "app password" — a special sixteen-character code, not the regular Gmail password. **Dani (the CCDO) needs to generate this herself**: go into that Gmail account's settings → Security → turn on 2-Step Verification if it is not already on → App passwords → create one named "START-SYS". She should hand that code to Ethan privately (never in chat, never posted anywhere) so he can store it securely.
- A regular Gmail account can only send roughly 500 emails a day. A full 600-person send (like acceptance emails) will take about two days. Plan around this for anything time-sensitive.
- There is no automatic "this email bounced" report — if an address is bad, the bounce notice will show up as a regular email in the START inbox, not inside the system's report.
- This is meant as a working stand-in until the org has its own website domain, after which the system can switch to a more capable email provider with one setting change — nothing else about how CRRD uses it will change.

**Decided by:** team meeting, 2026-09-05 (the decision to use the org's Gmail account rather than build against a provider that needs a domain the org doesn't have yet); written up by Ethan Baltazar, 2026-09-06 (decision record ADR 0010).

---

### 4. Regional Representatives can now see contact details for their own region

**What it is.** A Regional Representative's screen used to show only names, member IDs, region, status, and committee for their region — nothing they could actually use to reach a scholar. The team decided that was not useful, and widened it.

**How it works from the user's side.** For their own region only, a Regional Representative can now see each scholar's name, member ID, status, university, email, phone number, and Facebook link. They can filter that list by university. The contact list does not show committee or department (CRRD manages those). A Regional Representative still cannot see any other region, and still cannot edit or delete anything.

**What CRRD must do or know.** This wider view only turns on for a Regional Representative **after** they have signed the confidentiality agreement for the current term — the same rule that already applies to CRRD admins reading full member details. If a newly appointed Regional Representative says their screen looks empty of contact details, the fix is for an executive admin to record that their agreement is on file, not a technical problem. Every time a Regional Rep opens this contact list, it is written to the system's permanent activity log, so there is always a record of who looked at contact information and when.

**Decided by:** team meeting, 2026-09-05; written up by Ethan Baltazar, 2026-09-06 (decision record ADR 0011). This is a deliberate loosening of an earlier, stricter privacy rule — everyone involved agreed it was worth it for Regional Representatives specifically, and only for their own region.

---

### 5. The membership renewal form

**What it is.** A new public form, `/renew`, for scholars who are already members and need to renew for the new term. Like the application form, it needs no account.

**How it works from the user's side.**
1. The scholar goes to `/renew` and types their **member ID and the email on file**. Both must match one existing record, or they are told at once that it did not match (so a typo is caught immediately, rather than the scholar waiting for a decision that will never come).
2. They fill in the same personal and academic details as a fresh application, and upload the same two documents (latest registration form + Notice of Award).
3. CRRD reviews pending renewals on their own screen, opens each one (which is logged), checks the documents, and approves or rejects with a written reason.
4. Approving a renewal creates the scholar's active membership for the new term and updates their details — **their member ID never changes.** `2024-0012` renews as `2024-0012`, term after term.

**What CRRD must do or know.**
- A member whose membership was **terminated** (by an Executive Board vote) cannot renew through this form — the form itself refuses them with a generic message, not their specific status, and directs them to contact CRRD. Reinstating a terminated member is a separate, Executive-Admin-only action.
- Someone who is already active for the current term also cannot submit a duplicate renewal.
- CRRD opens and closes the renewal period the same way they already open and close the application period — from the applications-and-windows screen.
- Unfinished renewal attempts (someone who typed their ID and email but never uploaded documents) are automatically cleared out after 30 days, the same as abandoned applications.

**Decided by:** team meeting, 2026-09-05 (the CCDO's document: "Membership Renewal Form"). Built 2026-09-06. The "no match" answer for a wrong member ID + email pair was Ethan's call on 2026-09-06.

---

## Agreed on 2026-09-06, being built next

These are decided, not yet built:

- When someone submits the application form, the system will now refuse it and explain exactly what's wrong, rather than accepting a bad submission: both documents must be attached; the expected graduation year must be later than the end of the current term (so only current students apply); the program and university must be from the approved lists; the scholarship award type and year must be filled in; and the email must not belong to someone whose membership was terminated (that last case shows only a generic "this email cannot be used to apply, contact CRRD" message, not the reason).
- The system cannot check on its own whether DOST has ended someone's scholarship — the uploaded Notice of Award, plus CRRD's own review of the queue, is the actual safeguard. When the CCDO calls an application "invalid," that means either DOST ended the scholarship or the program isn't on the eligible list.
- After the application period closes, CRRD will be able to click one button — "Approve all" — and every still-pending application gets a member ID at once, in a single batch. CRRD can still reject any individual application before clicking that button. CRRD then sends the acceptance emails as one campaign to everyone approved. There is no rejection email — a bad submission is simply never let in, so nothing needs to be sent about it.
- For renewals: anyone whose membership was **not** terminated can renew while the renewal period is open — there is no additional requirement that they were active last term. The renewal form will keep showing the scholar's name, birthday, email, and member ID for CRRD to compare, and approving a renewal will never overwrite those from what CRRD already has on file.
- Home address is coming back onto the application form. The school ID number field is being removed everywhere.
- START-SYS will become the org's system of record for officer appointments and departures. CRRD will get a screen to appoint anyone to any officer position — for example, replacing someone who goes AWOL or steps down — and to record when someone leaves a position. Creating that person's actual login, though, is expected to stay with the CTO (this is the current default and still needs a final yes from everyone).
- On the Gmail sending account: it is a regular (not Workspace) Gmail account. Dani will create the app password herself (2-Step Verification → App passwords → name it "START-SYS") and hand it to Ethan privately — never typed into chat or committed to the codebase.

---

## Questions still waiting for the CCDO

1. Does CRRD alone decide on committee applications, or does the relevant department's chief also get a say?
2. Should there be an "interview" stage between an application being pending and being approved?
3. When a committee application is "approved," does that only mark the decision — with CRRD assigning the person to the actual committee as a separate step afterward?
4. If someone applies to three departments on one committee application, are those three separate decisions (one department could approve while another rejects), or one decision for the whole application?
5. What does "COC" mean in the list of documents a committee applicant can upload — Certificate of Candidacy? Certificate of Compliance? Certificate of Completion?
6. For the booking-form link shown on each department's committee application — is that link the same every time, or does CRRD set a new one for each call for members?

---

## Who can do what now

| Access level | Who holds it | Can do |
|---|---|---|
| **Executive admin** | CEO, COO | Oversee all records; the only ones who can terminate a membership. Today also the only ones who can record who holds an officer position — changing, see "Agreed" above |
| **Technical admin** | CTO, Deputy CTO for Product Development | Configure the system, create and manage everyone's access, open/close the application and renewal periods, run the once-a-year term rollover |
| **CRRD admin** | CCDO, Deputy CCDO for Community, Deputy CCDO for Development | Manage members, committees and departments; open/close the application and renewal periods; review and decide applications and renewals; compose and send emails and forms; grant Regional Reps permission to send |
| **Officer** | Every other Chief and Deputy, plus the Special Advisor | View member and committee information only — cannot edit or approve anything |
| **Regional Representative** | The Regional Representatives (under the Deputy CCDO for Community) | View and (as of this update) contact their own region's scholars only; cannot edit anything |
| **Member** | Every scholar in the org | No login at all — submits the application and renewal forms only |

---

## Things the system deliberately does NOT do

- It never permanently deletes a member's record. Leaving, graduating, or being removed is recorded as a status change, not an erasure — the history stays.
- Ordinary members do not get logins. Only officers, admins, and Regional Representatives do.
- The activity log that records who did what and when cannot be edited or deleted by anyone — not even the CEO.
- A phone number, address, or birthdate can never be inserted into a mass email — only a short, safe list of fields (name, member ID, region, and similar) can be merged in.
- When an application or renewal period is closed, submissions are refused by the system itself, not by hiding the link — a saved or shared link stops working the moment the period closes.
