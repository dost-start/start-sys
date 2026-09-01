// The audit trail panel on the member detail page (BUILD_PLAN S5-T26; PRD US-I1).
//
// ⚠ RENDERS ONLY WHEN `entries` IS NON-EMPTY. `audit_log_read` (0014) names exec_admin
// and tech_admin only, so a crrd_admin or moderator opening this same page
// legitimately gets `[]` from `listMemberAuditTrail` — that is RLS, not a failure, and
// this component must not show an error or a "no changes" message that would be
// false for a caller who simply cannot see the log (CONVENTIONS.md §4.3).
//
// Every value in `old_data`/`new_data` already arrived masked — see
// lib/members/types.ts. There is no un-masking path here.
import type { MemberAuditEntry } from "@/lib/members/types";

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function summarizeDiff(entry: MemberAuditEntry): string {
  const before = entry.old_data as Record<string, unknown> | null;
  const after = entry.new_data as Record<string, unknown> | null;
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed = [...keys].filter(
    (key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]),
  );
  return changed.length > 0 ? changed.join(", ") : "no field-level change recorded";
}

export function MemberAuditTrail({ entries }: { entries: MemberAuditEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-6">
      <h2 className="text-sm font-semibold">Audit trail</h2>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="border-b pb-2 text-sm last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {entry.operation} — {entry.table_name}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatTimestamp(entry.created_at)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              By {entry.actor_role} · changed: {summarizeDiff(entry)}
              {entry.note ? ` · ${entry.note}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
