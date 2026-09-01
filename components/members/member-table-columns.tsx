// Column definitions for the member grid (BUILD_PLAN S5-T20).
//
// ⚠ NO CONTACT NUMBER, ADDRESS OR BIRTHDATE COLUMN — AND NONE MAY BE ADDED. This is
// the officer-tier boundary `061_officer_column_sets.sql` proves at the database
// layer; `search_member_directory()` never returns those columns in the first place
// (0030), so there is no prop this file could read to leak them even by accident
// (ARCHITECTURE.md §5, PRD US-J1, US-D2).
//
// Sort keys correspond 1:1 with `MEMBER_SORTS` in lib/members/filters.ts — every
// `id` below is a column PostgREST actually accepts in `.order()` on
// `search_member_directory()`'s return shape.
import type { ColumnDef } from "@tanstack/react-table";

import { MemberStatusBadge } from "@/components/members/member-status-badge";
import type { MemberDirectoryRow } from "@/lib/members/types";

/** Sortable column ids, matching the `column` half of a `MEMBER_SORTS` token. */
export const SORTABLE_MEMBER_COLUMNS = new Set([
  "family_name",
  "given_name",
  "member_id",
  "join_year",
  "status",
  "region_name",
]);

function joinNames(names: readonly string[] | null | undefined): string {
  if (!names || names.length === 0) return "—";
  return names.join(", ");
}

export const memberTableColumns: ColumnDef<MemberDirectoryRow>[] = [
  {
    id: "family_name",
    header: "Name",
    cell: ({ row }) => (
      <a
        href={`/members/${row.original.person_id}`}
        className="font-medium underline-offset-2 hover:underline"
      >
        {row.original.given_name} {row.original.family_name}
      </a>
    ),
  },
  {
    id: "member_id",
    header: "Member ID",
    cell: ({ row }) => <span className="font-mono text-sm">{row.original.member_id ?? "—"}</span>,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <MemberStatusBadge status={row.original.status} />,
  },
  {
    id: "region_name",
    header: "Region",
    cell: ({ row }) => <span className="text-sm">{row.original.region_name}</span>,
  },
  {
    id: "join_year",
    header: "Joined",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.join_year}</span>
    ),
  },
  {
    id: "committee_names",
    header: "Committees",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {joinNames(row.original.committee_names)}
      </span>
    ),
  },
  {
    id: "department_names",
    header: "Departments",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {joinNames(row.original.department_names)}
      </span>
    ),
  },
];
