// Form-field scaffolding, brand edition (2026-09-08): a label above a control, an
// optional hint, an error line with `role="alert"`. The label is uppercase via CSS only,
// so the accessible name (and every getByLabel in e2e/) keeps its sentence-case text.
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function Field({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field" className={cn("flex flex-col gap-2", className)} {...props} />;
}

function FieldLabel({
  htmlFor,
  children,
  optional,
  required,
  className,
}: {
  htmlFor: string;
  children: ReactNode;
  optional?: boolean;
  /**
   * Marks the field required with an asterisk (PDF review 2026-09-09, Danielle and Aira:
   * "required fields carry no asterisk"). The asterisk is `aria-hidden` and paired with
   * visually-hidden " (required)" text, so the accessible name gains the word rather than
   * a punctuation mark a screen reader would read as "star" — and `getByLabel("First
   * name")` in e2e/ still matches, because the substring is unchanged.
   */
  required?: boolean;
  className?: string;
}) {
  return (
    <Label htmlFor={htmlFor} className={className}>
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="text-destructive font-semibold">
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      ) : null}
      {optional ? (
        <span className="text-brand-label font-medium normal-case">(optional)</span>
      ) : null}
    </Label>
  );
}

/** A field-level error message, rendered only when present. `role="alert"` so a screen reader announces it. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-hint"
      className={cn("text-muted-foreground text-xs", className)}
      {...props}
    />
  );
}

export { Field, FieldError, FieldHint, FieldLabel };
