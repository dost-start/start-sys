"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Academic information — the SRS membership form (2026-09-05), step two.
//
// The form is hardcoded; the CHOICES come from the database (meeting 2026-09-05: "form
// is hardcoded but choices are flexible based on the data"). Universities and programs
// are rows in `universities` and `programs` (0037), loaded by the Server Component and
// passed down as plain options — this client leaf never fetches. Year level is 1..5 per
// the SRS (0038). "Year of Award" is the DOST scholarship year and is NOT the member-ID
// year (that is the year the scholar joins the org).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";

import {
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  FormSection,
} from "@/components/applications/form-section";
import type { RegionOption } from "@/components/applications/membership-section";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  SCHOLARSHIP_AWARD_LABELS,
  SCHOLARSHIP_AWARDS,
  type ApplicationSubmitInput,
} from "@/lib/applications/schema";
import { awardYearOptions } from "@/lib/validation/award-year";

export type UniversityOption = {
  id: string;
  name: string;
  region_id: string;
  city_municipality: string | null;
};

export type ProgramOption = {
  id: string;
  name: string;
};

const YEAR_LEVELS = [1, 2, 3, 4, 5] as const;
const YEAR_LEVEL_LABELS: Record<(typeof YEAR_LEVELS)[number], string> = {
  1: "1st year",
  2: "2nd year",
  3: "3rd year",
  4: "4th year",
  5: "5th year",
};

export function AcademicSection({
  universities,
  programs,
  regions,
}: {
  universities: UniversityOption[];
  programs: ProgramOption[];
  regions: RegionOption[];
}) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<ApplicationSubmitInput>();

  // ── PR E, and the university half of Ethan's cascade ─────────────────────────────
  // The university list is 445 rows (0048 + 0050 — the DOST-SEI placement list plus the
  // LUCs). Rendering all of them meant ~27KB of <option> markup in the HTML and the same
  // list again in the RSC payload, on a form that is filled on mobile data; it also meant
  // scrolling 445 entries to find one school.
  //
  // The region is already a required field on this same step, so it is the natural parent:
  // pick a region, and the select offers that region's schools only. Same data, same
  // props, ~20 options instead of 445 — and it is the shape PR C2's full PSGC cascade will
  // extend rather than replace.
  const selectedRegionId = watch("region_id");

  const byRegion = new Map<string, UniversityOption[]>();
  for (const u of universities) {
    const list = byRegion.get(u.region_id) ?? [];
    list.push(u);
    byRegion.set(u.region_id, list);
  }
  const regionUniversities = selectedRegionId ? (byRegion.get(selectedRegionId) ?? []) : [];
  const selectedRegionName = regions.find((r) => r.id === selectedRegionId)?.name ?? null;

  // A university chosen under a previous region is not a valid answer under the new one,
  // and leaving it selected would submit a school in a region the applicant just changed
  // away from. Cleared on the region change, not on submit, so the applicant SEES it go.
  const lastRegionRef = useRef<string | undefined>(selectedRegionId);
  useEffect(() => {
    if (lastRegionRef.current === selectedRegionId) return;
    lastRegionRef.current = selectedRegionId;
    setValue("university_id", "" as ApplicationSubmitInput["university_id"], {
      shouldValidate: false,
      shouldDirty: false,
    });
  }, [selectedRegionId, setValue]);

  return (
    <FormSection
      title="Scholarship and Academic Information"
      description="From your Notice of Award and current enrollment."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="scholarship_award" required>
            DOST scholarship award
          </FieldLabel>
          <NativeSelect
            id="scholarship_award"
            aria-invalid={errors.scholarship_award ? "true" : "false"}
            defaultValue=""
            {...register("scholarship_award")}
          >
            <option value="" disabled>
              Select…
            </option>
            {SCHOLARSHIP_AWARDS.map((award) => (
              <option key={award} value={award}>
                {SCHOLARSHIP_AWARD_LABELS[award]}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.scholarship_award?.message} />
        </Field>
        <Field>
          <FieldLabel htmlFor="award_year" required>
            Year of award
          </FieldLabel>
          <NativeSelect
            id="award_year"
            aria-invalid={errors.award_year ? "true" : "false"}
            defaultValue=""
            {...register("award_year")}
          >
            <option value="" disabled>
              Select…
            </option>
            {awardYearOptions().map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.award_year?.message} />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="university_id" required>
          University
        </FieldLabel>
        <NativeSelect
          id="university_id"
          aria-invalid={errors.university_id ? "true" : "false"}
          defaultValue=""
          disabled={!selectedRegionId}
          {...register("university_id")}
        >
          <option value="" disabled>
            {selectedRegionId ? "Select your university…" : "Choose your region first…"}
          </option>
          {regionUniversities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.city_municipality ? ` — ${u.city_municipality}` : ""}
            </option>
          ))}
        </NativeSelect>
        {selectedRegionId && regionUniversities.length === 0 ? (
          <FieldHint>
            No DOST-SEI listed school is recorded for {selectedRegionName ?? "this region"} yet.
            Choose the region your school is in, or contact CRRD.
          </FieldHint>
        ) : null}
        <FieldError message={errors.university_id?.message} />
      </Field>

      <Field>
        <FieldLabel htmlFor="program_id" required>
          Program
        </FieldLabel>
        <NativeSelect
          id="program_id"
          aria-invalid={errors.program_id ? "true" : "false"}
          defaultValue=""
          {...register("program_id")}
        >
          <option value="" disabled>
            Select your program…
          </option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <FieldError message={errors.program_id?.message} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="year_level" required>
            Year level
          </FieldLabel>
          <NativeSelect
            id="year_level"
            aria-invalid={errors.year_level ? "true" : "false"}
            defaultValue=""
            {...register("year_level")}
          >
            <option value="" disabled>
              Select…
            </option>
            {YEAR_LEVELS.map((level) => (
              <option key={level} value={level}>
                {YEAR_LEVEL_LABELS[level]}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.year_level?.message} />
        </Field>
        <Field>
          <FieldLabel htmlFor="expected_grad_year" required>
            Expected year of graduation
          </FieldLabel>
          <Input
            id="expected_grad_year"
            inputMode="numeric"
            placeholder="2028"
            aria-invalid={errors.expected_grad_year ? "true" : "false"}
            {...register("expected_grad_year")}
          />
          <FieldError message={errors.expected_grad_year?.message} />
        </Field>
      </div>

      {universities.length === 0 ? (
        <p className="text-destructive text-sm">
          Universities could not be loaded. Reload the page before submitting.
        </p>
      ) : (
        <FieldHint>
          Not listed? Choose the nearest campus and tell CRRD in your email — the list is maintained
          by CRRD and grows as scholars apply.
        </FieldHint>
      )}
    </FormSection>
  );
}
