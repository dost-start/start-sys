# START-DOST Privacy Notice

How START-DOST handles the information you give us when you apply.

## What we collect

When you apply, we collect your name, birth date, sex, email, phone number and Facebook
link. We also collect your home address, your scholarship details, your school and
program, your region, and two documents: your registration form and your Notice of
Award.

## Why we collect it

To check that you are a DOST scholar, and to run your membership. That means your member
record, your committee, and the emails START-DOST sends you.

## Who can see it

Only the officers whose job needs it. The CRRD officers and the CEO and COO can see your
contact details. Other officers and your Regional Representative see your name, member
ID, region and status. The database itself enforces this, not just the screen.

## Where it is stored

Our database and app run on servers in Singapore. Your documents are stored in
START-DOST's Google Drive. Emails are sent from START-DOST's Gmail account. Your
information is stored outside the Philippines.

## How long we keep it

Five years after your last active term with START-DOST. An application you start but do
not finish is cleared after 30 days.

## Your rights

You can ask what we hold about you, ask us to correct it, object to how we use it, or
file a complaint. These are your rights under the Data Privacy Act. Write to
[crrd@start-dost.org](mailto:crrd@start-dost.org).

## If something goes wrong

If your information is ever exposed, START-DOST will tell you and the National Privacy
Commission within 72 hours.

---

## Maintainer notes (not shown to applicants)

**Version `v2` — effective 2026-09-08.** Supersedes `v1` (effective 2026-09-01). The text
above the divider is what an applicant agrees to and is mirrored word for word by
`app/(public)/privacy/page.tsx`; the two must change together, and any change to that
text is a NEW version — a new `privacy_notice_versions` row (migration `0035` explains
why the register is append-only) carrying this file's sha256, with `PRIVACY_NOTICE_VERSION`
in `lib/privacy/notice-version.ts` bumped in the same commit. The CI step "Guard the
privacy-notice digest against drift" compares the file's digest with the migration's.

> **Drift note (2026-09-06, resolved 2026-09-08).** The 2026-09-06 revision added the
> "Why we're allowed to collect it" section and two processor rows (GitHub Actions,
> Backblaze B2) that `page.tsx` did not carry. The 2026-09-08 rewrite settled the split
> the other way: the page renders only the plain-language text above the divider, and
> everything in this section is maintainer material that is deliberately not shown to
> applicants. Neither change alters what is collected, retained, or who can read it.

> **Status.** START-DOST has not yet designated a Data Protection Officer or
> registered with the National Privacy Commission (see `PRD.md` OQ-2). Until that is
> done, the Chief Community Development Officer (CCDO) is the interim contact for any
> question about this notice or about your data. The mechanisms above — what gets
> collected, who can read it, how long it is kept, and how a breach is handled — are
> built and enforced by the system today; the organizational paperwork around them is
> not finished. See `BUILD_PLAN.md` "RA 10173 — mechanisms vs paperwork" for the full,
> honest accounting.

### Why we're allowed to collect it

**Your consent, given when you submit the form.** RA 10173 requires a lawful basis for
processing personal data; ours is your affirmative agreement, captured at the moment you
apply — not implied, not pre-ticked, and recorded against the exact version of this notice
you agreed to (see "Version" above). If you do not tick the two consent boxes on the
application form, the form will not let you submit.

### Where it is processed — the full register

Your information is stored and processed by:

| Processor | What it holds | Location |
|---|---|---|
| Supabase (database) | Your application record | Singapore (`ap-southeast-1`) |
| Vercel (hosting) | Runs the application while you use it; does not retain your data afterward | Singapore (`sin1`) |
| Google Drive **or** Supabase Storage | Your uploaded proof-of-enrollment documents, never shared publicly | Google/Supabase data centers |
| Gmail (SMTP, interim — ADR 0010) | Delivers system emails from the org's Gmail account until the org owns a domain (OQ-10); Resend is the planned replacement | United States |
| GitHub Actions | Briefly handles an encrypted copy of the whole database — including your record — while producing the nightly backup; never stores it unencrypted | United States |
| Backblaze B2 *(planned)* | Stores the encrypted nightly backup once provisioned (see "Status" note above) | United States / European Union |

**Your data is stored outside the Philippines**, at every processor in this table. We use
processors in Singapore where possible to keep it close to home, and every backup copy is
encrypted before it leaves our database so that no processor in this table — including
GitHub and Backblaze — can read your birthdate, address, contact number, or school ID
without the decryption key, which is held offline by the Technical Admin.
