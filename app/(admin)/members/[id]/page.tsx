// The member detail page (BUILD_PLAN S5-T26; PRD §3 v1.0 item 10; US-D1, US-D3, US-D5,
// US-D6, US-H1, US-H3, US-H5, US-I1, US-J1, US-J5).
//
// ⚠ MERELY RENDERING THE SENSITIVE PANEL WRITES AN AUDIT ROW — `getMemberRecord` calls
// `get_member_record()`, which inserts one `VIEW_RECORD` entry before it returns
// (DATA_MODEL.md §8.3, CBL Art. VIII §6). Do not call it more than once per render.
//
// ⚠ THE MISSING-ACKNOWLEDGEMENT DENIAL IS THE ONE DENIAL THAT RENDERS ITS OWN PANEL,
// NOT `notFound()`. It is a documented day-one failure mode (PRD US-J5;
// ARCHITECTURE.md §9 item 5) that says nothing about this scholar and everything about
// the caller, and it has a one-INSERT fix — sending a newly appointed CCDO to a plain
// 404 would hide that. Every OTHER denial renders as `notFound()`, never a distinct
// "forbidden" message (CONVENTIONS.md §4.3).
//
// Brand edition (2026-09-08): a detail page keeps a VISIBLE `<h1>` (the member's name)
// under the shell's "Members" top bar; the summary card, status row and panels follow
// docs/design/canvas/boards_admin.py `member_detail`.
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { toPsgcRegions } from "@/components/applications/psgc-address-picker";
import { MemberAuditTrail } from "@/components/members/member-audit-trail";
import { MemberEditForm } from "@/components/members/member-edit-form";
import { MemberSensitivePanel } from "@/components/members/member-sensitive-panel";
import { MemberStatusBadge } from "@/components/members/member-status-badge";
import { MemberTermHistory } from "@/components/members/member-term-history";
import { MembershipStatusEditor } from "@/components/members/membership-status-editor";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { MEMBERS_PATH } from "@/lib/members/filters";
import { getSessionContext } from "@/lib/auth/queries";
import {
  getMemberRecord,
  isMissingAcknowledgement,
  listMemberAuditTrail,
  listMemberTermHistory,
} from "@/lib/members/queries";

export const dynamic = "force-dynamic";

const backLinkClassName = "text-brand-label text-sm no-underline hover:underline";

// One cell of the summary card: the uppercase field-label style on a <dt>, the value
// on a <dd>. Not a <label> element — nothing here is a form control.
function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-brand-label text-xs leading-none font-semibold tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className="text-brand-ink text-sm">{children}</dd>
    </div>
  );
}

export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const { id } = await params;

  const result = await getMemberRecord(ctx, id);

  // Names for the two SRS choice columns (0037/0038). Public reference tables, read as
  // the caller; an id whose row is gone falls back to the raw id in the panel.
  const [universityRows, programRows, regionRows] = await Promise.all([
    ctx.supabase.from("universities").select("id, name"),
    ctx.supabase.from("programs").select("id, name"),
    // PR C2: the top of the two address cascades. Our eighteen regions with their PSA
    // codes — the picker walks down from here through `psgc_locations`.
    ctx.supabase.from("regions").select("psgc_code, name").order("sort_order", { ascending: true }),
  ]);
  const psgcRegions = regionRows.data ?? [];
  const toMap = (rows: { id: string; name: string }[] | null): Record<string, string> =>
    Object.fromEntries((rows ?? []).map((r) => [r.id, r.name]));
  const lookups = {
    universities: toMap(universityRows.data),
    programs: toMap(programRows.data),
  };

  if (!result.ok) {
    if (isMissingAcknowledgement(result.error)) {
      return (
        <div className="space-y-4">
          <a href={MEMBERS_PATH} className={backLinkClassName}>
            ← Back to members
          </a>
          <Alert variant="warning" role="alert">
            {result.error.message}
          </Alert>
        </div>
      );
    }
    notFound();
  }

  const record = result.data;

  // Term history is the current-membership source for the header — status, region,
  // year level — sorted newest-first, so `rows[0]` is the term this reader can see
  // that is closest to "now". `listMemberAuditTrail` returns `[]` for a caller whose
  // tier cannot read `audit_log` (exec_admin, tech_admin only per 0014); that is a
  // correct, silent empty answer, not an error (CONVENTIONS.md §4.3).
  const termHistory = await listMemberTermHistory(ctx, id);
  const current = termHistory[0] ?? null;

  const auditRowIds = current ? [current.membership_id] : [];
  const auditTrail = await listMemberAuditTrail(ctx, id, auditRowIds);

  // The current membership's committee and department assignments. Not part of
  // `MemberTermHistoryRow` — a small, explicit read through the caller's own client,
  // same pattern as the applicant-id lookup on the application detail page.
  let committeeNames: string[] = [];
  let departmentNames: string[] = [];
  if (current) {
    const [committees, departments] = await Promise.all([
      ctx.supabase
        .from("committee_memberships")
        .select("committees ( name )")
        .eq("membership_id", current.membership_id),
      ctx.supabase
        .from("department_assignments")
        .select("departments ( name )")
        .eq("membership_id", current.membership_id),
    ]);
    committeeNames = (committees.data ?? [])
      .map((row) => (row.committees as { name: string } | null)?.name)
      .filter((name): name is string => typeof name === "string");
    departmentNames = (departments.data ?? [])
      .map((row) => (row.departments as { name: string } | null)?.name)
      .filter((name): name is string => typeof name === "string");
  }

  const fullName = `${record.given_name} ${record.family_name}`.trim();

  return (
    <div className="space-y-5">
      <div>
        <a href={MEMBERS_PATH} className={backLinkClassName}>
          ← Back to members
        </a>
        <div className="mt-2.5 flex flex-wrap items-center gap-3.5">
          <h1 className="text-brand-ink text-[26px] leading-tight font-semibold">
            {fullName || "Member"}
          </h1>
          <span className="text-brand-label font-mono text-[13px]">{record.member_id ?? "—"}</span>
          {current ? <MemberStatusBadge status={current.status} /> : null}
        </div>
      </div>

      {current ? (
        <Card className="p-5 sm:p-6">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryItem label="Status">
              <MemberStatusBadge status={current.status} />
            </SummaryItem>
            <SummaryItem label="Region">{current.region_name}</SummaryItem>
            <SummaryItem label="Year level">{current.year_level ?? "—"}</SummaryItem>
            <SummaryItem label="Department">
              {departmentNames.length > 0 ? departmentNames.join(", ") : "—"}
            </SummaryItem>
            <SummaryItem label="Committee">
              {committeeNames.length > 0 ? committeeNames.join(", ") : "—"}
            </SummaryItem>
          </dl>
        </Card>
      ) : null}

      {current ? (
        <div className="flex items-center justify-end">
          <MembershipStatusEditor
            membershipId={current.membership_id}
            currentStatus={current.status}
            role={ctx.role}
          />
        </div>
      ) : null}

      <MemberSensitivePanel record={record} lookups={lookups} />
      <MemberEditForm record={record} regions={toPsgcRegions(psgcRegions)} />
      <MemberTermHistory memberId={record.member_id} rows={termHistory} />
      <MemberAuditTrail entries={auditTrail} />
    </div>
  );
}
