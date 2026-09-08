// The CRRD records desk (ADR 0012; PRD US-E5, US-E6, US-E7). Server Component through the
// caller's own client: `officer_assignments_read` (0014) is `using (true)` for every
// authenticated tier, so this page needs no special read RPC; the redirect below is UX for
// the two tiers ADR 0012 does NOT widen (mirrors app/(admin)/renewals/page.tsx's structure).
//
// Vacancy is a QUERY, not a stored status (CBL Art. VI §4, DATA_MODEL.md §3.4): a position
// with an empty `holders` array is vacant, and nothing here writes a "vacant" row anywhere.
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `officers`): the page title
// lives in the shell's top bar, so the <h1> here is screen-reader-only; status tones follow
// the canvas's STATUS_TONE.
import { Fragment } from "react";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppointOfficerDialog } from "@/components/officers/appoint-officer-dialog";
import { RecordOfficerSeparationDialog } from "@/components/officers/record-separation-dialog";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/route-access";
import { listOfficerRoster } from "@/lib/officers/queries";
import {
  OFFICER_ASSIGNMENT_STATUS_LABELS,
  type OfficerAssignmentStatus,
} from "@/lib/officers/schema";

export const dynamic = "force-dynamic";

const RECORDS_DESK_ROLES = new Set(["exec_admin", "crrd_admin"]);

/** CBL Art. VI standing, as a badge tone: sitting is green, a disciplinary state is red. */
const STATUS_VARIANT: Record<OfficerAssignmentStatus, "success" | "neutral" | "danger"> = {
  active: "success",
  on_leave: "neutral",
  suspended: "danger",
  resigned: "neutral",
  dismissed: "danger",
  impeached: "danger",
  ended: "neutral",
};

function PositionCell({ title, code }: { title: string; code: string }) {
  return (
    <>
      <div className="text-brand-ink font-semibold">{title}</div>
      <div className="text-brand-label font-mono text-xs">{code}</div>
    </>
  );
}

export default async function OfficersPage() {
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);
  if (!RECORDS_DESK_ROLES.has(ctx.role)) redirect(homeForRole(ctx.role));

  const roster = await listOfficerRoster(ctx);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="sr-only">Officers</h1>
        <p className="text-brand-body max-w-3xl text-sm">
          Who holds each CBL position for the current term, and their standing under CBL Art. VI.
          Appointing or recording a separation here is a RECORD of a decision made under the
          Constitution — by the CEO or the Executive Board — not the decision itself (ADR 0012). It
          does not, by itself, grant a system account or role; that stays a separate,
          tech_admin-only step at{" "}
          <span className="text-brand-ink font-semibold">System &rarr; User roles</span>.
        </p>
      </header>

      {roster.term_id === null ? (
        <Card className="border-border border border-dashed p-6 shadow-none">
          <p className="text-brand-label text-sm" data-testid="officers-empty">
            No active term is open.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table className="min-w-[48rem]" data-testid="officers-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Position</TableHead>
                <TableHead scope="col">Holder</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Note</TableHead>
                <TableHead scope="col">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roster.positions.map((position) => {
                const isVacant = position.holders.length === 0;

                return (
                  <Fragment key={position.code}>
                    {isVacant ? (
                      <TableRow>
                        <TableCell>
                          <PositionCell title={position.title} code={position.code} />
                        </TableCell>
                        <TableCell className="text-brand-label" colSpan={3}>
                          Vacant
                        </TableCell>
                        <TableCell>
                          <AppointOfficerDialog
                            positionCode={position.code}
                            positionTitle={position.title}
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      position.holders.map((holder, index) => (
                        <TableRow key={holder.assignment_id}>
                          <TableCell>
                            {index === 0 ? (
                              <PositionCell title={position.title} code={position.code} />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <span className="text-brand-ink font-medium">
                              {holder.person.family_name}, {holder.person.given_name}
                            </span>
                            {holder.is_acting ? (
                              <span className="text-brand-label"> (acting)</span>
                            ) : null}
                            <div className="text-brand-label font-mono text-xs">
                              {holder.person.member_id ?? "—"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANT[holder.status]}>
                              {OFFICER_ASSIGNMENT_STATUS_LABELS[holder.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-brand-label max-w-xs truncate text-xs">
                            {holder.status_note ?? "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <RecordOfficerSeparationDialog
                                assignmentId={holder.assignment_id}
                                holderName={`${holder.person.given_name} ${holder.person.family_name}`}
                                fromStatus={holder.status}
                              />
                              {position.code === "REGIONAL_REP" ||
                              position.code === "COMMITTEE_MEMBER" ? (
                                <AppointOfficerDialog
                                  positionCode={position.code}
                                  positionTitle={position.title}
                                />
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
