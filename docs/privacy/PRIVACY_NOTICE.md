# START-DOST Privacy Notice

**Version `v1` — effective 2026-09-01.**

This notice is written for anyone submitting a START-DOST membership application, not
for a lawyer. It mirrors, in plain language, `app/(public)/privacy/page.tsx` — that
page is what a submitter actually sees, and the two must stay in sync (S7-T22 will
enforce that with a checked hash; until then, edit both files in one commit).

> **Drift note (2026-09-06):** this revision adds the "Why we're allowed to collect it"
> section and two processor rows (GitHub Actions, Backblaze B2) that `page.tsx` does not
> yet carry. Neither changes what is collected, retained, or who can read it — both are
> additions, not corrections — so the applicant-facing consent is not invalidated, but
> `page.tsx` should be updated to match in the same lane that next touches it, and this
> note deleted once it does.

> **Status.** START-DOST has not yet designated a Data Protection Officer or
> registered with the National Privacy Commission (see `PRD.md` OQ-2). Until that is
> done, the Chief Community Development Officer (CCDO) is the interim contact for any
> question about this notice or about your data. The mechanisms below — what gets
> collected, who can read it, how long it is kept, and how a breach is handled — are
> built and enforced by the system today; the organizational paperwork around them is
> not finished. See `BUILD_PLAN.md` "RA 10173 — mechanisms vs paperwork" for the full,
> honest accounting.

## What we collect

When you submit a membership application, START-SYS collects:

- **Personal information**: full name, date of birth, contact number, email address,
  and home address.
- **Academic information**: your school, school ID number, degree program, year
  level, and expected graduation year.
- **Membership information**: your region.
- **Proof of enrollment**: a Certificate of Registration, scholar ID, or equivalent
  document, uploaded as part of your application.

We do not collect anything beyond what the application form asks for, and the form
will not let you submit without agreeing to this notice.

## Why we're allowed to collect it

**Your consent, given when you submit the form.** RA 10173 requires a lawful basis for
processing personal data; ours is your affirmative agreement, captured at the moment you
apply — not implied, not pre-ticked, and recorded against the exact version of this notice
you agreed to (see "Version" above). If you do not tick the two consent boxes on the
application form, the form will not let you submit.

## Who can see it

Access to your information is restricted **inside the database itself**, not just by
what a screen chooses to show:

- The **CCDO** (Chief Community Development Officer) and the **CEO/COO** (Executive
  Admins) can read your full application, including your contact details and address,
  and can view your proof-of-enrollment document. Every document view is recorded —
  who looked, and when.
- **Moderators** (the CRRD and Technology deputies who review applications
  day-to-day) can read the same information, for the same reason: reviewing an
  application is impossible without reading it.
- No other role — Officers, Regional Representatives, or ordinary Members — can read
  your application at all.
- Reading your sensitive information additionally requires the reviewing officer to
  have signed START-DOST's Confidentiality Agreement for the current term (Constitution
  and By-Laws, Article VIII §7). If they have not, the system refuses the read outright.

## Where it is processed

Your information is stored and processed by:

| Processor | What it holds | Location |
|---|---|---|
| Supabase (database) | Your application record | Singapore (`ap-southeast-1`) |
| Vercel (hosting) | Runs the application while you use it; does not retain your data afterward | Singapore (`sin1`) |
| Google Drive **or** Supabase Storage | Your uploaded proof-of-enrollment document, never shared publicly | Google/Supabase data centers |
| Resend *(planned, v1.1)* | Will deliver system emails (e.g. account invitations, acceptance emails) once outreach features ship | United States |
| GitHub Actions | Briefly handles an encrypted copy of the whole database — including your record — while producing the nightly backup; never stores it unencrypted | United States |
| Backblaze B2 *(planned)* | Stores the encrypted nightly backup once provisioned (see "Status" note below) | United States / European Union |

**Your data is stored outside the Philippines**, at every processor in this table. We use
processors in Singapore where possible to keep it close to home, and every backup copy is
encrypted before it leaves our database so that no processor in this table — including
GitHub and Backblaze — can read your birthdate, address, contact number, or school ID
without the decryption key, which is held offline by the Technical Admin.

## How long we keep it

If your application is not approved, or if you never complete it, unfinished
("draft") submissions are cleared automatically after 30 days.

If you become a member, your sensitive information is kept for **five years after
your last active term** with the organization. After that, your birthdate, contact
number, address, and school ID are cleared from our records, and your
proof-of-enrollment document is deleted — on both sides of the storage boundary at
once. Non-identifying facts (your member ID, join year, region, and status history)
are kept indefinitely so the organization's own historical records stay accurate.

## Your rights under the Data Privacy Act (RA 10173)

You have the right to know what we hold about you, to ask that inaccurate
information be corrected, to object to processing, and to file a complaint. To
exercise any of these, contact the CCDO (interim contact, see the note above) at
**crrd@start-dost.org**.

## If something goes wrong

START-DOST has a pre-drafted breach response procedure, including notification to
the National Privacy Commission within 72 hours where required. If you believe your
data has been exposed, contact the CCDO immediately at the address above.
