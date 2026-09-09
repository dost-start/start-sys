// Shared scaffolding for the public forms (`/apply`, `/renew`) — BUILD_PLAN S3-T17/S3-T18,
// brand edition (2026-09-08). `FormSection` is a titled sub-section INSIDE the one form
// card (no border, no card of its own); the field primitives come from
// `components/ui/field` and are re-exported here so every section file keeps one import.
//
// The four-step structure (Ethan, 2026-09-08: "next page type of way") lives here too:
// the step names, and which schema keys each step owns, so `form.trigger()` before Next
// and the "jump to the lowest step with a server error" logic read one table.
"use client";

import { inputClassName } from "@/components/ui/input";
import type { ApplicationSubmitInput } from "@/lib/applications/schema";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-brand-ink text-lg font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The shared input/select class string, switching border color on error. */
export function fieldClassName(hasError: boolean): string {
  return cn(inputClassName, hasError && "border-destructive");
}

// ─────────────────────────────────────────────────────────────────────────────
// The four steps
// ─────────────────────────────────────────────────────────────────────────────

export const FORM_STEPS = [
  "Personal",
  "Scholarship & School",
  "Documents",
  "Review & Submit",
] as const;

export type FormStep = 1 | 2 | 3 | 4;

export const FIRST_STEP: FormStep = 1;
export const LAST_STEP: FormStep = 4;

export function isFormStep(value: number): value is FormStep {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function nextFormStep(step: FormStep): FormStep {
  return step === 1 ? 2 : step === 2 ? 3 : 4;
}

export function previousFormStep(step: FormStep): FormStep {
  return step === 4 ? 3 : step === 3 ? 2 : 1;
}

/**
 * Which schema keys each step validates before Next advances. Step 3 owns no schema
 * keys — the two documents are held outside react-hook-form — and step 4 owns the
 * consent boxes, which `handleSubmit` validates. The renewal form prepends `member_id`
 * to step 1.
 */
export const APPLICATION_STEP_FIELDS: Record<FormStep, readonly (keyof ApplicationSubmitInput)[]> =
  {
    1: [
      "applicant_given_name",
      "middle_name",
      "applicant_family_name",
      "suffix",
      "sex",
      "birthdate",
      "applicant_email",
      "contact_number",
      "facebook_account",
      "instagram_account",
      "github_account",
      "linkedin_account",
      "address_line",
      "city_municipality",
      "province",
      "postal_code",
    ],
    2: [
      "scholarship_award",
      "award_year",
      "university_id",
      "program_id",
      "year_level",
      "expected_grad_year",
      "region_id",
    ],
    3: [],
    4: ["consent_privacy_notice", "consent_privacy_notice_version", "certify_accuracy"],
  };

/** The step that renders `field`, or `undefined` for a key no step owns. */
export function stepOfField(
  stepFields: Record<FormStep, readonly string[]>,
  field: string,
): FormStep | undefined {
  for (const step of [1, 2, 3, 4] as const) {
    if (stepFields[step].includes(field)) return step;
  }
  return undefined;
}

/**
 * The lowest step among those that own one of `fields`, so a server response with
 * errors on several steps lands the applicant on the first thing to fix. Document
 * errors (`proof_*`, `noa_*`) belong to step 3.
 */
export function lowestStepForFields(
  stepFields: Record<FormStep, readonly string[]>,
  fields: Iterable<string>,
): FormStep | undefined {
  let lowest: FormStep | undefined;
  for (const field of fields) {
    const step =
      field.startsWith("proof_") || field.startsWith("noa_") ? 3 : stepOfField(stepFields, field);
    if (step !== undefined && (lowest === undefined || step < lowest)) lowest = step;
  }
  return lowest;
}
