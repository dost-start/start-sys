// The region block of the application form (BUILD_PLAN S3-T18) — the tail of step two.
//
// `regions` is fetched SERVER-SIDE in `app/(public)/apply/page.tsx` (an anonymous,
// ordinary `select on public.regions`, granted to `anon` in 0015) and passed down as
// a prop — never fetched client-side, so this file needs no Supabase client of its
// own and stays a plain presentational component.
"use client";

import { useFormContext } from "react-hook-form";

import { Field, FieldError, FieldLabel, FormSection } from "@/components/applications/form-section";
import { NativeSelect } from "@/components/ui/native-select";
import type { ApplicationSubmitInput } from "@/lib/applications/schema";

export type RegionOption = {
  id: string;
  code: string;
  name: string;
};

export function MembershipSection({ regions }: { regions: RegionOption[] }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<ApplicationSubmitInput>();

  return (
    <FormSection title="Region" description="Which region are you applying under?">
      <Field>
        <FieldLabel htmlFor="region_id" required>
          Region
        </FieldLabel>
        <NativeSelect
          id="region_id"
          aria-invalid={errors.region_id ? "true" : "false"}
          defaultValue=""
          {...register("region_id")}
        >
          <option value="" disabled>
            Select your region…
          </option>
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </NativeSelect>
        <FieldError message={errors.region_id?.message} />
        {regions.length === 0 ? (
          <p className="text-destructive text-sm">
            Regions could not be loaded. Reload the page before submitting.
          </p>
        ) : null}
      </Field>
    </FormSection>
  );
}
