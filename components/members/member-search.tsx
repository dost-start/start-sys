// Debounced name / member-ID search (BUILD_PLAN S5-T23; PRD US-I2).
//
// UNCONTROLLED with `defaultValue` seeded from the URL — so a shared link shows its
// own query text on load — and debounced at 300ms so a rapid typist produces exactly
// one navigation, not one per keystroke. Empty input removes `q` entirely rather than
// leaving a bare `?q=` (lib/members/filters.ts already treats `""` as absent; this
// mirrors that on the way out).
//
// Re-syncing when `filters.q` changes from elsewhere (a chip removed, Clear all) is
// done with `key={filters.q}` rather than a controlled `value` — remounting the input
// resets `defaultValue` for free without turning this into a controlled component that
// would re-render, and lose cursor position, on every keystroke's own navigation.
"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { changeMemberFilters, membersHref, type MemberFilters } from "@/lib/members/filters";

const DEBOUNCE_MS = 300;

export function MemberSearch({ filters }: { filters: MemberFilters }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onChange = (next: string): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = next.trim();
      router.replace(
        membersHref(changeMemberFilters(filters, { q: trimmed === "" ? null : trimmed })),
        { scroll: false },
      );
    }, DEBOUNCE_MS);
  };

  return (
    <label className="flex w-full max-w-sm items-center gap-2 text-sm">
      <span className="sr-only">Search by name or member ID</span>
      <input
        key={filters.q ?? ""}
        type="search"
        placeholder="Search by name or member ID…"
        defaultValue={filters.q ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </label>
  );
}
