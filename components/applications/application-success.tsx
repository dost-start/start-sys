// The success + pending screen (BUILD_PLAN S3-T21; PRD US-B3, item 7).
//
// Rendered IN PLACE by `application-form.tsx` swapping its own render output — the
// URL never changes, there is no `/apply/{id}`, no reference number, and no echo of
// the applicant's email. `finalizeApplication` (lib/applications/actions.ts)
// deliberately returns nothing an id-lookup page could use, and this component holds
// no props for the same reason: "let the applicant check their status later" is the
// feature request that would rebuild the email-enumeration surface 0008/0019 spend
// their whole design removing.
//
// Purely presentational — the component that renders this clears the submit token
// and any pending-upload state from its own closures on the same transition, so
// nothing here needs to. Brand edition (2026-09-08): the hero-less centred card from
// the design canvas (`success_card`), a check in a success disc above the copy.
import { CheckIcon } from "lucide-react";

import { Card } from "@/components/ui/card";

export function ApplicationSuccess({ contactEmail }: { contactEmail: string }) {
  return (
    <Card
      radius="hero"
      className="w-full max-w-[560px] items-center gap-4 px-6 py-10 text-center sm:px-12 sm:py-11"
    >
      <span
        aria-hidden="true"
        className="bg-success-soft text-success grid size-[52px] place-items-center rounded-full"
      >
        <CheckIcon className="size-6" strokeWidth={2.5} />
      </span>

      <h1 className="text-brand-ink text-xl font-semibold sm:text-[22px]">Application received</h1>

      <p className="text-brand-body text-sm">
        Your membership application has been submitted and is now <strong>pending review</strong>.
        You do not need to do anything else right now.
      </p>

      <p className="text-brand-body text-sm">
        A decision follows after the application period closes. If you are approved, you will
        receive an email at the address you provided.
      </p>

      <p className="text-brand-body text-sm">
        Made a mistake, or need to change something?{" "}
        <a
          href={`mailto:${contactEmail}`}
          className="text-brand-link font-medium underline underline-offset-4"
        >
          Contact CRRD
        </a>{" "}
        — they can update your application directly.
      </p>
    </Card>
  );
}
