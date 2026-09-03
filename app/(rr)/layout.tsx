// Server Component gate for `/region` (BUILD_PLAN S2-T34). Strictly
// `regional_rep` — region SCOPING itself is `auth_region_ids()` and the
// `memberships` RLS policy, never this file (US-F1, US-F2).
//
// ⚠️ UX and defence in depth only — see app/(admin)/layout.tsx.
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { getSessionContext } from "@/lib/auth/queries";
import { canAccess, homeForRole } from "@/lib/auth/route-access";

export default async function RegionalRepLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (!canAccess(ctx.role, "/region")) redirect(homeForRole(ctx.role));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-3">
          <span className="font-semibold tracking-tight">START-SYS</span>
          <span className="ml-auto text-xs text-muted-foreground">Regional Representative</span>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
