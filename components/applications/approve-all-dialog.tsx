// The batch-approval control (ADR 0013 §2). An `AlertDialog`, like
// `approve-application-dialog.tsx` — this is a confirm-then-act flow with no form
// fields, and it explains up front what the batch does and does not do rather than
// asking for anything.
//
// ⚠ THE RESULT PANEL SHOWS IDS AND FAILURE KEYS, NEVER NAMES. `approveAllPending()`'s
// return carries `applicationId`/`failures` only — there is no applicant name in this
// data to accidentally render, but this comment exists so a future edit does not widen
// the summary into a review screen. Reviewing a specific row already has its own
// screen (`/applications/[id]`); this dialog is a batch receipt, not a queue.
//
// THE REAL IDEMPOTENCY GUARD IS NOT HERE. It is `approve_all_pending()` only ever
// acting on rows still `pending` in the current term (ADR 0013 §2) — a second click
// after everyone eligible has been decided reports zero counts, it does not error.
"use client";

import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { approveAllPending, type ApproveAllPendingResult } from "@/lib/applications/review-actions";

export function ApproveAllDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ApproveAllPendingResult | null>(null);

  const reset = () => {
    setErrorMessage(null);
    setResult(null);
  };

  const handleApproveAll = () => {
    setErrorMessage(null);
    startTransition(async () => {
      const outcome = await approveAllPending();
      if (!outcome.ok) {
        // `conflict` here almost always means the application period is still open
        // (CONVENTIONS.md §4.3) — the dialog explains rather than retries.
        setErrorMessage(outcome.error.message);
        return;
      }
      setResult(outcome.data);
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" data-testid="approve-all">
          Approve all pending
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve every pending application and renewal?</AlertDialogTitle>
          <AlertDialogDescription>
            Approves every pending application and renewal in the current term that meets the
            submission standards, minting member IDs in one batch. A row that fails a standard is
            skipped, not approved. This cannot run while the application period is still open —
            close it first on the application-period page.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {errorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}

        {result ? (
          <div role="status" className="space-y-3 text-sm">
            <p className="font-medium text-green-800 dark:text-green-300">
              Approved {result.applicationsApproved} application
              {result.applicationsApproved === 1 ? "" : "s"} and {result.renewalsApproved} renewal
              {result.renewalsApproved === 1 ? "" : "s"}.
            </p>

            {result.skipped.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium text-muted-foreground">
                  Skipped ({result.skipped.length}) — did not meet the submission standards:
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {result.skipped.map((row) => (
                    <li key={row.id}>
                      {row.id} — {row.failures.length > 0 ? row.failures.join(", ") : "unknown"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.failed.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium text-destructive">
                  Failed ({result.failed.length}) — review these individually:
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-destructive">
                  {result.failed.map((row) => (
                    <li key={row.id}>{row.id}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.applicationsApproved === 0 &&
            result.renewalsApproved === 0 &&
            result.skipped.length === 0 &&
            result.failed.length === 0 ? (
              <p className="text-muted-foreground">Nothing was pending. Nothing to do.</p>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          {result ? (
            <AlertDialogAction onClick={() => setOpen(false)}>Close</AlertDialogAction>
          ) : (
            <>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  handleApproveAll();
                }}
                disabled={isPending}
              >
                {isPending ? "Approving…" : "Approve all pending"}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
