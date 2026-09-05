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
import { approveRenewal } from "@/lib/applications/renewal-review-actions";

/** The in-flight disabled button is UX; the real double-click guard is approve_renewal()'s idempotent early return. */
export function ApproveRenewalDialog({
  renewalId,
  memberName,
}: {
  renewalId: string;
  memberName: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [approvedMemberId, setApprovedMemberId] = useState<string | null>(null);

  const handleApprove = () => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await approveRenewal({ id: renewalId });
      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }
      setApprovedMemberId(result.data.member_id);
    });
  };

  if (approvedMemberId) {
    return (
      <div
        role="status"
        data-testid="renewal-approved"
        className="rounded-md border border-green-600/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:bg-green-950 dark:text-green-300"
      >
        Renewed — member ID {approvedMemberId} (unchanged)
      </div>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" data-testid="approve-renewal">
          Approve renewal
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve {memberName}&rsquo;s renewal?</AlertDialogTitle>
          <AlertDialogDescription>
            This creates an active membership for the current term and applies the updated contact
            and academic details to the member&rsquo;s record. The member ID does not change. A
            mistake is corrected on the member&rsquo;s record, not by reversing this decision.
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
