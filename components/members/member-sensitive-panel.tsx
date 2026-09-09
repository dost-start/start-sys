// The sensitive-column panel on the member detail page (BUILD_PLAN S5-T26; PRD
// US-D1, US-J1, US-J5).
//
// ⚠ RENDERING THIS COMPONENT MEANS AN AUDIT ROW WAS ALREADY WRITTEN — by
// `get_member_record()`, before the page called this component, not by anything here
// (DATA_MODEL.md §8.3, CBL Art. VIII §6). The visible notice below is not decorative:
// it is the reader being told, truthfully, that their read of this record is on the
// record.
//
// Server Component — `MemberRecord` (`Tables<"people">`) carries every sensitive
// column and must never enter a client bundle (CONVENTIONS.md §1.3).
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { SCHOLARSHIP_AWARD_LABELS, SEX_LABELS } from "@/lib/applications/schema";
import type { MemberRecord } from "@/lib/members/types";

export type MemberRecordLookups = {
  universities: Record<string, string>;
  programs: Record<string, string>;
};

// A definition-list pair in the design canvas's label style (components/ui/label's
// classes on a <dt>, since a <label> element belongs to a form control, not to a value).
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-1">
      <dt className="text-brand-label text-xs leading-none font-semibold tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className="text-brand-ink text-sm break-words">
        {value === null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

export function MemberSensitivePanel({
  record,
  lookups,
}: {
  record: MemberRecord;
  lookups: MemberRecordLookups;
}) {
  return (
    <Card className="gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Personal details</CardTitle>
        <Badge variant="neutral">This view is logged (CBL Art. VIII §6)</Badge>
      </div>
      <dl className="grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
        <Field label="First name" value={record.given_name} />
        <Field label="Middle name" value={record.middle_name} />
        <Field label="Last name" value={record.family_name} />
        <Field label="Suffix" value={record.suffix} />
        <Field label="Date of birth" value={record.birthdate} />
        <Field label="Contact number" value={record.contact_number} />
        <Field label="Personal email" value={record.personal_email} />
        <Field label="Street address" value={record.address_line} />
        <Field label="City / municipality" value={record.city_municipality} />
        <Field label="Province" value={record.province} />
        <Field label="Postal code" value={record.postal_code} />
        {/* PR C2: the levels the cascade added. Rendered even when null so a reader can
            tell "not collected under the old form" from "the field does not exist". */}
        <Field label="Barangay" value={record.barangay} />
        <Field label="District (Manila only)" value={record.sub_municipality} />
        <Field label="Address region" value={record.address_region} />
        <Field
          label="Current address"
          value={
            record.current_address_same_as_home
              ? "Same as home address"
              : [
                  record.current_address_line,
                  record.current_barangay,
                  record.current_sub_municipality,
                  record.current_city_municipality,
                  record.current_province,
                  record.current_postal_code,
                ]
                  .filter(Boolean)
                  .join(", ") || null
          }
        />
        <Field label="School" value={record.school} />
        {/* School ID number removed from this panel (Ethan, 2026-09-06) — UI-only; the
            column still exists on `record` and is still masked by audit_row() and
            cleared by the five-year purge. Do not re-add without checking first. */}
        <Field label="Sex" value={record.sex ? SEX_LABELS[record.sex] : null} />
        <Field label="Facebook account" value={record.facebook_account} />
        {/* PR C1 — optional contact channels, registered sensitive like the Facebook one,
            so they belong on THIS panel (audited, acknowledgement-gated) and nowhere else. */}
        <Field label="Instagram" value={record.instagram_account} />
        <Field label="GitHub" value={record.github_account} />
        <Field label="LinkedIn" value={record.linkedin_account} />
        <Field
          label="DOST scholarship award"
          value={
            record.scholarship_award ? SCHOLARSHIP_AWARD_LABELS[record.scholarship_award] : null
          }
        />
        <Field
          label="Year of award"
          value={record.award_year === null ? null : String(record.award_year)}
        />
        <Field
          label="University"
          value={
            record.university_id
              ? (lookups.universities[record.university_id] ?? record.university_id)
              : null
          }
        />
        <Field
          label="Program"
          value={
            record.program_id ? (lookups.programs[record.program_id] ?? record.program_id) : null
          }
        />
      </dl>
    </Card>
  );
}
