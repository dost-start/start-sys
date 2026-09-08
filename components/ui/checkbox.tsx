// A styled NATIVE checkbox, brand edition (2026-09-08). Not the Radix checkbox: the
// consent boxes on /apply are bound with react-hook-form's `register()` and the e2e
// specs tick `input[type="checkbox"]`. `accent-color` is set globally in globals.css.
import * as React from "react";

import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "mt-0.5 size-[18px] shrink-0 cursor-pointer rounded-[5px] border border-[#8a8f94] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.06)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
