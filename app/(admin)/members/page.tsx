// The member directory (BUILD_PLAN S5-T25; PRD §3 v1.0 items 10, 12; US-I2, US-I3).
//
// Server Component. `searchParams` is parsed through `parseMemberFilters`
// (CONVENTIONS.md §2 — filter/sort/pagination state lives in the URL, never in
// `useState`), so `listMemberDirectory` sees the SAME filters a shared link would
// reproduce, and a second admin opening that exact URL sees the same rows (US-I3).
//
// Access is enforced independently by RLS + `search_member_directory()` (0030) and by
// `(admin)/layout.tsx`; this page adds no third opinion on top of them.
import { redirect } from "next/navigation";

import { MemberActiveFilters } from "@/components/members/member-active-filters";
import { MemberEmptyState } from "@/components/members/member-empty-state";
import { MemberFilterBar } from "@/components/members/member-filters";
import { MemberPagination } from "@/components/members/member-pagination";
import { MemberSearch } from "@/components/members/member-search";
import { MemberTable } from "@/components/members/member-table";
import { getSessionContext } from "@/lib/auth/queries";
import type { OrgRole } from "@/lib/auth/route-access";
import { parseMemberFilters } from "@/lib/members/filters";
import { listFacetOptions, listMemberDirectory } from "@/lib/members/queries";

export const dynamic = "force-dynamic";

/**
 * Mirrors `TERM_SELECTING_ROLES` in lib/members/queries.ts. Not imported because that
 * constant is private to the query module — kept here as UX only, since the real gate
 * is server-side inside `search_member_directory()` regardless of what this page sends.
 */
const TERM_SELECTING_ROLES = new Set<OrgRole>(["exec_admin", "crrd_admin", "tech_admin"]);

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const rawParams = await searchParams;
  const filters = parseMemberFilters(rawParams);

  const [listResult, facets] = await Promise.all([
    listMemberDirectory(ctx, filters),
    listFacetOptions(ctx),
  ]);

  const page = listResult.ok
    ? listResult.data
    : { rows: [], total: 0, page: filters.page, perPage: filters.per_page };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground">
          {page.total} member{page.total === 1 ? "" : "s"} match the current filters.
        </p>
      </div>

      <div className="space-y-3">
        <MemberSearch filters={filters} />
        <MemberFilterBar
          filters={filters}
          facets={facets}
          canSelectTerm={TERM_SELECTING_ROLES.has(ctx.role)}
        />
        <MemberActiveFilters filters={filters} facets={facets} />
      </div>

      {!listResult.ok ? (
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          {listResult.error.message}
        </p>
      ) : (
        <>
          <MemberTable
            filters={filters}
            page={page}
            emptyState={<MemberEmptyState filters={filters} />}
          />
          <MemberPagination filters={filters} total={page.total} />
        </>
      )}
    </div>
  );
}
