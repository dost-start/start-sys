// The audit log table (BUILD_PLAN S6-T19; PRD US-I1).
//
// Columns are the question the reader arrived with, in the order they ask it: WHEN, WHO,
// WHAT they did, TO WHICH RECORD, and WHAT CHANGED.
//
// ⚠ TIMESTAMPS RENDER IN Asia/Manila. Everything is stored UTC (`timestamptz`,
// CONVENTIONS.md §3.3) and rendered in the org's timezone — an audit entry whose
// displayed time is eight hours off is worse than useless during an incident, because it
// is confidently wrong. Formatted on the SERVER with an explicit `timeZone`, never with
// the browser's locale: a page rendered for a maintainer travelling abroad must show the
// same instant as the one rendered in Manila, or two people reading the same log
// disagree about when something happened.
//
// ⚠ NO EXPORT, NO EDIT, NO DELETE CONTROL. The log is append-only at the GRANT level
// (`REVOKE UPDATE, DELETE`) with no such policy anywhere, so not even the CEO can
// rewrite history from the app. A rendered control would imply otherwise. An export
// button is deliberately absent: it would be a second PII-adjacent surface with its own
// audit question.
//
// ⚠ NO NAME RESOLUTION. `actor_user_id` is rendered as an id, not joined to `people`.
// See the header of components/audit/audit-entry-diff.tsx — the log holds no PII and
// must not acquire any by way of its own viewer.
//
// Server-rendered. No `'use client'`, no state.
import { AuditEntryDiff } from "@/components/audit/audit-entry-diff";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AuditEntry } from "@/lib/audit/queries";

/** Asia/Manila, fixed. See the header note — this must not follow the viewer's locale. */
const MANILA = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatManila(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : MANILA.format(parsed);
}

/** Reads that never changed a record are visually distinct from writes that did. */
function operationVariant(operation: string) {
  if (operation.startsWith("VIEW")) return "outline" as const;
  if (operation === "INSERT") return "default" as const;
  return "secondary" as const;
}

export function AuditLogTable({ entries }: { entries: readonly AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No audit entries match these filters.
      </div>
    );
  }

  return (
    // Scrolls inside its own container so the page body never scrolls horizontally.
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">When (Asia/Manila)</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Record</TableHead>
            <TableHead>Changed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="align-top text-xs whitespace-nowrap tabular-nums">
                {formatManila(entry.created_at)}
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs">{entry.actor_role}</span>
                  {/* A system job writes a null actor — shown as `system`, not as blank,
                      so "nobody was recorded" and "a job did it" stay distinguishable. */}
                  <span className="font-mono text-[10px] break-all text-muted-foreground">
                    {entry.actor_user_id ?? "system"}
                  </span>
                </div>
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={operationVariant(entry.operation)}>{entry.operation}</Badge>
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs">{entry.table_name}</span>
                  <span className="font-mono text-[10px] break-all text-muted-foreground">
                    {entry.row_id ?? "—"}
                  </span>
                </div>
              </TableCell>
              <TableCell className="align-top">
                <AuditEntryDiff old_data={entry.old_data} new_data={entry.new_data} />
                {entry.note !== null ? (
                  <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
