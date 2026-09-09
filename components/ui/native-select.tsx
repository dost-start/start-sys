// A styled NATIVE <select>, brand edition (2026-09-08). Deliberately not the Radix
// select: react-hook-form's `register()` binds native controls directly, and the e2e
// specs drive these with `selectOption()`. Same surface as `Input`, plus a chevron.
import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const selectClassName = cn(inputClassName, "cursor-pointer appearance-none pr-10");

function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <select data-slot="native-select" className={cn(selectClassName, className)} {...props}>
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="text-brand-label pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
      />
    </span>
  );
}

export { NativeSelect };
