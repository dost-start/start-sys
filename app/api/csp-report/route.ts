// ─────────────────────────────────────────────────────────────────────────────
// POST /api/csp-report — where the Report-Only CSP actually reports.
//
// WHY THIS EXISTS: `next.config.ts` has shipped a `Content-Security-Policy-Report-Only`
// header since S7-T11, with no `report-uri` and no `report-to`. Browsers dutifully
// evaluated the policy and dropped every violation on the floor. A policy that reports to
// nobody buys nothing — it is not a security control, it is a comment in a header
// (QA 2026-09-10, ISSUE-009).
//
// It matters beyond tidiness. Launch-debt item 5 wants the CSP ENFORCING. You cannot flip
// Report-Only to enforcing safely without first knowing what it would have blocked, and
// that list has never been collected. This is the endpoint that collects it.
//
// ── Why it is unauthenticated, and why that is acceptable ──────────────────────
// A browser sends a violation report on its own, with no session and no way to attach
// one. So this is open by construction. Three things keep that cheap:
//
//   1. It does nothing but hand the report to `reportError` and return 204. No database,
//      no third-party call of its own.
//   2. The body is capped. A report is a few hundred bytes; anything larger is not a
//      browser and is discarded unread.
//   3. It records the violated DIRECTIVE and the BLOCKED URI, never the request body and
//      never a query string — the same rule as everywhere else (CLAUDE.md: log IDs,
//      never values). `document-uri` is truncated to its path for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

import { reportError } from "@/instrumentation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A real violation report is a few hundred bytes. This is generous. */
const MAX_REPORT_BYTES = 8_192;

/** Always 204: a browser has nothing useful to do with any other answer. */
const NO_CONTENT = { status: 204, headers: { "cache-control": "no-store" } } as const;

/** Path only. A full URL can carry a query string, and a query string can carry anything. */
function pathOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).pathname;
  } catch {
    return value.startsWith("/") ? (value.split("?")[0] ?? null) : null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text().catch(() => "");
  if (body.length === 0 || body.length > MAX_REPORT_BYTES)
    return new NextResponse(null, NO_CONTENT);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new NextResponse(null, NO_CONTENT);
  }

  // Two wire formats: the legacy `report-uri` shape (`{"csp-report": {...}}`) and the
  // newer Reporting API shape (an array of `{type, body}`). Both are in the field.
  const legacy = (parsed as { "csp-report"?: Record<string, unknown> })["csp-report"];
  const modern = Array.isArray(parsed)
    ? (parsed[0] as { body?: Record<string, unknown> } | undefined)?.body
    : undefined;
  const report = legacy ?? modern;
  if (!report) return new NextResponse(null, NO_CONTENT);

  const directive = report["violated-directive"] ?? report["effectiveDirective"];
  const blocked = report["blocked-uri"] ?? report["blockedURL"];

  await reportError(new Error("csp-violation"), {
    message: "Content-Security-Policy violation (report-only)",
    level: "warning",
    tags: { route: "api/csp-report" },
    extra: {
      violated_directive: typeof directive === "string" ? directive : null,
      blocked_uri: pathOf(blocked) ?? (typeof blocked === "string" ? blocked : null),
      document_path: pathOf(report["document-uri"] ?? report["documentURL"]),
    },
  });

  return new NextResponse(null, NO_CONTENT);
}
