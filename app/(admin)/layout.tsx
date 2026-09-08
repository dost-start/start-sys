// Server Component gate for the `/dashboard`, `/members`, `/applications`, `/audit`
// and `/system*` surface (BUILD_PLAN S2-T34).
//
// ⚠️ THIS IS UX AND DEFENCE IN DEPTH, NOT THE SECURITY BOUNDARY. Deleting this file
// degrades navigation, not confidentiality: `middleware.ts` already redirects an
// unauthorized visitor before a Server Component ever renders, and every PII read in
// the pages below is additionally guarded by RLS and (for sensitive columns) the
// audited RPCs in `lib/members/` — see ARCHITECTURE.md §5. If you find yourself
// relying on this file to keep a column secret, the policy is wrong.
//
// `/system` is narrower than the rest of this group (tech_admin only); that narrowing
// is `canAccess`'s job at the PAGE level (and at `middleware.ts`), not this layout's —
// this layout only confirms the visitor belongs to the admin group at all, using
// `/dashboard` as the group's representative path.
//
// The chrome is `AppShell` (brand restyle, 2026-09-08); it receives only the link set
// and the role string, never the session object.
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { ADMIN_NAV_LINKS, TECH_ADMIN_NAV_LINKS } from "@/components/layout/nav-links";
import { getSessionContext } from "@/lib/auth/queries";
import { canAccess, homeForRole } from "@/lib/auth/route-access";

const TITLE_OVERRIDES = [
  { href: "/applications/window", label: "Application period" },
  { href: "/campaigns/new", label: "New campaign" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (!canAccess(ctx.role, "/dashboard")) redirect(homeForRole(ctx.role));

  // tech_admin's day-to-day surface is system configuration, not the records
  // dashboards (BUILD_PLAN S6-T13) — the nav reflects that rather than showing links
  // to a screen whose `memberships` policy does not name this role.
  const links = ctx.role === "tech_admin" ? TECH_ADMIN_NAV_LINKS : ADMIN_NAV_LINKS;

  return (
    <AppShell links={links} roleLabel={ctx.role} titleOverrides={TITLE_OVERRIDES}>
      {children}
    </AppShell>
  );
}
