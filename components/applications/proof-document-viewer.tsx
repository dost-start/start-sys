// The proof-of-enrollment viewer (BUILD_PLAN S4-T20; ARCHITECTURE.md §4.1 step 7).
//
// Takes an APPLICATION ID and a MIME TYPE — never a URL, never a file id. The only
// source the browser is ever pointed at is `/api/applications/[id]/proof`
// (S4-T17, built in another lane): an ordinary same-origin route that re-checks RLS,
// writes exactly one `VIEW_DOCUMENT` audit row per successful GET, and streams the
// bytes. There is no prop this component could receive that leaks a Drive URL,
// because it never receives one.
//
// EVERY RENDER OF THE PDF/IMAGE BRANCHES CAUSES ONE AUDIT ROW ON THE SERVER (the route
// writes it, not this component) — so this component mounts the viewer element exactly
// once per open and never prefetches or pre-mounts it from the list page.
"use client";

import { useState } from "react";

const PDF_MIME = "application/pdf";
const IMAGE_MIMES = new Set(["image/jpeg", "image/png"]);
/** No browser renders HEIC/HEIF natively. An iPhone photo of a CoR is the single most
 *  likely upload, so this is an expected branch, not an edge case (S4 risk table). */
const UNVIEWABLE_MIMES = new Set(["image/heic", "image/heif"]);

export function ProofDocumentViewer({
  applicationId,
  mimeType,
  doc = "registration",
  proxyBasePath = "/api/applications",
}: {
  applicationId: string;
  mimeType: string | null;
  /** Which document the proxy serves — the registration form (default) or the NOA. */
  doc?: "registration" | "noa";
  /** `/api/applications` (default) or `/api/renewals` (0044) — both proxies share one contract. */
  proxyBasePath?: "/api/applications" | "/api/renewals";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const proofUrl =
    doc === "noa"
      ? `${proxyBasePath}/${applicationId}/proof?doc=noa`
      : `${proxyBasePath}/${applicationId}/proof`;

  if (!mimeType) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        No proof of enrollment is attached to this application.
      </p>
    );
  }

  if (mimeType === PDF_MIME) {
    return (
      <iframe
        src={proofUrl}
        title="Proof of enrollment"
        className="h-[70vh] w-full rounded-md border"
        // The browser's own sandboxed PDF viewer is the residual-risk mitigation
        // ARCHITECTURE.md §4.1 names — never offer a download link alongside it.
      />
    );
  }

  if (IMAGE_MIMES.has(mimeType) && !imageFailed) {
    return (
      // Same-origin proxy route, not an optimizable remote asset — next/image would
      // need a remotePatterns entry that does not exist and should not, since the URL
      // is per-application.
      <img
        src={proofUrl}
        alt="Proof of enrollment"
        className="max-h-[70vh] w-full rounded-md border object-contain"
        onError={() => setImageFailed(true)}
      />
    );
  }

  const unviewable = UNVIEWABLE_MIMES.has(mimeType) || imageFailed;

  return (
    <div className="space-y-3 rounded-md border border-dashed p-6">
      <p className="text-sm text-muted-foreground">
        {unviewable
          ? "This file is a HEIC/HEIF photo, which no browser can display inline."
          : "This file type cannot be previewed here."}{" "}
        Open it directly to review it.
      </p>
      <a
        href={proofUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium underline underline-offset-2"
      >
        Open proof of enrollment in a new tab
      </a>
      {unviewable ? (
        <p className="text-xs text-muted-foreground">
          Suggested rejection reason: &ldquo;Your Certificate of Registration could not be displayed
          for review — please re-upload as a PDF, JPEG or PNG.&rdquo;
        </p>
      ) : null}
    </div>
  );
}
