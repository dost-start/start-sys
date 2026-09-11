// The faceted filter bar (BUILD_PLAN S5-T22; PRD §3 v1.0 item 12, US-I3).
//
// Plain checkboxes and a native `<select>` rather than a combobox — CONVENTIONS.md
// §11 bans an installed component library, and BUILD_PLAN's own S6 risk table
// sanctions exactly this fallback ("ship plain `<select>` elements... the URL
// contract in filters.ts is the deliverable; the combobox is polish"). Every control
// here is UX on top of `lib/members/filters.ts`, which is the actual contract.
//
// Brand edition (2026-09-08): each option is a CHIP (the design canvas's `.chip`) —
// a `<label>` wrapping the SAME native checkbox, now screen-reader-only, so the
// checkbox keeps its label association (`getByLabel("Active")` still finds a real
// `input[type=checkbox]`) while the label paints the checked state with `:has()`.
//
// ⚠ THE TERM SELECTOR IS UX ONLY. It renders only when `canSelectTerm` is true (an
// admin tier, decided by the Server Component from `TERM_SELECTING_ROLES`), but the
// real gate is server-side: `search_member_directory()` ignores a client-supplied
// term for every other tier and RLS refuses the rows regardless (PRD US-H3).
"use client";

import { useRouter } from "next/navigation";

import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  changeMemberFilters,
  MEMBERS_PATH,
  membersHref,
  MEMBERSHIP_STATUSES,
  type MemberFilters,
} from "@/lib/members/filters";
import { MEMBERSHIP_STATUS_LABELS } from "@/lib/members/transitions";
import type { MemberFacetOptions } from "@/lib/members/types";

/** The uppercase field-label style (components/ui/label), on a `<legend>` / `<span>`. */
const legendClassName =
  "text-brand-label text-xs leading-none font-semibold tracking-[0.08em] uppercase";

const chipClassName =
  "text-brand-body border-border bg-card has-[:checked]:bg-brand-gradient has-[:checked]:text-brand-ink has-[:focus-visible]:ring-ring/25 inline-flex max-w-full min-h-8 cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-left text-[13px] has-[:checked]:border-transparent has-[:checked]:font-semibold has-[:focus-visible]:ring-[3px]";

function toggleValue<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

export function MemberFilterBar({
  filters,
  facets,
  canSelectTerm,
  basePath = MEMBERS_PATH,
}: {
  filters: MemberFilters;
  facets: MemberFacetOptions;
  canSelectTerm: boolean;
  /** Which list these facets filter. `/directory` passes its own base (RECORDS-01). */
  basePath?: string;
}) {
  const router = useRouter();

  const navigate = (patch: Partial<MemberFilters>): void => {
    router.replace(membersHref(changeMemberFilters(filters, patch), basePath), { scroll: false });
  };

  return (
    <Card className="gap-5 p-5">
      {canSelectTerm && facets.terms.length > 0 ? (
        <label className="flex flex-wrap items-center gap-3 text-sm">
          <span className={legendClassName}>Term</span>
          <NativeSelect
            wrapperClassName="w-full sm:w-56"
            className="h-9 px-3 text-[13px]"
            value={filters.term_id ?? ""}
            onChange={(event) => navigate({ term_id: event.target.value || null })}
          >
            <option value="">Current term</option>
            {facets.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.label}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}

      <fieldset className="space-y-2.5">
        <legend className={legendClassName}>Status</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {MEMBERSHIP_STATUSES.map((status) => (
            <label key={status} className={chipClassName}>
              <input
                type="checkbox"
                className="sr-only"
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
    </Card>
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
    <fieldset className="space-y-2.5">
      <legend className={legendClassName}>{label}</legend>
      <div
        className="flex max-h-40 flex-wrap gap-2 overflow-y-auto"
        role="group"
        aria-label={`Filter by ${label.toLowerCase()}`}
      >
        {options.map((option) => (
          <label key={option.id} className={chipClassName}>
            <input
              type="checkbox"
              className="sr-only"
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
