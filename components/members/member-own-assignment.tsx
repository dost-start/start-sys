// What a member sees about themselves (BUILD_PLAN S6-T18; PRD US-E4).
//
// "As a Member, I can view my current committee, department or organizational role, so
// that I know where I sit in the org" — and, in the same story's CANNOT column: "the
// member sees only their own assignment, never anyone else's. No organizational roster
// is reachable from the member view."
//
// ⚠ THIS COMPONENT RENDERS ONE PERSON AND HAS NO SHAPE FOR A SECOND. It takes a single
// record, not a list. That is deliberate: a component that accepted an array would be
// one careless page edit away from rendering a roster on the member portal, and the
// props are where that becomes impossible rather than merely unlikely.
//
// ⚠ NO SENSITIVE COLUMN. A member holds the same six-column GRANT on `people` everyone
// else does (0015) — their own birthdate and address are NOT selected by the portal and
// are not accepted here. Self-service profile editing is deferred (PRD §4), so there is
// nothing to edit and no control for it.
//
// Presentational only: no fetch, no `'use client'`, no Server Action.
import { Badge } from "@/components/ui/badge";
import { membershipStatusLabel } from "@/lib/dashboard/status-buckets";
import type { MembershipStatus } from "@/lib/dashboard/types";

export type MemberOwnAssignment = {
  /** `2024-001`. Null only before approval mints one — no member row can lack it. */
  member_id: string | null;
  given_name: string;
  family_name: string;
  status: MembershipStatus;
  region_name: string;
  year_level: number | null;
  term_label: string;
  /** CBL Art. III §5 sets no limit on committee seats, so this is a list. */
  committee_names: readonly string[];
  department_names: readonly string[];
  /** CBL positions held this term, e.g. "Regional Representative". Usually empty. */
  position_titles: readonly string[];
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

const listOr = (values: readonly string[], fallback: string): string =>
  values.length > 0 ? values.join(", ") : fallback;

export function MemberOwnAssignment({ record }: { record: MemberOwnAssignment }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          {record.given_name} {record.family_name}
        </h1>
        <Badge variant={record.status === "active" ? "default" : "secondary"}>
          {membershipStatusLabel(record.status)}
        </Badge>
      </div>

      <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        {/* ⚠ The member ID never changes across terms — it lives on `people`, and renewal
            only ever inserts into `memberships` (PRD US-C4, US-H5; DATA_MODEL.md §4). */}
        <Field label="Member ID" value={record.member_id ?? "Not yet issued"} />
        <Field label="Term" value={record.term_label} />
        <Field label="Region" value={record.region_name} />
        <Field
          label="Year level"
          value={record.year_level === null ? "Not recorded" : String(record.year_level)}
        />
      </dl>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Your assignments</h2>
        <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <Field
            label="Committee"
            value={listOr(record.committee_names, "No committee this term")}
          />
          <Field
            label="Department"
            value={listOr(record.department_names, "No department this term")}
          />
          <Field
            label="Position"
            value={listOr(record.position_titles, "No organizational position this term")}
          />
        </dl>
      </section>
    </div>
  );
}
