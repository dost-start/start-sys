// Vendored shadcn/ui component (new-york style). Org-owned source per
// ARCHITECTURE.md §1 — edited in place, never installed as a runtime
// dependency. CONVENTIONS.md §1.1: kebab-case file, PascalCase export.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Brand edition (2026-09-08): the primary button is the blue→yellow gradient pill from
// the Figma frames, labels are uppercase via CSS (the DOM text stays sentence case, so
// every `getByRole("button", { name })` in e2e/ keeps matching), and `pill` is the
// large white rounded call-to-action on the landing and form heroes.
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-semibold uppercase tracking-[0.06em] transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-brand-gradient text-brand-ink shadow-pill hover:brightness-[1.03]",
        "brand-reverse":
          "bg-brand-gradient-reverse text-brand-ink shadow-pill hover:brightness-[1.03]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_6px_18px_rgb(185_28_28/0.18)] hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline: "bg-card text-foreground shadow-soft hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "text-brand-body normal-case tracking-normal font-medium hover:bg-accent hover:text-accent-foreground",
        link: "text-brand-link normal-case tracking-normal font-medium underline-offset-4 hover:underline",
        pill: "bg-card text-foreground shadow-card rounded-full normal-case tracking-normal font-medium hover:brightness-[1.02]",
      },
      size: {
        default: "h-11 px-6 has-[>svg]:px-5",
        sm: "h-9 gap-1.5 px-4 has-[>svg]:px-3",
        lg: "h-12 px-8 has-[>svg]:px-6",
        icon: "size-10",
        pill: "h-12 px-6 text-base sm:h-14 sm:min-w-[320px] sm:px-10 sm:text-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
