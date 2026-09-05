// One renewal: the record it belongs to, what the scholar submitted, the two documents,
// and the decision (PRD US-G7, US-H5). Opening this page calls `get_renewal_detail()`,
// which asserts the confidentiality acknowledgement and writes the VIEW audit row — the
// RA 10173 access record is a consequence of rendering, not a separate step.
import { notFound, redirect } from "next/navigation";

import { ApplicationDetailFields } from "@/components/applications/application-detail-fields";
import { ApplicationStatusBadge } from "@/components/applications/application-status-badge";
import { ApproveRenewalDialog } from "@/components/applications/approve-renewal-dialog";
import { ProofDocumentViewer } from "@/components/applications/proof-document-viewer";
import { RejectRenewalDialog } from "@/components/applications/reject-renewal-dialog";
import type { Database } from "@/database.types";
import { getRenewalDetail } from "@/lib/applications/renewal-queries";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/route-access";

export const dynamic = "force-dynamic";

const REVIEWER_ROLES = new Set(["exec_admin", "crrd_admin"]);

type ApplicationStatus = Database["public"]["Enums"]["application_status"];

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export default async function RenewalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect(LOGIN_PATH);
  if (!REVIEWER_ROLES.has(ctx.role)) redirect(homeForRole(ctx.role));

  const { id } = await params;
  const result = await getRenewalDetail(ctx, id);
  if (!result.ok) notFound();

  const detail = result.data;
  const status = detail.status as ApplicationStatus;
  const givenName = readString(detail, "given_name") ?? "";
  const familyName = readString(detail, "family_name") ?? "";
  const memberName = `${givenName} ${familyName}`.trim() || "this member";
  const memberId = readString(detail, "member_id");
  const reviewedAt = readString(detail, "reviewed_at");
  const reviewNote = readString(detail, "review_note");
  const proofMimeType = readString(detail, "proof_mime_type");
  const noaMimeType = readString(detail, "noa_mime_type");

  // The shared fields component reads the applicant's name and email from the top level
  // (an application row's columns). For a renewal those come from the RECORD — the name
  // on file and the email that proved the identity — so they are mapped in here.
  const fieldsDetail: Record<string, unknown> = {
    ...detail,
    applicant_given_name: givenName,
    applicant_family_name: familyName,
    applicant_email: readString(detail, "personal_email_on_file"),
  };

  const [regionRows, universityRows, programRows] = await Promise.all([
    ctx.supabase.from("regions").select("id, name"),
    ctx.supabase.from("universities").select("id, name"),
    ctx.supabase.from("programs").select("id, name"),
  ]);
  const toMap = (rows: { id: string; name: string }[] | null): Record<string, string> =>
    Object.fromEntries((rows ?? []).map((r) => [r.id, r.name]));
  const lookups = {
    regions: toMap(regionRows.data),
    universities: toMap(universityRows.data),
    programs: toMap(programRows.data),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <a href="/renewals" className="text-sm text-muted-foreground hover:underline">
            ← Back to renewals
          </a>
          <h1
            className="mt-1 text-xl font-semibold tracking-tight"
            data-testid="renewal-member-name"
          >
            {memberName}
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="renewal-member-id">
            Member ID {memberId ?? "—"} — unchanged by renewal
          </p>
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

        {status === "pending" ? (
          <div className="flex gap-2">
            <ApproveRenewalDialog renewalId={id} memberName={memberName} />
            <RejectRenewalDialog renewalId={id} memberName={memberName} />
          </div>
        ) : null}
      </div>

      {status === "approved" ? (
        <div className="rounded-md border border-green-600/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
          Renewed — active membership for the current term, member ID {memberId ?? "—"}
        </div>
      ) : null}

      {status === "rejected" && reviewNote ? (
        <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Rejected</p>
          <p className="text-muted-foreground">{reviewNote}</p>
          <p className="text-muted-foreground text-xs">
            The member may submit the form again while the renewal period is open.
          </p>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Notice of Award</h2>
        <ProofDocumentViewer
          applicationId={id}
          mimeType={noaMimeType}
          doc="noa"
          proxyBasePath="/api/renewals"
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Latest registration form</h2>
        <ProofDocumentViewer
          applicationId={id}
          mimeType={proofMimeType}
          doc="registration"
          proxyBasePath="/api/renewals"
        />
      </section>

      <ApplicationDetailFields detail={fieldsDetail} lookups={lookups} />
    </div>
  );
}
