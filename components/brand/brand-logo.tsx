// The START-DOST emblem (the org's own PNG, public/brand/start-emblem.png). Used in the
// landing hero, the login card, the sidebar and the footer. The file is 665×1024; pass
// the rendered height (and an optional smaller one for phone widths) and the width
// follows. Sizes travel as CSS variables so the responsive switch is a static Tailwind
// class rather than an inline style nothing can override.
import Image from "next/image";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

const ASPECT = 665 / 1024;

export function BrandLogo({
  height = 96,
  mobileHeight,
  className,
  priority = false,
}: {
  height?: number;
  /** Rendered height below the `sm` breakpoint; defaults to `height`. */
  mobileHeight?: number;
  className?: string;
  priority?: boolean;
}) {
  const width = Math.round(height * ASPECT);
  const mobileWidth = Math.round((mobileHeight ?? height) * ASPECT);
  const vars = {
    "--brand-logo-w": `${width}px`,
    "--brand-logo-w-sm": `${mobileWidth}px`,
  } as CSSProperties;
  return (
    <Image
      src="/brand/start-emblem.png"
      alt="START-DOST emblem"
      width={width}
      height={height}
      priority={priority}
      className={cn(
        "h-auto w-(--brand-logo-w) select-none max-sm:w-(--brand-logo-w-sm)",
        className,
      )}
      style={vars}
    />
  );
}
