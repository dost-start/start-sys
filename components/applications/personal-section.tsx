"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Personal information — the SRS membership form (2026-09-05), section one.
//
// Field `name`s are the zod keys, which are the payload / column names — CONVENTIONS
// §6, no mapping layer. The SRS dropped the address block and the school ID; they are
// not collected here any more (0038). Age is computed from the birthdate at review time
// and never stored.
// ─────────────────────────────────────────────────────────────────────────────

import { useFormContext } from "react-hook-form";

import {
  FieldError,
  FieldLabel,
  fieldClassName,
  FormSection,
} from "@/components/applications/form-section";
import { SEX_LABELS, SEX_OPTIONS, type ApplicationSubmitInput } from "@/lib/applications/schema";

export function PersonalSection() {
  const {
    register,
    formState: { errors },
  } = useFormContext<ApplicationSubmitInput>();

  return (
    <FormSection
      title="Personal information"
      description="As it appears on your Notice of Award and school records."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="applicant_given_name">First name</FieldLabel>
          <input
            id="applicant_given_name"
            autoComplete="given-name"
            className={fieldClassName(Boolean(errors.applicant_given_name))}
            aria-invalid={errors.applicant_given_name ? "true" : "false"}
            {...register("applicant_given_name")}
          />
          <FieldError message={errors.applicant_given_name?.message} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="middle_name" optional>
            Middle name
          </FieldLabel>
          <input
            id="middle_name"
            autoComplete="additional-name"
            className={fieldClassName(Boolean(errors.middle_name))}
            aria-invalid={errors.middle_name ? "true" : "false"}
            {...register("middle_name")}
          />
          <FieldError message={errors.middle_name?.message} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="applicant_family_name">Last name</FieldLabel>
          <input
            id="applicant_family_name"
            autoComplete="family-name"
            className={fieldClassName(Boolean(errors.applicant_family_name))}
            aria-invalid={errors.applicant_family_name ? "true" : "false"}
            {...register("applicant_family_name")}
          />
          <FieldError message={errors.applicant_family_name?.message} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="suffix" optional>
            Suffix
          </FieldLabel>
          <input
            id="suffix"
            placeholder="Jr., III, …"
            autoComplete="honorific-suffix"
            className={fieldClassName(Boolean(errors.suffix))}
            aria-invalid={errors.suffix ? "true" : "false"}
            {...register("suffix")}
          />
          <FieldError message={errors.suffix?.message} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="sex">Sex</FieldLabel>
          <select
            id="sex"
            className={fieldClassName(Boolean(errors.sex))}
            aria-invalid={errors.sex ? "true" : "false"}
            defaultValue=""
            {...register("sex")}
          >
            <option value="" disabled>
              Select…
            </option>
            {SEX_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {SEX_LABELS[option]}
              </option>
            ))}
          </select>
          <FieldError message={errors.sex?.message} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="birthdate">Date of birth</FieldLabel>
          <input
            id="birthdate"
            type="date"
            autoComplete="bday"
            className={fieldClassName(Boolean(errors.birthdate))}
            aria-invalid={errors.birthdate ? "true" : "false"}
            {...register("birthdate")}
          />
          <FieldError message={errors.birthdate?.message} />
        </div>
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="applicant_email">Email address</FieldLabel>
        <input
          id="applicant_email"
          type="email"
          autoComplete="email"
          className={fieldClassName(Boolean(errors.applicant_email))}
          aria-invalid={errors.applicant_email ? "true" : "false"}
          {...register("applicant_email")}
        />
        <FieldError message={errors.applicant_email?.message} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="contact_number">Contact number</FieldLabel>
          <input
            id="contact_number"
            type="tel"
            placeholder="09171234567"
            autoComplete="tel"
            className={fieldClassName(Boolean(errors.contact_number))}
            aria-invalid={errors.contact_number ? "true" : "false"}
            {...register("contact_number")}
          />
          <FieldError message={errors.contact_number?.message} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="facebook_account">Facebook account link</FieldLabel>
          <input
            id="facebook_account"
            type="url"
            inputMode="url"
            placeholder="https://facebook.com/yourname"
            autoComplete="url"
            className={fieldClassName(Boolean(errors.facebook_account))}
            aria-invalid={errors.facebook_account ? "true" : "false"}
            {...register("facebook_account")}
          />
          <FieldError message={errors.facebook_account?.message} />
        </div>
      </div>
    </FormSection>
  );
}
