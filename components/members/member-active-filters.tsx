// The visible, clearable active-filter set (BUILD_PLAN S5-T22; PRD US-I3: "the active
// filter set is visible"). One removable chip per active value plus "Clear all",
// which lands on the canonical empty `/members` — `DEFAULT_MEMBER_FILTERS` is the
// single source of what "empty" means, so this component and `parseMemberFilters`
// cannot disagree about it.
"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_MEMBER_FILTERS,
  MEMBERS_PATH,
  changeMemberFilters,
  hasActiveMemberFilters,
  membersHref,
  type MemberFilters,
} from "@/lib/members/filters";
import { MEMBERSHIP_STATUS_LABELS, type MembershipStatus } from "@/lib/members/transitions";
import type { MemberFacetOptions } from "@/lib/members/types";

type Chip = { key: string; label: string; onRemove: () => void };

function labelFor(facets: readonly { id: string; label: string }[], id: string): string {
  return facets.find((option) => option.id === id)?.label ?? id;
}

export function MemberActiveFilters({
  filters,
  facets,
}: {
  filters: MemberFilters;
  facets: MemberFacetOptions;
}) {
  const router = useRouter();

  const navigate = (patch: Partial<MemberFilters>): void => {
    router.replace(membersHref(changeMemberFilters(filters, patch)), { scroll: false });
  };

  if (!hasActiveMemberFilters(filters)) return null;

  const chips: Chip[] = [];

  if (filters.q !== null) {
    chips.push({
      key: "q",
      label: `Search: "${filters.q}"`,
      onRemove: () => navigate({ q: null }),
    });
  }
  if (filters.term_id !== null) {
    chips.push({
      key: "term_id",
      label: `Term: ${labelFor(facets.terms, filters.term_id)}`,
      onRemove: () => navigate({ term_id: null }),
    });
  }
  for (const status of filters.status) {
    chips.push({
      key: `status:${status}`,
      label: MEMBERSHIP_STATUS_LABELS[status as MembershipStatus],
      onRemove: () => navigate({ status: filters.status.filter((value) => value !== status) }),
    });
  }
  for (const id of filters.region_id) {
    chips.push({
      key: `region:${id}`,
      label: labelFor(facets.regions, id),
      onRemove: () => navigate({ region_id: filters.region_id.filter((value) => value !== id) }),
    });
  }
  for (const id of filters.committee_id) {
    chips.push({
      key: `committee:${id}`,
      label: labelFor(facets.committees, id),
      onRemove: () =>
        navigate({ committee_id: filters.committee_id.filter((value) => value !== id) }),
    });
  }
  for (const id of filters.department_id) {
    chips.push({
      key: `department:${id}`,
      label: labelFor(facets.departments, id),
      onRemove: () =>
        navigate({ department_id: filters.department_id.filter((value) => value !== id) }),
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="active-filters">
      {chips.map((chip) => (
        <Badge key={chip.key} variant="secondary" className="gap-1.5">
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove filter: ${chip.label}`}
            className="ml-0.5 rounded-sm hover:opacity-70"
          >
            ×
          </button>
        </Badge>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          router.replace(membersHref(DEFAULT_MEMBER_FILTERS, MEMBERS_PATH), { scroll: false })
        }
      >
        Clear all
      </Button>
    </div>
  );
}
