// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/fake-upload/[ref] — the fake document store's upload endpoint.
// BUILD_PLAN S3-T9, and the reason `fakeDocumentStore.createUploadSession()` returns a
// RELATIVE app URL rather than a dead absolute one.
//
// WHY IT EXISTS: in a CI e2e run the browser really does PUT the bytes. Every other
// driver hands back a provider URL (a Drive resumable session URI, a Supabase signed
// upload URL) and the bytes leave our infrastructure entirely. The fake driver has no
// provider, and a browser cannot PUT to a port nothing is listening on — so the fake
// driver's "provider" is this route.
//
// ⚠️ THIS IS THE ONLY ROUTE IN THE SYSTEM THAT ACCEPTS UNAUTHENTICATED BYTES, so it is
// gated three ways and every gate is load-bearing:
//   1. `DOCUMENT_STORE === "fake"`, checked FIRST and on every request. In production it
//      is `drive` (or `supabase_storage` under ADR 0005), so this handler 404s — it does
//      not merely refuse, it does not exist as far as a caller can tell.
//   2. The ref must match the fake driver's own pattern: `<uuid>__<16 hex>.<ext>`. No
//      slashes and no `..`, so it cannot escape the store directory. Re-checked here
//      independently of `fake-store.ts` — a validator used in one place is a validator
//      someone eventually removes from that place.
//   3. A hard body cap. The store's own limit is 10MB; this refuses anything larger
//      before buffering it, so the endpoint cannot be used to exhaust a test runner.
//
// It is deliberately NOT in `middleware.ts`'s matcher — `/api/*` is excluded there and
// Route Handlers self-authorize (middleware.ts config comment). The gates above ARE the
// authorization.
//
// NOTE: this route never validates the file's TYPE. Neither does a real provider. The
// sniff-and-reject happens in `verifyUpload()`, which is exactly where it happens for
// Drive and for Storage — the fake path must have the same shape or the e2e flow proves
// nothing about the real one.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

import { fakeStorePut, isValidFakeRef } from "@/lib/documents/fake-store";
import { MAX_PROOF_BYTES } from "@/lib/documents/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Identical body for every refusal: this endpoint is not an oracle for anything. */
function notFound(): NextResponse {
  return NextResponse.json({ code: "not_found", message: "Not found." }, { status: 404 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
): Promise<NextResponse> {
  // Gate 1 — the driver. Checked before anything else is read.
  if (process.env.DOCUMENT_STORE !== "fake") return notFound();

  // Gate 2 — the ref shape, which is also the path-traversal guard.
  const { ref } = await params;
  if (!isValidFakeRef(ref)) return notFound();

  // Gate 3 — the size cap, refused from the declared length before buffering where
  // possible, and again from the actual bytes where the client declared nothing.
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_PROOF_BYTES) {
    return NextResponse.json(
      { code: "validation", message: "File is larger than the 10MB limit." },
      { status: 400 },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return NextResponse.json(
      { code: "validation", message: "Upload body could not be read." },
      { status: 400 },
    );
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROOF_BYTES) {
    return NextResponse.json(
      { code: "validation", message: "File is empty or larger than the 10MB limit." },
      { status: 400 },
    );
  }

  // The request's own Content-Type stands in for the provider's stored metadata — still
  // a claim, and still contradicted by the magic-byte sniff in `verifyUpload()` if it is
  // a lie. That is the point: the fake path exercises the same disagreement.
  const mime = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";

  await fakeStorePut(ref, bytes, mime);

  // Shaped like a provider's completion response so the upload widget's success handling
  // is the same code on every driver. No echo of the bytes, no store path, no URL.
  return NextResponse.json({ ok: true, ref, size: bytes.byteLength }, { status: 200 });
}
