// ─────────────────────────────────────────────────────────────────────────────
// The Regional Representative's contact roster (ADR 0011). A Server Component: the rows
// come from `list_region_member_contacts()` — regional_rep only, own region(s), current
// term, acknowledgement-gated, audited per call — and are rendered once, never fetched
// from a client leaf. Columns are exactly the meeting's set (name, member ID, university,
// email, contact number, Facebook) plus status; committee and department are
// deliberately absent ("remove committee and department").
// ─────────────────────────────────────────────────────────────────────────────

import { MemberStatusBadge } from "@/components/members/member-status-badge";
import type { RegionContactRow } from "@/lib/dashboard/queries";

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
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Member ID</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">University</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Contact number</th>
            <th className="px-3 py-2 font-medium">Facebook</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const fb = safeHref(row.facebook_account);
            const tel = telHref(row.contact_number);
            return (
              <tr key={row.membership_id}>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.family_name}, {row.given_name}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{row.member_id ?? "—"}</td>
                <td className="px-3 py-2">
                  <MemberStatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2">{row.university_name ?? "—"}</td>
                <td className="px-3 py-2">
                  {row.personal_email ? (
                    <a
                      className="underline underline-offset-4"
                      href={`mailto:${row.personal_email}`}
                    >
                      {row.personal_email}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.contact_number ? (
                    tel ? (
                      <a className="underline underline-offset-4" href={tel}>
                        {row.contact_number}
                      </a>
                    ) : (
                      row.contact_number
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {fb ? (
                    <a
                      className="underline underline-offset-4"
                      href={fb}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Profile
                    </a>
                  ) : (
                    (row.facebook_account ?? "—")
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
