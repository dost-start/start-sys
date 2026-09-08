// The renewal review queue (PRD US-G7; SRS "CRRD Chiefs and Deputies … manage
// membership applications"). Server Component through the caller's client:
// `renewal_submissions_read` (0018) is the authorization; the redirect is UX for tiers
// that would otherwise see an empty table. Filter state lives in the URL (CONVENTIONS §2).
//
// Brand edition (2026-09-08): the app shell's top bar reads "Renewals" for this path,
// so the <h1> is screen-reader-only; the status filter is a nav of pill chips (links,
// as before — the active one is the gradient chip) and the grid sits in a white panel
// (design canvas `renewals`). Every string and test id is unchanged.
import Link from "next/link";
import { redirect } from "next/navigation";

import { ApplicationStatusBadge } from "@/components/applications/application-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/route-access";
import { listRenewals } from "@/lib/applications/renewal-queries";
import { RENEWAL_QUEUE_STATUSES, type RenewalQueueStatus } from "@/lib/applications/renewal-schema";
import { cn } from "@/lib/utils";

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
    <div className="space-y-5">
      <header>
        <h1 className="sr-only">Membership renewals</h1>
        <p className="text-brand-body max-w-3xl text-sm">
          Returning scholars who submitted the renewal form for the current term. Approving one
          creates their membership for this term; their member ID never changes. The renewal period
          is opened on the{" "}
          <Link
            href="/applications/window"
            className="text-brand-link font-medium underline underline-offset-[3px] hover:text-[#00508c]"
          >
            application period
          </Link>{" "}
          page.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={`/renewals?status=${tab.value}`}
            aria-current={tab.value === status ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: tab.value === status ? "default" : "outline", size: "sm" }),
              "rounded-full no-underline",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-brand-label text-sm" data-testid="renewals-empty">
          No {status === "all" ? "" : `${status} `}renewals this term.
        </p>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table className="min-w-[40rem]" data-testid="renewals-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Member</TableHead>
                <TableHead scope="col">Member ID</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Submitted</TableHead>
                <TableHead scope="col">Decided</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/renewals/${row.id}`}
                      className="text-brand-ink font-medium underline-offset-2 hover:underline"
                    >
                      {row.person
                        ? `${row.person.family_name}, ${row.person.given_name}`
                        : "(record unavailable)"}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-[13px] tabular-nums">
                    {row.person?.member_id ?? "—"}
                  </TableCell>
                  <TableCell>
                    <ApplicationStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>{formatInstant(row.submitted_at)}</TableCell>
                  <TableCell>{formatInstant(row.reviewed_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <p className="text-brand-label text-xs">All times shown in Asia/Manila.</p>
    </div>
  );
}
