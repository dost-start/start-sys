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
//
// Brand edition (2026-09-08): the `application_detail` board of the design canvas —
// back link, the applicant's name as the visible page title with the status beside it,
// the decision controls on the right, the two documents side by side, then the field
// panels. Every string, control name and audit read is the one the previous version had.
import { notFound, redirect } from "next/navigation";

import { ApplicationDetailFields } from "@/components/applications/application-detail-fields";
import { ApplicationStatusBadge } from "@/components/applications/application-status-badge";
import { ApproveApplicationDialog } from "@/components/applications/approve-application-dialog";
import { ProofDocumentViewer } from "@/components/applications/proof-document-viewer";
import { RejectApplicationDialog } from "@/components/applications/reject-application-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import type { Database } from "@/database.types";
import { getApplicationDetail } from "@/lib/applications/queries";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole } from "@/lib/auth/route-access";

export const dynamic = "force-dynamic";

const REVIEWER_ROLES = new Set(["exec_admin", "crrd_admin"]);

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
  const noaMimeType = readString(detail, "noa_mime_type");

  // Names for the three uuid choices. Public reference tables, read as the caller.
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
      <div>
        <a href="/applications" className="text-brand-label text-xs hover:underline">
          ← Back to applications
        </a>
        <div className="mt-2.5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2">
            <h1 className="text-brand-ink text-[26px] leading-tight font-semibold break-words">
              {applicantName}
            </h1>
            <ApplicationStatusBadge status={status} />
            {reviewedAt ? (
              <span className="text-brand-label text-xs">
                Decided{" "}
                {new Intl.DateTimeFormat("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Manila",
                }).format(new Date(reviewedAt))}
              </span>
            ) : null}
          </div>

          {/* Decision controls appear ONLY for a pending application. `approved` and
              `rejected` are terminal states in this UI — DATA_MODEL.md §3.2 — and no
              control here can re-decide them; a mistaken approval is corrected on the
              resulting member's record, not by reversing this screen. */}
          {status === "pending" ? (
            <div className="flex flex-wrap gap-2.5">
              <ApproveApplicationDialog applicationId={id} applicantName={applicantName} />
              <RejectApplicationDialog applicationId={id} applicantName={applicantName} />
            </div>
          ) : null}
        </div>
      </div>

      {status === "approved" && memberId ? (
        <Alert variant="success" className="font-medium">
          Approved — member ID {memberId}
        </Alert>
      ) : null}

      {status === "rejected" && reviewNote ? (
        <Alert variant="danger">
          <div className="space-y-1">
            <AlertTitle>Rejected</AlertTitle>
            <AlertDescription>
              <p>{reviewNote}</p>
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      {/* Two documents (SRS 2026-09-05, 0040). Each viewer is ONE audited proxy read —
          do not mount either twice. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2.5">
          <h2 className="text-brand-ink text-lg leading-tight font-semibold">Notice of Award</h2>
          <Card className="overflow-hidden p-0">
            <ProofDocumentViewer applicationId={id} mimeType={noaMimeType} doc="noa" />
          </Card>
        </section>

        <section className="space-y-2.5">
          <h2 className="text-brand-ink text-lg leading-tight font-semibold">
            Latest registration form
          </h2>
          <Card className="overflow-hidden p-0">
            <ProofDocumentViewer applicationId={id} mimeType={proofMimeType} doc="registration" />
          </Card>
        </section>
      </div>

      <ApplicationDetailFields detail={detail} lookups={lookups} />
    </div>
  );
}
