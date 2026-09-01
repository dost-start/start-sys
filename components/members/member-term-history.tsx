// Term-by-term membership history (BUILD_PLAN S5-T26; PRD US-H1, US-H3, US-H5).
//
// ⚠ THIS TABLE DEMONSTRATES THE PRD'S HARDEST RULE RATHER THAN ASSERTING IT: the same
// `memberId` renders on every row, because the number lives on `people` and renewal
// only ever inserts into `memberships` (DATA_MODEL.md §4) — `2024-001` never becomes
// `2025-001`. `memberId` is a prop, not a per-row field, for exactly that reason: this
// component cannot accidentally render a different id per term even by mistake.
import { MemberStatusBadge } from "@/components/members/member-status-badge";
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
      <section className="space-y-2 rounded-lg border border-border bg-card p-4 sm:p-6">
        <h2 className="text-sm font-semibold">Term history</h2>
        <p className="text-sm text-muted-foreground">
          No membership record for any term is visible here.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-6">
      <h2 className="text-sm font-semibold">Term history</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Term</th>
              <th className="py-2 pr-3 font-medium">Member ID</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Region</th>
              <th className="py-2 pr-3 font-medium">Year level</th>
              <th className="py-2 pr-3 font-medium">Ended reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.membership_id} className="border-b last:border-b-0">
                <td className="py-2 pr-3">
                  {row.term_label}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({formatDate(row.term_starts_on)} – {formatDate(row.term_ends_on)})
                  </span>
                </td>
                <td className="py-2 pr-3 font-mono">{memberId ?? "—"}</td>
                <td className="py-2 pr-3">
                  <MemberStatusBadge status={row.status} />
                </td>
                <td className="py-2 pr-3">{row.region_name}</td>
                <td className="py-2 pr-3">{row.year_level ?? "—"}</td>
                <td className="py-2 pr-3 text-muted-foreground">{row.ended_reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
