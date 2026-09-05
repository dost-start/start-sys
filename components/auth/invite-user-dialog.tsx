"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The invite dialog (BUILD_PLAN S2-T39/S2-T40). react-hook-form bound to
// `inviteUserSchema` — the SAME schema module `inviteUser` re-parses server-side
// (CONVENTIONS §6). Field `name`s are exactly the schema keys, which are exactly
// what the action inserts into `user_roles`.
//
// Uses `@radix-ui/react-dialog` directly (already a pinned dependency — see
// package.json) rather than a vendored `components/ui/dialog.tsx`, which does
// not exist yet as of this slice (only `button.tsx` is vendored; S5-T20 is where
// the rest of the shadcn primitives land). This file does not create that
// vendored wrapper — out of lane.
// ─────────────────────────────────────────────────────────────────────────────

import * as Dialog from "@radix-ui/react-dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import type { RegionOption } from "@/components/auth/user-roles-table";
import { inviteUser } from "@/lib/auth/invite-actions";
import { ASSIGNABLE_ROLES, inviteUserSchema, type InviteUserInput } from "@/lib/auth/invite-schema";

export function InviteUserDialog({ regions }: { regions: readonly RegionOption[] }) {
  const [open, setOpen] = useState(false);
  const [serverMessage, setServerMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const form = useForm<z.input<typeof inviteUserSchema>, unknown, InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: "", role: "officer", region_id: undefined, person_id: undefined },
  });

  const role = form.watch("role");
  const needsRegion = role === "regional_rep";

  async function onSubmit(values: InviteUserInput) {
    setServerMessage(null);

    const result = await inviteUser(values);

    if (!result.ok) {
      // Field-level errors (a duplicate email, say) go into RHF via setError —
      // never dropped into a generic toast (CONVENTIONS §6).
      if (result.error.fields) {
        for (const [field, messages] of Object.entries(result.error.fields)) {
          form.setError(field as keyof InviteUserInput, { message: messages[0] });
        }
      }
      setServerMessage({ kind: "error", text: result.error.message });
      return;
    }

    setServerMessage({ kind: "ok", text: `Invitation sent (account ${result.data.userId}).` });
    form.reset({ email: "", role: "officer", region_id: undefined, person_id: undefined });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset();
          setServerMessage(null);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button>Invite user</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <Dialog.Title className="text-lg font-semibold">Invite user</Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-1 text-sm">
            No public signup exists (PRD MVP item 1). Sends a one-time invite email and, on
            acceptance, grants the role selected below.
          </Dialog.Description>

          <form className="mt-4 space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="invite-email">
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="invite-role">
                Role
              </label>
              <select
                id="invite-role"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                {...form.register("role")}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {form.formState.errors.role && (
                <p className="text-xs text-destructive">{form.formState.errors.role.message}</p>
              )}
            </div>

            {needsRegion && (
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="invite-region">
                  Region
                </label>
                <select
                  id="invite-region"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  {...form.register("region_id")}
                >
                  <option value="">Select a region…</option>
                  {regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name} ({region.code})
                    </option>
                  ))}
                </select>
                {form.formState.errors.region_id && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.region_id.message}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="invite-person-id">
                Person id <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                id="invite-person-id"
                type="text"
                placeholder="uuid — leave blank for a system-only account"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                {...form.register("person_id")}
              />
              {form.formState.errors.person_id && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.person_id.message}
                </p>
              )}
            </div>

            {serverMessage && (
              <p
                className={
                  serverMessage.kind === "error"
                    ? "text-sm text-destructive"
                    : "text-muted-foreground text-sm"
                }
              >
                {serverMessage.text}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Sending…" : "Send invite"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
