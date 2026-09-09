// The renewal form's closed state (0044). The same deliberate limitation as
// `ApplicationClosed`: anon can read a window ONLY while it is open, so this screen
// cannot announce when the next period starts. Brand edition (2026-09-08): the
// hero-less centred card from the design canvas (`closed_card`).
import { ClockIcon } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
// A7 (reviewer PDF 2026-09-09): the contact address arrives as a PROP rather than being
// hardcoded. It is derived from the mail environment by `lib/brand/org-contact.ts`, which
// is `server-only`, so the server page resolves it and passes it down — this component is
// on the client side of the boundary and must not read the environment itself.

export function RenewalClosed({ contactEmail }: { contactEmail: string }) {
  return (
    <Card
      radius="hero"
      className="w-full max-w-[560px] items-center gap-4 px-6 py-10 text-center sm:px-12 sm:py-11"
      data-testid="renewal-closed"
    >
      <span
        aria-hidden="true"
        className="bg-warning-soft text-warning grid size-[52px] place-items-center rounded-full"
      >
        <ClockIcon className="size-6" />
      </span>
      <h1 className="text-brand-ink text-xl font-semibold sm:text-[22px]">
        Membership renewal is not open right now
      </h1>
      <p className="text-brand-body text-sm">
        START-DOST opens renewals at the start of each term. Watch START-DOST&apos;s official
        channels — and your inbox — for the renewal announcement.
      </p>
      <p className="text-brand-body text-sm">
        Questions about your membership?{" "}
        <a
          href={`mailto:${contactEmail}`}
          className="text-brand-link font-medium underline underline-offset-4"
        >
          Contact CRRD
        </a>
        .
      </p>
      <Link
        href="/"
        className="text-brand-link inline-block text-sm font-medium underline underline-offset-4"
      >
        Return home
      </Link>
    </Card>
  );
}
