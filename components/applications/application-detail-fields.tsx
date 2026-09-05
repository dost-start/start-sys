// ─────────────────────────────────────────────────────────────────────────────
// Every submitted field, rendered in the same order as /apply (PRD US-C1: "the
// detail view shows every submitted field"). A Server Component — the detail object
// comes from the audited get_application_detail() RPC and never enters a client
// bundle. The three uuid choices (region, university, program) are resolved to names
// through lookup maps the page builds from the public reference tables; an id whose
// row is gone falls back to the raw id rather than to nothing, so a reviewer always
// sees what was submitted.
//
// Pre-0038 payloads may still carry an address block and a school ID; they are shown
// under "Legacy fields" only when present, so the review of an old application loses
// nothing and a new one is not cluttered with empty rows.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";

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
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value === null || value === "" ? "—" : value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
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

  const sex = text(payload, "sex");
  const award = text(payload, "scholarship_award");
  const regionId = text(payload, "region_id");
  const regionName = lookup(lookups.regions, regionId);

  const legacy: Array<[string, string | null]> = [
    ["Street address", text(payload, "address_line")],
    ["City / municipality", text(payload, "city_municipality")],
    ["Province", text(payload, "province")],
    ["Postal code", text(payload, "postal_code")],
    ["School (free text)", text(payload, "school")],
    ["School ID number", text(payload, "school_id_no")],
    ["Program (free text)", text(payload, "program")],
  ].filter((entry): entry is [string, string] => entry[1] !== null);

  return (
    <div className="space-y-4">
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
        <Field label="Region" value={regionName} />
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
