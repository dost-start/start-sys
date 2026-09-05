// ─────────────────────────────────────────────────────────────────────────────
// GET /api/renewals/[id]/proof[?doc=noa] — the renewal documents, through the same design
// as /api/applications/[id]/proof (ARCHITECTURE.md §4.1 step 7): an ORDINARY RLS-checked
// SELECT authorizes (row returned ⇒ allowed; nothing ⇒ 404, never 403), the audit write
// happens BEFORE a byte moves and fails closed, and the store's URL never leaves the server.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";

import { DocumentUnavailableError, getProofStream, isAllowedMime } from "@/lib/documents";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" };

function notFound(): NextResponse {
  return NextResponse.json(
    { code: "not_found", message: "That record could not be found." },
    { status: 404, headers: NO_STORE },
  );
}

function serverError(): NextResponse {
  return NextResponse.json(
    { code: "unknown", message: "Something went wrong. Please try again." },
    { status: 500, headers: NO_STORE },
  );
}

function unauthenticated(): NextResponse {
  return NextResponse.json(
    { code: "unauthorized", message: "Sign in to continue." },
    { status: 401, headers: NO_STORE },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await params;

  let supabase: Awaited<ReturnType<typeof createServerSupabase>>;
  try {
    supabase = await createServerSupabase();
  } catch {
    return serverError();
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError !== null || userData.user === null) return unauthenticated();

  const doc = new URL(request.url).searchParams.get("doc") === "noa" ? "noa" : "registration";

  const { data: row, error: selectError } = await supabase
    .from("renewal_submissions")
    .select("id, proof_drive_file_id, proof_mime_type, noa_drive_file_id, noa_mime_type")
    .eq("id", id)
    .maybeSingle();
  if (selectError !== null || row === null) return notFound();

  const storageRef = doc === "noa" ? row.noa_drive_file_id : row.proof_drive_file_id;
  const storedMime = doc === "noa" ? row.noa_mime_type : row.proof_mime_type;
  if (storageRef === null || storageRef === "") return notFound();
  if (storedMime === null || !isAllowedMime(storedMime)) return serverError();

  // Fail closed: an unlogged view is a compliance failure (RA 10173, CBL Art. VIII §6).
  const { error: auditError } = await supabase.rpc("log_renewal_document_view", { p_id: id });
  if (auditError !== null) return serverError();

  let proof: Awaited<ReturnType<typeof getProofStream>>;
  try {
    proof = await getProofStream(storageRef);
  } catch (error) {
    if (error instanceof DocumentUnavailableError) return serverError();
    return serverError();
  }

  const headers = new Headers({
    "content-type": storedMime,
    "content-disposition": "inline",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'self'; sandbox",
  });
  if (proof.contentLength !== null) headers.set("content-length", String(proof.contentLength));

  return new Response(proof.stream, { status: 200, headers });
}
