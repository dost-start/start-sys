// The privacy notice, reachable anonymously (BUILD_PLAN S3-T20 / S7-T21).
//
// `middleware.ts` already excludes `/privacy` from its matcher. This page is a
// hardcoded JSX mirror of `docs/privacy/PRIVACY_NOTICE.md` — S7-T22 is where the two
// get a checked hash so they cannot silently drift; until then, edit both files in
// the same commit (see `lib/privacy/notice-version.ts`).
//
// This page renders NO application data and calls no Server Action: it is static
// content, safe to serve to an anonymous caller with no RLS reasoning involved.
import type { Metadata } from "next";
import Link from "next/link";

import {
  PRIVACY_NOTICE_EFFECTIVE_DATE,
  PRIVACY_NOTICE_VERSION,
} from "@/lib/privacy/notice-version";

export const metadata: Metadata = {
  title: "Privacy Notice — START-DOST",
  description: "How START-SYS collects, uses, and protects your information.",
};

export default function PrivacyNoticePage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-8 px-4 py-10 sm:px-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">START-DOST Privacy Notice</h1>
        <p className="text-sm text-muted-foreground">
          Version {PRIVACY_NOTICE_VERSION} — effective {PRIVACY_NOTICE_EFFECTIVE_DATE}.
        </p>
      </div>

      <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        This notice is written for anyone submitting a START-DOST membership application, not for a
        lawyer. START-DOST has not yet designated a Data Protection Officer or registered with the
        National Privacy Commission. Until that is done, the Chief Community Development Officer
        (CCDO) is the interim contact for any question about this notice or about your data.
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What we collect</h2>
        <p className="text-sm">When you submit a membership application, START-SYS collects:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Personal information</strong> — full name, date of birth, contact number, email
            address, and home address.
          </li>
          <li>
            <strong>Academic information</strong> — your school, school ID number, degree program,
            year level, and expected graduation year.
          </li>
          <li>
            <strong>Membership information</strong> — your region.
          </li>
          <li>
            <strong>Proof of enrollment</strong> — a Certificate of Registration, scholar ID, or
            equivalent document, uploaded as part of your application.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          We do not collect anything beyond what the application form asks for, and the form will
          not let you submit without agreeing to this notice.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Who can see it</h2>
        <p className="text-sm">
          Access is restricted inside the database itself, not just by what a screen chooses to
          show:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            The <strong>CCDO</strong> and the <strong>CEO/COO</strong> can read your full
            application, including your contact details and address, and can view your
            proof-of-enrollment document. Every document view is recorded — who looked, and when.
          </li>
          <li>
            <strong>Moderators</strong> (the CRRD and Technology deputies who review applications
            day-to-day) can read the same information, for the same reason: reviewing an application
            is impossible without reading it.
          </li>
          <li>
            No other role — Officers, Regional Representatives, or ordinary Members — can read your
            application at all.
          </li>
          <li>
            Reading your sensitive information additionally requires the reviewing officer to have
            signed START-DOST&apos;s Confidentiality Agreement for the current term (Constitution
            and By-Laws, Article VIII §7). If they have not, the system refuses the read outright.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Where it is processed</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-medium">Processor</th>
                <th className="py-2 pr-4 font-medium">What it holds</th>
                <th className="py-2 font-medium">Location</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-b [&>tr]:border-border/60">
              <tr>
                <td className="py-2 pr-4">Supabase (database)</td>
                <td className="py-2 pr-4">Your application record</td>
                <td className="py-2">Singapore</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Vercel (hosting)</td>
                <td className="py-2 pr-4">Runs the application while you use it</td>
                <td className="py-2">Singapore</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Google Drive or Supabase Storage</td>
                <td className="py-2 pr-4">
                  Your uploaded proof of enrollment, never shared publicly
                </td>
                <td className="py-2">Google / Supabase data centers</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Resend</td>
                <td className="py-2 pr-4">Delivers system emails</td>
                <td className="py-2">United States</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          Your data is stored outside the Philippines. We use processors in Singapore where possible
          to keep it close to home.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">How long we keep it</h2>
        <p className="text-sm">
          If your application is not approved, or if you never complete it, unfinished
          (&quot;draft&quot;) submissions are cleared automatically after 30 days.
        </p>
        <p className="text-sm">
          If you become a member, your sensitive information is kept for{" "}
          <strong>five years after your last active term</strong> with the organization. After that,
          your birthdate, contact number, address, and school ID are cleared from our records, and
          your proof-of-enrollment document is deleted — on both sides of the storage boundary at
          once. Non-identifying facts (your member ID, join year, region, and status history) are
          kept indefinitely so the organization&apos;s own historical records stay accurate.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your rights under the Data Privacy Act (RA 10173)</h2>
        <p className="text-sm">
          You have the right to know what we hold about you, to ask that inaccurate information be
          corrected, to object to processing, and to file a complaint. To exercise any of these,
          contact the CCDO (interim contact, see the note above) at{" "}
          <a href="mailto:crrd@start-dost.org" className="font-medium underline underline-offset-4">
            crrd@start-dost.org
          </a>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">If something goes wrong</h2>
        <p className="text-sm">
          START-DOST has a pre-drafted breach response procedure, including notification to the
          National Privacy Commission within 72 hours where required. If you believe your data has
          been exposed, contact the CCDO immediately at the address above.
        </p>
      </section>

      <Link href="/apply" className="inline-block text-sm font-medium underline underline-offset-4">
        Back to the application
      </Link>
    </main>
  );
}
