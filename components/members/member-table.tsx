// The member grid (BUILD_PLAN S5-T20; PRD §3 v1.0 items 10, 12; US-I2, US-I3).
//
// TanStack Table v8 in FULLY MANUAL mode — `manualSorting`, `manualFiltering`,
// `manualPagination`, `pageCount` from the server total. The table renders EXACTLY the
// rows the server returned and never sorts, filters or paginates in the browser: a
// client-side sort over one page of 25 would silently lie about the other 575
// (CONVENTIONS.md §2, §11 — "URL search params only", no client state library).
//
// State arrives as props (`filters`, `page`) and leaves via `router.replace(...,
// { scroll: false })` against `lib/members/filters.ts`'s URL contract — no `useState`
// mirrors any of it, so the grid cannot disagree with the address bar.
//
// Role-agnostic and prop-driven on purpose: S6's officer and RR read-only surfaces
// reuse this component rather than forking a second grid. The columns it renders
// (member-table-columns.tsx) never carry a sensitive field, so there is nothing here
// for a reused instance to leak regardless of who is looking.
"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  memberTableColumns,
  SORTABLE_MEMBER_COLUMNS,
} from "@/components/members/member-table-columns";
import {
  changeMemberFilters,
  membersHref,
  type MemberFilters,
  type MemberSort,
} from "@/lib/members/filters";
import type { MemberDirectoryPage } from "@/lib/members/types";

export function MemberTable({
  filters,
  page,
  emptyState,
}: {
  filters: MemberFilters;
  page: MemberDirectoryPage;
  /** Rendered in place of the body when there are no rows — see member-empty-state.tsx. */
  emptyState: ReactNode;
}) {
  const router = useRouter();

  const table = useReactTable({
    data: page.rows,
    columns: memberTableColumns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    rowCount: page.total,
  });

  const [sortColumn, sortDirection] = filters.sort.split(".") as [string, "asc" | "desc"];

  const toggleSort = (columnId: string): void => {
    if (!SORTABLE_MEMBER_COLUMNS.has(columnId)) return;

    const nextDirection: "asc" | "desc" =
      sortColumn === columnId && sortDirection === "asc" ? "desc" : "asc";
    const nextSort = `${columnId}.${nextDirection}` as MemberSort;

    router.replace(membersHref(changeMemberFilters(filters, { sort: nextSort })), {
      scroll: false,
    });
  };

  return (
    <div className="overflow-x-auto rounded-md border" data-testid="member-table">
      <Table>
        <TableHeader>
          <TableRow>
            {table.getFlatHeaders().map((header) => {
              const sortable = SORTABLE_MEMBER_COLUMNS.has(header.column.id);
              const active = sortColumn === header.column.id;
              return (
                <TableHead key={header.id}>
                  {sortable ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort(header.column.id)}
                      aria-sort={
                        active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"
                      }
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {active ? (
                        <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
                      ) : null}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={memberTableColumns.length} className="py-10">
                {emptyState}
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
  );
}
