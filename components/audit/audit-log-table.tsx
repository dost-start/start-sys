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
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `audit_log`): the table
// sits in a flush Card; a read is an info badge, an INSERT a success badge, any other
// write neutral. Columns and text are unchanged.
import { AuditEntryDiff } from "@/components/audit/audit-entry-diff";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  if (operation.startsWith("VIEW")) return "info" as const;
  if (operation === "INSERT") return "success" as const;
  return "neutral" as const;
}

/**
 * Collapse runs of identical repeated views into one row.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY, AND WHY IT COLLAPSES THE VIEW RATHER THAN THE WRITE
 * ═══════════════════════════════════════════════════════════════════════════════
 * `list_region_member_contacts()` writes one `VIEW_CONTACTS` row per call, and the RR
 * dashboard calls it on every render — including the renders caused by bouncing off a
 * route the rep cannot reach. QA 2026-09-10 produced TEN rows in 45 seconds of ordinary
 * navigation (ISSUE-008).
 *
 * Every one of those rows is correct and none of them may be dropped: ADR 0011 and CBL
 * Art. VIII §6 want each access recorded, and the log is append-only at the GRANT level
 * anyway. The problem is not that they exist, it is that a term of accidental navigation
 * buries the deliberate reads the log exists to evidence.
 *
 * So the fix is at the READING end. Nothing is written differently, nothing is deleted,
 * and the raw rows are one toggle away. Only runs that are ADJACENT, by the same actor,
 * with the same operation and table, and within the window are folded — so a burst of
 * dashboard renders becomes one line while two genuinely separate lookups an hour apart
 * stay two lines.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const COLLAPSE_WINDOW_MS = 10 * 60 * 1000;

/** Only repeated READS collapse. A write is never noise. */
function isCollapsible(operation: string): boolean {
  return operation.startsWith("VIEW");
}

type AuditGroup = { head: AuditEntry; count: number; earliest: string };

function groupRepeats(entries: readonly AuditEntry[]): AuditGroup[] {
  const groups: AuditGroup[] = [];

  for (const entry of entries) {
    const previous = groups[groups.length - 1];
    const sameSubject =
      previous !== undefined &&
      isCollapsible(entry.operation) &&
      isCollapsible(previous.head.operation) &&
      previous.head.operation === entry.operation &&
      previous.head.table_name === entry.table_name &&
      previous.head.actor_user_id === entry.actor_user_id;

    // Entries arrive newest-first, so `earliest` is the tail of the run.
    const withinWindow =
      previous !== undefined &&
      Date.parse(previous.earliest) - Date.parse(entry.created_at) <= COLLAPSE_WINDOW_MS;

    if (previous !== undefined && sameSubject && withinWindow) {
      previous.count += 1;
      previous.earliest = entry.created_at;
      continue;
    }

    groups.push({ head: entry, count: 1, earliest: entry.created_at });
  }

  return groups;
}

export function AuditLogTable({
  entries,
  collapseRepeats,
}: {
  entries: readonly AuditEntry[];
  collapseRepeats: boolean;
}) {
  if (entries.length === 0) {
    return (
      <Card className="border-border border border-dashed p-6 shadow-none">
        <p className="text-brand-label text-sm">No audit entries match these filters.</p>
      </Card>
    );
  }

  return (
    // The Table primitive scrolls inside its own container, so the page body never
    // scrolls horizontally; the Card is flush so the scroll edge is the card edge.
    <Card className="overflow-hidden p-0">
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
          {(collapseRepeats
            ? groupRepeats(entries)
            : entries.map((e) => ({ head: e, count: 1, earliest: e.created_at }))
          ).map(({ head: entry, count, earliest }) => (
            <TableRow key={entry.id}>
              <TableCell className="align-top font-mono text-xs whitespace-nowrap tabular-nums">
                {formatManila(entry.created_at)}
                {count > 1 ? (
                  <span className="text-brand-label mt-0.5 block font-sans text-[10px]">
                    back to {formatManila(earliest)}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-col gap-0.5">
                  <span className="text-brand-ink text-xs font-medium">{entry.actor_role}</span>
                  {/* A system job writes a null actor — shown as `system`, not as blank,
                      so "nobody was recorded" and "a job did it" stay distinguishable. */}
                  <span className="text-brand-label font-mono text-[10px] break-all">
                    {entry.actor_user_id ?? "system"}
                  </span>
                </div>
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={operationVariant(entry.operation)}>{entry.operation}</Badge>
                {count > 1 ? (
                  <span
                    className="text-brand-label ml-1.5 font-mono text-[10px]"
                    title={`${count} identical entries by this actor within ten minutes. Every one is still stored; this only folds them for reading.`}
                  >
                    ×{count}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-col gap-0.5">
                  <span className="text-brand-ink text-xs font-medium">{entry.table_name}</span>
                  <span className="text-brand-label font-mono text-[10px] break-all">
                    {entry.row_id ?? "—"}
                  </span>
                </div>
              </TableCell>
              <TableCell className="min-w-[16rem] align-top whitespace-normal">
                <AuditEntryDiff old_data={entry.old_data} new_data={entry.new_data} />
                {entry.note !== null ? (
                  <p className="text-brand-label mt-1 text-xs">{entry.note}</p>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
