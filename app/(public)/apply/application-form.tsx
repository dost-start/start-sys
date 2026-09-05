"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The public membership application form — the SRS form of 2026-09-05.
//
// Three sections (personal, scholarship/academic, membership), TWO documents (the
// latest registration form and the Notice of Award — 0040), the privacy consent and the
// accuracy certification. One zod schema is bound here and re-run inside the Server
// Action (CONVENTIONS §6); field names are the schema keys, which are the payload keys.
//
// The upload flow is unchanged in shape and doubled in count: `startApplication`
// validates the form and mints ONE upload session per document; the browser PUTs each
// file straight to storage (Vercel caps request bodies at 4.5MB, a phone photo of a
// registration form routinely exceeds it); `finalizeApplication` re-verifies both from
// provider metadata and flips the row to pending in one statement.
//
// Honeypot + a mount timestamp are the anti-bot control (BUILD_PLAN S3-T18): no CAPTCHA.
// Nothing here renders the upload URL or the token into the DOM.
// ─────────────────────────────────────────────────────────────────────────────

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";

import {
  AcademicSection,
  type ProgramOption,
  type UniversityOption,
} from "@/components/applications/academic-section";
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

const KNOWN_FIELDS = new Set<string>([
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
  "city_municipality",
  "province",
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

function isKnownField(key: string): key is keyof ApplicationSubmitInput {
  return KNOWN_FIELDS.has(key);
}

type Phase = "form" | "starting" | "uploading" | "finalizing";

function submitLabel(phase: Phase): string {
  switch (phase) {
    case "starting":
      return "Submitting…";
    case "uploading":
      return "Uploading documents…";
    case "finalizing":
      return "Finishing up…";
    default:
      return "Submit application";
  }
}

/** Everything one upload widget needs, twice over. */
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

export function ApplicationForm({
  regions,
  universities,
  programs,
}: {
  regions: RegionOption[];
  universities: UniversityOption[];
  programs: ProgramOption[];
}) {
  const [succeeded, setSucceeded] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [rootError, setRootError] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<DocKey, DocState>>({
    registration: IDLE_DOC,
    noa: IDLE_DOC,
  });

  const pendingRef = useRef<StartApplicationResult | null>(null);
  const filesRef = useRef<Record<DocKey, File | null>>({ registration: null, noa: null });
  const honeypotRef = useRef<HTMLInputElement>(null);
  const mountedAtRef = useRef<number>(Date.now());

  const form = useForm<z.input<typeof applicationSubmitSchema>, unknown, ApplicationSubmitInput>({
    resolver: zodResolver(applicationSubmitSchema),
    defaultValues: {
      applicant_given_name: "",
      middle_name: undefined,
      applicant_family_name: "",
      suffix: undefined,
      sex: "" as unknown as ApplicationSubmitInput["sex"],
      applicant_email: "",
      birthdate: "",
      contact_number: "",
      facebook_account: "",
      address_line: "",
      city_municipality: "",
      province: "",
      postal_code: "",
      scholarship_award: "" as unknown as ApplicationSubmitInput["scholarship_award"],
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

  function patchDoc(key: DocKey, patch: Partial<DocState>) {
    setDocs((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

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
    if (!mappedAny) setRootError(error.message);
  }

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

  async function runUploads(pending: StartApplicationResult) {
    setPhase("uploading");
    const registration = filesRef.current.registration;
    const noa = filesRef.current.noa;
    if (!registration || !noa) {
      setPhase("form");
      return;
    }

    // Sequential, not parallel: on mobile data two concurrent PUTs halve each other's
    // throughput and double the chance both time out. Retry re-runs whichever failed.
    if (docs.registration.status !== "success") {
      const ok = await uploadOne("registration", pending.uploadUrl, registration);
      if (!ok) {
        setPhase("form");
        return;
      }
    }
    if (docs.noa.status !== "success") {
      const ok = await uploadOne("noa", pending.noaUploadUrl, noa);
      if (!ok) {
        setPhase("form");
        return;
      }
    }

    setPhase("finalizing");
    const finalizeResult = await finalizeApplication({
      application_id: pending.applicationId,
      upload_token: pending.uploadToken,
      storage_ref: pending.storageRef,
      noa_storage_ref: pending.noaStorageRef,
    });

    if (isErr(finalizeResult)) {
      if (finalizeResult.error.code === "validation") {
        // One of the two files failed the server-side sniff. Both are cleared: the
        // response deliberately does not say which, and a fresh pair is the safe retry.
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
      return;
    }

    pendingRef.current = null;
    filesRef.current = { registration: null, noa: null };
    setSucceeded(true);
  }

  async function onValid(values: ApplicationSubmitInput) {
    setRootError(null);

    const honeypotFilled = Boolean(honeypotRef.current?.value);
    const submittedTooFast = Date.now() - mountedAtRef.current < 3000;
    if (honeypotFilled || submittedTooFast) {
      setRootError("Something went wrong. Please try again.");
      return;
    }

    const registration = filesRef.current.registration;
    const noa = filesRef.current.noa;
    if (!registration) {
      patchDoc("registration", {
        clientError: "Attach your latest registration form before submitting.",
      });
    }
    if (!noa) {
      patchDoc("noa", { clientError: "Attach your Notice of Award before submitting." });
    }
    if (!registration || !noa) return;
    if (docs.registration.clientError || docs.noa.clientError) return;

    setPhase("starting");
    const startResult = await startApplication({
      ...values,
      proof_file_name: registration.name,
      proof_mime_type: registration.type,
      proof_size_bytes: registration.size,
      noa_file_name: noa.name,
      noa_mime_type: noa.type,
      noa_size_bytes: noa.size,
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
    await runUploads(startResult.data);
  }

  function handleRetryUpload() {
    const pending = pendingRef.current;
    if (!pending) return;
    void runUploads(pending);
  }

  function fieldFor(key: DocKey, title: string, description: string, testId: string) {
    const state = docs[key];
    return (
      <FormSection title={title} description={description}>
        <div data-testid={testId}>
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
      </FormSection>
    );
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
        <AcademicSection universities={universities} programs={programs} regions={regions} />
        <MembershipSection regions={regions} />

        {fieldFor(
          "registration",
          "Latest registration form",
          "Your Certificate of Registration (or the enrollment form your school issues each term) for the current term. PDF or a clear photo, up to 10MB. Uploaded directly to secure storage.",
          "upload-registration",
        )}
        {fieldFor(
          "noa",
          "Notice of Award",
          "The DOST-SEI Notice of Award for your scholarship — this is what proves you are a DOST scholar. PDF or a clear photo, up to 10MB.",
          "upload-noa",
        )}

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
