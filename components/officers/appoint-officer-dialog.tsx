"use client";

// The appoint half of the CRRD records desk (ADR 0012). Two steps in one dialog: find
// the member (searchOfficerCandidates), then confirm the appointment (appointOfficer)
// with an acting flag and a mandatory note naming the CBL Art. VI basis. `position_code`
// is PRESELECTED — passed in as a prop from the roster row this dialog opened on, never
// typed by the caller.
//
// Officer feedback 2026-09-11: appoint by name. The first step was a member-ID box and a
// Find button; it is now a search that narrows as the caller types, debounced, with stale
// responses dropped (the `cancelled` flag, as in components/campaigns/audience-picker.tsx).
// It runs ONLY while the dialog is open with nobody picked: the roster renders one dialog
// per vacant seat, and a search each on page load would be reads nobody asked for.
// Picking a person here is UX — `officer_assignments_insert` is the permission.
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `officers`): the vendored
// Field / Input / NativeSelect / Checkbox / Textarea / Alert primitives.
import { useEffect, useState } from "react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  appointOfficer,
  searchOfficerCandidates,
  type OfficerCandidate,
} from "@/lib/officers/actions";
import {
  OFFICER_CANDIDATE_GROUP_LABELS,
  OFFICER_CANDIDATE_GROUPS,
  OFFICER_STATUS_NOTE_MAX_LENGTH,
  OFFICER_STATUS_NOTE_MIN_LENGTH,
  officerAppointSchema,
  officerCandidateSearchSchema,
  type OfficerAppointInput,
  type OfficerCandidateGroup,
} from "@/lib/officers/schema";

/** Long enough that a fast typist sends one request per pause, not one per letter. */
const SEARCH_DEBOUNCE_MS = 250;

const SEARCH_FAILED = "Search failed. Please try again.";

function isCandidateGroup(value: string): value is OfficerCandidateGroup {
  return (OFFICER_CANDIDATE_GROUPS as readonly string[]).includes(value);
}

export function AppointOfficerDialog({
  positionCode,
  positionTitle,
}: {
  positionCode: string;
  positionTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<OfficerCandidateGroup>("active");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfficerCandidate[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<OfficerCandidate | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [appointedId, setAppointedId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
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

  const isPicking = open && candidate === null && appointedId === null;

  useEffect(() => {
    if (!isPicking) return;

    // The schema the action re-runs: a refused character is reported at once and never sent.
    const parsed = officerCandidateSearchSchema.safeParse({ q: query, group });
    if (!parsed.success) {
      setSearching(false);
      setResults([]);
      setTruncated(false);
      setSearchError(parsed.error.issues[0]?.message ?? SEARCH_FAILED);
      return;
    }

    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const handle = setTimeout(() => {
      void searchOfficerCandidates(parsed.data)
        .then((result) => {
          if (cancelled) return;
          setSearching(false);
          setHasSearched(true);
          if (result.ok) {
            setResults(result.data.candidates);
            setTruncated(result.data.truncated);
          } else {
            setResults([]);
            setTruncated(false);
            setSearchError(result.error.fields?.q?.[0] ?? result.error.message);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setSearching(false);
          setHasSearched(true);
          setResults([]);
          setTruncated(false);
          setSearchError(SEARCH_FAILED);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [isPicking, query, group]);

  // The note is the one required field left once someone is picked; the clicked row is gone.
  useEffect(() => {
    if (candidate !== null) setFocus("status_note");
  }, [candidate, setFocus]);

  function resetAll() {
    setGroup("active");
    setQuery("");
    setResults([]);
    setTruncated(false);
    setSearching(false);
    setHasSearched(false);
    setSearchError(null);
    setCandidate(null);
    setFormError(null);
    setAppointedId(null);
    reset({ position_code: positionCode, person_id: "", is_acting: false, status_note: "" });
  }

  function close() {
    setOpen(false);
    resetAll();
  }

  function pickCandidate(next: OfficerCandidate) {
    setCandidate(next);
    setFormError(null);
    setValue("person_id", next.id, { shouldValidate: true });
  }

  function changeCandidate() {
    setCandidate(null);
    setFormError(null);
    setValue("person_id", "");
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await appointOfficer(values);
    if (!result.ok) {
      if (result.error.fields) {
        for (const [field, messages] of Object.entries(result.error.fields)) {
          const first = messages[0];
          if (first) setError(field as keyof OfficerAppointInput, { message: first });
        }
        return;
      }
      setFormError(result.error.message);
      return;
    }
    setAppointedId(result.data.assignment_id);
  });

  let searchStatus: string | null = null;
  if (searchError === null) {
    if (searching) searchStatus = "Searching…";
    else if (hasSearched && results.length === 0) searchStatus = "No one matches";
    else if (truncated) {
      searchStatus = `Showing the first ${results.length} — keep typing to narrow`;
    }
  }

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

            {candidate === null ? (
              <>
                <Field>
                  <FieldLabel htmlFor="appoint-group">Show</FieldLabel>
                  <NativeSelect
                    id="appoint-group"
                    value={group}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!isCandidateGroup(next)) return;
                      // A different group is a different list: never leave the old one clickable.
                      setResults([]);
                      setTruncated(false);
                      setHasSearched(false);
                      setGroup(next);
                    }}
                  >
                    {OFFICER_CANDIDATE_GROUPS.map((value) => (
                      <option key={value} value={value}>
                        {OFFICER_CANDIDATE_GROUP_LABELS[value]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>

                <Field>
                  <FieldLabel htmlFor="appoint-search">Search by name or member ID</FieldLabel>
                  <Input
                    id="appoint-search"
                    type="text"
                    autoComplete="off"
                    autoFocus
                    placeholder="e.g. Dela Cruz or 2026-0001"
                    value={query}
                    aria-invalid={searchError !== null ? "true" : "false"}
                    aria-describedby="appoint-search-status"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      // The search already runs as you type; Enter here must never appoint.
                      if (event.key === "Enter") event.preventDefault();
                    }}
                  />
                  {searchError !== null ? (
                    <p role="alert" className="text-destructive text-xs">
                      {searchError}
                    </p>
                  ) : null}
                  <p
                    id="appoint-search-status"
                    aria-live="polite"
                    className="text-brand-label min-h-4 text-xs"
                  >
                    {searchStatus}
                  </p>
                </Field>

                {searchError === null && results.length > 0 ? (
                  <ul className="border-border divide-border max-h-64 divide-y overflow-y-auto rounded-lg border">
                    {results.map((person) => (
                      <li key={person.id}>
                        <button
                          type="button"
                          data-testid="officer-candidate-option"
                          onClick={() => pickCandidate(person)}
                          className="hover:bg-accent focus-visible:bg-accent flex w-full cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 text-left outline-none"
                        >
                          <span className="text-brand-ink text-sm font-medium">
                            {person.family_name}, {person.given_name}
                          </span>
                          <span className="text-brand-label text-xs">
                            <span className="font-mono">{person.member_id ?? "no member ID"}</span>
                            {person.region_name ? ` · ${person.region_name}` : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <>
                <div
                  data-testid="officer-candidate"
                  className="border-border flex items-start justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="min-w-0">
                    <p className="text-brand-ink text-sm font-semibold">
                      {candidate.family_name}, {candidate.given_name}
                    </p>
                    <p className="text-brand-body text-xs">
                      <span className="font-mono">
                        {candidate.member_id ?? "no member ID on file"}
                      </span>
                      {candidate.region_name ? ` · ${candidate.region_name}` : null}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={changeCandidate}>
                    Change
                  </Button>
                </div>

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

                {formError !== null ? (
                  <p role="alert" className="text-destructive text-xs">
                    {formError}
                  </p>
                ) : null}

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Appointing…" : "Appoint"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
