// The member record edit form (BUILD_PLAN S5-T27; PRD US-D1).
//
// Bound to `memberUpdateSchema` — THE SAME MODULE `updateMemberRecord` re-parses
// server-side (CONVENTIONS.md §6). `expected_updated_at` travels as a hidden field:
// it is the value this form LOADED, and `update_member_record()` compares it under
// `FOR UPDATE` before writing (S5-T7). A mismatch raises 40001, mapped to `conflict`.
//
// ⚠ ON `conflict` THIS FORM DOES NOT SILENTLY RETRY OR MERGE. It shows an explicit
// banner and stops. Retrying with the caller's own (now stale) values would silently
// overwrite whatever the other edit just wrote — the exact outcome US-D1 forbids.
//
// ⚠ NO `member_id` OR `join_year` INPUT EXISTS ON THIS FORM, and none may be added.
// `MEMBER_PATCHABLE_KEYS` (lib/members/schema.ts) does not include them, and offering
// them here would invite the one thing PRD US-C4 forbids.
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updateMemberRecord } from "@/lib/members/actions";
import { memberUpdateSchema, type MemberUpdateInput } from "@/lib/members/schema";
import type { MemberRecord } from "@/lib/members/types";
import {
  SCHOLARSHIP_AWARD_LABELS,
  SCHOLARSHIP_AWARDS,
  SEX_LABELS,
  SEX_OPTIONS,
} from "@/lib/applications/schema";

function toDefault(value: string | null): string {
  return value ?? "";
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function MemberEditForm({ record }: { record: MemberRecord }) {
  const [conflict, setConflict] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MemberUpdateInput>({
    // `memberUpdateSchema` preprocesses several fields (`"" -> null`), which gives it
    // an input type distinct from its output type. `zodResolver`'s inferred type is
    // therefore not directly assignable to `Resolver<MemberUpdateInput>` even though
    // the runtime behaviour is exactly what this form needs — RHF still hands the
    // callback the OUTPUT shape after validation. A known zodResolver + preprocess
    // interaction, not a real type error.
    resolver: zodResolver(memberUpdateSchema) as unknown as Resolver<MemberUpdateInput>,
    defaultValues: {
      person_id: record.id,
      expected_updated_at: record.updated_at,
      given_name: record.given_name,
      middle_name: toDefault(record.middle_name),
      family_name: record.family_name,
      suffix: toDefault(record.suffix),
      birthdate: toDefault(record.birthdate),
      contact_number: toDefault(record.contact_number),
      personal_email: toDefault(record.personal_email),
      address_line: toDefault(record.address_line),
      city_municipality: toDefault(record.city_municipality),
      province: toDefault(record.province),
      postal_code: toDefault(record.postal_code),
      school: toDefault(record.school),
      school_id_no: toDefault(record.school_id_no),
      sex: (record.sex ?? "") as MemberUpdateInput["sex"],
      facebook_account: toDefault(record.facebook_account),
      scholarship_award: (record.scholarship_award ?? "") as MemberUpdateInput["scholarship_award"],
      award_year: (record.award_year === null
        ? ""
        : String(record.award_year)) as unknown as MemberUpdateInput["award_year"],
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setConflict(false);
    setFormError(null);
    setSaved(false);

    const result = await updateMemberRecord(values);

    if (!result.ok) {
      if (result.error.code === "conflict") {
        setConflict(true);
        return;
      }
      if (result.error.fields) {
        for (const [field, messages] of Object.entries(result.error.fields)) {
          const first = messages[0];
          if (first) setError(field as keyof MemberUpdateInput, { message: first });
        }
        return;
      }
      setFormError(result.error.message);
      return;
    }

    setSaved(true);
  });

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <input type="hidden" {...register("person_id")} />
      <input type="hidden" {...register("expected_updated_at")} />

      {conflict ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          This record was changed by someone else since you opened it. Reload the page to see the
          current values before saving again.
        </div>
      ) : null}

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      {saved ? <p className="text-sm text-green-700 dark:text-green-400">Saved.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="given_name">First name</Label>
          <input id="given_name" className={inputClass} {...register("given_name")} />
          <FieldError message={errors.given_name?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="middle_name">Middle name</Label>
          <input id="middle_name" className={inputClass} {...register("middle_name")} />
          <FieldError message={errors.middle_name?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="family_name">Last name</Label>
          <input id="family_name" className={inputClass} {...register("family_name")} />
          <FieldError message={errors.family_name?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="suffix">Suffix</Label>
          <input id="suffix" className={inputClass} {...register("suffix")} />
          <FieldError message={errors.suffix?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="birthdate">Date of birth</Label>
          <input id="birthdate" type="date" className={inputClass} {...register("birthdate")} />
          <FieldError message={errors.birthdate?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact_number">Contact number</Label>
          <input id="contact_number" className={inputClass} {...register("contact_number")} />
          <FieldError message={errors.contact_number?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="personal_email">Personal email</Label>
          <input
            id="personal_email"
            type="email"
            className={inputClass}
            {...register("personal_email")}
          />
          <FieldError message={errors.personal_email?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="address_line">Street address</Label>
          <input id="address_line" className={inputClass} {...register("address_line")} />
          <FieldError message={errors.address_line?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city_municipality">City / municipality</Label>
          <input id="city_municipality" className={inputClass} {...register("city_municipality")} />
          <FieldError message={errors.city_municipality?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="province">Province</Label>
          <input id="province" className={inputClass} {...register("province")} />
          <FieldError message={errors.province?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="postal_code">Postal code</Label>
          <input id="postal_code" className={inputClass} {...register("postal_code")} />
          <FieldError message={errors.postal_code?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="school">School</Label>
          <input id="school" className={inputClass} {...register("school")} />
          <FieldError message={errors.school?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="school_id_no">School ID number</Label>
          <input id="school_id_no" className={inputClass} {...register("school_id_no")} />
          <FieldError message={errors.school_id_no?.message} />
        </div>
      </div>

      {/* SRS 2026-09-05 profile fields (0038). University and program are chosen from the
          reference tables on the application form and corrected here by id is not a
          reviewer's job — they stay read-only in the panel above. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sex">Sex</Label>
          <select id="sex" className={inputClass} {...register("sex")}>
            <option value="">—</option>
            {SEX_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {SEX_LABELS[option]}
              </option>
            ))}
          </select>
          <FieldError message={errors.sex?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="facebook_account">Facebook account link</Label>
          <input
            id="facebook_account"
            type="url"
            className={inputClass}
            {...register("facebook_account")}
          />
          <FieldError message={errors.facebook_account?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scholarship_award">DOST scholarship award</Label>
          <select id="scholarship_award" className={inputClass} {...register("scholarship_award")}>
            <option value="">—</option>
            {SCHOLARSHIP_AWARDS.map((award) => (
              <option key={award} value={award}>
                {SCHOLARSHIP_AWARD_LABELS[award]}
              </option>
            ))}
          </select>
          <FieldError message={errors.scholarship_award?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="award_year">Year of award</Label>
          <input
            id="award_year"
            inputMode="numeric"
            className={inputClass}
            {...register("award_year")}
          />
          <FieldError message={errors.award_year?.message} />
        </div>
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
