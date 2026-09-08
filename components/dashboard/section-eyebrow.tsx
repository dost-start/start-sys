// A section heading in the design canvas's `.eyebrow` style (docs/design/canvas/lib.py):
// small, uppercase, tracked, in the label grey. Used above every tile grid and bar panel
// on the dashboards so the three read surfaces share one heading treatment.
//
// An `<h2>` by default — the page's `<h1>` is the shell's top-bar title (or the visible
// heading on a detail page), and these are its sections. Presentational only.
import type * as React from "react";

import { cn } from "@/lib/utils";

export function SectionEyebrow({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "text-brand-label text-[12px] font-semibold tracking-[0.12em] uppercase",
        className,
      )}
      {...props}
    />
  );
}
