"use client";

// The one field the renewal form adds to the application body: the member ID. Together
// with the email in the personal section it is the identity `start_renewal()` (0044)
// checks against `people` — a scholar renews with the two things they already hold, and
// never with an account (SRS: members have no accounts).

import { useFormContext } from "react-hook-form";

import {
  FieldError,
  FieldLabel,
  fieldClassName,
  FormSection,
} from "@/components/applications/form-section";
import type { RenewalSubmitInput } from "@/lib/applications/renewal-schema";

export function RenewalIdentitySection() {
  const {
    register,
    formState: { errors },
  } = useFormContext<RenewalSubmitInput>();

  return (
    <FormSection
      title="Your membership"
      description="Your member ID, as issued when you joined. It never changes — a 2024 member renews as 2024-xxxx."
    >
      <div className="space-y-1.5">
        <FieldLabel htmlFor="member_id">Member ID</FieldLabel>
        <input
          id="member_id"
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 2024-0012"
          className={fieldClassName(Boolean(errors.member_id))}
          aria-invalid={errors.member_id ? "true" : "false"}
          {...register("member_id")}
        />
        <FieldError message={errors.member_id?.message} />
      </div>
      <p className="text-xs text-muted-foreground">
        The email address you enter under <strong>Personal information</strong> must be the one
        START-DOST has on file for you. If it has changed, contact CRRD before renewing.
      </p>
    </FormSection>
  );
}
