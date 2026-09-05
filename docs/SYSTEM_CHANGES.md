# START-SYS — What changed, and why (for the CCDO)

**How to read this.** "Built" means it exists in the system right now, ready to review. "Still open" means a default is in place but someone still has to say yes, or do something outside the system. Everything here traces back to one of three moments: the team meeting on 2026-09-05, the CCDO's "Questions Roles and Features" document from that same day, or Ethan's written answers on 2026-09-06 after relaying the CCDO's replies. Where a decision has a name attached (an "ADR"), that is a short written record of who decided it and why — ask Ethan if you want to read the full version. Nothing below has gone live for real scholars yet; this is all in development.

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

Home address is on the form again (section 8 below). The school ID number is no longer collected anywhere.

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

### 6. Bad submissions are refused on the spot (both forms)

**What it is.** The application form and the renewal form now check the membership standards the CCDO listed **before** accepting a submission. A submission that fails is not stored as "pending" at all — the applicant sees exactly which fields to fix and can resubmit.

**How it works from the user's side.** On submit, the system checks that:
- both documents are attached (latest registration form and Notice of Award);
- the expected graduation year is later than the end of the current term — so only current students get in;
- the program and the university are both chosen from the approved lists;
- the scholarship award type is one of the DOST-SEI programs and the year of award is a real year;
- the email does not belong to someone whose membership was terminated. That case shows only "This email address cannot be used to apply. Please contact CRRD." — never the reason.

Every other failure is highlighted on the exact field. The check runs inside the database itself, so it cannot be skipped by someone bypassing the web form.

**What CRRD must do or know.** The system still cannot tell whether DOST has actually ended someone's scholarship — the uploaded Notice of Award and CRRD's own look at the queue remain the real safeguard for that. On the review screen, every pending row now shows a "Standards" column: "meets" or the list of what fails, so CRRD can see at a glance which rows the batch (next section) will take.

**Decided by:** the CCDO's answer of 2026-09-05 ("automatic as long as it meets the standards"), Ethan's answers of 2026-09-06 (decision record ADR 0013). Built 2026-09-06.

---

### 7. "Approve all" — one batch after the period closes

**What it is.** Instead of approving applications one by one, CRRD clicks **Approve all** once the application period is closed. Every still-pending application **and** every pending renewal that meets the standards is approved in one go and gets its member ID.

**How it works from the user's side.**
1. Close the application period on the periods screen.
2. On the applications screen, click **Approve all**. A confirmation shows how many rows will be approved and how many will be skipped (with the reason for each skip).
3. Confirm. The batch runs in the database as one operation; rows that fail a standard are left pending with their reasons shown, and nothing else is touched.
4. Send the acceptance emails as one campaign to everyone approved (section 3). There is no rejection email — a bad submission was never let in, so there is nothing to send.

**What CRRD must do or know.**
- The button refuses to run while the application period is still open. That is deliberate: the batch is meant to happen once, after the deadline.
- CRRD can still reject any individual application before running the batch; rejected rows are never picked up.
- Running it twice is harmless — already-approved rows are skipped.
- Only CRRD admins and the executive admins can run it. The activity log records one summary line per batch, plus the usual entry for every individual approval.

**Decided by:** Ethan, 2026-09-06, on the CCDO's "one batch" answer (decision record ADR 0013). Built 2026-09-06.

---

### 8. Renewal rules, home address, school ID

**What it is.** Three smaller changes from the same 2026-09-06 answers.

- **Who can renew.** Anyone whose membership was **not** terminated can renew while the renewal period is open — there is no extra requirement that they were active last term. The same standards as section 6 apply to a renewal.
- **What a renewal changes.** The renewal form keeps showing the scholar's name, birthday, email and member ID so CRRD can compare them, but approving a renewal **never** overwrites those from what CRRD already has on file. It updates only the things that legitimately change: contact number, home address, Facebook link, sex, scholarship award and year, university, program, year level, expected graduation year, region.
- **Home address is back** on both forms (street, city or municipality, province, postal code). The **school ID number is gone** from every form and every screen; it is no longer collected.

**Decided by:** Ethan, 2026-09-06 (decision record ADR 0013). Built 2026-09-06.

---

### 9. CRRD records officer appointments and departures

**What it is.** START-SYS is now the org's system of record for who holds which officer position. A new **Officers** screen lists every position in the Constitution for the current term and who sits in it — and CRRD admins can record appointments and departures for **any** position, not only their own department's.

**How it works from the user's side.**
- **Appoint.** Pick the position, find the person, tick "acting" if it is a temporary designation (for example a deputy standing in for a Chief who left), and write a short note on the basis — at least ten characters, for example "Appointed by the CEO on 2026-09-10 to replace the outgoing CTO."
- **Record a departure or change of standing.** From a sitting officer's row: on leave, return from leave, suspended, resigned, dismissed (AWOL), impeached, or ended — again with a note. The system only offers the moves the Constitution allows; for example an impeachment is final and cannot be undone.
- The position a departed officer held simply shows as vacant until someone is appointed.

**What CRRD must do or know.**
- CRRD **records** the decision; it does not **make** it. Who decides is still whoever the Constitution says — the CEO approves leave and resignations, the Executive Board votes on impeachments, the Deputy COO issues an AWOL notice. Put that basis in the note.
- Recording an appointment does **not** create the person's login. Creating and removing logins stays with the CTO (this is the current default and still needs a final yes from everyone — see below).
- Removing someone from a position does not touch their membership. An officer who steps down is still a member.
- Every change is written to the activity log with who recorded it.

**Decided by:** Ethan, 2026-09-06 — "it's an HR system that will be used by CRRD … any position" (decision record ADR 0012). Built 2026-09-06.

---

### 10. Choosing exactly who gets an email

**What it is.** The campaign screen used to show CRRD a count of how many people matched their filters. Now it shows the actual people, one tick box each, so CRRD can add or leave out specific individuals rather than trusting the filters to get everyone right.

**How it works from the user's side.**
- The filters gained four more ways to narrow the list — department, committee, university, and year level — alongside the ones already there (status, year joined, region, island group, role, affiliation).
- Under the filters, the list of everyone the filters currently match appears, showing name, member ID, region, department, committee, and position for each person — **never their email address.**
- A checkbox at the top, "Everyone matching the filters," is ticked by default and takes the whole matching list. Untick it to start from nobody, untick a single row to drop that one person, or tick someone who isn't in the filtered list to add them anyway.
- A search box finds a person by name or member ID, for pulling in one or two specific people without paging through the whole list.
- Changing the filters afterward doesn't undo anyone CRRD ticked or unticked by hand — a hand-pick sticks.
- The number shown is exactly who the send will go to.
- Once that number passes about 400, a note explains that Gmail's daily sending limit means the send will spill into a second day and pick back up on its own — nothing to do differently, just something to plan around for a time-sensitive send.

**What CRRD must do or know.**
- The picker never shows an email address, a phone number, or a birthday, no matter who is looking — the same rule that already keeps those out of mail-merged messages applies here.
- The 400 mark is a heads-up, not a limit on what CRRD can send — the system already resumes automatically the next day if Gmail's daily cap is hit partway through (see the campaigns runbook).
- Only CRRD admins and the executive admins see this screen, the same access rule as composing and sending itself.

**Decided by:** Ethan, 2026-09-06, defaults accepted.

---

## Still open

Decided or defaulted, waiting for a final word or an action:

- **Login creation stays with the CTO** even though CRRD now records appointments. Default; needs a yes from the CTO and the CCDO.
- **"Approve all" refuses while the period is open.** Default; say if CRRD would rather be able to run it mid-period.
- **Renewals are approved inside the same batch** as applications. Default; say if renewals should be decided separately.
- **Gmail app password.** The sending account is a regular Gmail account. Dani creates the app password herself (2-Step Verification → App passwords → name it "START-SYS") and hands it to Ethan privately — never typed into chat or committed to the codebase. Until then the system cannot send real email.

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
| **Executive admin** | CEO, COO | Oversee all records; the only ones who can terminate a membership; record officer appointments and departures; run "Approve all" |
| **Technical admin** | CTO, Deputy CTO for Product Development | Configure the system, create and manage everyone's access, open/close the application and renewal periods, run the once-a-year term rollover |
| **CRRD admin** | CCDO, Deputy CCDO for Community, Deputy CCDO for Development | Manage members, committees and departments; open/close the application and renewal periods; review and decide applications and renewals, one by one or with "Approve all"; record officer appointments and departures for any position; compose and send emails and forms; grant Regional Reps permission to send |
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
