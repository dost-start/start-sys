// Section 2 of the application form: academic information (BUILD_PLAN S3-T18).
//
// `program` is a free-text input with a `<datalist>` suggesting the CBL Art. I §4
// programs, NOT a `<select>`. OQ-17 (see `lib/applications/schema.ts` header) is
// unresolved and the PRD's default is RECORD ONLY — free text with CRRD adjudicating
// at review — because Art. VII §2 lets a program reach accreditation "in the
// succeeding amendment", so a closed list would refuse a legitimate applicant whose
// program is mid-accreditation. The list below is illustrative, not authoritative;
// verify it against the actual CBL text before treating it as anything more than a
// typing aid.
"use client";

import { useFormContext } from "react-hook-form";

import {
  FieldError,
  FieldLabel,
  fieldClassName,
  FormSection,
} from "@/components/applications/form-section";
import type { ApplicationSubmitInput } from "@/lib/applications/schema";

const YEAR_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Illustrative only — see the header. Not sourced from the CBL text; do not treat as a closed list. */
const SUGGESTED_PROGRAMS = [
  "BS Computer Science",
  "BS Information Technology",
  "BS Computer Engineering",
  "BS Electronics Engineering",
  "BS Electrical Engineering",
  "BS Mechanical Engineering",
  "BS Civil Engineering",
  "BS Industrial Engineering",
  "BS Chemical Engineering",
  "BS Mathematics",
  "BS Physics",
  "BS Statistics",
];

export function AcademicSection() {
  const {
    register,
    formState: { errors },
  } = useFormContext<ApplicationSubmitInput>();

  return (
    <FormSection title="Academic information" description="About your current program of study.">
      <div className="space-y-1.5">
        <FieldLabel htmlFor="school">School</FieldLabel>
        <input
          id="school"
          autoComplete="organization"
          className={fieldClassName(Boolean(errors.school))}
          aria-invalid={errors.school ? "true" : "false"}
          {...register("school")}
        />
        <FieldError message={errors.school?.message} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="school_id_no">School ID number</FieldLabel>
          <input
            id="school_id_no"
            className={fieldClassName(Boolean(errors.school_id_no))}
            aria-invalid={errors.school_id_no ? "true" : "false"}
            {...register("school_id_no")}
          />
          <FieldError message={errors.school_id_no?.message} />
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="program">Degree program</FieldLabel>
          <input
            id="program"
            list="program-suggestions"
            placeholder="e.g. BS Computer Science"
            className={fieldClassName(Boolean(errors.program))}
            aria-invalid={errors.program ? "true" : "false"}
            {...register("program")}
          />
          <datalist id="program-suggestions">
            {SUGGESTED_PROGRAMS.map((program) => (
              <option key={program} value={program} />
            ))}
          </datalist>
          <FieldError message={errors.program?.message} />
        </div>
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
                Year {level}
              </option>
            ))}
          </select>
          <FieldError message={errors.year_level?.message} />
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="expected_grad_year">Expected graduation year</FieldLabel>
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
