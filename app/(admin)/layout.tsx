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
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSessionContext } from "@/lib/auth/queries";
import { ADMIN_SYSTEM_PREFIX, canAccess, homeForRole } from "@/lib/auth/route-access";

const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/members", label: "Members" },
  { href: "/applications", label: "Applications" },
  { href: "/audit", label: "Audit log" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  if (!canAccess(ctx.role, "/dashboard")) redirect(homeForRole(ctx.role));

  // tech_admin's day-to-day surface is system configuration, not the records
  // dashboards (BUILD_PLAN S6-T13) — the nav reflects that rather than showing links
  // to a screen whose `memberships` policy does not name this role.
  const links =
    ctx.role === "tech_admin"
      ? [
          { href: ADMIN_SYSTEM_PREFIX, label: "System" },
          { href: "/system/user-roles", label: "User roles" },
        ]
      : NAV_LINKS;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <span className="font-semibold tracking-tight">START-SYS</span>
          <nav className="flex gap-4 text-sm">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-muted-foreground hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <span className="ml-auto text-xs text-muted-foreground">{ctx.role}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
