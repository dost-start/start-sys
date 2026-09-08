// The authenticated app shell from the Figma Dashboard frame: a white sidebar with the
// emblem, the wordmark, pill navigation and SIGN OUT pinned to the bottom; a white top
// bar with the page title and the role label; the content area on the brand background.
// Under `lg` the sidebar collapses into a top bar with a menu button and a drawer.
//
// A Server Component. It receives only strings and ReactNodes — never the session
// object — so no PII can reach the client components it composes (SidebarNav,
// MobileNav and ShellPageTitle read the pathname and nothing else).
//
// ⚠️ UX only. The three route-group layouts that render this still run the
// `canAccess` gate first, and the data on every page is cut by RLS regardless of what
// this shell shows (ARCHITECTURE.md §5).
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { BrandBackground } from "@/components/brand/brand-background";
import { BrandLogo } from "@/components/brand/brand-logo";
import { BrandWordmark } from "@/components/brand/brand-wordmark";
import { MobileNav } from "@/components/layout/mobile-nav";
import type { NavLink } from "@/components/layout/nav-links";
import { ShellPageTitle } from "@/components/layout/shell-page-title";
import { SidebarNav } from "@/components/layout/sidebar-nav";

export function AppShell({
  links,
  roleLabel,
  titleOverrides,
  width = "wide",
  children,
}: {
  links: ReadonlyArray<NavLink>;
  /** Shown in the top bar's right corner: the role enum, or a human label for the RR. */
  roleLabel: string;
  titleOverrides?: ReadonlyArray<NavLink>;
  /** `wide` = the admin tables (1152px); `narrow` = the RR page (896px). */
  width?: "wide" | "narrow";
  children: ReactNode;
}) {
  const signOut = <SignOutButton variant="button" className="w-full [&>button]:w-full" />;
  return (
    <div className="bg-card min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="bg-card sticky top-0 hidden h-screen flex-col gap-2.5 px-5 pt-7 pb-6 shadow-[1px_0_0_#eff0f2] lg:flex">
        <a
          href={links[0]?.href ?? "/"}
          className="mb-5 flex flex-col items-center gap-2 no-underline"
        >
          <BrandLogo height={64} />
          <span className="text-[22px]">
            <BrandWordmark />
          </span>
        </a>
        <SidebarNav links={links} />
        <div className="mt-auto pt-6">{signOut}</div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="bg-card flex h-[68px] items-center gap-3 px-4 shadow-[0_1px_0_#eff0f2] sm:px-6 lg:h-[76px] lg:px-8">
          <MobileNav links={links} footer={signOut} />
          <span className="text-[18px] lg:hidden">
            <BrandWordmark />
          </span>
          <div className="hidden min-w-0 lg:block">
            <ShellPageTitle links={links} overrides={titleOverrides} />
          </div>
          <span className="text-brand-label bg-brand-field ml-auto rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
            {roleLabel}
          </span>
        </header>
        <main className="brand-surface flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <BrandBackground compact />
          <div className={width === "narrow" ? "mx-auto max-w-4xl" : "mx-auto max-w-6xl"}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
