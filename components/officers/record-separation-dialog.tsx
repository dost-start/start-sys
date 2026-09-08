"use client";

// The separation half of the CRRD records desk (ADR 0012). Offers only the target
// statuses `legalSeparationTargets` says are reachable from this holder's CURRENT
// status (lib/officers/schema.ts) — a status this dialog wrongly offered would NOT be
// caught anywhere else in the system, because officer_assignments carries no database
// state-machine trigger the way memberships does (0028). Renders nothing at all when
// there is no legal separation target from the current status (e.g. a terminal one).
//
// Brand restyle (2026-09-08): the vendored Field / NativeSelect / Textarea primitives —
// `register()` binds the native <select> exactly as before, since NativeSelect forwards
// every prop to it. Every id, label and string is unchanged.
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
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
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

        <form onSubmit={onSubmit} className="space-y-5">
          <input type="hidden" {...register("assignment_id")} />
          <input type="hidden" {...register("from_status")} />

          <Field>
            <FieldLabel htmlFor="separation-status">New status</FieldLabel>
            <NativeSelect
              id="separation-status"
              aria-invalid={errors.status ? "true" : "false"}
              {...register("status")}
            >
              {targets.map((target) => (
                <option key={target} value={target}>
                  {OFFICER_ASSIGNMENT_STATUS_LABELS[target]}
                </option>
              ))}
            </NativeSelect>
            {errors.status ? (
              <p className="text-destructive text-xs">{errors.status.message}</p>
            ) : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="separation-note">Note</FieldLabel>
            <Textarea
              id="separation-note"
              rows={4}
              maxLength={OFFICER_STATUS_NOTE_MAX_LENGTH}
              aria-invalid={errors.status_note ? "true" : "false"}
              {...register("status_note")}
            />
            <div className="flex items-center justify-between gap-3">
              {errors.status_note ? (
                <p className="text-destructive text-xs">{errors.status_note.message}</p>
              ) : (
                <span />
              )}
              <span className="text-brand-label text-xs tabular-nums">
                {noteLength}/{OFFICER_STATUS_NOTE_MAX_LENGTH}
              </span>
            </div>
          </Field>

          {conflictMessage ? (
            <p role="alert" className="text-destructive text-sm">
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
