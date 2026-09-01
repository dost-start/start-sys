// The proof-of-enrollment upload widget (BUILD_PLAN S3-T19) — the one place a phone
// on Philippine mobile data is most likely to fail, so it has to fail recoverably.
//
// Two things live in this file on purpose:
//   1. `ProofUploadField` — file selection + CLIENT-SIDE validation against the
//      DECLARED limits in `lib/applications/schema.ts` (a claim, refused cheaply,
//      before a database row or a provider session exists).
//   2. `uploadFileToStore` — the actual XHR PUT with progress, called from
//      `application-form.tsx`'s submit handler using the `uploadUrl` returned by
//      `startApplication`. It is a plain function, not component state, so the
//      upload URL and the submit token never enter this component's props or the
//      DOM (S3-T19's "never render uploadUrl/token into the DOM" — they live only in
//      `application-form.tsx`'s closures).
//
// `fetch` is not used for the PUT: it has no upload-progress event, and a determinate
// bar is the whole point on a 6MB file over mobile data. `XMLHttpRequest` does.
"use client";

import { useId } from "react";
import type { ChangeEvent } from "react";

import { DECLARED_ALLOWED_MIME, MAX_DECLARED_PROOF_BYTES } from "@/lib/applications/schema";

export type ProofUploadStatus = "idle" | "uploading" | "success" | "error";

/** Client-side check against the DECLARED limits — a claim, not the authoritative check. See the module header. */
export function validateProofFile(file: File): string | null {
  if (!(DECLARED_ALLOWED_MIME as readonly string[]).includes(file.type)) {
    return "Upload a PDF, JPEG, PNG or HEIC file — that is what a phone photo or a scan produces.";
  }
  if (file.size <= 0) {
    return "That file appears to be empty. Choose a different file.";
  }
  if (file.size > MAX_DECLARED_PROOF_BYTES) {
    return `That file is larger than the ${Math.floor(MAX_DECLARED_PROOF_BYTES / (1024 * 1024))}MB limit.`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection UI
// ─────────────────────────────────────────────────────────────────────────────

export function ProofUploadField({
  file,
  status,
  progress,
  error,
  onFileChange,
  onRetry,
}: {
  file: File | null;
  status: ProofUploadStatus;
  /** 0–100. Only meaningful while `status === "uploading"`. */
  progress: number;
  error?: string | null;
  onFileChange: (file: File | null, clientError: string | null) => void;
  onRetry?: () => void;
}) {
  const inputId = useId();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) {
      onFileChange(null, null);
      return;
    }
    const clientError = validateProofFile(picked);
    onFileChange(clientError ? null : picked, clientError);
  }

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        Proof of enrollment
      </label>
      <p className="text-sm text-muted-foreground">
        Your Certificate of Registration, scholar ID, or equivalent. A phone photo is fine — PDF,
        JPEG, PNG or HEIC, up to 10MB.
      </p>
      <input
        id={inputId}
        type="file"
        accept={DECLARED_ALLOWED_MIME.join(",")}
        onChange={handleChange}
        disabled={status === "uploading"}
        aria-invalid={error ? "true" : "false"}
        className="block w-full text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground disabled:opacity-50"
      />

      {file ? (
        <p className="text-sm text-muted-foreground">
          Selected: {file.name} ({Math.max(1, Math.ceil(file.size / 1024))} KB)
        </p>
      ) : null}

      {status === "uploading" ? (
        <div className="space-y-1">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>
        </div>
      ) : null}

      {status === "success" ? <p className="text-sm text-green-700">Uploaded.</p> : null}

      {error ? (
        <div className="space-y-1.5">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          {onRetry && status === "error" ? (
            <button
              type="button"
              onClick={onRetry}
              className="text-sm font-medium underline underline-offset-4"
            >
              Retry upload
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport — XHR PUT with progress, and a best-effort resume attempt
// ─────────────────────────────────────────────────────────────────────────────

export type UploadOutcome = { ok: true } | { ok: false };

/** Automatic attempts before handing control back to a manual "Retry upload" click. */
const MAX_AUTO_RETRIES = 3;

type XhrResult = { status: number; getHeader: (name: string) => string | null };

function xhrPut(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void,
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
    }
    xhr.onload = () =>
      resolve({ status: xhr.status, getHeader: (name) => xhr.getResponseHeader(name) });
    xhr.onerror = () => reject(new Error("network_error"));
    xhr.onabort = () => reject(new Error("aborted"));
    xhr.send(body);
  });
}

/**
 * Best-effort resumable-upload status probe, per the Google resumable-upload
 * protocol: an empty PUT with a `Content-Range: bytes (star)/total` header (see the
 * literal below) asks the provider what it has already committed. A `308` with a
 * `Range` header means "resume from here";
 * anything else means "this provider is not speaking that protocol" and the caller
 * falls back to a full retry from byte 0 — which is always correct, just not always
 * the cheapest option (BUILD_PLAN S3-T19: "implement simple retry-from-zero fallback
 * if probe fails").
 */
async function probeCommittedOffset(url: string, totalBytes: number): Promise<number | null> {
  try {
    const result = await xhrPut(url, new Blob([]), { "Content-Range": `bytes */${totalBytes}` });
    if (result.status !== 308) return null;
    const range = result.getHeader("Range");
    if (!range) return 0;
    const match = /bytes=0-(\d+)/.exec(range);
    return match?.[1] ? Number(match[1]) + 1 : 0;
  } catch {
    return null;
  }
}

/**
 * PUT `file`'s bytes to `uploadUrl`, reporting progress and retrying up to
 * `MAX_AUTO_RETRIES` times before giving up and returning `{ ok: false }` for the
 * caller to offer a manual retry.
 *
 * The submit token and upload URL are never touched by this function beyond being
 * passed straight through — it holds no state of its own, so there is nothing here
 * for a re-render to leak into the DOM.
 */
export async function uploadFileToStore(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadOutcome> {
  let attempt = 0;
  let startByte = 0;

  while (attempt <= MAX_AUTO_RETRIES) {
    const chunk = startByte > 0 ? file.slice(startByte) : file;
    const headers: Record<string, string> =
      startByte > 0
        ? {
            "Content-Range": `bytes ${startByte}-${file.size - 1}/${file.size}`,
            "Content-Type": file.type,
          }
        : { "Content-Type": file.type };

    try {
      const result = await xhrPut(uploadUrl, chunk, headers, (chunkPercent) => {
        if (!onProgress) return;
        const uploadedBytes = startByte + (chunkPercent / 100) * (file.size - startByte);
        onProgress(Math.min(100, Math.round((uploadedBytes / Math.max(1, file.size)) * 100)));
      });

      if (result.status >= 200 && result.status < 300) {
        onProgress?.(100);
        return { ok: true };
      }
      // Non-2xx but the request itself completed. Not a network error — still worth
      // one retry-from-a-known-offset before giving up, since a transient 5xx from
      // the provider is common under load.
    } catch {
      // Network error, abort, or timeout. Fall through to the retry path below.
    }

    attempt += 1;
    if (attempt > MAX_AUTO_RETRIES) return { ok: false };

    const resumeFrom = await probeCommittedOffset(uploadUrl, file.size);
    startByte = resumeFrom ?? 0;
  }

  return { ok: false };
}
