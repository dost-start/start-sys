// Renders every submitted field of one application (BUILD_PLAN S4-T19; PRD US-C1:
// "the detail view shows every submitted field"). A Server Component, NOT `'use
// client'` — the data it holds (`applicant_email`, the payload's birthdate, contact
// number, address, school ID) is the densest PII in the schema and must never enter a
// client bundle (CONVENTIONS.md §1.3).
//
// The section order mirrors `/apply`'s four sections (personal → academic →
// membership → consent) so a reviewer reading this page recognizes the same shape the
// applicant filled in.
//
// Input is the raw jsonb `get_application_detail()` returns: `to_jsonb(applications
// row) - proof_web_view_link - proof_drive_file_id`. Every accessor below tolerates a
// missing or wrongly-typed key rather than throwing — the payload is a jsonb column
// with no schema of its own at the database layer, so a field this component expects
// is a convention (`APPLICATION_PAYLOAD_KEYS`), not a guarantee.
import type { ReactNode } from "react";

import type { ApplicationPayload } from "@/lib/applications/schema";

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

export function ApplicationDetailFields({ detail }: { detail: Record<string, unknown> }) {
  const payload = readPayload(detail);
  const givenName = readString(detail, "applicant_given_name");
  const familyName = readString(detail, "applicant_family_name");
  const email = readString(detail, "applicant_email");

  return (
    <div className="space-y-4">
      <Section title="Personal information">
        <Field label="First name" value={givenName} />
        <Field label="Middle name" value={(payload.middle_name as string | null) ?? null} />
        <Field label="Last name" value={familyName} />
        <Field label="Suffix" value={(payload.suffix as string | null) ?? null} />
        <Field label="Email address" value={email} />
        <Field label="Date of birth" value={(payload.birthdate as string | null) ?? null} />
        <Field label="Contact number" value={(payload.contact_number as string | null) ?? null} />
        <Field label="Street address" value={(payload.address_line as string | null) ?? null} />
        <Field
          label="City / municipality"
          value={(payload.city_municipality as string | null) ?? null}
        />
        <Field label="Province" value={(payload.province as string | null) ?? null} />
        <Field label="Postal code" value={(payload.postal_code as string | null) ?? null} />
      </Section>

      <Section title="Academic information">
        <Field label="School" value={(payload.school as string | null) ?? null} />
        <Field label="School ID number" value={(payload.school_id_no as string | null) ?? null} />
        <Field label="Degree program" value={(payload.program as string | null) ?? null} />
        <Field label="Year level" value={(payload.year_level as number | null) ?? null} />
        <Field
          label="Expected graduation year"
          value={(payload.expected_grad_year as number | null) ?? null}
        />
      </Section>

      <Section title="Membership information">
        {/* region_id is a uuid FK, not a name — the detail RPC returns the raw row and
            joining `regions` is a display nicety, not a PII concern, but it is not in
            scope for this pass. Rendered as-is rather than guessed at. */}
        <Field label="Region" value={(payload.region_id as string | null) ?? null} />
      </Section>

      <Section title="Consent">
        <Field
          label="Privacy notice version agreed to"
          value={(payload.consent_privacy_notice_version as string | null) ?? null}
        />
        <Field
          label="Consent recorded at"
          value={(payload.consent_given_at as string | null) ?? null}
        />
      </Section>
    </div>
  );
}
