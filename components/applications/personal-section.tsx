"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Personal information — the SRS membership form (2026-09-05), step one.
//
// Field `name`s are the zod keys, which are the payload / column names — CONVENTIONS
// §6, no mapping layer. The SRS dropped the school ID; it is not collected here any
// more (0038) and stays removed (ADR 0013 — Ethan, 2026-09-06). Home address RETURNS
// here (ADR 0013 §Consequences, Ethan 2026-09-06 "include home address") as four
// required fields — the design canvas omitted them by mistake; the decision stands.
// Age is computed from the birthdate at review time and never stored.
// ─────────────────────────────────────────────────────────────────────────────

import { useFormContext } from "react-hook-form";

import { Field, FieldError, FieldLabel, FormSection } from "@/components/applications/form-section";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="applicant_given_name">First name</FieldLabel>
          <Input
            id="applicant_given_name"
            autoComplete="given-name"
            aria-invalid={errors.applicant_given_name ? "true" : "false"}
            {...register("applicant_given_name")}
          />
          <FieldError message={errors.applicant_given_name?.message} />
        </Field>
        <Field>
          <FieldLabel htmlFor="middle_name" optional>
            Middle name
          </FieldLabel>
          <Input
            id="middle_name"
            autoComplete="additional-name"
            aria-invalid={errors.middle_name ? "true" : "false"}
            {...register("middle_name")}
          />
          <FieldError message={errors.middle_name?.message} />
        </Field>
        <Field>
          <FieldLabel htmlFor="applicant_family_name">Last name</FieldLabel>
          <Input
            id="applicant_family_name"
            autoComplete="family-name"
            aria-invalid={errors.applicant_family_name ? "true" : "false"}
            {...register("applicant_family_name")}
          />
          <FieldError message={errors.applicant_family_name?.message} />
        </Field>
        <Field>
          <FieldLabel htmlFor="suffix" optional>
            Suffix
          </FieldLabel>
          <Input
            id="suffix"
            placeholder="Jr., III, …"
            autoComplete="honorific-suffix"
            aria-invalid={errors.suffix ? "true" : "false"}
            {...register("suffix")}
          />
          <FieldError message={errors.suffix?.message} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="sex">Sex</FieldLabel>
          <NativeSelect
            id="sex"
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
          </NativeSelect>
          <FieldError message={errors.sex?.message} />
        </Field>
        <Field>
          <FieldLabel htmlFor="birthdate">Date of birth</FieldLabel>
          <Input
            id="birthdate"
            type="date"
            autoComplete="bday"
            aria-invalid={errors.birthdate ? "true" : "false"}
            {...register("birthdate")}
          />
          <FieldError message={errors.birthdate?.message} />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="applicant_email">Email address</FieldLabel>
        <Input
          id="applicant_email"
          type="email"
          autoComplete="email"
          aria-invalid={errors.applicant_email ? "true" : "false"}
          {...register("applicant_email")}
        />
        <FieldError message={errors.applicant_email?.message} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="contact_number">Contact number</FieldLabel>
          <Input
            id="contact_number"
            type="tel"
            placeholder="09171234567"
            autoComplete="tel"
            aria-invalid={errors.contact_number ? "true" : "false"}
            {...register("contact_number")}
          />
          <FieldError message={errors.contact_number?.message} />
        </Field>
        <Field>
          <FieldLabel htmlFor="facebook_account">Facebook account link</FieldLabel>
          <Input
            id="facebook_account"
            type="url"
            inputMode="url"
            placeholder="https://facebook.com/yourname"
            autoComplete="url"
            aria-invalid={errors.facebook_account ? "true" : "false"}
            {...register("facebook_account")}
          />
          <FieldError message={errors.facebook_account?.message} />
        </Field>
      </div>

      <div className="flex flex-col gap-5">
        <h3 className="text-brand-ink text-base font-semibold">Home address</h3>

        <Field>
          <FieldLabel htmlFor="address_line">Street address</FieldLabel>
          <Input
            id="address_line"
            autoComplete="street-address"
            aria-invalid={errors.address_line ? "true" : "false"}
            {...register("address_line")}
          />
          <FieldError message={errors.address_line?.message} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="city_municipality">City / municipality</FieldLabel>
            <Input
              id="city_municipality"
              autoComplete="address-level2"
              aria-invalid={errors.city_municipality ? "true" : "false"}
              {...register("city_municipality")}
            />
            <FieldError message={errors.city_municipality?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="province">Province</FieldLabel>
            <Input
              id="province"
              autoComplete="address-level1"
              aria-invalid={errors.province ? "true" : "false"}
              {...register("province")}
            />
            <FieldError message={errors.province?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="postal_code">Postal code</FieldLabel>
            <Input
              id="postal_code"
              inputMode="numeric"
              placeholder="1100"
              autoComplete="postal-code"
              aria-invalid={errors.postal_code ? "true" : "false"}
              {...register("postal_code")}
            />
            <FieldError message={errors.postal_code?.message} />
          </Field>
        </div>
      </div>
    </FormSection>
  );
}
