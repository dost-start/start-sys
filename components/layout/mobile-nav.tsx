// The navigation drawer under the `lg` breakpoint: a menu button in the top bar that
// opens a Sheet holding the emblem, the same pill nav and the sign-out control (passed in
// from the server layout as a ReactNode, so this file stays free of Server Actions).
"use client";

import { MenuIcon } from "lucide-react";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { BrandWordmark } from "@/components/brand/brand-wordmark";
import type { NavLink } from "@/components/layout/nav-links";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function MobileNav({ links, footer }: { links: ReadonlyArray<NavLink>; footer: ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger
        className="text-brand-body hover:bg-brand-field grid size-10 place-items-center rounded-lg lg:hidden"
        aria-label="Open navigation"
      >
        <MenuIcon className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" title="Navigation" className="px-5 pt-7 pb-6">
        <div className="mb-4 flex flex-col items-center gap-2">
          <BrandLogo height={56} />
          <span className="text-[20px]">
            <BrandWordmark />
          </span>
        </div>
        <SidebarNav links={links} />
        <div className="mt-auto pt-6">{footer}</div>
      </SheetContent>
    </Sheet>
  );
}
