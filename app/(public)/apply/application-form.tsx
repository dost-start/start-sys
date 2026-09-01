"use client";

// The application form's orchestrator (BUILD_PLAN S3-T18, S3-T19, S3-T21).
//
// Owns the one state machine the four presentational sections do not need to know
// about: fill in the form -> startApplication (mints a draft row + upload session)
// -> PUT the file directly to the document store -> finalizeApplication (re-verifies
// the upload and flips draft -> pending) -> render the success screen IN PLACE.
//
// The upload URL and submit token returned by `startApplication` live ONLY in this
// component's closures (`pendingRef`) — never in the DOM, never in a child
// component's props that could end up rendered, never in the URL (S3-T19).
//
// ⚠ THE HONEYPOT + MOUNT-TIMESTAMP CHECK IS CLIENT-SIDE ONLY, AND THAT IS A KNOWN GAP.
// BUILD_PLAN S3-T18 calls for the server to refuse a bot submission too, but
// `lib/applications/actions.ts` — read, not owned by this lane — does not currently
// accept or check either signal. `startApplicationSchema` is `.strict()`, so adding
// `website`/`mounted_at` fields to the wire payload would need a schema change this
// lane was not asked to make. Handed to whoever owns `lib/applications/actions.ts`
// next, exactly like the `middle_name`/`suffix` gap already flagged in
// `lib/applications/schema.ts`. Until then this check only stops a bot's OWN browser
// from calling the action — it does not stop a scripted POST that skips the DOM
// entirely, which is what the rate limiter (`withPublic`) and the anti-enumeration
// design in 0008/0019 are for.
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";

import { AcademicSection } from "@/components/applications/academic-section";
import { ApplicationSuccess } from "@/components/applications/application-success";
import { ConsentSection } from "@/components/applications/consent-section";
import { FormSection } from "@/components/applications/form-section";
import { MembershipSection, type RegionOption } from "@/components/applications/membership-section";
import { PersonalSection } from "@/components/applications/personal-section";
import {
  ProofUploadField,
  type ProofUploadStatus,
  uploadFileToStore,
} from "@/components/applications/proof-upload-field";
import { Button } from "@/components/ui/button";
import { type ActionError, isErr } from "@/lib/action-result";
import {
  finalizeApplication,
  startApplication,
  type StartApplicationResult,
} from "@/lib/applications/actions";
import { applicationSubmitSchema, type ApplicationSubmitInput } from "@/lib/applications/schema";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/notice-version";

/** The keys `applicationSubmitSchema` actually validates — everything else routes to the form-level error. */
const KNOWN_FIELDS = new Set<string>([
  "applicant_given_name",
  "middle_name",
  "applicant_family_name",
  "suffix",
  "applicant_email",
  "birthdate",
  "contact_number",
  "address_line",
  "city_municipality",
  "province",
  "postal_code",
  "school",
  "school_id_no",
  "program",
  "year_level",
  "expected_grad_year",
  "region_id",
  "consent_privacy_notice",
  "consent_privacy_notice_version",
]);

function isKnownField(key: string): key is keyof ApplicationSubmitInput {
  return KNOWN_FIELDS.has(key);
}

type Phase = "form" | "starting" | "uploading" | "finalizing";

function submitLabel(phase: Phase): string {
  switch (phase) {
    case "starting":
      return "Submitting…";
    case "uploading":
      return "Uploading document…";
    case "finalizing":
      return "Finishing up…";
    default:
      return "Submit application";
  }
}

export function ApplicationForm({ regions }: { regions: RegionOption[] }) {
  const [succeeded, setSucceeded] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [rootError, setRootError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileClientError, setFileClientError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<ProofUploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadServerError, setUploadServerError] = useState<string | null>(null);

  /**
   * The submit token + upload session from `startApplication`. Kept in a ref rather
   * than state so a re-render never has to pass it through a component's props (and
   * therefore never risks it landing on an element's DOM attribute).
   */
  const pendingRef = useRef<StartApplicationResult | null>(null);
  const currentFileRef = useRef<File | null>(null);

  const honeypotRef = useRef<HTMLInputElement>(null);
  const mountedAtRef = useRef<number>(Date.now());

  // Three generics, deliberately: `zodResolver` infers a schema's INPUT type (what
  // the raw form controls actually produce — a `<select>`'s value is always a
  // string, `year_level`/`expected_grad_year` go through `z.preprocess` precisely so
  // an empty string reads as "missing" rather than "0") separately from its OUTPUT
  // type (`ApplicationSubmitInput`, what `onValid` below receives). Collapsing this
  // to one generic is the standard RHF+zod typing trap with a preprocessed schema —
  // see `lib/applications/schema.ts`'s `coercedInt` helper for why the preprocess
  // exists at all.
  const form = useForm<z.input<typeof applicationSubmitSchema>, unknown, ApplicationSubmitInput>({
    resolver: zodResolver(applicationSubmitSchema),
    defaultValues: {
      applicant_given_name: "",
      middle_name: undefined,
      applicant_family_name: "",
      suffix: undefined,
      applicant_email: "",
      birthdate: "",
      contact_number: "",
      address_line: "",
      city_municipality: "",
      province: "",
      postal_code: "",
      school: "",
      school_id_no: "",
      program: "",
      year_level: "",
      expected_grad_year: "",
      region_id: "",
      // The schema's literal(true) input type is `true` itself, which makes an
      // "unticked by default" checkbox untypeable without a cast. The checkbox is
      // genuinely unticked on mount; only the type says otherwise.
      consent_privacy_notice: false as unknown as true,
      consent_privacy_notice_version: PRIVACY_NOTICE_VERSION,
    },
  });

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
        setFileClientError(message);
        mappedAny = true;
        continue;
      }
      if (isKnownField(key)) {
        form.setError(key, { message });
        mappedAny = true;
      }
    }
    if (!mappedAny) setRootError(error.message);
  }

  async function runUpload(pending: StartApplicationResult, uploadFile: File) {
    setPhase("uploading");
    setUploadStatus("uploading");
    setUploadProgress(0);
    setUploadServerError(null);

    const outcome = await uploadFileToStore(pending.uploadUrl, uploadFile, setUploadProgress);

    if (!outcome.ok) {
      setUploadStatus("error");
      setUploadServerError(
        "The upload did not complete. Check your connection, then try again below.",
      );
      setPhase("form");
      return;
    }

    setUploadStatus("success");
    setPhase("finalizing");

    const finalizeResult = await finalizeApplication({
      application_id: pending.applicationId,
      upload_token: pending.uploadToken,
      storage_ref: pending.storageRef,
    });

    if (isErr(finalizeResult)) {
      if (finalizeResult.error.code === "validation") {
        // The file itself was rejected once the server re-verified it (wrong type,
        // magic bytes disagreeing with the declared type, or oversize). Every typed
        // field is left untouched; the applicant just picks a different file.
        setFile(null);
        currentFileRef.current = null;
        setUploadStatus("idle");
        setUploadServerError(
          "That file could not be accepted. Choose a different photo or document of your proof of enrollment, then submit again.",
        );
      } else {
        setUploadStatus("error");
        setUploadServerError(finalizeResult.error.message);
      }
      setPhase("form");
      return;
    }

    // Success. Drop the token and pending session immediately — nothing after this
    // point should ever try to reuse them (S3-T21: clear token state on success).
    pendingRef.current = null;
    currentFileRef.current = null;
    setSucceeded(true);
  }

  async function onValid(values: ApplicationSubmitInput) {
    setRootError(null);

    // Anti-bot heuristic — see the module header for why this is client-side only.
    const honeypotFilled = Boolean(honeypotRef.current?.value);
    const submittedTooFast = Date.now() - mountedAtRef.current < 3000;
    if (honeypotFilled || submittedTooFast) {
      setRootError("Something went wrong. Please try again.");
      return;
    }

    if (!file) {
      setFileClientError("Attach your proof of enrollment before submitting.");
      return;
    }
    if (fileClientError) {
      // A previously-selected file already failed client validation; do not let a
      // stale File object reach startApplication.
      return;
    }

    setPhase("starting");
    currentFileRef.current = file;

    const startResult = await startApplication({
      ...values,
      proof_file_name: file.name,
      proof_mime_type: file.type,
      proof_size_bytes: file.size,
    });

    if (isErr(startResult)) {
      setPhase("form");
      if (startResult.error.code === "window_closed") {
        setRootError(
          "The application period closed while you were filling this out. Reload the page to see the current status.",
        );
        return;
      }
      applyServerError(startResult.error);
      return;
    }

    pendingRef.current = startResult.data;
    await runUpload(startResult.data, file);
  }

  function handleRetryUpload() {
    const pending = pendingRef.current;
    const uploadFile = currentFileRef.current;
    if (!pending || !uploadFile) return;
    void runUpload(pending, uploadFile);
  }

  if (succeeded) {
    return <ApplicationSuccess />;
  }

  const submitting = phase !== "form";

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onValid)} noValidate className="space-y-6">
        {/* Honeypot. Real applicants never see or fill this — see the module header. */}
        <div
          aria-hidden="true"
          className="absolute left-[-9999px] top-auto size-px overflow-hidden"
        >
          <label htmlFor="website">Leave this field blank</label>
          <input id="website" type="text" tabIndex={-1} autoComplete="off" ref={honeypotRef} />
        </div>

        <PersonalSection />
        <AcademicSection />

        <FormSection
          title="Proof of enrollment"
          description="Uploaded directly and securely — this file never passes through our own servers unencrypted in transit."
        >
          <ProofUploadField
            file={file}
            status={uploadStatus}
            progress={uploadProgress}
            error={fileClientError ?? uploadServerError}
            onFileChange={(picked, clientError) => {
              setFile(picked);
              currentFileRef.current = picked;
              setFileClientError(clientError);
              setUploadServerError(null);
              setUploadStatus("idle");
            }}
            onRetry={handleRetryUpload}
          />
        </FormSection>

        <MembershipSection regions={regions} />
        <ConsentSection />

        {rootError ? (
          <p role="alert" className="text-sm text-destructive">
            {rootError}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitLabel(phase)}
        </Button>
      </form>
    </FormProvider>
  );
}
