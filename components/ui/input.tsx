// Vendored shadcn-style primitive, brand edition (2026-09-08). Org-owned source per
// ARCHITECTURE.md §1 — edited in place, never installed as a runtime dependency.
// The soft grey pill input from the Figma frames. `inputClassName` is exported so the
// two existing class helpers (`fieldClassName` in components/applications/form-section.tsx
// and the member edit form) and any native <select> can share the exact same surface.
import * as React from "react";

import { cn } from "@/lib/utils";

export const inputClassName =
  "bg-brand-field text-foreground shadow-field h-11 w-full min-w-0 rounded-lg border border-transparent px-4 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 file:mr-3 file:rounded-md file:border-0 file:bg-card file:px-3 file:py-1.5 file:text-xs file:font-semibold file:uppercase file:text-foreground";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input type={type} data-slot="input" className={cn(inputClassName, className)} {...props} />
  );
}

export { Input };
