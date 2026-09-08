// Vendored shadcn/ui component (new-york style). Org-owned source per
// ARCHITECTURE.md §1 — edited in place, never installed as a runtime
// dependency. CONVENTIONS.md §1.1: kebab-case file, PascalCase export.
"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        // Brand edition: uppercase field labels (Figma). Uppercase is CSS-only so the
        // accessible name keeps its sentence-case text for getByLabel matchers.
        "text-brand-label flex items-center gap-2 text-xs leading-none font-semibold tracking-[0.08em] uppercase select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
