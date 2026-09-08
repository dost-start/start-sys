// The sidebar's pill navigation (Figma Dashboard frame). A client component only for
// `usePathname()`; it renders plain <a> elements, never next/link, so each navigation is
// a full request and the server layout gate re-runs (BUILD_PLAN S2-T34).
"use client";

import { usePathname } from "next/navigation";

import { activeLink, type NavLink } from "@/components/layout/nav-links";
import { cn } from "@/lib/utils";

export function SidebarNav({
  links,
  className,
}: {
  links: ReadonlyArray<NavLink>;
  className?: string;
}) {
  const pathname = usePathname();
  const active = activeLink(links, pathname);
  return (
    <nav aria-label="Main" className={cn("flex flex-col gap-2.5", className)}>
      {links.map((link) => {
        const isActive = active?.href === link.href;
        return (
          <a
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "bg-card text-brand-body shadow-soft flex h-[46px] items-center rounded-lg px-5 text-[15px] font-medium no-underline transition-[filter,transform] hover:brightness-[0.98] active:scale-[0.99]",
              isActive && "bg-brand-gradient text-brand-ink font-semibold",
            )}
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
