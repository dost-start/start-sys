// The navigation link sets the app shell renders, one per route group. Labels and hrefs
// are exactly what the three layouts rendered before the brand restyle (2026-09-08);
// only the look changed. Plain data — no PII, safe to hand to a client component.

export type NavLink = { href: string; label: string };

export const ADMIN_NAV_LINKS: ReadonlyArray<NavLink> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/members", label: "Members" },
  { href: "/applications", label: "Applications" },
  { href: "/renewals", label: "Renewals" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/officers", label: "Officers" },
  { href: "/audit", label: "Audit log" },
];

// tech_admin's day-to-day surface is system configuration, not the records
// dashboards (BUILD_PLAN S6-T13).
export const TECH_ADMIN_NAV_LINKS: ReadonlyArray<NavLink> = [
  { href: "/system", label: "System" },
  { href: "/system/user-roles", label: "User roles" },
];

export const OFFICER_NAV_LINKS: ReadonlyArray<NavLink> = [
  { href: "/directory", label: "Directory" },
  { href: "/committees", label: "Committees" },
];

export const RR_NAV_LINKS: ReadonlyArray<NavLink> = [{ href: "/region", label: "Region" }];

/** Which link "owns" a path: the longest href that is the path or a segment prefix of it. */
export function activeLink(links: ReadonlyArray<NavLink>, pathname: string): NavLink | null {
  let best: NavLink | null = null;
  for (const link of links) {
    const owns = pathname === link.href || pathname.startsWith(`${link.href}/`);
    if (owns && (best === null || link.href.length > best.href.length)) best = link;
  }
  return best;
}
