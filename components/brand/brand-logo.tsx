// The START-DOST emblem (the org's own PNG, public/brand/start-emblem.png). Used in the
// landing hero, the login card, the sidebar and the footer. Pass the rendered height (and
// an optional smaller one for phone widths) and the width follows. Sizes travel as CSS
// variables so the responsive switch is a static Tailwind class rather than an inline
// style nothing can override.
//
// ⚠ THE width/height PROPS ARE THE FILE'S OWN 665×1024, NOT THE RENDERED SIZE.
//
// They used to be the rendered size, and `width` was `Math.round(height * ASPECT)`. That
// rounding is what made Next warn on every single page render: at height 150 the rounded
// width is 97, and 97 at the true ratio is 149.36px tall — so with `height: auto` the
// browser rendered 149.28px where the props promised 150, Next saw CSS had changed one
// dimension and not the other, and said so. Passing the intrinsic dimensions makes the
// ratio Next checks exact and unroundable; the DISPLAY size is the CSS variable below,
// which is where it belonged anyway.
//
// The warning mattered beyond tidiness: it was the only console output in an otherwise
// clean run, which is exactly the noise a real error hides behind. QA 2026-09-10,
// ISSUE-014. If the asset is re-exported at a different size, update these two numbers
// (`file public/brand/start-emblem.png` prints them).
import Image from "next/image";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

const INTRINSIC_W = 665;
const INTRINSIC_H = 1024;
const ASPECT = INTRINSIC_W / INTRINSIC_H;

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
    // `height: auto` INLINE, not only via the `h-auto` class. Next compares the rendered
    // box against the width/height props and warns when CSS changes one dimension without
    // the other; a utility class does not always win that comparison, and the warning then
    // fires on every page. It was the only console output in an otherwise clean run, which
    // is exactly the noise that hides a real error (QA 2026-09-10, ISSUE-014).
    height: "auto",
  } as CSSProperties;
  return (
    <Image
      src="/brand/start-emblem.png"
      alt="START-DOST emblem"
      // The FILE's dimensions, not the rendered ones — so the ratio Next checks against is
      // exact. Display size is the CSS variable below.
      width={INTRINSIC_W}
      height={INTRINSIC_H}
      priority={priority}
      className={cn(
        "h-auto w-(--brand-logo-w) select-none max-sm:w-(--brand-logo-w-sm)",
        className,
      )}
      style={vars}
    />
  );
}
