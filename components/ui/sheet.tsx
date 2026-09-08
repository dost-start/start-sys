// Vendored shadcn-style Sheet (a side panel on @radix-ui/react-dialog), brand edition
// (2026-09-08). Org-owned source per ARCHITECTURE.md §1. Used for the app shell's
// navigation drawer under the `lg` breakpoint.
"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  side = "left",
  title,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "left" | "right";
  /** Accessible name for the panel; rendered visually hidden. */
  title: string;
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "bg-card data-[state=open]:animate-in data-[state=closed]:animate-out fixed inset-y-0 z-50 flex w-[300px] max-w-[85vw] flex-col gap-4 shadow-card transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
          side === "left"
            ? "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left left-0"
            : "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right right-0",
          className,
        )}
        {...props}
      >
        <SheetPrimitive.Title className="sr-only">{title}</SheetPrimitive.Title>
        {children}
        <SheetPrimitive.Close className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-md opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
          <XIcon className="size-5" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetTrigger };
