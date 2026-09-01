// The approve control (BUILD_PLAN S4-T21; PRD US-C2, US-C3). An `AlertDialog`, not a
// plain `Dialog` — approval is irreversible-by-UI (DATA_MODEL.md §3.2: `approved` has
// no path back short of an admin manually setting the resulting membership to `left`),
// and an alert dialog is the correct primitive for a confirm-then-act flow with no
// form fields.
//
// THE REAL DOUBLE-CLICK GUARD IS NOT HERE. It is `approve_application()`'s idempotent
// early-return, proved by ten concurrent RPC calls in `approve-application.test.ts`.
// The disabled-while-pending button below is UX only, so a slow network does not read
// as "nothing happened" — CONVENTIONS.md §10 item 3 is explicit that a disabled submit
// button is never the only guard.
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
import { approveApplication } from "@/lib/applications/review-actions";

export function ApproveApplicationDialog({
  applicationId,
  applicantName,
}: {
  applicationId: string;
  applicantName: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [approvedMemberId, setApprovedMemberId] = useState<string | null>(null);

  const handleApprove = () => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await approveApplication({ id: applicationId });
      if (!result.ok) {
        // `conflict` means another reviewer decided this application seconds ago
        // (CONVENTIONS.md §4.3) — the dialog explains rather than retries, and the
        // page's own revalidation will show the real state once closed.
        setErrorMessage(result.error.message);
        return;
      }
      setApprovedMemberId(result.data.memberId);
    });
  };

  if (approvedMemberId) {
    return (
      <div
        role="status"
        className="rounded-md border border-green-600/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:bg-green-950 dark:text-green-300"
      >
        Approved — member ID {approvedMemberId}
      </div>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button">Approve</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve {applicantName}&rsquo;s application?</AlertDialogTitle>
          <AlertDialogDescription>
            This mints a member ID and creates an active membership for the current term. Approval
            cannot be undone from this screen — a mistake is corrected by changing the resulting
            member&rsquo;s status, not by reversing this decision.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {errorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              handleApprove();
            }}
            disabled={isPending}
          >
            {isPending ? "Approving…" : "Approve"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
