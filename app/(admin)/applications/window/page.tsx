// ─────────────────────────────────────────────────────────────────────────────
// `/applications/window` — open and close the membership application period
// (BUILD_PLAN S4-T24; PRD US-B4, MVP item 5).
//
// This screen is the operational half of item 5. Everything else about the window
// already existed — the policies (0014), the audit trigger (0012), the anon INSERT
// policy that reads the window from inside its own expression (0008) — but nothing let
// the CCDO actually open one, so the public portal could only be opened by hand-run SQL.
//
// READS THROUGH THE CALLER'S CLIENT. `application_windows_read` grants every
// authenticated tier a read of the schedule, so a moderator or an exec_admin who
// follows a link here sees the dates and is told, in words, that changing them is not
// theirs (ADR 0003). That is deliberately a read-only render rather than a redirect: a
// bounce would leave an officer unsure whether the period is open, and the write is
// refused at the data layer regardless of what this page draws.
//
// NO PII. A window row is a term id, a form kind and two timestamps. Nothing on this
// page needs a confidentiality acknowledgement and nothing here is masked.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { ApplicationWindowForm } from "@/components/applications/application-window-form";
import {
  MEMBERSHIP_APPLICATION_FORM_KIND,
  MEMBERSHIP_RENEWAL_FORM_KIND,
  windowState,
  type WindowState,
} from "@/lib/applications/window-schema";
import { getSessionContext } from "@/lib/auth/queries";
import { LOGIN_PATH } from "@/lib/auth/route-access";

/** The window is global state read at request time; a cached copy could contradict it. */
export const dynamic = "force-dynamic";

/** ADR 0003 — mirrored from `lib/applications/window-actions.ts`, which is the gate. */
const WINDOW_WRITER_ROLES: ReadonlyArray<string> = ["crrd_admin", "tech_admin"];

const MANILA = "Asia/Manila";

/** Instants are stored UTC and rendered in Asia/Manila (CONVENTIONS §3.3). */
function formatInstant(value: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: MANILA,
  }).format(new Date(value));
}

/**
 * An absolute instant → the `datetime-local` shape the inputs need, in Asia/Manila.
 *
 * Done here rather than in the client component so the two officers looking at this
 * screen from two machines see the same prefill: the org operates on one clock, and a
 * maintainer travelling should not see the period shift under them.
 */
function toManilaLocalInput(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MANILA,
  }).formatToParts(new Date(value));

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

const STATE_LABEL: Record<WindowState, string> = {
  open: "Open — the public form accepts submissions",
  scheduled: "Scheduled — not yet open",
  closed: "Closed — submissions are refused",
};

export default async function ApplicationWindowPage() {
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);

  const canWrite = WINDOW_WRITER_ROLES.includes(ctx.role);

  const { data: termId } = await ctx.supabase.rpc("current_term_id");

  const { data: term } = termId
    ? await ctx.supabase
        .from("terms")
        .select("label, starts_on, ends_on")
        .eq("id", termId)
        .maybeSingle()
    : { data: null };

  const { data: windows } = termId
    ? await ctx.supabase
        .from("application_windows")
        .select("id, form_kind, opens_at, closes_at")
        .eq("term_id", termId)
        .order("opens_at", { ascending: true })
    : { data: null };

  const rows = windows ?? [];
  const membershipWindow =
    rows.find((row) => row.form_kind === MEMBERSHIP_APPLICATION_FORM_KIND) ?? null;
  const state = membershipWindow === null ? null : windowState(membershipWindow);
  const renewalWindow = rows.find((row) => row.form_kind === MEMBERSHIP_RENEWAL_FORM_KIND) ?? null;
  const renewalState = renewalWindow === null ? null : windowState(renewalWindow);

  // Sensible defaults for a term that has never had a window: open now, close in 30
  // days. The officer changes both; nothing is submitted for them.
  const now = Date.now();
  const defaultOpensAtLocal = toManilaLocalInput(
    membershipWindow?.opens_at ?? new Date(now).toISOString(),
  );
  const defaultClosesAtLocal = toManilaLocalInput(
    membershipWindow?.closes_at ?? new Date(now + 30 * 86_400_000).toISOString(),
  );
  const renewalOpensAtLocal = toManilaLocalInput(
    renewalWindow?.opens_at ?? new Date(now).toISOString(),
  );
  const renewalClosesAtLocal = toManilaLocalInput(
    renewalWindow?.closes_at ?? new Date(now + 30 * 86_400_000).toISOString(),
  );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Application period</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          The membership application form at <code>/apply</code> accepts submissions only while a
          period is open, for the current term{term ? ` (${term.label})` : ""}.
        </p>
      </header>

      {termId ? null : (
        <p role="alert" className="text-sm">
          There is no active term, so no application period can be scheduled. A term is created by
          the Technical Admin.
        </p>
      )}

      <section className="space-y-4 rounded-lg border p-4 sm:p-6">
        <h2 className="text-base font-semibold">Current schedule</h2>

        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No application period has been scheduled for this term yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Form
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Opens
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Closes
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="py-2 pr-4">{row.form_kind}</td>
                    <td className="py-2 pr-4">{formatInstant(row.opens_at)}</td>
                    <td className="py-2 pr-4">{formatInstant(row.closes_at)}</td>
                    <td className="py-2" data-testid={`window-status-${row.form_kind}`}>
                      {STATE_LABEL[windowState(row)]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground text-xs">All times shown in Asia/Manila.</p>
      </section>

      <section className="space-y-4 rounded-lg border p-4 sm:p-6">
        <h2 className="text-base font-semibold">
          {state === "open" ? "Change or close the open period" : "Schedule the period"}
        </h2>

        <ApplicationWindowForm
          isOpen={state === "open"}
          canWrite={canWrite}
          defaultOpensAtLocal={defaultOpensAtLocal}
          defaultClosesAtLocal={defaultClosesAtLocal}
        />
      </section>

      {/* The renewal period (0044; PRD US-G7). Same table, same policies, same audit —
          a second row keyed on form_kind = 'membership_renewal'. */}
      <section className="space-y-4 rounded-lg border p-4 sm:p-6">
        <h2 className="text-base font-semibold">
          {renewalState === "open"
            ? "Change or close the open renewal period"
            : "Schedule the renewal period"}
        </h2>
        <p className="text-muted-foreground text-sm">
          The membership renewal form at <code>/renew</code> — for returning scholars, identified by
          member ID and email — accepts submissions only while this period is open.
        </p>
        <ApplicationWindowForm
          formKind={MEMBERSHIP_RENEWAL_FORM_KIND}
          isOpen={renewalState === "open"}
          canWrite={canWrite}
          defaultOpensAtLocal={renewalOpensAtLocal}
          defaultClosesAtLocal={renewalClosesAtLocal}
        />
      </section>

      {/* US-B4's operational fact, stated on the screen rather than in a runbook nobody
          has open at the time. Closing is not a cache invalidation and does not wait for
          one: the refusal lives inside `applications_insert_anon`, which re-checks
          `now() between opens_at and closes_at` on every INSERT. */}
      <section className="text-muted-foreground max-w-2xl space-y-2 text-sm">
        <h2 className="text-foreground text-base font-semibold">
          Closing takes effect on the next submission
        </h2>
        <p>
          The check that refuses an application is a database policy, not a cache. The moment a
          closure is saved, the next submission is refused — including from a browser that already
          has the form open, and including a forwarded or bookmarked link. Nothing needs to be
          redeployed and there is no delay to wait out.
        </p>
        <p>
          Every open and close is written to the audit log with the officer who did it (US-B4).
          Closing a period never deletes it: the row stays, with its closing time set to the moment
          you closed it, so the period people actually applied in remains on the record.
        </p>
      </section>
    </div>
  );
}
