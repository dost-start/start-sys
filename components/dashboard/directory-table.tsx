// The read-only member roster rendered by the officer directory and the Regional
// Representative dashboard (BUILD_PLAN S6-T10, S6-T12).
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ WHY THIS EXISTS ALONGSIDE S5's GRID — THE PRE-AGREED FALLBACK, NOT A FORK
// ═══════════════════════════════════════════════════════════════════════════════
// BUILD_PLAN S6 risks: "S5's grid and URL parser may not land before this slice starts.
// 30-minute cap, then render the rosters with a plain vendored `<Table>` over the same
// column set, keeping links.ts pointed at the agreed param names." At the time of writing
// `components/members/member-table.tsx` does not exist, so this is that fallback, taken
// deliberately rather than by waiting.
//
// It is a FALLBACK and not a competing grid because of three constraints it keeps:
//   · the same row type — `MemberDirectoryRow`, straight off `search_member_directory()`;
//   · the same URL contract — `lib/members/filters.ts`, via `lib/dashboard/links.ts`;
//   · no sorting, no filtering, no pagination controls of its own.
// When S5's grid lands, the read-only surfaces swap to it and this file is deleted. The
// pages call `listMemberDirectory` either way, so nothing else moves.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ THE COLUMN SET IS THE OFFICER BOUNDARY, AND NO COLUMN MAY BE ADDED TO IT
// ═══════════════════════════════════════════════════════════════════════════════
// PRD US-D2, US-J1: no contact number, no address, no birthdate, no school ID, no proof
// link — for officers OR for regional reps. That boundary is drawn by the column-level
// GRANT on `people` (0015) and by what `search_member_directory()` returns; this file
// renders what it is given and cannot widen it. But rendering a column that is not in
// `MemberDirectoryRow` would be a compile error, and adding one to the RPC to satisfy
// this file would be the exact banned move (CLAUDE.md: "Never widen v_member_directory
// or a column-level GRANT to make an officer screen work"). 061 asserts the column set.
//
// ⚠ NO EDIT, STATUS OR ASSIGN CONTROL, EVER. The officer and regional_rep tiers hold no
// UPDATE policy on any table (US-D2, US-F2) — regional access is not regional editing. A
// rendered button would only produce a confusing failure, and would imply a capability
// the database does not grant.
//
// Server-rendered. No `'use client'`, no state, no fetching.
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { membershipStatusLabel } from "@/lib/dashboard/status-buckets";
import type { MemberDirectoryRow } from "@/lib/members/types";

export type DirectoryTableProps = {
  rows: readonly MemberDirectoryRow[];
  /** Rendered in place of the table when there is nothing to show. */
  emptyMessage: string;
  /** Whether to render the region column — the RR roster is one region by definition. */
  showRegion?: boolean;
};

/** `active` reads as the healthy default; every other status is visually secondary. */
function statusVariant(status: MemberDirectoryRow["status"]) {
  if (status === "active") return "default" as const;
  if (status === "terminated") return "destructive" as const;
  return "secondary" as const;
}

export function DirectoryTable({ rows, emptyMessage, showRegion = true }: DirectoryTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    // The table scrolls inside its own container so the page body never scrolls
    // horizontally at 375px.
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member ID</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            {showRegion ? <TableHead>Region</TableHead> : null}
            <TableHead>Year</TableHead>
            <TableHead>Committee</TableHead>
            <TableHead>Department</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.membership_id}>
              <TableCell className="font-mono text-xs whitespace-nowrap">{row.member_id}</TableCell>
              <TableCell className="whitespace-nowrap">
                {row.family_name}, {row.given_name}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(row.status)}>
                  {membershipStatusLabel(row.status)}
                </Badge>
              </TableCell>
              {showRegion ? (
                <TableCell className="whitespace-nowrap">{row.region_name}</TableCell>
              ) : null}
              <TableCell className="tabular-nums">{row.year_level ?? "—"}</TableCell>
              {/* A scholar may sit on more than one committee (CBL Art. III §5), which is
                  why the RPC returns arrays and why the committee panel does not sum. */}
              <TableCell>
                {row.committee_names.length > 0 ? row.committee_names.join(", ") : "—"}
              </TableCell>
              <TableCell>
                {row.department_names.length > 0 ? row.department_names.join(", ") : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
