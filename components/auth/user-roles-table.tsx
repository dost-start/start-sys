"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The tech_admin role-management grid (BUILD_PLAN S2-T40). Renders exactly what
// `user_roles` grants — `user_id`, `role`, `person_id`, `region_id` — plus the
// display-only joins the page fetched for readability. No table primitive is
// vendored yet (`components/ui/` only holds `button.tsx` as of this slice, per
// S5-T20), so this is a plain HTML `<table>` styled with Tailwind rather than a
// TanStack grid — deliberately, so this file does not fork the S5 grid work.
//
// Each row's role/region is editable inline via `assignRole`; each row has a
// `revokeRole` control. Both actions are `withRole(['tech_admin'])`-guarded
// server-side (role-actions.ts) — the disabled state here is UX only, never the
// enforcement (CONVENTIONS §0 rule "never rely on a hidden link or disabled
// button as the enforcement of a permission").
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { assignRole, revokeRole } from "@/lib/auth/role-actions";
import { ASSIGNABLE_ROLES } from "@/lib/auth/invite-schema";
import type { OrgRole } from "@/lib/auth/route-access";

export type RegionOption = { id: string; code: string; name: string };

export type UserRoleRow = {
  userId: string;
  role: OrgRole;
  personId: string | null;
  regionId: string | null;
  /** Display-only, from the `regions` join. */
  regionLabel: string | null;
  /** Display-only, from the `people` join. */
  personLabel: string | null;
};

export function UserRolesTable({
  rows,
  regions,
}: {
  rows: readonly UserRoleRow[];
  regions: readonly RegionOption[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border p-6 text-sm">
        No accounts yet. Invite the first one above.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="p-3 font-medium">Account</th>
            <th className="p-3 font-medium">Person</th>
            <th className="p-3 font-medium">Role</th>
            <th className="p-3 font-medium">Region</th>
            <th className="p-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <UserRoleRowItem key={row.userId} row={row} regions={regions} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRoleRowItem({ row, regions }: { row: UserRoleRow; regions: readonly RegionOption[] }) {
  const [role, setRole] = useState<OrgRole>(row.role);
  const [regionId, setRegionId] = useState<string>(row.regionId ?? "");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = role !== row.role || regionId !== (row.regionId ?? "");
  const needsRegion = role === "regional_rep";

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await assignRole({
        user_id: row.userId,
        role,
        region_id: needsRegion && regionId ? regionId : undefined,
        person_id: row.personId ?? undefined,
      });

      if (!result.ok) {
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      setMessage({ kind: "ok", text: "Updated." });
    });
  }

  function handleRevoke() {
    setMessage(null);
    startTransition(async () => {
      const result = await revokeRole({ user_id: row.userId });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      setRole("member");
      setRegionId("");
      setMessage({ kind: "ok", text: "Revoked — this account is now a Member." });
    });
  }

  return (
    <tr className="border-t align-top">
      <td className="p-3 font-mono text-xs">{row.userId}</td>
      <td className="p-3">{row.personLabel ?? <span className="text-muted-foreground">—</span>}</td>
      <td className="p-3">
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={role}
          disabled={isPending}
          onChange={(event) => setRole(event.target.value as OrgRole)}
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </td>
      <td className="p-3">
        {needsRegion ? (
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={regionId}
            disabled={isPending}
            onChange={(event) => setRegionId(event.target.value)}
          >
            <option value="">Select a region…</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name} ({region.code})
              </option>
            ))}
          </select>
        ) : (
          <span className="text-muted-foreground">
            {row.regionLabel ?? "— (not a Regional Representative)"}
          </span>
        )}
      </td>
      <td className="space-x-2 p-3 text-right whitespace-nowrap">
        {dirty && (
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            Save
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleRevoke}
          disabled={isPending || row.role === "member"}
        >
          Revoke
        </Button>
        {message && (
          <p
            className={
              message.kind === "error"
                ? "mt-1 text-xs text-destructive"
                : "text-muted-foreground mt-1 text-xs"
            }
          >
            {message.text}
          </p>
        )}
      </td>
    </tr>
  );
}
