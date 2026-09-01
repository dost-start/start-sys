// The two empty states for `/members` (BUILD_PLAN S5-T25).
//
// ⚠ THESE ARE THE ONLY TWO SENTENCES THIS COMPONENT MAY SAY. "No members match these
// filters" (with a clear action) and "no member records yet" are the correct reads of
// an empty result set; "you are not allowed to see these" is NEVER one of them — an
// RLS-empty result is `not_found`, never `unauthorized` (CONVENTIONS.md §4.3), and a
// caller with a genuinely narrower view (an officer, a regional rep) sees an accurate
// empty state, not an accusation.
"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_MEMBER_FILTERS,
  MEMBERS_PATH,
  hasActiveMemberFilters,
  membersHref,
  type MemberFilters,
} from "@/lib/members/filters";

export function MemberEmptyState({ filters }: { filters: MemberFilters }) {
  if (hasActiveMemberFilters(filters)) {
    return (
      <div className="space-y-2 text-center">
        <p className="text-sm font-medium">No members match these filters.</p>
        <p className="text-sm text-muted-foreground">
          Try removing a filter or widening your search.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={membersHref(DEFAULT_MEMBER_FILTERS, MEMBERS_PATH)}>Clear all filters</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1 text-center">
      <p className="text-sm font-medium">No member records yet.</p>
      <p className="text-sm text-muted-foreground">
        Approved applications create a member record for the current term.
      </p>
    </div>
  );
}
