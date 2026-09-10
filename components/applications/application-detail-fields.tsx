// ─────────────────────────────────────────────────────────────────────────────
// Every submitted field, rendered in the same order as /apply (PRD US-C1: "the
// detail view shows every submitted field"). A Server Component — the detail object
// comes from the audited get_application_detail() RPC and never enters a client
// bundle. The three uuid choices (region, university, program) are resolved to names
// through lookup maps the page builds from the public reference tables; an id whose
// row is gone falls back to the raw id rather than to nothing, so a reviewer always
// sees what was submitted.
//
// Home address returned to the form (ADR 0013, 2026-09-06) and is rendered as an
// ordinary always-visible section below, not as a legacy field — a submission that
// predates the return simply shows "—" for each. School ID number is removed from
// every screen (Ethan, 2026-09-06) and is never rendered here, even for an old
// payload that still carries one. Pre-0038 free-text `school`/`program` values are
// shown under "Legacy fields" only when present, so the review of an old application
// loses nothing and a new one is not cluttered with empty rows.
//
// Brand edition (2026-09-08): each section is a white panel with an 18px heading and a
// two-column grid of uppercase label + ink value (design canvas `detail_cards`). The
// <dl>/<dt>/<dd> structure is kept — a <dt> styled like the field label, not a <label>
// element, because nothing here is a form control. Section names, field labels and
// field order are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";

import { Card, CardTitle } from "@/components/ui/card";
import {
  SCHOLARSHIP_AWARD_LABELS,
  SEX_LABELS,
  type ApplicationPayload,
} from "@/lib/applications/schema";

export type DetailLookups = {
  regions: Record<string, string>;
  universities: Record<string, string>;
  programs: Record<string, string>;
};

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPayload(detail: Record<string, unknown>): ApplicationPayload {
  const payload = detail.payload;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as ApplicationPayload;
  }
  return {};
}

function text(payload: ApplicationPayload, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number") return String(value);
  return null;
}

function lookup(map: Record<string, string>, id: string | null): string | null {
  if (!id) return null;
  return map[id] ?? id;
}

/** Age at review time, computed from the birthdate (SRS: "dynamic calculation"). */
function ageFrom(birthdate: string | null): string | null {
  if (!birthdate) return null;
  const born = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? String(age) : null;
}

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-brand-label text-xs font-semibold tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className="text-brand-ink text-sm break-words">
        {value === null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-4 p-5 sm:p-6">
      <CardTitle>{title}</CardTitle>
      <dl className="grid gap-x-8 gap-y-3.5 sm:grid-cols-2">{children}</dl>
    </Card>
  );
}

/** The `psgc_resolve()` shape, read defensively out of the detail jsonb. */
type ResolvedAddressView = {
  barangay_name: string | null;
  sub_municipality_name: string | null;
  city_name: string | null;
  province_name: string | null;
  region_name: string | null;
};

function readResolved(detail: Record<string, unknown>, key: string): ResolvedAddressView | null {
  const value = detail[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const str = (k: string) =>
    typeof row[k] === "string" && row[k] !== "" ? (row[k] as string) : null;
  return {
    barangay_name: str("barangay_name"),
    sub_municipality_name: str("sub_municipality_name"),
    city_name: str("city_name"),
    province_name: str("province_name"),
    region_name: str("region_name"),
  };
}

export function ApplicationDetailFields({
  detail,
  lookups,
}: {
  detail: Record<string, unknown>;
  lookups: DetailLookups;
}) {
  const payload = readPayload(detail);
  const givenName = readString(detail, "applicant_given_name");
  const familyName = readString(detail, "applicant_family_name");
  const email = readString(detail, "applicant_email");
  const birthdate = text(payload, "birthdate");

  // PR C2: attached by `getApplicationDetail`, which calls `psgc_resolve()` for each of
  // the two codes. Null when the applicant predates the cascade or the code no longer
  // resolves — the fields then render "—" rather than the read failing.
  const home = readResolved(detail, "resolved_home_address");
  const current = readResolved(detail, "resolved_current_address");
  const sameAsHome = text(payload, "current_address_same_as_home") === "true";

  const sex = text(payload, "sex");
  const award = text(payload, "scholarship_award");
  const regionId = text(payload, "region_id");
  const regionName = lookup(lookups.regions, regionId);

  // school_id_no is intentionally never read here — removed from every screen
  // (Ethan, 2026-09-06) — even though a pre-existing payload may still carry one.
  const legacy: Array<[string, string | null]> = [
    ["School (free text)", text(payload, "school")],
    ["Program (free text)", text(payload, "program")],
  ].filter((entry): entry is [string, string] => entry[1] !== null);

  return (
    <div className="space-y-5">
      <Section title="Personal information">
        <Field label="First name" value={givenName} />
        <Field label="Middle name" value={text(payload, "middle_name")} />
        <Field label="Last name" value={familyName} />
        <Field label="Suffix" value={text(payload, "suffix")} />
        <Field
          label="Sex"
          value={sex && sex in SEX_LABELS ? SEX_LABELS[sex as keyof typeof SEX_LABELS] : sex}
        />
        <Field label="Date of birth" value={birthdate} />
        <Field label="Age" value={ageFrom(birthdate)} />
        <Field label="Email address" value={email} />
        <Field label="Contact number" value={text(payload, "contact_number")} />
        <Field label="Facebook account" value={text(payload, "facebook_account")} />
        {/* PR C1 — optional, so these render "—" for most applicants. Shown anyway rather
            than conditionally hidden: a reviewer comparing two applications should not
            have to wonder whether a missing row means "not given" or "not asked". */}
        <Field label="Instagram" value={text(payload, "instagram_account")} />
        <Field label="GitHub" value={text(payload, "github_account")} />
        <Field label="LinkedIn" value={text(payload, "linkedin_account")} />
      </Section>

      {/*
        PR C2: the payload holds barangay CODES; the names come from `psgc_resolve()` and
        are attached by `getApplicationDetail`. A reviewer sees an address, never a code —
        and it is the same resolution the write path performs, so what is shown here is
        what will be stored on approval.
      */}
      <Section title="Home address">
        <Field label="Street address" value={text(payload, "address_line")} />
        <Field label="Barangay" value={home?.barangay_name ?? null} />
        <Field label="District (Manila only)" value={home?.sub_municipality_name ?? null} />
        <Field label="City / municipality" value={home?.city_name ?? null} />
        <Field label="Province" value={home?.province_name ?? null} />
        <Field label="Region" value={home?.region_name ?? null} />
        <Field label="Postal code" value={text(payload, "postal_code")} />
      </Section>

      <Section title="Current address">
        {sameAsHome ? (
          <Field label="Current address" value="Same as home address" />
        ) : (
          <>
            <Field label="Street address" value={text(payload, "current_address_line")} />
            <Field label="Barangay" value={current?.barangay_name ?? null} />
            <Field label="District (Manila only)" value={current?.sub_municipality_name ?? null} />
            <Field label="City / municipality" value={current?.city_name ?? null} />
            <Field label="Province" value={current?.province_name ?? null} />
            <Field label="Region" value={current?.region_name ?? null} />
            <Field label="Postal code" value={text(payload, "current_postal_code")} />
          </>
        )}
      </Section>

      <Section title="Scholarship and academic information">
        <Field
          label="DOST scholarship award"
          value={
            award && award in SCHOLARSHIP_AWARD_LABELS
              ? SCHOLARSHIP_AWARD_LABELS[award as keyof typeof SCHOLARSHIP_AWARD_LABELS]
              : award
          }
        />
        <Field label="Year of award" value={text(payload, "award_year")} />
        <Field
          label="University"
          value={lookup(lookups.universities, text(payload, "university_id"))}
        />
        <Field label="Program" value={lookup(lookups.programs, text(payload, "program_id"))} />
        <Field label="Year level" value={text(payload, "year_level")} />
        <Field label="Expected year of graduation" value={text(payload, "expected_grad_year")} />
      </Section>

      <Section title="Membership information">
        {/* The ORG region (drives RR scoping + the member ID prefix), not the home
            address region rendered above. QA 2026-09-10, ISSUE-013. */}
        <Field label="START-DOST region" value={regionName} />
      </Section>

      {legacy.length > 0 ? (
        <Section title="Legacy fields (submitted before the 2026-09-05 form)">
          {legacy.map(([label, value]) => (
            <Field key={label} label={label} value={value} />
          ))}
        </Section>
      ) : null}

      <Section title="Consent and certification">
        <Field
          label="Privacy notice version agreed to"
          value={text(payload, "consent_privacy_notice_version")}
        />
        <Field label="Consent recorded at" value={text(payload, "consent_given_at")} />
        <Field label="Accuracy certified at" value={text(payload, "certified_accuracy_at")} />
      </Section>
    </div>
  );
}
