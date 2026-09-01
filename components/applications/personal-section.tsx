// Section 1 of the application form: personal information (BUILD_PLAN S3-T18).
// Reads/writes through `useFormContext` — `application-form.tsx` is the sole
// `<FormProvider>`, so this component never receives `register`/`errors` as props.
// Field `name` attributes are exactly the `applicationSubmitSchema` keys, which are
// exactly the `people` column names (CONVENTIONS.md §6).
"use client";

import { useFormContext } from "react-hook-form";

import {
  FieldError,
  FieldLabel,
  fieldClassName,
  FormSection,
} from "@/components/applications/form-section";
import type { ApplicationSubmitInput } from "@/lib/applications/schema";

export function PersonalSection() {
  const {
    register,
    formState: { errors },
  } = useFormContext<ApplicationSubmitInput>();

  return (
    <FormSection
      title="Personal information"
      description="As it appears on your government or school ID."
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
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="address_line">Street address</FieldLabel>
        <input
          id="address_line"
          autoComplete="address-line1"
          className={fieldClassName(Boolean(errors.address_line))}
          aria-invalid={errors.address_line ? "true" : "false"}
          {...register("address_line")}
        />
        <FieldError message={errors.address_line?.message} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="city_municipality">City / municipality</FieldLabel>
          <input
            id="city_municipality"
            autoComplete="address-level2"
            className={fieldClassName(Boolean(errors.city_municipality))}
            aria-invalid={errors.city_municipality ? "true" : "false"}
            {...register("city_municipality")}
          />
          <FieldError message={errors.city_municipality?.message} />
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="province">Province</FieldLabel>
          <input
            id="province"
            autoComplete="address-level1"
            className={fieldClassName(Boolean(errors.province))}
            aria-invalid={errors.province ? "true" : "false"}
            {...register("province")}
          />
          <FieldError message={errors.province?.message} />
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="postal_code">Postal code</FieldLabel>
          <input
            id="postal_code"
            inputMode="numeric"
            placeholder="1101"
            autoComplete="postal-code"
            className={fieldClassName(Boolean(errors.postal_code))}
            aria-invalid={errors.postal_code ? "true" : "false"}
            {...register("postal_code")}
          />
          <FieldError message={errors.postal_code?.message} />
        </div>
      </div>
    </FormSection>
  );
}
