"use client";

// The separation half of the CRRD records desk (ADR 0012). Offers only the target
// statuses `legalSeparationTargets` says are reachable from this holder's CURRENT
// status (lib/officers/schema.ts) — a status this dialog wrongly offered would NOT be
// caught anywhere else in the system, because officer_assignments carries no database
// state-machine trigger the way memberships does (0028). Renders nothing at all when
// there is no legal separation target from the current status (e.g. a terminal one).
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

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
import { recordOfficerSeparation } from "@/lib/officers/actions";
import {
  legalSeparationTargets,
  OFFICER_ASSIGNMENT_STATUS_LABELS,
  officerSeparationSchema,
  OFFICER_STATUS_NOTE_MAX_LENGTH,
  OFFICER_STATUS_NOTE_MIN_LENGTH,
  type OfficerAssignmentStatus,
  type OfficerSeparationInput,
} from "@/lib/officers/schema";

export function RecordOfficerSeparationDialog({
  assignmentId,
  holderName,
  fromStatus,
}: {
  assignmentId: string;
  holderName: string;
  fromStatus: OfficerAssignmentStatus;
}) {
  const [open, setOpen] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const targets = legalSeparationTargets(fromStatus);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OfficerSeparationInput>({
    resolver: zodResolver(officerSeparationSchema),
    defaultValues: {
      assignment_id: assignmentId,
      from_status: fromStatus,
      // Falls back to a placeholder that is never actually submittable when `targets`
      // is empty — the component returns null below before the form ever renders.
      status: targets[0] ?? "resigned",
      status_note: "",
    },
  });

  const noteLength = watch("status_note")?.length ?? 0;

  const onSubmit = handleSubmit(async (values) => {
    setConflictMessage(null);
    const result = await recordOfficerSeparation(values);
    if (!result.ok) {
      if (result.error.fields) {
        for (const [field, messages] of Object.entries(result.error.fields)) {
          const first = messages[0];
          if (first) setError(field as keyof OfficerSeparationInput, { message: first });
        }
        return;
      }
      setConflictMessage(result.error.message);
      return;
    }
    reset();
    setOpen(false);
  });

  // No legal edge exists from this status at all (e.g. a terminal one slipped through
  // to this row somehow) — no control to render, not a disabled one.
  if (targets.length === 0) return null;

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
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`record-separation-${assignmentId}`}
        >
          Record separation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record {holderName}&rsquo;s separation from office</DialogTitle>
          <DialogDescription>
            CBL Art. VI. The CEO or the Executive Board still decides; this records that the
            decision happened. Give a reason of at least {OFFICER_STATUS_NOTE_MIN_LENGTH} characters
            naming the CBL basis and, if you are not the decider, who decided.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" {...register("assignment_id")} />
          <input type="hidden" {...register("from_status")} />

          <div className="space-y-1.5">
            <Label htmlFor="separation-status">New status</Label>
            <select
              id="separation-status"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              aria-invalid={errors.status ? "true" : "false"}
              {...register("status")}
            >
              {targets.map((target) => (
                <option key={target} value={target}>
                  {OFFICER_ASSIGNMENT_STATUS_LABELS[target]}
                </option>
              ))}
            </select>
            {errors.status ? (
              <p className="text-xs text-destructive">{errors.status.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="separation-note">Note</Label>
            <Textarea
              id="separation-note"
              rows={4}
              maxLength={OFFICER_STATUS_NOTE_MAX_LENGTH}
              aria-invalid={errors.status_note ? "true" : "false"}
              {...register("status_note")}
            />
            <div className="flex items-center justify-between">
              {errors.status_note ? (
                <p className="text-xs text-destructive">{errors.status_note.message}</p>
              ) : (
                <span />
              )}
              <span className="text-xs text-muted-foreground">
                {noteLength}/{OFFICER_STATUS_NOTE_MAX_LENGTH}
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
              {isSubmitting ? "Recording…" : "Record separation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
