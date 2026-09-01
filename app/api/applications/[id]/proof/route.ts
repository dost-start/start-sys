// ─────────────────────────────────────────────────────────────────────────────
// GET /api/applications/[id]/proof — the proof-of-enrollment document proxy.
// BUILD_PLAN S4-T16, S4-T17. ARCHITECTURE.md §4.1 step 7. PRD US-C1, US-J1, US-J2.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE ORDER OF THE FIVE STEPS *IS* THE SECURITY PROPERTY. Do not reorder them.
// ═══════════════════════════════════════════════════════════════════════════════
//   1. A request-scoped Supabase client carrying THE CALLER'S OWN JWT from cookies.
//   2. An ORDINARY SELECT on that application row. A row returned means authorized;
//      nothing returned means 404. Document authorization is thereby delegated to the
//      same `applications_read` policy (0014/0027) that guards every other read — there
//      is no second permission model here and there must never be one.
//   3. A row with no stored pointer is a draft whose upload never completed: 404.
//   4. `log_document_view()` — and IT FAILS CLOSED. If the audit write errors we return
//      500 and DO NOT STREAM. An unlogged view is a compliance failure under RA 10173
//      (a constitutional obligation here — CBL Art. VIII §6), so the record is written
//      before a single byte moves. A client that disconnects mid-stream still leaves it.
//   5. Only then: open the byte stream through `lib/documents`.
//
// ⚠ NEVER 403. A 403 confirms the application exists, which discloses that a named
// applicant applied — a leak with no data in it (CONVENTIONS §4.3). Every denial and
// every miss returns the SAME 404 body.
//
// ⚠ NO PROVIDER URL EVER REACHES THE BROWSER — not in a redirect, not in a header, not
// in an error body. `proof_web_view_link` is not even granted to `authenticated` (0027),
// and `getProofStream()` is imported from `lib/documents` rather than `googleapis` so
// ADR 0005's driver swap does not touch this file.
//
// ⚠ CONTENT-TYPE COMES FROM THE STORED `proof_mime_type`, validated against
// ALLOWED_MIME — never from the provider's response header and never from a query
// param. A caller-influenced Content-Type on a route that streams user-uploaded bytes is
// a stored-XSS delivery mechanism.
//
// STATUS CODES: 200, 401, 404, 500. Nothing else (CONVENTIONS §4.4).
//
// GETPROOFREF: implemented INLINE here, deliberately. `lib/applications/queries.ts` is
// under concurrent edit in this slice; the select is three granted columns and one
// `.eq()`, and inlining it keeps this route buildable and keeps the RLS-delegation
// argument above readable in one file. If `getProofRef(ctx, id)` lands in queries.ts,
// swapping to it is a two-line change and changes nothing about the order above.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

import { DocumentUnavailableError, getProofStream, isAllowedMime } from "@/lib/documents";
import { createServerSupabase } from "@/lib/supabase/server";

/** Streams live data under the caller's session; never prerendered, never cached. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The single 404 body. IDENTICAL for: no such application, an application this caller's
 * policies hide, a draft with no document, and a malformed id. This endpoint is not an
 * existence oracle for anything.
 */
function notFound(): NextResponse {
  return NextResponse.json(
    { code: "not_found", message: "That record could not be found." },
    {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    },
  );
}

/** Generic 500. Carries no provider message, no ref, no id, no Postgres text. */
function serverError(): NextResponse {
  return NextResponse.json(
    { code: "unknown", message: "Something went wrong. Please try again." },
    {
      status: 500,
      headers: { "cache-control": "private, no-store" },
    },
  );
}

/** 401 only for "there is no session at all" — never for "this session may not read it". */
function unauthenticated(): NextResponse {
  return NextResponse.json(
    { code: "unauthorized", message: "Sign in to continue." },
    {
      status: 401,
      headers: { "cache-control": "private, no-store" },
    },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await params;

  // ── 1 — the caller's own client ────────────────────────────────────────────
  let supabase: Awaited<ReturnType<typeof createServerSupabase>>;
  try {
    supabase = await createServerSupabase();
  } catch {
    return serverError();
  }

  // `getUser()` revalidates against the auth server; `getSession()` would trust a
  // cookie. This distinguishes 401 (nobody is signed in) from 404 (signed in, not
  // permitted) — and NOTHING ELSE. It is not the authorization check; step 2 is.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError !== null || userData.user === null) return unauthenticated();

  // ── 2 — the RLS-checked SELECT. THIS is the authorization. ─────────────────
  // A malformed uuid arrives here as 22P02 and takes the same 404 as a hidden row.
  const { data: row, error: selectError } = await supabase
    .from("applications")
    .select("id, proof_drive_file_id, proof_mime_type")
    .eq("id", id)
    .maybeSingle();

  if (selectError !== null || row === null) return notFound();

  // ── 3 — no stored pointer means the upload never completed ─────────────────
  const storageRef = row.proof_drive_file_id;
  const storedMime = row.proof_mime_type;
  if (storageRef === null || storageRef === "") return notFound();

  // The stored type is validated BEFORE the audit write, so a corrupt row does not
  // produce a "viewed" record for a view that never happens. An unrecognised stored
  // mime is a data-integrity fault, not a permission fault: 500, not 404.
  if (storedMime === null || !isAllowedMime(storedMime)) return serverError();

  // ── 4 — the audit write, FAIL CLOSED, before any byte moves ────────────────
  const { error: auditError } = await supabase.rpc("log_document_view", { p_app_id: id });
  if (auditError !== null) {
    // Covers both the missing-confidentiality-acknowledgement refusal (CBL Art. VIII
    // §7.1 / US-J5 — an ERROR, never an empty result) and a genuine audit failure. Both
    // mean the same thing here: no record, therefore no bytes.
    return serverError();
  }

  // ── 5 — stream ─────────────────────────────────────────────────────────────
  let proof: Awaited<ReturnType<typeof getProofStream>>;
  try {
    proof = await getProofStream(storageRef);
  } catch (error) {
    // DocumentUnavailableError carries a provider message that can name a service
    // account, a folder and a Drive. It is caught by type only so the intent is legible;
    // both branches return the same opaque 500.
    if (error instanceof DocumentUnavailableError) return serverError();
    return serverError();
  }

  const headers = new Headers({
    // From the DATABASE, validated above.
    "content-type": storedMime,
    // Rendered in the browser's own sandboxed viewer (ARCHITECTURE §4.1's residual-risk
    // mitigation). `inline` with no filename: a filename would carry the applicant's
    // family name into the download bar.
    "content-disposition": "inline",
    // A Certificate of Registration must not sit in a shared cache or on disk.
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    // Belt-and-braces against the file being framed by anything but our own page.
    "content-security-policy": "default-src 'none'; frame-ancestors 'self'; sandbox",
  });

  if (proof.contentLength !== null) {
    headers.set("content-length", String(proof.contentLength));
  }

  return new Response(proof.stream, { status: 200, headers });
}
