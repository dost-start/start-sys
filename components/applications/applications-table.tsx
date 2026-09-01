// The review queue grid (BUILD_PLAN S4-T18). TanStack Table v8 in FULLY MANUAL mode —
// `manualSorting` + `manualPagination`, no client-side filter/sort/page state. Every
// interaction (a header click, a status chip, Next/Previous) rewrites the URL via
// `router.replace(..., { scroll: false })` and the Server Component re-fetches. This
// is CONVENTIONS.md §2's rule made literal: filter/sort/page state lives ONLY in the
// URL, so a filtered queue is a link a second reviewer can open and see the same rows.
//
// The table never receives `applicant_email` or `payload` — the parent page only ever
// passes `ApplicationListRow`, whose columns are exactly `QUEUE_COLUMNS`
// (`lib/applications/queries.ts`). There is no prop this component could widen to leak
// them.
"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";

import { ApplicationStatusBadge } from "@/components/applications/application-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApplicationListFilters, ApplicationQueueStatus } from "@/lib/applications/schema";
import { APPLICATION_QUEUE_STATUSES } from "@/lib/applications/schema";
import type { ApplicationListPage, ApplicationListRow } from "@/lib/applications/queries";

type TermOption = { id: string; label: string };

const STATUS_FILTER_LABEL: Record<ApplicationQueueStatus | "all", string> = {
  all: "All",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

/** `Asia/Manila` per CONVENTIONS.md §3.3 — every rendered instant is local, storage is UTC. */
function formatManila(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const columns: ColumnDef<ApplicationListRow>[] = [
  {
    id: "name",
    header: "Applicant",
    cell: ({ row }) => (
      <a
        href={`/applications/${row.original.id}`}
        className="font-medium underline-offset-2 hover:underline"
      >
        {row.original.applicant_given_name} {row.original.applicant_family_name}
      </a>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <ApplicationStatusBadge status={row.original.status} />,
  },
  {
    id: "proof",
    header: "Proof",
    cell: ({ row }) =>
      row.original.proof_verified_at ? (
        <span className="text-sm text-muted-foreground">
          {row.original.proof_mime_type ?? "attached"}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
  {
    id: "submitted_at",
    header: "Submitted",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatManila(row.original.submitted_at)}
      </span>
    ),
  },
  {
    id: "reviewed",
    header: "Decided",
    cell: ({ row }) =>
      row.original.reviewed_at ? (
        <span className="text-sm text-muted-foreground">
          {formatManila(row.original.reviewed_at)}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
];

export function ApplicationsTable({
  page,
  filters,
  terms,
}: {
  page: ApplicationListPage;
  filters: ApplicationListFilters;
  terms: TermOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /** Build the queue URL for a partial filter change, preserving everything else. */
  const buildHref = (patch: Partial<Record<string, string | number | undefined>>): string => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    const qs = next.toString();
    return qs.length > 0 ? `${pathname}?${qs}` : pathname;
  };

  const navigate = (patch: Partial<Record<string, string | number | undefined>>) => {
    router.replace(buildHref(patch), { scroll: false });
  };

  const table = useReactTable({
    data: page.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    rowCount: page.total,
  });

  const totalPages = Math.max(1, Math.ceil(page.total / page.perPage));
  const currentSortDesc = filters.sort === "submitted_at.desc";

  const statusChips = useMemo(() => ["all" as const, ...APPLICATION_QUEUE_STATUSES], []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {statusChips.map((status) => {
            const active =
              status === "all" ? filters.status === undefined : filters.status === status;
            return (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => navigate({ status: status === "all" ? undefined : status, page: 1 })}
              >
                {STATUS_FILTER_LABEL[status]}
              </Button>
            );
          })}
        </div>

        {terms.length > 0 ? (
          <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            Term
            <select
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={filters.term_id ?? page.termId}
              onChange={(event) => navigate({ term_id: event.target.value, page: 1 })}
            >
              {terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {table.getFlatHeaders().map((header) => (
                <TableHead key={header.id}>
                  {header.column.id === "submitted_at" ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() =>
                        navigate({
                          sort: currentSortDesc ? "submitted_at.asc" : "submitted_at.desc",
                          page: 1,
                        })
                      }
                    >
                      Submitted {currentSortDesc ? "↓" : "↑"}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-10 text-center text-muted-foreground"
                >
                  {filters.status
                    ? `No ${filters.status} applications match these filters.`
                    : "No applications yet."}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {page.page} of {totalPages} · {page.total} total
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page.page <= 1}
            onClick={() => navigate({ page: page.page - 1 })}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page.page >= totalPages}
            onClick={() => navigate({ page: page.page + 1 })}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
