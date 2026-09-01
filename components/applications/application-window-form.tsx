// ─────────────────────────────────────────────────────────────────────────────
// The open/close controls for the membership application period (BUILD_PLAN S4-T24,
// PRD US-B4).
//
// ⚠ NOTHING HERE IS AN ENFORCEMENT. Hiding a button is never how a permission is
// applied in this system (ARCHITECTURE.md §5): `canWrite` below only decides whether
// the controls are rendered, and a caller who forges the request is refused twice —
// by `withRole([...])` in `lib/applications/window-actions.ts` and, independently, by
// `application_windows_insert` / `_update` in 0014, which also demand `has_aal2()`.
//
// ⚠ THE TIMEZONE CONVERSION IS THE ONE PIECE OF REAL LOGIC IN THIS FILE.
// `<input type="datetime-local">` yields a wall-clock string with no offset. The
// action's schema REFUSES that shape on purpose, so this component converts local →
// absolute ISO before calling it. Without that, a CCDO in Asia/Manila setting a 5pm
// close would have it applied against the server's UTC clock — eight hours late, with
// no error anywhere.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useState, useTransition } from "react";

import { closeApplicationWindow, openApplicationWindow } from "@/lib/applications/window-actions";
import { MEMBERSHIP_APPLICATION_FORM_KIND } from "@/lib/applications/window-schema";
import { Button } from "@/components/ui/button";

export type ApplicationWindowFormProps = {
  /** Whether a period is open right now — decides which control is primary. */
  isOpen: boolean;
  /** False for a reviewer who may read the schedule but not change it (see the page). */
  canWrite: boolean;
  /** Prefill for the two inputs, already converted to `datetime-local` shape. */
  defaultOpensAtLocal: string;
  defaultClosesAtLocal: string;
};

/**
 * `2026-06-01T09:00` (the browser's local reading) → `2026-06-01T09:00:00.000+08:00`.
 *
 * `new Date(localValue)` parses a datetime-local string in the *browser's* zone, which
 * is the officer's own zone and therefore the one they meant. `toISOString()` then
 * makes it absolute. Returns null for an unparseable value so the caller can surface a
 * field error rather than sending `Invalid Date` to the server.
 */
function toAbsoluteInstant(localValue: string): string | null {
  if (localValue.trim() === "") return null;
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function ApplicationWindowForm({
  isOpen,
  canWrite,
  defaultOpensAtLocal,
  defaultClosesAtLocal,
}: ApplicationWindowFormProps) {
  const [opensAt, setOpensAt] = useState(defaultOpensAtLocal);
  const [closesAt, setClosesAt] = useState(defaultClosesAtLocal);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  if (!canWrite) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="window-read-only">
        You can see the schedule but not change it. Opening and closing the application period is
        the CCDO&apos;s or the CTO&apos;s to do (ADR 0003) — and the database refuses the write
        independently of what this page renders.
      </p>
    );
  }

  const submitOpen = () => {
    setMessage(null);
    setFieldErrors({});

    const opens = toAbsoluteInstant(opensAt);
    const closes = toAbsoluteInstant(closesAt);
    if (opens === null || closes === null) {
      setFieldErrors({
        ...(opens === null ? { opens_at: ["Enter an opening date and time"] } : {}),
        ...(closes === null ? { closes_at: ["Enter a closing date and time"] } : {}),
      });
      return;
    }

    startTransition(async () => {
      const result = await openApplicationWindow({
        form_kind: MEMBERSHIP_APPLICATION_FORM_KIND,
        opens_at: opens,
        closes_at: closes,
      });

      if (result.ok) {
        setMessage("The application period is open. The public form accepts submissions now.");
        return;
      }
      // Server field errors go under their input, never into a generic toast
      // (CONVENTIONS §6). The message is the action's own user-safe string.
      setFieldErrors(result.error.fields ?? {});
      setMessage(result.error.message);
    });
  };

  const submitClose = () => {
    setMessage(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await closeApplicationWindow({
        form_kind: MEMBERSHIP_APPLICATION_FORM_KIND,
      });

      setMessage(
        result.ok
          ? "The application period is closed. The next submission is refused by the database."
          : result.error.message,
      );
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="opens_at" className="text-sm font-medium">
            Applications open
          </label>
          <input
            id="opens_at"
            name="opens_at"
            type="datetime-local"
            value={opensAt}
            onChange={(event) => setOpensAt(event.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          <FieldErrors messages={fieldErrors["opens_at"]} />
        </div>

        <div className="space-y-1">
          <label htmlFor="closes_at" className="text-sm font-medium">
            Applications close
          </label>
          <input
            id="closes_at"
            name="closes_at"
            type="datetime-local"
            value={closesAt}
            onChange={(event) => setClosesAt(event.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
          <FieldErrors messages={fieldErrors["closes_at"]} />
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Times are entered and shown in your own timezone and stored as absolute instants.
      </p>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={submitOpen} disabled={pending}>
          {isOpen ? "Update the open period" : "Open applications"}
        </Button>
        <Button type="button" variant="outline" onClick={submitClose} disabled={pending || !isOpen}>
          Close applications now
        </Button>
      </div>

      {message === null ? null : (
        <p role="alert" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

function FieldErrors({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {messages.join(" ")}
    </p>
  );
}
