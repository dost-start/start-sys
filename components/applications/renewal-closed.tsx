import Link from "next/link";

// The renewal form's closed state (0044). The same deliberate limitation as
// `ApplicationClosed`: anon can read a window ONLY while it is open, so this screen
// cannot announce when the next period starts.

export function RenewalClosed() {
  return (
    <div
      className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 text-center"
      data-testid="renewal-closed"
    >
      <h1 className="text-xl font-semibold">Membership renewal is not open right now</h1>
      <p className="text-sm text-muted-foreground">
        START-DOST opens renewals at the start of each term. Watch START-DOST&apos;s official
        channels — and your inbox — for the renewal announcement.
      </p>
      <p className="text-sm text-muted-foreground">
        Questions about your membership?{" "}
        <a href="mailto:crrd@start-dost.org" className="font-medium underline underline-offset-4">
          Contact CRRD
        </a>
        .
      </p>
      <Link href="/" className="inline-block text-sm font-medium underline underline-offset-4">
        Return home
      </Link>
    </div>
  );
}
