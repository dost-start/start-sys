// The before/after cell of one audit entry (BUILD_PLAN S6-T19).
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ IT RENDERS WHAT THE ROW HOLDS, VERBATIM. THERE IS NO UN-MASKING PATH.
// ═══════════════════════════════════════════════════════════════════════════════
// `mask_sensitive()` replaced every column in `sensitive_column_registry` with a
// redaction marker BEFORE the row was written (DATA_MODEL.md §8.3). So an entry
// recording a change to `contact_number` shows the marker where the number would be, and
// `given_name` beside it shows the real value — which is exactly what proves the
// registry is driving the masking (017_audit_triggers.sql asserts this).
//
// This component therefore does NOT join back to `people`, does not re-read a value from
// its source table, and offers no "show original". Putting the number back next to the
// entry recording its change would undo the design and place PII in a surface that has
// no retention story — the purge cannot reach the audit log precisely because the log
// holds nothing to purge.
//
// ⚠ ONLY CHANGED KEYS ARE SHOWN. An `UPDATE` on a `people` row carries twenty-odd
// columns in each of `old_data` and `new_data`, nineteen of them identical. Rendering
// all of them buries the one that changed — which is the entire question the reader
// came with ("who changed what").
//
// Presentational: no fetch, no client directive.
import type { Json } from "@/database.types";

export type AuditEntryDiffProps = {
  old_data: Json | null;
  new_data: Json | null;
};

/** A jsonb object, or null. Arrays and scalars are not shapes `audit_row()` writes. */
function asRecord(value: Json | null): Record<string, Json> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Json>;
}

/** Stable, compact rendering. `null` is shown as a word so it is not mistaken for blank. */
function display(value: Json | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function AuditEntryDiff({ old_data, new_data }: AuditEntryDiffProps) {
  const before = asRecord(old_data);
  const after = asRecord(new_data);

  if (before === null && after === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  // INSERT has no `old_data`; DELETE has no `new_data` (and cannot occur — no DELETE
  // policy exists anywhere). The union of keys covers all three shapes.
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();

  const changed = keys.filter((key) => display(before?.[key]) !== display(after?.[key]));

  if (changed.length === 0) {
    return <span className="text-xs text-muted-foreground">No field values changed</span>;
  }

  return (
    <ul className="space-y-0.5">
      {changed.map((key) => (
        <li key={key} className="text-xs">
          <span className="font-mono text-muted-foreground">{key}</span>{" "}
          {before === null ? (
            <span className="font-mono break-all">{display(after?.[key])}</span>
          ) : (
            <>
              <span className="font-mono break-all line-through opacity-60">
                {display(before[key])}
              </span>{" "}
              <span aria-hidden="true">→</span>{" "}
              <span className="font-mono break-all">{display(after?.[key])}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
