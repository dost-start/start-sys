// The closed-window state of `/apply` (BUILD_PLAN S3-T17). Rendered whenever
// `getPublicWindowState()` reports the period is not open — including when no window
// exists at all — and says NOTHING about any applicant, only about the period itself.
// Brand edition (2026-09-08): the hero-less centred card from the design canvas
// (`closed_card`), a clock in a warning disc above the existing copy.
import { ClockIcon } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { PublicWindowState } from "@/lib/applications/queries";

const MANILA_TIME_ZONE = "Asia/Manila";

function formatManila(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TIME_ZONE,
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function ApplicationClosed({ window }: { window: PublicWindowState }) {
  return (
    <Card
      radius="hero"
      className="w-full max-w-[560px] items-center gap-4 px-6 py-10 text-center sm:px-12 sm:py-11"
    >
      <span
        aria-hidden="true"
        className="bg-warning-soft text-warning grid size-[52px] place-items-center rounded-full"
      >
        <ClockIcon className="size-6" />
      </span>

      <h1 className="text-brand-ink text-xl font-semibold sm:text-[22px]">
        Applications are not open right now
      </h1>

      {/*
        `getPublicWindowState()` (lib/applications/queries.ts) can ONLY read
        `opens_at`/`closes_at` while a window is currently open — the anon SELECT
        policy on `application_windows` is deliberately scoped that way, because it is
        the same policy the anon INSERT policy on `applications` checks, and widening
        it to serve a "next opens on…" date here would make a bookmarked link
        submittable outside the period. In practice `window.closesAt` is therefore
        always `null` today; this branch is here in case a future, separately
        published value (queries.ts's own suggestion) makes it non-null later.
      */}
      {window.closesAt ? (
        <p className="text-brand-body text-sm">
          The membership application period closed on {formatManila(window.closesAt)} (Philippine
          time).
        </p>
      ) : (
        <p className="text-brand-body text-sm">
          START-DOST is not currently accepting membership applications. Watch START-DOST&apos;s
          official channels for the next application period.
        </p>
      )}

      <p className="text-brand-body text-sm">
        Already submitted an application?{" "}
        <a
          href="mailto:crrd@start-dost.org"
          className="text-brand-link font-medium underline underline-offset-4"
        >
          Contact CRRD
        </a>{" "}
        with any questions.
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
