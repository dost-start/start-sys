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

import {
  PsgcAddressPicker,
  type PsgcRegionOption,
} from "@/components/applications/psgc-address-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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

export function MemberEditForm({
  record,
  regions,
}: {
  record: MemberRecord;
  /** For the two PSGC address pickers (PR C2). Read server-side; plain reference data. */
  regions: PsgcRegionOption[];
}) {
  const [conflict, setConflict] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
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
      postal_code: toDefault(record.postal_code),
      // PR C2: the picker owns the code; city and province are derived and no longer
      // editable here, because a typed name beside a code that disagrees is a member
      // filed under a city they do not live in.
      psgc_barangay_code: toDefault(record.psgc_barangay_code),
      current_address_line: toDefault(record.current_address_line),
      current_postal_code: toDefault(record.current_postal_code),
      current_psgc_barangay_code: toDefault(record.current_psgc_barangay_code),
      current_address_same_as_home: record.current_address_same_as_home ? "true" : "false",
      school: toDefault(record.school),
      // School ID number removed from this form (Ethan, 2026-09-06) — UI-only. The
      // field stays in `MEMBER_PATCHABLE_KEYS` and `memberUpdateSchema` (it is
      // `.optional()`; absent means "leave alone", CONVENTIONS.md §6), so not
      // registering it here neither edits nor clears the stored value. Do not add a
      // `school_id_no` default or input back without checking with Ethan first.
      sex: (record.sex ?? "") as MemberUpdateInput["sex"],
      facebook_account: toDefault(record.facebook_account),
      // PR C1: same "clearable" contract — an emptied input clears the column.
      instagram_account: toDefault(record.instagram_account),
      github_account: toDefault(record.github_account),
      linkedin_account: toDefault(record.linkedin_account),
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
    <Card className="p-5 sm:p-6">
      <form method="post" onSubmit={onSubmit} className="space-y-5">
        <CardTitle>Edit record</CardTitle>

        <input type="hidden" {...register("person_id")} />
        <input type="hidden" {...register("expected_updated_at")} />

        {conflict ? (
          <Alert variant="danger" role="alert">
            This record was changed by someone else since you opened it. Reload the page to see the
            current values before saving again.
          </Alert>
        ) : null}

        {formError ? (
          <p role="alert" className="text-destructive text-sm">
            {formError}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="given_name">First name</FieldLabel>
            <Input id="given_name" {...register("given_name")} />
            <FieldError message={errors.given_name?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="middle_name">Middle name</FieldLabel>
            <Input id="middle_name" {...register("middle_name")} />
            <FieldError message={errors.middle_name?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="family_name">Last name</FieldLabel>
            <Input id="family_name" {...register("family_name")} />
            <FieldError message={errors.family_name?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="suffix">Suffix</FieldLabel>
            <Input id="suffix" {...register("suffix")} />
            <FieldError message={errors.suffix?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="birthdate">Date of birth</FieldLabel>
            <Input id="birthdate" type="date" {...register("birthdate")} />
            <FieldError message={errors.birthdate?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="contact_number">Contact number</FieldLabel>
            <Input id="contact_number" {...register("contact_number")} />
            <FieldError message={errors.contact_number?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="personal_email">Personal email</FieldLabel>
            <Input id="personal_email" type="email" {...register("personal_email")} />
            <FieldError message={errors.personal_email?.message} />
          </Field>
          {/*
            PR C2: the same cascade the public form uses, so a record approved from /apply
            can be corrected here without the two screens disagreeing about what an address
            is. Emptying a picker clears the code; 0059 then leaves the stored names alone
            rather than half-clearing an address.
          */}
          <div className="sm:col-span-2">
            <p className="text-brand-label mb-2 text-xs font-semibold tracking-[0.08em] uppercase">
              Home address
            </p>
            <PsgcAddressPicker
              idPrefix="member_home"
              regions={regions}
              required={false}
              value={watch("psgc_barangay_code") ?? ""}
              onChange={(code) =>
                setValue("psgc_barangay_code", code, { shouldValidate: true, shouldDirty: true })
              }
              error={errors.psgc_barangay_code?.message}
            />
          </div>
          <Field>
            <FieldLabel htmlFor="address_line">Street address</FieldLabel>
            <Input id="address_line" {...register("address_line")} />
            <FieldError message={errors.address_line?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="postal_code">Postal code</FieldLabel>
            <Input id="postal_code" {...register("postal_code")} />
            <FieldError message={errors.postal_code?.message} />
          </Field>

          <div className="sm:col-span-2">
            <p className="text-brand-label mb-2 text-xs font-semibold tracking-[0.08em] uppercase">
              Current address
            </p>
            <PsgcAddressPicker
              idPrefix="member_current"
              regions={regions}
              required={false}
              value={watch("current_psgc_barangay_code") ?? ""}
              onChange={(code) =>
                setValue("current_psgc_barangay_code", code, {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              error={errors.current_psgc_barangay_code?.message}
            />
          </div>
          <Field>
            <FieldLabel htmlFor="current_address_line" optional>
              Current street address
            </FieldLabel>
            <Input id="current_address_line" {...register("current_address_line")} />
            <FieldError message={errors.current_address_line?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="current_postal_code" optional>
              Current postal code
            </FieldLabel>
            <Input id="current_postal_code" {...register("current_postal_code")} />
            <FieldError message={errors.current_postal_code?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="school">School</FieldLabel>
            <Input id="school" {...register("school")} />
            <FieldError message={errors.school?.message} />
          </Field>
        </div>

        {/* SRS 2026-09-05 profile fields (0038). University and program are chosen from the
            reference tables on the application form and corrected here by id is not a
            reviewer's job — they stay read-only in the panel above. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="sex">Sex</FieldLabel>
            <NativeSelect id="sex" {...register("sex")}>
              <option value="">—</option>
              {SEX_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {SEX_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
            <FieldError message={errors.sex?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="facebook_account">Facebook account link</FieldLabel>
            <Input id="facebook_account" type="url" {...register("facebook_account")} />
            <FieldError message={errors.facebook_account?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="instagram_account" optional>
              Instagram
            </FieldLabel>
            <Input id="instagram_account" type="url" {...register("instagram_account")} />
            <FieldError message={errors.instagram_account?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="github_account" optional>
              GitHub
            </FieldLabel>
            <Input id="github_account" type="url" {...register("github_account")} />
            <FieldError message={errors.github_account?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="linkedin_account" optional>
              LinkedIn
            </FieldLabel>
            <Input id="linkedin_account" type="url" {...register("linkedin_account")} />
            <FieldError message={errors.linkedin_account?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="scholarship_award">DOST scholarship award</FieldLabel>
            <NativeSelect id="scholarship_award" {...register("scholarship_award")}>
              <option value="">—</option>
              {SCHOLARSHIP_AWARDS.map((award) => (
                <option key={award} value={award}>
                  {SCHOLARSHIP_AWARD_LABELS[award]}
                </option>
              ))}
            </NativeSelect>
            <FieldError message={errors.scholarship_award?.message} />
          </Field>
          <Field>
            <FieldLabel htmlFor="award_year">Year of award</FieldLabel>
            <Input id="award_year" inputMode="numeric" {...register("award_year")} />
            <FieldError message={errors.award_year?.message} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
          {saved ? <p className="text-success text-sm">Saved.</p> : null}
        </div>
      </form>
    </Card>
  );
}
