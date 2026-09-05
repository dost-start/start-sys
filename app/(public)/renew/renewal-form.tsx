"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The renewal form (PRD US-G7, US-H5). The application form's sections plus one identity
// section (member ID), bound to `renewalSubmitSchema` — the same schema module
// `startRenewal` re-runs (CONVENTIONS §6). The upload flow is the application form's:
// `startRenewal` verifies the identity, writes the draft and mints two upload sessions;
// the browser PUTs both files straight to the store; `finalizeRenewal` re-verifies them
// from provider metadata and flips the draft to pending.
//
// The token from `startRenewal` lives in a ref and is never rendered, never in the URL.
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
import { ConsentSection } from "@/components/applications/consent-section";
import { FormSection } from "@/components/applications/form-section";
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
import { type ActionError, isErr } from "@/lib/action-result";
import {
  finalizeRenewal,
  startRenewal,
  type StartRenewalResult,
} from "@/lib/applications/renewal-actions";
import { renewalSubmitSchema, type RenewalSubmitInput } from "@/lib/applications/renewal-schema";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/notice-version";

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

export function RenewalForm({
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

  async function runUploads(pending: StartRenewalResult) {
    setPhase("uploading");
    const registration = filesRef.current.registration;
    const noa = filesRef.current.noa;
    if (!registration || !noa) {
      setPhase("form");
      return;
    }

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
    const finalizeResult = await finalizeRenewal({
      renewal_id: pending.renewalId,
      upload_token: pending.uploadToken,
      storage_ref: pending.storageRef,
      noa_storage_ref: pending.noaStorageRef,
    });

    if (isErr(finalizeResult)) {
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
      return;
    }

    pendingRef.current = null;
    filesRef.current = { registration: null, noa: null };
    setSucceeded(true);
  }

  async function onValid(values: RenewalSubmitInput) {
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
    const startResult = await startRenewal({
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
    return <RenewalSuccess />;
  }

  const submitting = phase !== "form";

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onValid)} noValidate className="space-y-6">
        <div
          aria-hidden="true"
          className="absolute left-[-9999px] top-auto size-px overflow-hidden"
        >
          <label htmlFor="website">Leave this field blank</label>
          <input id="website" type="text" tabIndex={-1} autoComplete="off" ref={honeypotRef} />
        </div>

        <RenewalIdentitySection />
        <PersonalSection />
        <AcademicSection universities={universities} programs={programs} regions={regions} />
        <MembershipSection regions={regions} />

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

        <ConsentSection />

        {rootError ? (
          <p role="alert" className="text-sm text-destructive" data-testid="renewal-root-error">
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
