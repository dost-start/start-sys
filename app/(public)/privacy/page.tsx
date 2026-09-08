// The privacy notice, reachable anonymously (BUILD_PLAN S3-T20 / S7-T21).
//
// `middleware.ts` already excludes `/privacy` from its matcher. This page is a
// hardcoded JSX mirror of the applicant-facing half of `docs/privacy/PRIVACY_NOTICE.md`
// — the wording here and there must stay identical, and any change to it is a NEW
// notice version (a new `privacy_notice_versions` row in a migration, with
// `PRIVACY_NOTICE_VERSION` in `lib/privacy/notice-version.ts` bumped in the same
// commit). The maintainer material — processor register, DPO status, legal basis —
// lives below that file's divider and is deliberately not rendered here: this page is
// written for a college reader, in plain words.
//
// This page renders NO application data and calls no Server Action: it is static
// content, safe to serve to an anonymous caller with no RLS reasoning involved.
import type { Metadata } from "next";
import Link from "next/link";

import { BrandBackground } from "@/components/brand/brand-background";
import { Card } from "@/components/ui/card";
import { ORG_CONTACT_EMAIL } from "@/lib/brand/org";

export const metadata: Metadata = {
  title: "Privacy Notice — START-DOST",
  description: "How START-DOST handles the information you give us when you apply.",
};

const SECTION_CLASS = "flex flex-col gap-2";
const HEADING_CLASS = "text-brand-ink text-lg font-semibold";
const BODY_CLASS = "text-brand-body text-sm leading-relaxed sm:text-[15px]";

export default function PrivacyNoticePage() {
  return (
    <main className="brand-surface flex min-h-screen justify-center px-4 py-10 sm:px-8">
      <BrandBackground />
      <Card
        radius="hero"
        className="w-full max-w-[860px] gap-7 self-start px-7 py-10 sm:px-16 sm:py-14"
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-brand-ink text-[28px] font-bold tracking-tight">
            START-DOST Privacy Notice
          </h1>
          <p className="text-muted-foreground text-sm">
            How START-DOST handles the information you give us when you apply.
          </p>
        </div>

        <section className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>What we collect</h2>
          <p className={BODY_CLASS}>
            When you apply, we collect your name, birth date, sex, email, phone number and Facebook
            link. We also collect your home address, your scholarship details, your school and
            program, your region, and two documents: your registration form and your Notice of
            Award.
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>Why we collect it</h2>
          <p className={BODY_CLASS}>
            To check that you are a DOST scholar, and to run your membership. That means your member
            record, your committee, and the emails START-DOST sends you.
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>Who can see it</h2>
          <p className={BODY_CLASS}>
            Only the officers whose job needs it. The CRRD officers and the CEO and COO can see your
            contact details. Other officers and your Regional Representative see your name, member
            ID, region and status. The database itself enforces this, not just the screen.
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>Where it is stored</h2>
          <p className={BODY_CLASS}>
            Our database and app run on servers in Singapore. Your documents are stored in
            START-DOST&apos;s Google Drive. Emails are sent from START-DOST&apos;s Gmail account.
            Your information is stored outside the Philippines.
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>How long we keep it</h2>
          <p className={BODY_CLASS}>
            Five years after your last active term with START-DOST. An application you start but do
            not finish is cleared after 30 days.
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>Your rights</h2>
          <p className={BODY_CLASS}>
            You can ask what we hold about you, ask us to correct it, object to how we use it, or
            file a complaint. These are your rights under the Data Privacy Act. Write to{" "}
            <a
              href={`mailto:${ORG_CONTACT_EMAIL}`}
              className="text-brand-link font-medium underline-offset-4 hover:underline"
            >
              {ORG_CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <section className={SECTION_CLASS}>
          <h2 className={HEADING_CLASS}>If something goes wrong</h2>
          <p className={BODY_CLASS}>
            If your information is ever exposed, START-DOST will tell you and the National Privacy
            Commission within 72 hours.
          </p>
        </section>

        <Link
          href="/apply"
          className="text-brand-link self-start text-sm font-medium underline-offset-4 hover:underline"
        >
          Back to the application
        </Link>
      </Card>
    </main>
  );
}
