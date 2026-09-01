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
// nothing here needs to.
export function ApplicationSuccess() {
  return (
    <div className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 text-center">
      <div
        aria-hidden="true"
        className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-100 text-green-700"
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-6" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h1 className="text-xl font-semibold">Application received</h1>

      <p className="text-sm text-muted-foreground">
        Your membership application has been submitted and is now <strong>pending review</strong>.
        You do not need to do anything else right now.
      </p>

      <p className="text-sm text-muted-foreground">
        A decision follows after the application period closes. If you are approved, you will
        receive an email at the address you provided.
      </p>

      <p className="text-sm text-muted-foreground">
        Made a mistake, or need to change something?{" "}
        <a href="mailto:crrd@start-dost.org" className="font-medium underline underline-offset-4">
          Contact CRRD
        </a>{" "}
        — they can update your application directly.
      </p>
    </div>
  );
}
