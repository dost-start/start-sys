// The faceted filter bar (BUILD_PLAN S5-T22; PRD §3 v1.0 item 12, US-I3).
//
// Plain checkboxes and a native `<select>` rather than a combobox — CONVENTIONS.md
// §11 bans an installed component library, and BUILD_PLAN's own S6 risk table
// sanctions exactly this fallback ("ship plain `<select>` elements... the URL
// contract in filters.ts is the deliverable; the combobox is polish"). Every control
// here is UX on top of `lib/members/filters.ts`, which is the actual contract.
//
// ⚠ THE TERM SELECTOR IS UX ONLY. It renders only when `canSelectTerm` is true (an
// admin tier, decided by the Server Component from `TERM_SELECTING_ROLES`), but the
// real gate is server-side: `search_member_directory()` ignores a client-supplied
// term for every other tier and RLS refuses the rows regardless (PRD US-H3).
"use client";

import { useRouter } from "next/navigation";

import {
  changeMemberFilters,
  membersHref,
  MEMBERSHIP_STATUSES,
  type MemberFilters,
} from "@/lib/members/filters";
import { MEMBERSHIP_STATUS_LABELS } from "@/lib/members/transitions";
import type { MemberFacetOptions } from "@/lib/members/types";

function toggleValue<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

export function MemberFilterBar({
  filters,
  facets,
  canSelectTerm,
}: {
  filters: MemberFilters;
  facets: MemberFacetOptions;
  canSelectTerm: boolean;
}) {
  const router = useRouter();

  const navigate = (patch: Partial<MemberFilters>): void => {
    router.replace(membersHref(changeMemberFilters(filters, patch)), { scroll: false });
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {canSelectTerm && facets.terms.length > 0 ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Term</span>
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={filters.term_id ?? ""}
            onChange={(event) => navigate({ term_id: event.target.value || null })}
          >
            <option value="">Current term</option>
            {facets.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Status</legend>
        <div className="flex flex-wrap gap-3" role="group" aria-label="Filter by status">
          {MEMBERSHIP_STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={filters.status.includes(status)}
                onChange={() => navigate({ status: toggleValue(filters.status, status) })}
              />
              {MEMBERSHIP_STATUS_LABELS[status]}
            </label>
          ))}
        </div>
      </fieldset>

      {facets.regions.length > 0 ? (
        <FacetGroup
          label="Region"
          options={facets.regions}
          selected={filters.region_id}
          onToggle={(id) => navigate({ region_id: toggleValue(filters.region_id, id) })}
        />
      ) : null}

      {facets.committees.length > 0 ? (
        <FacetGroup
          label="Committee"
          options={facets.committees}
          selected={filters.committee_id}
          onToggle={(id) => navigate({ committee_id: toggleValue(filters.committee_id, id) })}
        />
      ) : null}

      {facets.departments.length > 0 ? (
        <FacetGroup
          label="Department"
          options={facets.departments}
          selected={filters.department_id}
          onToggle={(id) => navigate({ department_id: toggleValue(filters.department_id, id) })}
        />
      ) : null}
    </div>
  );
}

function FacetGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div
        className="flex max-h-40 flex-wrap gap-3 overflow-y-auto"
        role="group"
        aria-label={`Filter by ${label.toLowerCase()}`}
      >
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={() => onToggle(option.id)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
