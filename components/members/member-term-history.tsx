// Term-by-term membership history (BUILD_PLAN S5-T26; PRD US-H1, US-H3, US-H5).
//
// ⚠ THIS TABLE DEMONSTRATES THE PRD'S HARDEST RULE RATHER THAN ASSERTING IT: the same
// `memberId` renders on every row, because the number lives on `people` and renewal
// only ever inserts into `memberships` (DATA_MODEL.md §4) — `2024-001` never becomes
// `2025-001`. `memberId` is a prop, not a per-row field, for exactly that reason: this
// component cannot accidentally render a different id per term even by mistake.
import { MemberStatusBadge } from "@/components/members/member-status-badge";
import { Card, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MemberTermHistoryRow } from "@/lib/members/types";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(
    new Date(value),
  );
}

export function MemberTermHistory({
  memberId,
  rows,
}: {
  memberId: string | null;
  rows: MemberTermHistoryRow[];
}) {
  if (rows.length === 0) {
    return (
      <Card className="gap-2 p-5 sm:p-6">
        <CardTitle>Term history</CardTitle>
        <p className="text-brand-label text-sm">
          No membership record for any term is visible here.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 pt-5 pb-3 sm:px-6 sm:pt-6">
        <CardTitle>Term history</CardTitle>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Term</TableHead>
            <TableHead>Member ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Year level</TableHead>
            <TableHead>Ended reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.membership_id}>
              <TableCell>
                {row.term_label}
                <span className="text-brand-label ml-1 text-xs">
                  ({formatDate(row.term_starts_on)} – {formatDate(row.term_ends_on)})
                </span>
              </TableCell>
              <TableCell className="font-mono text-[13px]">{memberId ?? "—"}</TableCell>
              <TableCell>
                <MemberStatusBadge status={row.status} />
              </TableCell>
              <TableCell>{row.region_name}</TableCell>
              <TableCell className="tabular-nums">{row.year_level ?? "—"}</TableCell>
              <TableCell className="text-brand-label whitespace-normal">
                {row.ended_reason ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
