"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { FieldError } from "@/components/applications/form-section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RENEWAL_REJECT_REASON_MIN_LENGTH,
  renewalRejectSchema,
  type RenewalRejectInput,
} from "@/lib/applications/renewal-schema";
import { rejectRenewal } from "@/lib/applications/renewal-review-actions";

const REASON_MAX = 2000;

export function RejectRenewalDialog({
  renewalId,
  memberName,
}: {
  renewalId: string;
  memberName: string;
}) {
  const [open, setOpen] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RenewalRejectInput>({
    resolver: zodResolver(renewalRejectSchema),
    defaultValues: { id: renewalId, review_note: "" },
  });

  const reasonLength = watch("review_note")?.length ?? 0;

  const onSubmit = handleSubmit(async (values) => {
    setConflictMessage(null);
    const result = await rejectRenewal(values);
    if (!result.ok) {
      if (result.error.fields) {
        for (const [field, messages] of Object.entries(result.error.fields)) {
          const first = messages[0];
          if (first) setError(field as keyof RenewalRejectInput, { message: first });
        }
        return;
      }
      setConflictMessage(result.error.message);
      return;
    }
    reset();
    setOpen(false);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
          setConflictMessage(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" data-testid="reject-renewal">
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {memberName}&rsquo;s renewal</DialogTitle>
          <DialogDescription>
            Give a reason of at least {RENEWAL_REJECT_REASON_MIN_LENGTH} characters. It is recorded
            in the audit log; the member may submit again while the renewal period is open.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <input type="hidden" {...register("id")} />
          <div className="space-y-1.5">
            <Label htmlFor="review_note">Reason</Label>
            <Textarea
              id="review_note"
              rows={4}
              maxLength={REASON_MAX}
              aria-invalid={errors.review_note ? "true" : "false"}
              {...register("review_note")}
            />
            <div className="flex items-center justify-between">
              <FieldError message={errors.review_note?.message} />
              <span className="text-xs text-muted-foreground">
                {reasonLength}/{REASON_MAX}
              </span>
            </div>
          </div>

          {conflictMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {conflictMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? "Rejecting…" : "Reject renewal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
