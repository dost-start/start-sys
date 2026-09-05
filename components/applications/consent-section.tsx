// Section 4 of the application form: RA 10173 consent, captured AT COLLECTION
// (BUILD_PLAN S3-T20). Consent obtained after the fact is not consent —
// ARCHITECTURE.md §4.1 step 2 puts the capture on the form itself, and CBL Art. VIII
// §6 makes the Data Privacy Act a constitutional obligation of the organization, not
// merely a statutory one.
//
// The schema (`consentShape` in `lib/applications/schema.ts`) currently has ONE
// required boolean: `consent_privacy_notice`. It is worded below to cover both the
// privacy-notice acknowledgement AND the proof-document handling acknowledgement
// S7-T23 asks for as two separate checkboxes — one checkbox, two sentences, because
// splitting it into a second schema field is an S7 change (it needs the immutable
// `privacy_notice_versions` table to mean anything) and duplicating unenforced UI
// state here would just be a control nobody checks.
//
// `consent_privacy_notice_version` is NOT user-facing: it is a hidden field, pinned
// to `PRIVACY_NOTICE_VERSION`, so "which text did this applicant see" is answerable
// without asking the applicant to read a version string.
"use client";

import Link from "next/link";
import { useFormContext } from "react-hook-form";

import { FieldError, FormSection } from "@/components/applications/form-section";
import type { ApplicationSubmitInput } from "@/lib/applications/schema";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/notice-version";

export function ConsentSection() {
  const {
    register,
    formState: { errors },
  } = useFormContext<ApplicationSubmitInput>();

  return (
    <FormSection title="Privacy and consent" description="Required before you can submit.">
      {/* Not shown to the applicant — pinned to the currently published notice. */}
      <input
        type="hidden"
        defaultValue={PRIVACY_NOTICE_VERSION}
        {...register("consent_privacy_notice_version")}
      />

      <label className="flex items-start gap-3 text-sm leading-relaxed">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 rounded border-input"
          aria-invalid={errors.consent_privacy_notice ? "true" : "false"}
          {...register("consent_privacy_notice")}
        />
        <span>
          I have read the{" "}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-4"
          >
            privacy notice
          </Link>{" "}
          and agree to START-DOST CRRD collecting and processing my personal and academic
          information to review this application. I understand this information is kept for up to
          five years after my last active term with the organization. I also understand that my
          uploaded proof of enrollment is stored securely, is viewed only by authorized reviewers,
          and that every view of it is recorded.
        </span>
      </label>
      <FieldError message={errors.consent_privacy_notice?.message} />

      {/* SRS 2026-09-05: "A tick box certifying accuracy of all information and confirmation
          of understanding that falsification may lead to banning from future START
          activities." Enforced server-side too — z.literal(true) in the shared schema. */}
      <label className="flex items-start gap-3 text-sm leading-relaxed">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 rounded border-input"
          aria-invalid={errors.certify_accuracy ? "true" : "false"}
          {...register("certify_accuracy")}
        />
        <span>
          I certify that all the information I provided is accurate, and I understand that
          falsification of any information or document may lead to my being banned from future START
          activities.
        </span>
      </label>
      <FieldError message={errors.certify_accuracy?.message} />
    </FormSection>
  );
}
