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
  /**
   * The PSA's two-digit region code (0057 §2). Carried here so the address cascade can
   * start from OUR eighteen regions — the same list this section's dropdown offers —
   * rather than from a nineteenth copy read out of `psgc_locations`.
   *
   * Nullable because the column is (0057) — a region added before the PSA publishes one
   * has no code. `toPsgcRegions()` filters those out at the picker's boundary.
   */
  psgc_code: string | null;
};

export function MembershipSection({ regions }: { regions: RegionOption[] }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<ApplicationSubmitInput>();

  return (
    // ⚠ NOT the same "Region" as the one on the Personal step.
    //
    // That one is the applicant's HOME address (PSGC, where they are from). This one is
    // the START-DOST region they belong to as a member: it decides which Regional
    // Representative can see them and it prefixes their member ID. A Bicol scholar
    // studying in Manila answers the two differently, and nothing on the form said so —
    // DATA_MODEL.md §2.2 warns they are not the same field, and QA 2026-09-10 (ISSUE-013)
    // found both rendered under the bare word "Region".
    <FormSection
      title="START-DOST region"
      description="The region you represent as a member. This is not always where you live — pick the region of your school, or the chapter you are joining."
    >
      <Field>
        <FieldLabel htmlFor="region_id" required>
          START-DOST region
        </FieldLabel>
        <NativeSelect
          id="region_id"
          aria-invalid={errors.region_id ? "true" : "false"}
          defaultValue=""
          {...register("region_id")}
        >
          <option value="" disabled>
            Select your START-DOST region…
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
