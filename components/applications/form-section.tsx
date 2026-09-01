// Shared presentational scaffolding for the `/apply` form (BUILD_PLAN S3-T17/S3-T18).
// One card-styled section wrapper plus the field-error/input-class helpers every
// section component below reuses, so the four sections stay visually identical
// without four copies of the same Tailwind string.
"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** A field-level error message, rendered only when present. `role="alert"` so a screen reader announces it. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** The shared input/select class string, switching border color on error. */
export function fieldClassName(hasError: boolean): string {
  return cn(
    "w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    hasError ? "border-destructive" : "border-input",
  );
}

/** A label above a field, consistent size/weight across every section. */
export function FieldLabel({
  htmlFor,
  children,
  optional,
}: {
  htmlFor: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
      {optional ? <span className="ml-1 font-normal text-muted-foreground">(optional)</span> : null}
    </label>
  );
}
