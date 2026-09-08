// Server Component gate for `/directory` and `/committees` (BUILD_PLAN S2-T34).
//
// ⚠️ UX and defence in depth only — see the identical note in app/(admin)/layout.tsx.
// The COLUMNS an officer sees are cut by the column-level GRANT and
// `v_member_directory`, never by this file (ARCHITECTURE §5, US-D2, US-J1).
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { OFFICER_NAV_LINKS } from "@/components/layout/nav-links";
import { getSessionContext } from "@/lib/auth/queries";
import { canAccess, homeForRole } from "@/lib/auth/route-access";

export default async function OfficerLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (!canAccess(ctx.role, "/directory")) redirect(homeForRole(ctx.role));

  return (
    <AppShell links={OFFICER_NAV_LINKS} roleLabel={ctx.role}>
      {children}
    </AppShell>
  );
}
