"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Academic information — the SRS membership form (2026-09-05), section two.
//
// The form is hardcoded; the CHOICES come from the database (meeting 2026-09-05: "form
// is hardcoded but choices are flexible based on the data"). Universities and programs
// are rows in `universities` and `programs` (0037), loaded by the Server Component and
// passed down as plain options — this client leaf never fetches. Year level is 1..5 per
// the SRS (0038). "Year of Award" is the DOST scholarship year and is NOT the member-ID
// year (that is the year the scholar joins the org).
// ─────────────────────────────────────────────────────────────────────────────

import { useFormContext } from "react-hook-form";

import {
  FieldError,
  FieldLabel,
  fieldClassName,
  FormSection,
} from "@/components/applications/form-section";
import type { RegionOption } from "@/components/applications/membership-section";
import {
  SCHOLARSHIP_AWARD_LABELS,
  SCHOLARSHIP_AWARDS,
  type ApplicationSubmitInput,
} from "@/lib/applications/schema";

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

/** The SRS lists 2022–2026; a scholar can hold an older award, so offer ten years back. */
function awardYears(): number[] {
  const current = new Date().getUTCFullYear();
  return Array.from({ length: 11 }, (_, i) => current - i);
}

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
    formState: { errors },
  } = useFormContext<ApplicationSubmitInput>();

  const byRegion = new Map<string, UniversityOption[]>();
  for (const u of universities) {
    const list = byRegion.get(u.region_id) ?? [];
    list.push(u);
    byRegion.set(u.region_id, list);
  }
  const groups = regions
    .filter((r) => byRegion.has(r.id))
    .map((r) => ({ region: r, items: byRegion.get(r.id) ?? [] }));

  return (
    <FormSection
      title="Scholarship and academic information"
      description="From your Notice of Award and current enrollment."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="scholarship_award">DOST scholarship award</FieldLabel>
          <select
            id="scholarship_award"
            className={fieldClassName(Boolean(errors.scholarship_award))}
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
          </select>
          <FieldError message={errors.scholarship_award?.message} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="award_year">Year of award</FieldLabel>
          <select
            id="award_year"
            className={fieldClassName(Boolean(errors.award_year))}
            aria-invalid={errors.award_year ? "true" : "false"}
            defaultValue=""
            {...register("award_year")}
          >
            <option value="" disabled>
              Select…
            </option>
            {awardYears().map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <FieldError message={errors.award_year?.message} />
        </div>
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="university_id">University</FieldLabel>
        <select
          id="university_id"
          className={fieldClassName(Boolean(errors.university_id))}
          aria-invalid={errors.university_id ? "true" : "false"}
          defaultValue=""
          {...register("university_id")}
        >
          <option value="" disabled>
            Select your university…
          </option>
          {groups.map(({ region, items }) => (
            <optgroup key={region.id} label={region.name}>
              {items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.city_municipality ? ` — ${u.city_municipality}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <FieldError message={errors.university_id?.message} />
        {universities.length === 0 ? (
          <p className="text-sm text-destructive">
            Universities could not be loaded. Reload the page before submitting.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Not listed? Choose the nearest campus and tell CRRD in your email — the list is
            maintained by CRRD and grows as scholars apply.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="program_id">Program</FieldLabel>
        <select
          id="program_id"
          className={fieldClassName(Boolean(errors.program_id))}
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
        </select>
        <FieldError message={errors.program_id?.message} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="year_level">Year level</FieldLabel>
          <select
            id="year_level"
            className={fieldClassName(Boolean(errors.year_level))}
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
          </select>
          <FieldError message={errors.year_level?.message} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="expected_grad_year">Expected year of graduation</FieldLabel>
          <input
            id="expected_grad_year"
            inputMode="numeric"
            placeholder="2028"
            className={fieldClassName(Boolean(errors.expected_grad_year))}
            aria-invalid={errors.expected_grad_year ? "true" : "false"}
            {...register("expected_grad_year")}
          />
          <FieldError message={errors.expected_grad_year?.message} />
        </div>
      </div>
    </FormSection>
  );
}
