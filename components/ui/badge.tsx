// Vendored shadcn/ui component (new-york style). Org-owned source per
// ARCHITECTURE.md §1 — edited in place, never installed as a runtime
// dependency. CONVENTIONS.md §1.1: kebab-case file, PascalCase export.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Brand edition (2026-09-08): soft-tinted status pills. The four shadcn variant names
// are kept so no call site changes; their tones now read as status semantics —
// default = success (Active, Approved, Sent), secondary = neutral, destructive = danger,
// outline = warning (Renewal pending, Draft). Extra `success/warning/info/danger`
// aliases exist for new call sites that want to say what they mean.
const badgeVariants = cva(
  "inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-xs font-semibold w-fit whitespace-nowrap shrink-0 gap-1 [&>svg]:size-3 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-success-soft text-success",
        secondary: "border-transparent bg-brand-field text-brand-body",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        outline: "border-transparent bg-warning-soft text-warning",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        info: "border-transparent bg-info-soft text-info",
        danger: "border-transparent bg-destructive/10 text-destructive",
        neutral: "border-transparent bg-brand-field text-brand-body",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
