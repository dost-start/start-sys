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
import type { MemberRecord } from "@/lib/members/types";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value === null || value === "" ? "—" : value}</dd>
    </div>
  );
}

export function MemberSensitivePanel({ record }: { record: MemberRecord }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Personal details</h2>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          This view is logged (CBL Art. VIII §6)
        </span>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
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
        <Field label="School" value={record.school} />
        <Field label="School ID number" value={record.school_id_no} />
      </dl>
    </section>
  );
}
