// The application detail page (BUILD_PLAN S4-T19; PRD US-C1, US-C2, US-C3).
//
// ⚠️ MERELY RENDERING THIS PAGE WRITES AN AUDIT ROW. `getApplicationDetail` calls
// `get_application_detail()`, which inserts one `VIEW` entry before it returns
// (0026_application_detail_rpc.sql) — under RA 10173, "who read this scholar's
// submission, and when" must be answerable. Do not call it more than once per render
// and do not prefetch it from the list page.
//
// A null result is rendered as `notFound()`, never as a distinct "forbidden" message —
// CONVENTIONS.md §4.3: an RLS-shaped denial must be indistinguishable from "this row
// does not exist", because saying "forbidden" would itself disclose that a named
// applicant exists. This also covers the CBL Art. VIII §7.1 acknowledgement gate: a
// reviewer with no current-term acknowledgement sees the same 404 as a bad id, which is
// the documented (if terse) failure mode in ARCHITECTURE.md §9.
import { notFound, redirect } from "next/navigation";

import { ApplicationDetailFields } from "@/components/applications/application-detail-fields";
import { ApplicationStatusBadge } from "@/components/applications/application-status-badge";
import { ApproveApplicationDialog } from "@/components/applications/approve-application-dialog";
import { ProofDocumentViewer } from "@/components/applications/proof-document-viewer";
import { RejectApplicationDialog } from "@/components/applications/reject-application-dialog";
import type { Database } from "@/database.types";
import { getApplicationDetail } from "@/lib/applications/queries";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";

export const dynamic = "force-dynamic";

const REVIEWER_ROLES = new Set(["exec_admin", "crrd_admin", "moderator"]);

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!REVIEWER_ROLES.has(ctx.role)) redirect(homeForRole(ctx.role));

  const { id } = await params;

  const result = await getApplicationDetail(ctx, id);
  if (!result.ok) notFound();

  const detail = result.data;
  const status = detail.status as ApplicationStatus;
  const givenName = readString(detail, "applicant_given_name") ?? "";
  const familyName = readString(detail, "applicant_family_name") ?? "";
  const applicantName = `${givenName} ${familyName}`.trim() || "this applicant";
  const personId = readString(detail, "person_id");
  const reviewedAt = readString(detail, "reviewed_at");
  const reviewNote = readString(detail, "review_note");
  const proofMimeType = readString(detail, "proof_mime_type");

  // `applications` carries no `member_id` column — the number lives on `people`
  // (DATA_MODEL.md §2/§4: it is not on the record renewal touches). `member_id` is one
  // of the SIX non-sensitive columns column-GRANTed to every authenticated role
  // (0015_grants.sql), so this is an ordinary select, not the audited sensitive RPC —
  // reading it here does not add a second `VIEW` audit row.
  let memberId: string | null = null;
  if (status === "approved" && personId) {
    const { data: person } = await ctx.supabase
      .from("people")
      .select("member_id")
      .eq("id", personId)
      .maybeSingle();
    memberId = person?.member_id ?? null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href="/applications" className="text-sm text-muted-foreground hover:underline">
            ← Back to applications
          </a>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{applicantName}</h1>
          <div className="mt-1 flex items-center gap-2">
            <ApplicationStatusBadge status={status} />
            {reviewedAt ? (
              <span className="text-xs text-muted-foreground">
                Decided{" "}
                {new Intl.DateTimeFormat("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Manila",
                }).format(new Date(reviewedAt))}
              </span>
            ) : null}
          </div>
        </div>

        {/* Decision controls appear ONLY for a pending application. `approved` and
            `rejected` are terminal states in this UI — DATA_MODEL.md §3.2 — and no
            control here can re-decide them; a mistaken approval is corrected on the
            resulting member's record, not by reversing this screen. */}
        {status === "pending" ? (
          <div className="flex gap-2">
            <ApproveApplicationDialog applicationId={id} applicantName={applicantName} />
            <RejectApplicationDialog applicationId={id} applicantName={applicantName} />
          </div>
        ) : null}
      </div>

      {status === "approved" && memberId ? (
        <div className="rounded-md border border-green-600/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
          Approved — member ID {memberId}
        </div>
      ) : null}

      {status === "rejected" && reviewNote ? (
        <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Rejected</p>
          <p className="text-muted-foreground">{reviewNote}</p>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Proof of enrollment</h2>
        <ProofDocumentViewer applicationId={id} mimeType={proofMimeType} />
      </section>

      <ApplicationDetailFields detail={detail} />
    </div>
  );
}
