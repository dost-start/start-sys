"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The renewal form (PRD US-G7, US-H5) — the application form's four steps plus one
// identity block (member ID) at the top of step one, bound to `renewalSubmitSchema`,
// the same schema module `startRenewal` re-runs (CONVENTIONS §6). Brand edition
// 2026-09-08 (design canvas `form_card("renew")`).
//
// Step logic mirrors `app/(public)/apply/application-form.tsx`: Next validates the
// step's own keys (`RENEWAL_STEP_FIELDS`) and advances only when they pass; step 3
// requires both documents; the stepper only jumps back; a server response with field
// errors lands the scholar on the lowest step that owns one.
//
// The upload flow is the application form's: `startRenewal` verifies the identity,
// writes the draft and mints two upload sessions; the browser PUTs both files straight
// to the store; `finalizeRenewal` re-verifies them from provider metadata and flips the
// draft to pending. The token from `startRenewal` lives in a ref and is never rendered,
// never in the URL.
// ─────────────────────────────────────────────────────────────────────────────

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";

import {
  AcademicSection,
  type ProgramOption,
  type UniversityOption,
} from "@/components/applications/academic-section";
import { ConsentSection } from "@/components/applications/consent-section";
import {
  APPLICATION_STEP_FIELDS,
  FIRST_STEP,
  FORM_STEPS,
  FormSection,
  LAST_STEP,
  type FormStep,
  isFormStep,
  lowestStepForFields,
  nextFormStep,
  previousFormStep,
} from "@/components/applications/form-section";
import { MembershipSection, type RegionOption } from "@/components/applications/membership-section";
import { PersonalSection } from "@/components/applications/personal-section";
import {
  ProofUploadField,
  uploadFileToStore,
  type ProofUploadStatus,
} from "@/components/applications/proof-upload-field";
import { RenewalIdentitySection } from "@/components/applications/renewal-identity-section";
import { RenewalSuccess } from "@/components/applications/renewal-success";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Stepper } from "@/components/ui/stepper";
import { type ActionError, isErr } from "@/lib/action-result";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/applications/call-action";
import { DraftNotice } from "@/components/applications/draft-notice";
import { useFormDraft } from "@/components/applications/use-form-draft";
import {
  finalizeRenewal,
  startRenewal,
  type StartRenewalResult,
} from "@/lib/applications/renewal-actions";
import { renewalSubmitSchema, type RenewalSubmitInput } from "@/lib/applications/renewal-schema";
import { SCHOLARSHIP_AWARD_LABELS } from "@/lib/applications/schema";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/notice-version";

/** The card's anchor: the hero pill scrolls here, and so does every step change. */
const CARD_ID = "application-form";

/** The application's steps, with the member ID owned by step one. */
const RENEWAL_STEP_FIELDS: Record<FormStep, readonly (keyof RenewalSubmitInput)[]> = {
  ...APPLICATION_STEP_FIELDS,
  1: ["member_id", ...APPLICATION_STEP_FIELDS[1]],
};

const KNOWN_FIELDS = new Set<string>([
  "member_id",
  "applicant_given_name",
  "middle_name",
  "applicant_family_name",
  "suffix",
  "sex",
  "applicant_email",
  "birthdate",
  "contact_number",
  "facebook_account",
  "address_line",
  "postal_code",
  "scholarship_award",
  "award_year",
  "university_id",
  "program_id",
  "year_level",
  "expected_grad_year",
  "region_id",
  "consent_privacy_notice",
  "consent_privacy_notice_version",
  "certify_accuracy",
]);

function isKnownField(key: string): key is keyof RenewalSubmitInput {
  return KNOWN_FIELDS.has(key);
}

type Phase = "form" | "starting" | "uploading" | "finalizing";

function submitLabel(phase: Phase): string {
  switch (phase) {
    case "starting":
      return "Checking your membership…";
    case "uploading":
      return "Uploading documents…";
    case "finalizing":
      return "Finishing up…";
    default:
      return "Submit renewal";
  }
}

type DocState = {
  file: File | null;
  clientError: string | null;
  status: ProofUploadStatus;
  progress: number;
  serverError: string | null;
};

const IDLE_DOC: DocState = {
  file: null,
  clientError: null,
  status: "idle",
  progress: 0,
  serverError: null,
};

type DocKey = "registration" | "noa";

/** A form value as review text: the raw input types include `unknown` (the coerced ints). */
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

const AWARD_LABELS: Record<string, string> = SCHOLARSHIP_AWARD_LABELS;

export function RenewalForm({
  hero,
  regions,
  universities,
  programs,
}: {
  /** The page hero, rendered above the card while the form is open and dropped on success. */
  hero: ReactNode;
  regions: RegionOption[];
  universities: UniversityOption[];
  programs: ProgramOption[];
}) {
  const [succeeded, setSucceeded] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState<FormStep>(FIRST_STEP);
  const [rootError, setRootError] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<DocKey, DocState>>({
    registration: IDLE_DOC,
    noa: IDLE_DOC,
  });

  const pendingRef = useRef<StartRenewalResult | null>(null);
  const filesRef = useRef<Record<DocKey, File | null>>({ registration: null, noa: null });
  const honeypotRef = useRef<HTMLInputElement>(null);
  const mountedAtRef = useRef<number>(Date.now());

  const form = useForm<z.input<typeof renewalSubmitSchema>, unknown, RenewalSubmitInput>({
    resolver: zodResolver(renewalSubmitSchema),
    defaultValues: {
      member_id: "",
      applicant_given_name: "",
      middle_name: undefined,
      applicant_family_name: "",
      suffix: undefined,
      sex: "" as unknown as RenewalSubmitInput["sex"],
      applicant_email: "",
      birthdate: "",
      contact_number: "",
      facebook_account: "",
      address_line: "",
      postal_code: "",
      // PR C2: the cascade writes these through `setValue`; they are declared here so the
      // field is registered from the first render and a restored draft has somewhere to land.
      psgc_barangay_code: "",
      current_address_same_as_home: true,
      current_address_line: "",
      current_postal_code: "",
      current_psgc_barangay_code: "",
      scholarship_award: "" as unknown as RenewalSubmitInput["scholarship_award"],
      award_year: "",
      university_id: "",
      program_id: "",
      year_level: "",
      expected_grad_year: "",
      region_id: "",
      consent_privacy_notice: false as unknown as true,
      consent_privacy_notice_version: PRIVACY_NOTICE_VERSION,
      certify_accuracy: false as unknown as true,
    },
  });

  // PR D: restore on mount, save (debounced) on every change. Files and the consent
  // boxes are never stored — see `lib/applications/draft-storage`.
  const draft = useFormDraft("renew", form);

  function patchDoc(key: DocKey, patch: Partial<DocState>) {
    setDocs((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  // ── Steps ──────────────────────────────────────────────────────────────────

  function showStep(next: FormStep) {
    setStep(next);
    document.getElementById(CARD_ID)?.scrollIntoView({ block: "start" });
  }

  /** Both documents picked and neither refused client-side. Sets the field errors otherwise. */
  function documentsReady(): boolean {
    const registration = filesRef.current.registration;
    const noa = filesRef.current.noa;
    if (!registration && !docs.registration.clientError) {
      patchDoc("registration", {
        clientError: "Attach your latest registration form before submitting.",
      });
    }
    if (!noa && !docs.noa.clientError) {
      patchDoc("noa", { clientError: "Attach your Notice of Award before submitting." });
    }
    if (!registration || !noa) return false;
    if (docs.registration.clientError || docs.noa.clientError) return false;
    return true;
  }

  async function goNext() {
    if (step === LAST_STEP) return;
    if (step === 3) {
      if (!documentsReady()) return;
      showStep(nextFormStep(step));
      return;
    }
    const valid = await form.trigger(RENEWAL_STEP_FIELDS[step], { shouldFocus: true });
    if (!valid) return;
    showStep(nextFormStep(step));
  }

  function goBack() {
    if (step > FIRST_STEP) showStep(previousFormStep(step));
  }

  /** The stepper only ever jumps back; forward movement goes through Next's validation. */
  function goBackTo(target: number) {
    if (isFormStep(target) && target < step) showStep(target);
  }

  /** Enter in a text field on steps 1–3 means Next, not "submit the whole form". */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || step === LAST_STEP) return;
    if (!(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    void goNext();
  }

  // ── Server errors ──────────────────────────────────────────────────────────

  function applyServerError(error: ActionError) {
    if (!error.fields) {
      setRootError(error.message);
      return;
    }
    let mappedAny = false;
    for (const [key, messages] of Object.entries(error.fields)) {
      const message = messages[0];
      if (!message) continue;
      if (key.startsWith("proof_")) {
        patchDoc("registration", { clientError: message });
        mappedAny = true;
        continue;
      }
      if (key.startsWith("noa_")) {
        patchDoc("noa", { clientError: message });
        mappedAny = true;
        continue;
      }
      if (isKnownField(key)) {
        form.setError(key, { message });
        mappedAny = true;
      }
    }
    if (!mappedAny) {
      setRootError(error.message);
      return;
    }
    const target = lowestStepForFields(RENEWAL_STEP_FIELDS, Object.keys(error.fields));
    if (target !== undefined && target !== step) showStep(target);
  }

  // ── Uploads ────────────────────────────────────────────────────────────────

  async function uploadOne(key: DocKey, uploadUrl: string, file: File): Promise<boolean> {
    patchDoc(key, { status: "uploading", progress: 0, serverError: null });
    const outcome = await uploadFileToStore(uploadUrl, file, (percent) =>
      patchDoc(key, { progress: percent }),
    );
    if (!outcome.ok) {
      patchDoc(key, {
        status: "error",
        serverError: "The upload did not complete. Check your connection, then try again below.",
      });
      return false;
    }
    patchDoc(key, { status: "success" });
    return true;
  }

  async function runUploads(pending: StartRenewalResult) {
    setPhase("uploading");
    const registration = filesRef.current.registration;
    const noa = filesRef.current.noa;
    if (!registration || !noa) {
      setPhase("form");
      showStep(3);
      return;
    }

    if (docs.registration.status !== "success") {
      const ok = await uploadOne("registration", pending.uploadUrl, registration);
      if (!ok) {
        setPhase("form");
        showStep(3);
        return;
      }
    }
    if (docs.noa.status !== "success") {
      const ok = await uploadOne("noa", pending.noaUploadUrl, noa);
      if (!ok) {
        setPhase("form");
        showStep(3);
        return;
      }
    }

    setPhase("finalizing");
    // A10: wrapped, so a rejected or never-settling POST becomes an ActionResult failure
    // instead of an unhandled rejection that strands this screen on "Finishing up…".
    const finalizeResult = await callAction(() =>
      finalizeRenewal({
        renewal_id: pending.renewalId,
        upload_token: pending.uploadToken,
        storage_ref: pending.storageRef,
        noa_storage_ref: pending.noaStorageRef,
      }),
    );

    if (isErr(finalizeResult)) {
      // A10: the call never reached a decision. Both documents are already uploaded and
      // `pendingRef` still holds the submit token, so Submit resumes rather than restarts;
      // `finalize_renewal()` (0044) is idempotent on the same token.
      if (finalizeResult.error.code === "upstream") {
        setRootError(finalizeResult.error.message || ACTION_UNREACHABLE_MESSAGE);
        setPhase("form");
        showStep(LAST_STEP);
        return;
      }
      if (finalizeResult.error.code === "validation") {
        filesRef.current = { registration: null, noa: null };
        setDocs({
          registration: {
            ...IDLE_DOC,
            serverError:
              "One of the files could not be accepted. Choose your documents again, then submit.",
          },
          noa: { ...IDLE_DOC },
        });
        pendingRef.current = null;
      } else {
        patchDoc("registration", { status: "error", serverError: finalizeResult.error.message });
      }
      setPhase("form");
      // The document errors render on the Documents step; land the scholar there.
      showStep(3);
      return;
    }

    pendingRef.current = null;
    filesRef.current = { registration: null, noa: null };
    // PR D: the submission is in; the local copy of this scholar's PII goes now,
    // without waiting for an expiry, and without the applicant having to ask.
    draft.clear();
    setSucceeded(true);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function onValid(values: RenewalSubmitInput) {
    setRootError(null);

    const honeypotFilled = Boolean(honeypotRef.current?.value);
    const submittedTooFast = Date.now() - mountedAtRef.current < 3000;
    if (honeypotFilled || submittedTooFast) {
      setRootError("Something went wrong. Please try again.");
      return;
    }

    if (!documentsReady()) {
      showStep(3);
      return;
    }
    const registration = filesRef.current.registration;
    const noa = filesRef.current.noa;
    if (!registration || !noa) return;

    // ── A10, the retry path ──────────────────────────────────────────────────
    // A previous attempt already created the draft and PUT both documents; only finalize
    // was lost. Resume rather than calling `startRenewal` again, which would create a
    // second draft holding the same scholar's PII plus a pair of orphaned objects.
    const resumable = pendingRef.current;
    if (resumable !== null) {
      await runUploads(resumable);
      return;
    }

    setPhase("starting");
    const startResult = await callAction(() =>
      startRenewal({
        ...values,
        proof_file_name: registration.name,
        proof_mime_type: registration.type,
        proof_size_bytes: registration.size,
        noa_file_name: noa.name,
        noa_mime_type: noa.type,
        noa_size_bytes: noa.size,
      }),
    );

    if (isErr(startResult)) {
      setPhase("form");
      if (startResult.error.code === "window_closed") {
        setRootError(
          "The renewal period closed while you were filling this out. Reload the page to see the current status.",
        );
        return;
      }
      applyServerError(startResult.error);
      return;
    }

    pendingRef.current = startResult.data;
    await runUploads(startResult.data);
  }

  /** A field from an earlier step failed the full-schema check: go and show it. */
  function onInvalid(errors: Record<string, unknown>) {
    const target = lowestStepForFields(RENEWAL_STEP_FIELDS, Object.keys(errors));
    if (target !== undefined && target !== step) showStep(target);
  }

  function handleRetryUpload() {
    const pending = pendingRef.current;
    if (!pending) return;
    void runUploads(pending);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function fieldFor(key: DocKey, title: string, description: string, testId: string) {
    const state = docs[key];
    return (
      <div data-testid={testId} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-brand-ink text-base font-semibold">{title}</h3>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <ProofUploadField
          file={state.file}
          status={state.status}
          progress={state.progress}
          error={state.clientError ?? state.serverError}
          onFileChange={(picked, clientError) => {
            filesRef.current = { ...filesRef.current, [key]: picked };
            patchDoc(key, {
              file: picked,
              clientError,
              serverError: null,
              status: "idle",
              progress: 0,
            });
          }}
          onRetry={handleRetryUpload}
        />
      </div>
    );
  }

  /** The review panel's rows, read from the form at render time (step 4 has no inputs that feed it). */
  function summaryRows(): Array<{ label: string; value: string }> {
    const v = form.getValues();
    const name = [v.applicant_given_name, v.middle_name, v.applicant_family_name, v.suffix]
      .map(text)
      .filter(Boolean)
      .join(" ");
    const scholarship = [AWARD_LABELS[text(v.scholarship_award)] ?? "", text(v.award_year)]
      .filter(Boolean)
      .join(", ");
    const school = [
      universities.find((u) => u.id === v.university_id)?.name ?? "",
      programs.find((p) => p.id === v.program_id)?.name ?? "",
    ]
      .filter(Boolean)
      .join(", ");
    const region = regions.find((r) => r.id === v.region_id)?.name ?? "";
    return [
      { label: "Member ID", value: text(v.member_id) },
      { label: "Name", value: name },
      { label: "Email", value: text(v.applicant_email) },
      { label: "Contact number", value: text(v.contact_number) },
      { label: "Scholarship", value: scholarship },
      { label: "School", value: school },
      { label: "Region", value: region },
    ];
  }

  if (succeeded) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-16 sm:px-10">
        <RenewalSuccess />
      </div>
    );
  }

  const submitting = phase !== "form";

  return (
    <>
      {hero}
      <div className="flex flex-1 justify-center px-4 pb-16 sm:px-10">
        <Card
          radius="hero"
          id={CARD_ID}
          className="w-full max-w-[1040px] scroll-mt-6 gap-7 px-5 py-8 sm:px-14 sm:py-11"
        >
          <div className="flex flex-col items-center gap-4">
            <h1 className="text-brand-slate text-center text-2xl font-bold tracking-wide uppercase sm:text-[32px]">
              Membership renewal form
            </h1>
            <hr className="border-border w-full border-t" />
          </div>

          <Stepper steps={FORM_STEPS} current={step} onSelect={submitting ? undefined : goBackTo} />

          <DraftNotice restored={draft.restored} onClear={draft.clear} />

          <FormProvider {...form}>
            <form
              method="post"
              onSubmit={form.handleSubmit(onValid, onInvalid)}
              onKeyDown={handleKeyDown}
              noValidate
              className="flex flex-col gap-7"
            >
              <div
                aria-hidden="true"
                className="absolute top-auto left-[-9999px] size-px overflow-hidden"
              >
                <label htmlFor="website">Leave this field blank</label>
                <input
                  id="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  ref={honeypotRef}
                />
              </div>

              {step === 1 ? (
                <>
                  <RenewalIdentitySection />
                  <PersonalSection regions={regions} />
                </>
              ) : null}

              {step === 2 ? (
                <>
                  {/* PR E: region first — the university select now offers that region's
                      schools only (445 rows down to ~20), so asking for the region after
                      the school would leave the applicant staring at a disabled control. */}
                  <MembershipSection regions={regions} />
                  <AcademicSection
                    universities={universities}
                    programs={programs}
                    regions={regions}
                  />
                </>
              ) : null}

              {step === 3 ? (
                <FormSection
                  title="Documents"
                  description="Two files. A clear phone photo or a PDF, up to 10MB each. They go straight to secure storage."
                >
                  <div className="grid gap-7 sm:grid-cols-2">
                    {fieldFor(
                      "registration",
                      "Latest registration form",
                      "Your Certificate of Registration (or the enrollment form your school issues each term) for the current term. PDF or a clear photo, up to 10MB.",
                      "upload-registration",
                    )}
                    {fieldFor(
                      "noa",
                      "Notice of Award",
                      "The DOST-SEI Notice of Award for your scholarship. PDF or a clear photo, up to 10MB.",
                      "upload-noa",
                    )}
                  </div>
                </FormSection>
              ) : null}

              {step === 4 ? (
                <>
                  <FormSection
                    title="Review and Submit"
                    description="Check your answers. Use Back to change anything."
                  >
                    <dl className="bg-brand-field rounded-form grid gap-x-6 gap-y-4 p-5 sm:grid-cols-3">
                      {summaryRows().map((row) => (
                        <div key={row.label} className="flex min-w-0 flex-col gap-0.5">
                          <dt className="text-brand-label text-xs font-semibold tracking-[0.08em] uppercase">
                            {row.label}
                          </dt>
                          <dd className="text-brand-ink text-sm break-words">{row.value || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </FormSection>
                  <ConsentSection />
                </>
              ) : null}

              {rootError ? (
                <p
                  role="alert"
                  className="text-destructive text-sm"
                  data-testid="renewal-root-error"
                >
                  {rootError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                {step > FIRST_STEP ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={goBack}
                    disabled={submitting}
                  >
                    Back
                  </Button>
                ) : (
                  <span aria-hidden="true" />
                )}
                {step < LAST_STEP ? (
                  <Button
                    type="button"
                    size="lg"
                    className="sm:min-w-[200px]"
                    onClick={() => void goNext()}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="lg"
                    className="sm:min-w-[240px]"
                    disabled={submitting}
                  >
                    {submitLabel(phase)}
                  </Button>
                )}
              </div>
            </form>
          </FormProvider>
        </Card>
      </div>
    </>
  );
}
