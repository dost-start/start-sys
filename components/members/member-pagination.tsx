// Pagination controls (BUILD_PLAN S5-T24).
//
// The total is PostgREST's `count: 'exact'` (lib/members/queries.ts), never an
// estimate — the page count shown here is honest. Out-of-range pages are already
// clamped by `parseMemberFilters` reading a malformed `?page=`, but a page that WAS
// valid when a link was shared and has since fallen out of range (rows deleted, a
// filter narrowed) is clamped again here so a stale link never dead-ends on a blank
// grid — it renders the last real page instead.
"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { changeMemberFilters, membersHref, type MemberFilters } from "@/lib/members/filters";

export function MemberPagination({ filters, total }: { filters: MemberFilters; total: number }) {
  const router = useRouter();
  const totalPages = Math.max(1, Math.ceil(total / filters.per_page));
  const currentPage = Math.min(filters.page, totalPages);

  const goTo = (page: number): void => {
    router.replace(membersHref(changeMemberFilters(filters, { page })), { scroll: false });
  };

  return (
    <nav
      className="flex items-center justify-between text-sm text-muted-foreground"
      aria-label="Member list pagination"
    >
      <span aria-live="polite">
        Page {currentPage} of {totalPages} · {total} member{total === 1 ? "" : "s"}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => goTo(currentPage - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => goTo(currentPage + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
