// Debounced name / member-ID search (BUILD_PLAN S5-T23; PRD US-I2).
//
// UNCONTROLLED with `defaultValue` seeded from the URL — so a shared link shows its
// own query text on load — and debounced at 300ms so a rapid typist produces exactly
// one navigation, not one per keystroke. Empty input removes `q` entirely rather than
// leaving a bare `?q=` (lib/members/filters.ts already treats `""` as absent; this
// mirrors that on the way out).
//
// ⚠ THE INPUT IS NEVER REMOUNTED, AND THAT IS THE POINT (QA 2026-09-11, RECORDS-08).
// It used to carry `key={filters.q}`: every debounced navigation changed the key, React
// unmounted and remounted the field, and focus dropped to `<body>` — so a typist who
// paused for 300ms found the rest of their query going nowhere. Re-syncing when
// `filters.q` changes from ELSEWHERE (a chip removed, Clear all, Back) is instead done
// by writing the DOM value through a ref, and only when the incoming `q` differs from
// the last one this component itself pushed. That distinction is the whole mechanism:
// our own navigation echoing back must not clobber characters typed while it was in
// flight. Still uncontrolled — a controlled `value` would re-render the field on every
// keystroke, which is the other well-known way to lose the caret mid-word.
//
// `{ scroll: false }` on the replace below is load-bearing for the same reason: App
// Router's scroll-and-focus handler is what would otherwise move focus to the top of
// the page on each navigation. Do not drop it.
//
// The input is still `type="search"` inside a label whose text is screen-reader-only —
// `getByRole("searchbox")` and the accessible name are unchanged by the restyle; only
// the magnifier icon and the brand field surface are new.
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  changeMemberFilters,
  MEMBERS_PATH,
  membersHref,
  type MemberFilters,
} from "@/lib/members/filters";

const DEBOUNCE_MS = 300;

export function MemberSearch({
  filters,
  basePath = MEMBERS_PATH,
}: {
  filters: MemberFilters;
  /**
   * Which list this box searches. Defaults to `/members`; the officer directory passes
   * `/directory` so one search box serves both (RECORDS-01). It is a PROP and never a
   * hardcoded path because an officer navigated onto `/members` is bounced home by
   * `canAccess` — which reads as a broken session rather than a broken link.
   */
  basePath?: string;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement | null>(null);

  // The last `q` THIS component put into the URL. Seeded from the first render so a
  // shared link arriving with `?q=…` is not mistaken for an external change on mount.
  const pushed = useRef<string>(filters.q ?? "");

  // Re-sync the field only when `q` changed somewhere ELSE — a chip removed, Clear all,
  // or Back. `filters.q` arriving equal to `pushed` is this component's own debounced
  // navigation landing, and writing the field then would delete whatever was typed
  // during the ~300ms it was in flight.
  useEffect(() => {
    const incoming = filters.q ?? "";
    if (incoming === pushed.current) return;
    pushed.current = incoming;
    // Any pending keystroke is now stale: Clear all clicked mid-word must not be undone
    // by a timer that still holds the old text.
    if (timer.current) clearTimeout(timer.current);
    if (input.current) input.current.value = incoming;
  }, [filters.q]);

  const onChange = (next: string): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = next.trim();
      // Recorded BEFORE the navigation, so the round trip back is recognised as ours.
      pushed.current = trimmed;
      const nextFilters = changeMemberFilters(filters, { q: trimmed === "" ? null : trimmed });
      router.replace(membersHref(nextFilters, basePath), { scroll: false });
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
        ref={input}
        type="search"
        placeholder="Search by name or member ID…"
        defaultValue={filters.q ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="pl-10"
      />
    </label>
  );
}
