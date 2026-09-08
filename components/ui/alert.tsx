// Notice panel, brand edition (2026-09-08): success / warning / danger / info tones.
// NO implicit `role` — several call sites use `role="status"` and several `role="alert"`,
// and the e2e specs read `getByRole("alert")`; the caller passes the role it means.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-card border-border text-foreground shadow-soft",
        success: "bg-success-soft border-success/30 text-success",
        warning: "bg-warning-soft border-warning/30 text-warning",
        danger: "bg-destructive/5 border-destructive/30 text-destructive",
        info: "bg-info-soft border-info/25 text-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="alert-title" className={cn("font-semibold", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("[&_p]:leading-relaxed", className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
