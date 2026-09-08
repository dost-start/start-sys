// Step progress bar for the multi-step public forms (Ethan, 2026-09-08: "next page
// type of way"). Numbered dots joined by lines; the current step carries the brand
// gradient, completed steps are solid blue. Steps are buttons so a reviewer can jump
// back; the parent decides whether jumping forward is allowed.
"use client";

import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function Stepper({
  steps,
  current,
  onSelect,
  className,
}: {
  steps: readonly string[];
  current: number; // 1-based
  onSelect?: (step: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn("flex w-full items-center gap-1.5", className)} aria-label="Form steps">
      {steps.map((name, index) => {
        const step = index + 1;
        const state = step === current ? "current" : step < current ? "done" : "todo";
        return (
          <li
            key={name}
            className={cn("flex items-center gap-1.5", index < steps.length - 1 && "flex-1")}
          >
            <button
              type="button"
              onClick={onSelect ? () => onSelect(step) : undefined}
              disabled={!onSelect || state === "todo"}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 whitespace-nowrap bg-transparent p-0 text-[13px] font-medium disabled:cursor-default",
                state === "current" ? "text-brand-ink font-semibold" : "text-brand-label",
                state === "done" && "text-brand-body",
              )}
            >
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-full text-sm font-semibold shadow-[0_2px_6px_rgb(23_23_23/0.08)]",
                  state === "current" && "bg-brand-gradient text-brand-ink",
                  state === "done" && "bg-brand-blue text-white",
                  state === "todo" && "bg-brand-field text-brand-label",
                )}
              >
                {state === "done" ? <CheckIcon className="size-4" aria-hidden="true" /> : step}
              </span>
              <span className="hidden sm:inline">{name}</span>
              <span className="sr-only sm:hidden">{name}</span>
            </button>
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="bg-border mx-1.5 h-0.5 flex-1 rounded-full" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
