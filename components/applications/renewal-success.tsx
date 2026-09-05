// The renewal confirmation (PRD US-B3's shape, for the renewal form). Rendered in place —
// no per-renewal URL, no reference number, no echo of anything submitted.

export function RenewalSuccess() {
  return (
    <div
      className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 text-center"
      data-testid="renewal-success"
    >
      <div
        aria-hidden="true"
        className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-100 text-green-700"
      >
        ✓
      </div>
      <h2 className="text-xl font-semibold">Renewal received</h2>
      <p className="text-sm text-muted-foreground">
        Your renewal is <strong>pending review</strong> by the Community and Regional Relations
        Department. Your member ID stays the same; once approved, your membership for the new term
        is active and you will hear from CRRD by email.
      </p>
      <p className="text-sm text-muted-foreground">
        Made a mistake? Contact CRRD and they will correct it on your record — you do not need to
        submit again.
      </p>
    </div>
  );
}
