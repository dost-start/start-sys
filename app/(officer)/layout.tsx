// Server Component gate for `/directory` and `/committees` (BUILD_PLAN S2-T34).
//
// ⚠️ UX and defence in depth only — see the identical note in app/(admin)/layout.tsx.
// The COLUMNS an officer sees are cut by the column-level GRANT and
// `v_member_directory`, never by this file (ARCHITECTURE §5, US-D2, US-J1).
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSessionContext } from "@/lib/auth/queries";
import { canAccess, homeForRole } from "@/lib/auth/route-access";

export default async function OfficerLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (!canAccess(ctx.role, "/directory")) redirect(homeForRole(ctx.role));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <span className="font-semibold tracking-tight">START-SYS</span>
          <nav className="flex gap-4 text-sm">
            <a href="/directory" className="text-muted-foreground hover:text-foreground">
              Directory
            </a>
            <a href="/committees" className="text-muted-foreground hover:text-foreground">
              Committees
            </a>
          </nav>
          <span className="ml-auto text-xs text-muted-foreground">{ctx.role}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
