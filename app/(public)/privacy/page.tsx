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
import { PublicHomeLink } from "@/components/brand/public-home-link";
import { Card } from "@/components/ui/card";
import { orgContactEmail } from "@/lib/brand/org-contact";

export const metadata: Metadata = {
  title: "Privacy Notice — START-DOST",
  description: "How START-DOST handles the information you give us when you apply.",
};

const SECTION_CLASS = "flex flex-col gap-2";
const HEADING_CLASS = "text-brand-ink text-lg font-semibold";
const BODY_CLASS = "text-brand-body text-sm leading-relaxed sm:text-[15px]";

// A7: the contact address is resolved from the environment PER REQUEST, not baked in at
// build time. Without this the page prerenders static, freezes whatever `MAIL_REPLY_TO`
// held during `next build`, and keeps printing it after the org changes its mailbox —
// which is the same class of defect as the hardcoded constant this replaced.
export const dynamic = "force-dynamic";

export default function PrivacyNoticePage() {
  // A7: derived from the mail environment, not a constant on a domain the org does not
  // own. The address in a privacy notice is the one a data subject exercises their RA
  // 10173 rights through, so it has to be a mailbox somebody actually reads.
  const contactEmail = orgContactEmail();

  return (
    <main className="brand-surface flex min-h-screen flex-col items-center px-4 py-10 sm:px-8">
      <BrandBackground />
      {/* Officer feedback 2026-09-11: a way back to the splash page. Navigation, not notice
          text — the card below is unchanged. */}
      <div className="flex w-full max-w-[860px] flex-col gap-4">
        <PublicHomeLink />
        <Card radius="hero" className="w-full gap-7 px-7 py-10 sm:px-16 sm:py-14">
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
              When you apply, we collect your name, birth date, sex, email, phone number and
              Facebook link, and — only if you give them — your Instagram, GitHub and LinkedIn
              links. We also collect your home address and the current address you live at while
              studying, your scholarship details, your school and program, your region, and two
              documents: your registration form and your Notice of Award.
            </p>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={HEADING_CLASS}>Why we collect it</h2>
            <p className={BODY_CLASS}>
              To check that you are a DOST scholar, and to run your membership. That means your
              member record, your committee, and the emails START-DOST sends you.
            </p>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={HEADING_CLASS}>Who can see it</h2>
            <p className={BODY_CLASS}>
              Only the officers whose job needs it. The CRRD officers and the CEO and COO can see
              your contact details. Your Regional Representative can see the email, phone number,
              Facebook link and university of the scholars in their own region, which includes you
              if you are in theirs. Every other officer sees only your name, member ID, region and
              status. The database itself enforces this, not just the screen.
            </p>
          </section>

          {/*
          Corrected 2026-09-10: production now runs DOCUMENT_STORE=drive (ADR 0018), so the
          two documents are in START-DOST's own Google Drive and Google is a processor. The
          previous wording — "stored there too", meaning the Singapore project — became
          false the moment the variable changed, and this page is what an applicant ticks a
          consent box against. It must move in the SAME PR as the variable; on 2026-09-10 it
          did not, and this is that correction.

          Word for word with docs/privacy/PRIVACY_NOTICE.md — the CI digest guard compares
          the file's sha256 against the newest privacy_notice_versions row.
        */}
          <section className={SECTION_CLASS}>
            <h2 className={HEADING_CLASS}>Where it is stored</h2>
            <p className={BODY_CLASS}>
              Our database and app run on servers in Singapore. Your two documents are kept in
              START-DOST&apos;s own Google Drive, which means Google stores them on its servers.
              Emails are sent from START-DOST&apos;s Gmail account. Your information is stored
              outside the Philippines.
            </p>
          </section>

          {/* PR D — draft autosave puts a birthdate and an address in the applicant's own
            browser. Disclosed here rather than left implicit. */}
          <section className={SECTION_CLASS}>
            <h2 className={HEADING_CLASS}>On your own device</h2>
            <p className={BODY_CLASS}>
              While you are filling in the application or renewal form, what you have typed is saved
              in your own browser on the device you are using, so that you can close the page and
              come back. This never leaves your device and START-DOST cannot see it. Your uploaded
              documents are never saved this way. It is removed as soon as you submit, and there is
              a <span className="text-brand-ink font-semibold">Clear the saved draft</span> button
              on the form if you want it gone sooner — worth using if you are on a shared or public
              computer.
            </p>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={HEADING_CLASS}>How long we keep it</h2>
            <p className={BODY_CLASS}>
              Five years after your last active term with START-DOST. An application you start but
              do not finish is cleared after 30 days.
            </p>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={HEADING_CLASS}>Your rights</h2>
            <p className={BODY_CLASS}>
              You can ask what we hold about you, ask us to correct it, object to how we use it, or
              file a complaint. These are your rights under the Data Privacy Act. Write to{" "}
              <a
                href={`mailto:${contactEmail}`}
                className="text-brand-link font-medium underline-offset-4 hover:underline"
              >
                {contactEmail}
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
      </div>
    </main>
  );
}
