// The top bar's page title (Figma Dashboard frame): the label of the nav link that owns
// the current path, or the system name. A <p>, not a heading — each page keeps its own
// <h1> (visible on detail pages, screen-reader-only where it would repeat this label).
"use client";

import { usePathname } from "next/navigation";

import { activeLink, type NavLink } from "@/components/layout/nav-links";
import { ORG_SYSTEM_NAME } from "@/lib/brand/org";

export function ShellPageTitle({
  links,
  overrides,
}: {
  links: ReadonlyArray<NavLink>;
  /** Extra path → title pairs for pages that are not nav links (e.g. `/applications/window`). */
  overrides?: ReadonlyArray<NavLink>;
}) {
  const pathname = usePathname();
  const active = activeLink([...(overrides ?? []), ...links], pathname);
  return (
    <p className="text-brand-ink truncate text-[22px] leading-tight font-semibold sm:text-[26px]">
      {active?.label ?? ORG_SYSTEM_NAME}
    </p>
  );
}
