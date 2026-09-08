// Server Component gate for `/region` (BUILD_PLAN S2-T34). Strictly
// `regional_rep` — region SCOPING itself is `auth_region_ids()` and the
// `memberships` RLS policy, never this file (US-F1, US-F2).
//
// ⚠️ UX and defence in depth only — see app/(admin)/layout.tsx.
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { RR_NAV_LINKS } from "@/components/layout/nav-links";
import { getSessionContext } from "@/lib/auth/queries";
import { canAccess, homeForRole } from "@/lib/auth/route-access";

export default async function RegionalRepLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (!canAccess(ctx.role, "/region")) redirect(homeForRole(ctx.role));

  return (
    <AppShell links={RR_NAV_LINKS} roleLabel="Regional Representative">
      {children}
    </AppShell>
  );
}
