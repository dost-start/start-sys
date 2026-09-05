// The CRRD records desk (ADR 0012; PRD US-E5, US-E6, US-E7). Server Component through the
// caller's own client: `officer_assignments_read` (0014) is `using (true)` for every
// authenticated tier, so this page needs no special read RPC; the redirect below is UX for
// the two tiers ADR 0012 does NOT widen (mirrors app/(admin)/renewals/page.tsx's structure).
//
// Vacancy is a QUERY, not a stored status (CBL Art. VI §4, DATA_MODEL.md §3.4): a position
// with an empty `holders` array is vacant, and nothing here writes a "vacant" row anywhere.
import { Fragment } from "react";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
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

const STATUS_VARIANT: Record<
  OfficerAssignmentStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  on_leave: "secondary",
  suspended: "destructive",
  resigned: "outline",
  dismissed: "destructive",
  impeached: "destructive",
  ended: "outline",
};

export default async function OfficersPage() {
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);
  if (!RECORDS_DESK_ROLES.has(ctx.role)) redirect(homeForRole(ctx.role));

  const roster = await listOfficerRoster(ctx);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Officers</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Who holds each CBL position for the current term, and their standing under CBL Art. VI.
          Appointing or recording a separation here is a RECORD of a decision made under the
          Constitution — by the CEO or the Executive Board — not the decision itself (ADR 0012). It
          does not, by itself, grant a system account or role; that stays a separate,
          tech_admin-only step at <span className="font-medium">System &rarr; User roles</span>.
        </p>
      </header>

      {roster.term_id === null ? (
        <p className="text-muted-foreground text-sm" data-testid="officers-empty">
          No active term is open.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[48rem] text-left text-sm" data-testid="officers-table">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Position
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Holder
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Note
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {roster.positions.map((position) => {
                const isVacant = position.holders.length === 0;

                return (
                  <Fragment key={position.code}>
                    {isVacant ? (
                      <tr className="border-t">
                        <td className="px-4 py-2">
                          <div className="font-medium">{position.title}</div>
                          <div className="text-muted-foreground text-xs">{position.code}</div>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground" colSpan={3}>
                          Vacant
                        </td>
                        <td className="px-4 py-2">
                          <AppointOfficerDialog
                            positionCode={position.code}
                            positionTitle={position.title}
                          />
                        </td>
                      </tr>
                    ) : (
                      position.holders.map((holder, index) => (
                        <tr key={holder.assignment_id} className="border-t">
                          <td className="px-4 py-2">
                            {index === 0 ? (
                              <>
                                <div className="font-medium">{position.title}</div>
                                <div className="text-muted-foreground text-xs">{position.code}</div>
                              </>
                            ) : null}
                          </td>
                          <td className="px-4 py-2">
                            {holder.person.family_name}, {holder.person.given_name}
                            {holder.is_acting ? (
                              <span className="text-muted-foreground"> (acting)</span>
                            ) : null}
                            <div className="text-muted-foreground text-xs tabular-nums">
                              {holder.person.member_id ?? "—"}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant={STATUS_VARIANT[holder.status]}>
                              {OFFICER_ASSIGNMENT_STATUS_LABELS[holder.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 max-w-xs truncate text-muted-foreground text-xs">
                            {holder.status_note ?? "—"}
                          </td>
                          <td className="px-4 py-2">
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
                          </td>
                        </tr>
                      ))
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
