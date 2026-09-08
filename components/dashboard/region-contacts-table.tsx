// ─────────────────────────────────────────────────────────────────────────────
// The Regional Representative's contact roster (ADR 0011). A Server Component: the rows
// come from `list_region_member_contacts()` — regional_rep only, own region(s), current
// term, acknowledgement-gated, audited per call — and are rendered once, never fetched
// from a client leaf. Columns are exactly the meeting's set (name, member ID, university,
// email, contact number, Facebook) plus status; committee and department are
// deliberately absent ("remove committee and department").
// ─────────────────────────────────────────────────────────────────────────────

import { MemberStatusBadge } from "@/components/members/member-status-badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RegionContactRow } from "@/lib/dashboard/queries";

const linkClassName = "text-brand-link underline-offset-4 hover:underline";

function safeHref(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function telHref(number: string | null): string | null {
  if (!number) return null;
  const digits = number.replace(/[^\d+]/g, "");
  return digits.length >= 10 ? `tel:${digits}` : null;
}

export function RegionContactsTable({
  rows,
  emptyMessage,
}: {
  rows: readonly RegionContactRow[];
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <Card className="border-border border border-dashed p-6 shadow-none">
        <p className="text-brand-label text-center text-sm">{emptyMessage}</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Member ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>University</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Contact number</TableHead>
            <TableHead>Facebook</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const fb = safeHref(row.facebook_account);
            const tel = telHref(row.contact_number);
            return (
              <TableRow key={row.membership_id}>
                <TableCell className="text-brand-ink font-medium">
                  {row.family_name}, {row.given_name}
                </TableCell>
                <TableCell className="font-mono text-[13px]">{row.member_id ?? "—"}</TableCell>
                <TableCell>
                  <MemberStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="whitespace-normal">{row.university_name ?? "—"}</TableCell>
                <TableCell>
                  {row.personal_email ? (
                    <a className={linkClassName} href={`mailto:${row.personal_email}`}>
                      {row.personal_email}
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {row.contact_number ? (
                    tel ? (
                      <a className={linkClassName} href={tel}>
                        {row.contact_number}
                      </a>
                    ) : (
                      row.contact_number
                    )
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {fb ? (
                    <a
                      className={linkClassName}
                      href={fb}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Profile
                    </a>
                  ) : (
                    (row.facebook_account ?? "—")
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
