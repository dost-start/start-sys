"use client";

// The one field the renewal form adds to the application body: the member ID. Together
// with the email in the personal section it is the identity `start_renewal()` (0044)
// checks against `people` — a scholar renews with the two things they already hold, and
// never with an account (SRS: members have no accounts). Renders first on step one.

import { useFormContext } from "react-hook-form";

import {
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  FormSection,
} from "@/components/applications/form-section";
import { Input } from "@/components/ui/input";
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
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="member_id">Member ID</FieldLabel>
          <Input
            id="member_id"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 2024-0012"
            aria-invalid={errors.member_id ? "true" : "false"}
            {...register("member_id")}
          />
          <FieldError message={errors.member_id?.message} />
        </Field>
      </div>
      <FieldHint>
        The email address you enter under <strong>Personal information</strong> must be the one
        START-DOST has on file for you. If it has changed, contact CRRD before renewing.
      </FieldHint>
    </FormSection>
  );
}
