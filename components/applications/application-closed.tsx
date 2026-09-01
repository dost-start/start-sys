// The closed-window state of `/apply` (BUILD_PLAN S3-T17). Rendered whenever
// `getPublicWindowState()` reports the period is not open — including when no window
// exists at all — and says NOTHING about any applicant, only about the period itself.
import Link from "next/link";

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
    <div className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 text-center">
      <h1 className="text-xl font-semibold">Applications are not open right now</h1>

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
        <p className="text-sm text-muted-foreground">
          The membership application period closed on {formatManila(window.closesAt)} (Philippine
          time).
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          START-DOST is not currently accepting membership applications. Watch START-DOST&apos;s
          official channels for the next application period.
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        Already submitted an application?{" "}
        <a href="mailto:crrd@start-dost.org" className="font-medium underline underline-offset-4">
          Contact CRRD
        </a>{" "}
        with any questions.
      </p>

      <Link href="/" className="inline-block text-sm font-medium underline underline-offset-4">
        Return home
      </Link>
    </div>
  );
}
