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
import {
  MEMBERSHIP_APPLICATION_FORM_KIND,
  type WindowFormKind,
  type WindowState,
} from "@/lib/applications/window-schema";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type ApplicationWindowFormProps = {
  /** Which public form's period this instance controls. Defaults to the application form. */
  formKind?: WindowFormKind;
  /**
   * The period's state right now, or null when this term has no window row at all.
   *
   * Three states, not a boolean: "scheduled" (opens_at still in the future) has to be
   * distinguishable from "open", because a scheduled period can be cancelled or
   * re-scheduled freely while an open one must be closed deliberately first.
   */
  state: WindowState | null;
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
  formKind = MEMBERSHIP_APPLICATION_FORM_KIND,
  state,
  canWrite,
  defaultOpensAtLocal,
  defaultClosesAtLocal,
}: ApplicationWindowFormProps) {
  const [opensAt, setOpensAt] = useState(defaultOpensAtLocal);
  const [closesAt, setClosesAt] = useState(defaultClosesAtLocal);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  // Derived once: three states, and every control below keys off one of the two that
  // permit an action. A closed or absent period offers only "Open the period".
  const isOpen = state === "open";
  const isScheduled = state === "scheduled";

  if (!canWrite) {
    return (
      <p className="text-brand-label text-sm" data-testid={`window-read-only-${formKind}`}>
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
        form_kind: formKind,
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
        form_kind: formKind,
      });

      setMessage(
        result.ok
          ? isScheduled
            ? "The scheduled period is cancelled. It will not open, and its dates are free to re-use."
            : "The application period is closed. The next submission is refused by the database."
          : result.error.message,
      );
    });
  };

  const opensAtError = fieldErrors["opens_at"]?.join(" ");
  const closesAtError = fieldErrors["closes_at"]?.join(" ");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="opens_at">Applications open</FieldLabel>
          <Input
            id="opens_at"
            name="opens_at"
            type="datetime-local"
            value={opensAt}
            onChange={(event) => setOpensAt(event.target.value)}
            aria-invalid={opensAtError ? "true" : undefined}
          />
          <FieldError message={opensAtError} />
        </Field>

        <Field>
          <FieldLabel htmlFor="closes_at">Applications close</FieldLabel>
          <Input
            id="closes_at"
            name="closes_at"
            type="datetime-local"
            value={closesAt}
            onChange={(event) => setClosesAt(event.target.value)}
            aria-invalid={closesAtError ? "true" : undefined}
          />
          <FieldError message={closesAtError} />
        </Field>
      </div>

      <p className="text-brand-label text-xs">
        Times are entered and shown in your own timezone and stored as absolute instants.
      </p>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={submitOpen}
          disabled={pending}
          data-testid={`window-open-${formKind}`}
        >
          {isOpen
            ? "Update the open period"
            : isScheduled
              ? "Reschedule the period"
              : "Open the period"}
        </Button>
        {/* ⚠ ENABLED FOR A SCHEDULED PERIOD TOO. A window whose opens_at was still in
            the future used to leave this disabled, which — together with Open refusing
            a scheduled row — made a mistyped date uncancellable until it passed. */}
        <Button
          type="button"
          variant="outline"
          onClick={submitClose}
          disabled={pending || (!isOpen && !isScheduled)}
          data-testid={`window-close-${formKind}`}
        >
          {isScheduled ? "Cancel the scheduled period" : "Close the period now"}
        </Button>
      </div>

      {message === null ? null : (
        <p role="alert" className="text-brand-body text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
