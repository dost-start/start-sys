// The membership status control (BUILD_PLAN S5-T28; PRD US-D3, US-D5, US-D6).
//
// ⚠ THIS IS CONVENIENCE, NOT ENFORCEMENT. `legalNextStatuses(from, role)`
// (lib/members/transitions.ts) decides which options are OFFERED; the trigger
// `enforce_membership_transition()` (0028) and `memberships_update` (0014) refuse an
// illegal or unauthorized edge regardless of what this component renders. If the role
// cannot cross an edge, that edge is simply absent from the list — never a disabled
// button pretending to be the guard (ARCHITECTURE.md §5).
//
// A reason is required for every status that ends a membership (`isEndingStatus`) and
// for the `terminated -> active` reversal, on BOTH sides: this component's own
// min-length check and, independently, `membershipStatusUpdateSchema`'s
// `superRefine` inside the Server Action.
"use client";

import { useState } from "react";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OrgRole } from "@/lib/auth/route-access";
import { updateMembershipStatus } from "@/lib/members/actions";
import {
  ENDED_REASON_MAX_LENGTH,
  ENDED_REASON_MIN_LENGTH,
  isEndingStatus,
} from "@/lib/members/schema";
import {
  MEMBERSHIP_STATUS_LABELS,
  legalNextStatuses,
  type MembershipStatus,
} from "@/lib/members/transitions";

export function MembershipStatusEditor({
  membershipId,
  currentStatus,
  role,
}: {
  membershipId: string;
  currentStatus: MembershipStatus;
  role: OrgRole;
}) {
  const options = legalNextStatuses(currentStatus, role);

  const [target, setTarget] = useState<MembershipStatus | "">("");
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (options.length === 0) return null;

  const needsReason = target !== "" && (isEndingStatus(target) || currentStatus === "terminated");
  const reasonTooShort = needsReason && reason.trim().length < ENDED_REASON_MIN_LENGTH;

  const submit = async (): Promise<void> => {
    if (target === "" || reasonTooShort) return;
    setPending(true);
    setError(null);

    const result = await updateMembershipStatus({
      membership_id: membershipId,
      status: target,
      from_status: currentStatus,
      ended_reason: needsReason ? reason.trim() : null,
    });

    setPending(false);

    if (!result.ok) {
      setError(result.error.fields?.ended_reason?.[0] ?? result.error.message);
      return;
    }

    setOpen(false);
    setTarget("");
    setReason("");
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTarget("");
          setReason("");
          setError(null);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="status-target">
          Change status
        </label>
        <select
          id="status-target"
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          value={target}
          onChange={(event) => setTarget(event.target.value as MembershipStatus)}
        >
          <option value="">Select a status…</option>
          {options.map((status) => (
            <option key={status} value={status}>
              {MEMBERSHIP_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <AlertDialogTrigger asChild>
          <Button type="button" size="sm" disabled={target === ""}>
            Continue
          </Button>
        </AlertDialogTrigger>
      </div>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target === "" ? "" : `Change status to ${MEMBERSHIP_STATUS_LABELS[target]}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This change is recorded in the audit log with your account and the time.
            {target === "terminated"
              ? " CBL Art. VII §3 requires a written ground for a termination."
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needsReason ? (
          <div className="space-y-1.5">
            <Label htmlFor="ended_reason">Reason</Label>
            <Textarea
              id="ended_reason"
              rows={4}
              maxLength={ENDED_REASON_MAX_LENGTH}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least {ENDED_REASON_MIN_LENGTH} characters.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            disabled={pending || reasonTooShort}
            onClick={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {pending ? "Saving…" : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
