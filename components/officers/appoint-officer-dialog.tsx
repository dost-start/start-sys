"use client";

// The appoint half of the CRRD records desk (ADR 0012). Two steps in one dialog:
// look up a member by their member ID (lookupOfficerCandidate), then confirm the
// appointment (appointOfficer) with an acting flag and a mandatory note naming the CBL
// Art. VI basis. `position_code` is PRESELECTED — passed in as a prop from the roster
// row this dialog opened on, never typed by the caller.
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `officers`): the vendored
// Field / Input / Checkbox / Textarea / Alert primitives. Every id, name, placeholder,
// `data-testid` and string is what it was.
import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  appointOfficer,
  lookupOfficerCandidate,
  type OfficerCandidate,
} from "@/lib/officers/actions";
import {
  OFFICER_STATUS_NOTE_MAX_LENGTH,
  OFFICER_STATUS_NOTE_MIN_LENGTH,
  officerAppointSchema,
  type OfficerAppointInput,
} from "@/lib/officers/schema";

export function AppointOfficerDialog({
  positionCode,
  positionTitle,
}: {
  positionCode: string;
  positionTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [candidate, setCandidate] = useState<OfficerCandidate | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, startLookup] = useTransition();
  const [appointedId, setAppointedId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OfficerAppointInput>({
    resolver: zodResolver(officerAppointSchema),
    defaultValues: {
      position_code: positionCode,
      person_id: "",
      is_acting: false,
      status_note: "",
    },
  });

  function resetAll() {
    setMemberId("");
    setCandidate(null);
    setLookupError(null);
    setAppointedId(null);
    reset({ position_code: positionCode, person_id: "", is_acting: false, status_note: "" });
  }

  function handleLookup() {
    const trimmed = memberId.trim();
    setLookupError(null);
    setCandidate(null);
    setValue("person_id", "");

    startLookup(async () => {
      const result = await lookupOfficerCandidate({ member_id: trimmed });
      if (!result.ok) {
        setLookupError(result.error.message);
        return;
      }
      setCandidate(result.data);
      setValue("person_id", result.data.id, { shouldValidate: true });
    });
  }

  const onSubmit = handleSubmit(async (values) => {
    setLookupError(null);
    const result = await appointOfficer(values);
    if (!result.ok) {
      if (result.error.fields) {
        for (const [field, messages] of Object.entries(result.error.fields)) {
          const first = messages[0];
          if (first) setError(field as keyof OfficerAppointInput, { message: first });
        }
        return;
      }
      setLookupError(result.error.message);
      return;
    }
    setAppointedId(result.data.assignment_id);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetAll();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" data-testid={`appoint-officer-${positionCode}`}>
          Appoint
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Appoint {positionTitle}</DialogTitle>
          <DialogDescription>
            Records who holds this CBL position for the current term (CBL Art. V §2, Art. VI §4). It
            does not, by itself, grant a system account or role — assigning one is a separate,
            tech_admin-only step.
          </DialogDescription>
        </DialogHeader>

        {appointedId ? (
          <Alert
            variant="success"
            role="status"
            data-testid="officer-appointed"
            className="font-medium"
          >
            Appointment recorded.
          </Alert>
        ) : (
          <form method="post" onSubmit={onSubmit} className="space-y-5">
            <input type="hidden" {...register("position_code")} />
            <input type="hidden" {...register("person_id")} />

            <Field>
              <FieldLabel htmlFor="appoint-member-id">Member ID</FieldLabel>
              <div className="flex gap-2.5">
                <Input
                  id="appoint-member-id"
                  type="text"
                  placeholder="2026-0001"
                  autoComplete="off"
                  className="font-mono"
                  value={memberId}
                  onChange={(event) => {
                    setMemberId(event.target.value);
                    setCandidate(null);
                    setLookupError(null);
                    setValue("person_id", "");
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isLookingUp || memberId.trim() === ""}
                  onClick={handleLookup}
                >
                  {isLookingUp ? "Looking up…" : "Find"}
                </Button>
              </div>
              {lookupError ? <p className="text-destructive text-xs">{lookupError}</p> : null}
              {candidate ? (
                <p className="text-brand-body text-xs" data-testid="officer-candidate">
                  {candidate.family_name}, {candidate.given_name} (
                  {candidate.member_id ?? "no member ID on file"})
                </p>
              ) : null}
            </Field>

            {candidate ? (
              <>
                <label
                  htmlFor="appoint-is-acting"
                  className="text-brand-body flex items-start gap-2.5 text-sm"
                >
                  <Checkbox id="appoint-is-acting" {...register("is_acting")} />
                  <span>Acting appointment (CBL Art. VI §4.1-4.3)</span>
                </label>

                <Field>
                  <FieldLabel htmlFor="appoint-note">Note</FieldLabel>
                  <Textarea
                    id="appoint-note"
                    rows={3}
                    maxLength={OFFICER_STATUS_NOTE_MAX_LENGTH}
                    placeholder={`Name the CBL Art. VI basis and the decider — at least ${OFFICER_STATUS_NOTE_MIN_LENGTH} characters.`}
                    aria-invalid={errors.status_note ? "true" : "false"}
                    {...register("status_note")}
                  />
                  {errors.status_note ? (
                    <p className="text-destructive text-xs">{errors.status_note.message}</p>
                  ) : null}
                </Field>

                {errors.person_id ? (
                  <p className="text-destructive text-xs">{errors.person_id.message}</p>
                ) : null}

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Appointing…" : "Appoint"}
                  </Button>
                </DialogFooter>
              </>
            ) : null}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
