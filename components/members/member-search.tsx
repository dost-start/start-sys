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
//
// The input is still `type="search"` inside a label whose text is screen-reader-only —
// `getByRole("searchbox")` and the accessible name are unchanged by the restyle; only
// the magnifier icon and the brand field surface are new.
"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
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
    <label className="relative block w-full max-w-sm">
      <span className="sr-only">Search by name or member ID</span>
      <SearchIcon
        aria-hidden="true"
        className="text-brand-label pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
      />
      <Input
        key={filters.q ?? ""}
        type="search"
        placeholder="Search by name or member ID…"
        defaultValue={filters.q ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="pl-10"
      />
    </label>
  );
}
