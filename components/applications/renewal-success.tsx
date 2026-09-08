// The renewal confirmation (PRD US-B3's shape, for the renewal form). Rendered in place —
// no per-renewal URL, no reference number, no echo of anything submitted. Brand edition
// (2026-09-08): the hero-less centred card from the design canvas (`success_card`).
import { CheckIcon } from "lucide-react";

import { Card } from "@/components/ui/card";

export function RenewalSuccess() {
  return (
    <Card
      radius="hero"
      className="w-full max-w-[560px] items-center gap-4 px-6 py-10 text-center sm:px-12 sm:py-11"
      data-testid="renewal-success"
    >
      <span
        aria-hidden="true"
        className="bg-success-soft text-success grid size-[52px] place-items-center rounded-full"
      >
        <CheckIcon className="size-6" strokeWidth={2.5} />
      </span>
      <h1 className="text-brand-ink text-xl font-semibold sm:text-[22px]">Renewal received</h1>
      <p className="text-brand-body text-sm">
        Your renewal is <strong>pending review</strong> by the Community and Regional Relations
        Department. Your member ID stays the same; once approved, your membership for the new term
        is active and you will hear from CRRD by email.
      </p>
      <p className="text-brand-body text-sm">
        Made a mistake? Contact CRRD and they will correct it on your record — you do not need to
        submit again.
      </p>
    </Card>
  );
}
