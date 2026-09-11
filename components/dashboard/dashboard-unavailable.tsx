// The "this number could not be read" panel (QA UX-03, 2026-09-11). NEW FILE.
//
// ⚠ IT EXISTS BECAUSE A FAILED READ USED TO RENDER AS `0`. `lib/dashboard/queries.ts`
// swallowed a PostgREST error into an empty array, the zero-fill turned that into a full
// screen of honest-looking zeros, and "0 active members, 0 in every region" is exactly
// what a term legitimately looks like the morning after rollover (PRD US-H2). The two
// states were indistinguishable, and the expensive half of that ambiguity is an officer
// going to look for six hundred rows that were never missing.
//
// ⚠ IT MUST NEVER SAY "you do not have permission", for the same reason
// DashboardEmptyState must not: an RLS-filtered aggregate is legitimately empty for
// several tiers, and "forbidden" would confirm rows exist that this caller cannot see
// (CONVENTIONS.md §4.3). This panel is rendered ONLY for a read that FAILED — never for
// one that succeeded and returned nothing. That distinction is the whole fix.
//
// ⚠ IT RENDERS NO ERROR DETAIL. `AggregateResult` carries no PostgREST message, so there
// is nothing here to leak: a raw error can hold a value in `details` (CLAUDE.md Privacy).
//
// `role="alert"` so the failure is announced, and so an e2e spec has a stable hook.
import { Alert } from "@/components/ui/alert";

export type DashboardUnavailableProps = {
  /** What could not be read, e.g. "Headcount by status". A noun phrase. */
  what: string;
  /** Where to retry — this page's own URL, so the reads simply run again. */
  retryHref: string;
};

export function DashboardUnavailable({ what, retryHref }: DashboardUnavailableProps) {
  return (
    <Alert variant="warning" role="alert">
      <div className="space-y-1">
        <p className="font-semibold">{what} could not be loaded.</p>
        <p>
          This is a failed read, not an empty term — these figures are unknown rather than zero.{" "}
          <a href={retryHref} className="underline underline-offset-4">
            Reload the page
          </a>{" "}
          to try again. If it keeps failing, tell the CTO.
        </p>
      </div>
    </Alert>
  );
}
