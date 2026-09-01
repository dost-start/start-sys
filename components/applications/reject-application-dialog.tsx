// The reject control (BUILD_PLAN S4-T21; PRD US-C2). A plain `Dialog` with a form —
// unlike approve, this needs an input, so an alert dialog (no form slot) is the wrong
// primitive here.
//
// `applicationRejectSchema` is the SAME module `rejectApplication` re-parses
// server-side (CONVENTIONS.md §6): the character floor here is not a UI opinion, it is
// `REJECT_REASON_MIN_LENGTH`, which is the exact number `rejected_has_reason` enforces
// in `0024_reject_application.sql`. A server field error — e.g. from a direct call, a
// stale bundle, or the DB CHECK firing on an edge case the schema missed — lands in
// `error.fields.review_note` and is pushed into RHF's `setError`, never a generic
// toast (CONVENTIONS.md §6).
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/applications/form-section";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  applicationRejectSchema,
  REJECT_REASON_MAX_LENGTH,
  REJECT_REASON_MIN_LENGTH,
  type ApplicationRejectInput,
} from "@/lib/applications/schema";
import { rejectApplication } from "@/lib/applications/review-actions";

export function RejectApplicationDialog({
  applicationId,
  applicantName,
}: {
  applicationId: string;
  applicantName: string;
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
  } = useForm<ApplicationRejectInput>({
    resolver: zodResolver(applicationRejectSchema),
    defaultValues: { id: applicationId, review_note: "" },
  });

  const reasonLength = watch("review_note")?.length ?? 0;

  const onSubmit = handleSubmit(async (values) => {
    setConflictMessage(null);
    const result = await rejectApplication(values);

    if (!result.ok) {
      if (result.error.fields) {
        for (const [field, messages] of Object.entries(result.error.fields)) {
          const first = messages[0];
          if (first) {
            setError(field as keyof ApplicationRejectInput, { message: first });
          }
        }
        return;
      }
      // `conflict` (already decided) has no field to attach to — explain and let the
      // reviewer refresh rather than silently retrying (CONVENTIONS.md §4.3).
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
        <Button type="button" variant="destructive">
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {applicantName}&rsquo;s application</DialogTitle>
          <DialogDescription>
            Give a reason of at least {REJECT_REASON_MIN_LENGTH} characters. It is recorded in the
            audit log and shown on this application — no membership record is created.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <input type="hidden" {...register("id")} />
          <div className="space-y-1.5">
            <Label htmlFor="review_note">Reason</Label>
            <Textarea
              id="review_note"
              rows={4}
              maxLength={REJECT_REASON_MAX_LENGTH}
              aria-invalid={errors.review_note ? "true" : "false"}
              {...register("review_note")}
            />
            <div className="flex items-center justify-between">
              <FieldError message={errors.review_note?.message} />
              <span className="text-xs text-muted-foreground">
                {reasonLength}/{REJECT_REASON_MAX_LENGTH}
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
              {isSubmitting ? "Rejecting…" : "Reject application"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
