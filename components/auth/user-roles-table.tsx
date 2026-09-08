"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The tech_admin role-management grid (BUILD_PLAN S2-T40). Renders exactly what
// `user_roles` grants — `user_id`, `role`, `person_id`, `region_id` — plus the
// display-only joins the page fetched for readability. Deliberately NOT a TanStack
// grid — the vendored Table primitives are enough for a list this size, and this
// file must not fork the S5 grid work.
//
// Each row's role/region is editable inline via `assignRole`; each row has a
// `revokeRole` control. Both actions are `withRole(['tech_admin'])`-guarded
// server-side (role-actions.ts) — the disabled state here is UX only, never the
// enforcement (CONVENTIONS §0 rule "never rely on a hidden link or disabled
// button as the enforcement of a permission").
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `user_roles`): the
// vendored Card / Table / NativeSelect primitives. Option order, every string and every
// `value` are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
      <Card className="border-border border border-dashed p-6 shadow-none">
        <p className="text-brand-label text-sm">No accounts yet. Invite the first one above.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Person</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Region</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <UserRoleRowItem key={row.userId} row={row} regions={regions} />
          ))}
        </TableBody>
      </Table>
    </Card>
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
    <TableRow className="align-top">
      <TableCell className="font-mono text-xs">{row.userId}</TableCell>
      <TableCell>{row.personLabel ?? <span className="text-brand-label">—</span>}</TableCell>
      <TableCell>
        <NativeSelect
          className="h-9 text-[13px]"
          wrapperClassName="w-44"
          value={role}
          disabled={isPending}
          onChange={(event) => setRole(event.target.value as OrgRole)}
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </NativeSelect>
      </TableCell>
      <TableCell>
        {needsRegion ? (
          <NativeSelect
            className="h-9 text-[13px]"
            wrapperClassName="w-60"
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
          </NativeSelect>
        ) : (
          <span className="text-brand-label">
            {row.regionLabel ?? "— (not a Regional Representative)"}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex justify-end gap-2">
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
          </div>
          {message && (
            <p
              className={
                message.kind === "error" ? "text-destructive text-xs" : "text-success text-xs"
              }
            >
              {message.text}
            </p>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
