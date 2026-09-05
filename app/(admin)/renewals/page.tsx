// The renewal review queue (PRD US-G7; SRS "CRRD Chiefs and Deputies … manage
// membership applications"). Server Component through the caller's client:
// `renewal_submissions_read` (0018) is the authorization; the redirect is UX for tiers
// that would otherwise see an empty table. Filter state lives in the URL (CONVENTIONS §2).
import Link from "next/link";
import { redirect } from "next/navigation";

import { ApplicationStatusBadge } from "@/components/applications/application-status-badge";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/route-access";
import { listRenewals } from "@/lib/applications/renewal-queries";
import { RENEWAL_QUEUE_STATUSES, type RenewalQueueStatus } from "@/lib/applications/renewal-schema";

export const dynamic = "force-dynamic";

const REVIEWER_ROLES = new Set(["exec_admin", "crrd_admin"]);

function formatInstant(value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function parseStatus(raw: string | string[] | undefined): RenewalQueueStatus | "all" {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (RENEWAL_QUEUE_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as RenewalQueueStatus)
    : value === "all"
      ? "all"
      : "pending";
}

export default async function RenewalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);
  if (!REVIEWER_ROLES.has(ctx.role)) redirect(homeForRole(ctx.role));

  const params = await searchParams;
  const status = parseStatus(params.status);
  const rows = await listRenewals(ctx, status);

  const tabs: Array<{ value: RenewalQueueStatus | "all"; label: string }> = [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Membership renewals</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Returning scholars who submitted the renewal form for the current term. Approving one
          creates their membership for this term; their member ID never changes. The renewal period
          is opened on the{" "}
          <Link href="/applications/window" className="underline underline-offset-2">
            application period
          </Link>{" "}
          page.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter by status">
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={`/renewals?status=${tab.value}`}
            aria-current={tab.value === status ? "page" : undefined}
            className={
              tab.value === status
                ? "rounded-md border bg-muted px-3 py-1 font-medium"
                : "text-muted-foreground rounded-md border px-3 py-1 hover:text-foreground"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="renewals-empty">
          No {status === "all" ? "" : `${status} `}renewals this term.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-left text-sm" data-testid="renewals-table">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Member
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Member ID
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Submitted
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Decided
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-4 py-2">
                    <Link
                      href={`/renewals/${row.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {row.person
                        ? `${row.person.family_name}, ${row.person.given_name}`
                        : "(record unavailable)"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{row.person?.member_id ?? "—"}</td>
                  <td className="px-4 py-2">
                    <ApplicationStatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2">{formatInstant(row.submitted_at)}</td>
                  <td className="px-4 py-2">{formatInstant(row.reviewed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground text-xs">All times shown in Asia/Manila.</p>
    </div>
  );
}
