// Server Component gate for `/portal` (BUILD_PLAN S2-T34). Strictly `member` —
// US-E4: a member sees their own assignment and nothing else, so no other role has
// a reason to be here (`canAccess`'s "member" case is deliberately not widened to
// include the admin roles).
//
// ⚠️ UX and defence in depth only — see app/(admin)/layout.tsx.
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { getSessionContext } from "@/lib/auth/queries";
import { canAccess, homeForRole } from "@/lib/auth/route-access";

export default async function MemberLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (!canAccess(ctx.role, "/portal")) redirect(homeForRole(ctx.role));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center gap-6 px-6 py-3">
          <span className="font-semibold tracking-tight">START-SYS</span>
          <span className="ml-auto text-xs text-muted-foreground">Member portal</span>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
