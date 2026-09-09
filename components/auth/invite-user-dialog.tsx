"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The invite dialog (BUILD_PLAN S2-T39/S2-T40). react-hook-form bound to
// `inviteUserSchema` — the SAME schema module `inviteUser` re-parses server-side
// (CONVENTIONS §6). Field `name`s are exactly the schema keys, which are exactly
// what the action inserts into `user_roles`.
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `user_roles`): on the
// vendored Dialog / Field / Input / NativeSelect primitives, which exist now (they did
// not when this file was written). Every id, name, option, placeholder and string is
// what it was; `register()` binds the native controls exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import type { RegionOption } from "@/components/auth/user-roles-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset();
          setServerMessage(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>Invite user</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            No public signup exists (PRD MVP item 1). Sends a one-time invite email and, on
            acceptance, grants the role selected below.
          </DialogDescription>
        </DialogHeader>

        <form method="post" className="space-y-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <Field>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input id="invite-email" type="email" {...form.register("email")} />
            {form.formState.errors.email && (
              <p className="text-destructive text-xs">{form.formState.errors.email.message}</p>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="invite-role">Role</FieldLabel>
            <NativeSelect id="invite-role" {...form.register("role")}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </NativeSelect>
            {form.formState.errors.role && (
              <p className="text-destructive text-xs">{form.formState.errors.role.message}</p>
            )}
          </Field>

          {needsRegion && (
            <Field>
              <FieldLabel htmlFor="invite-region">Region</FieldLabel>
              <NativeSelect id="invite-region" {...form.register("region_id")}>
                <option value="">Select a region…</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name} ({region.code})
                  </option>
                ))}
              </NativeSelect>
              {form.formState.errors.region_id && (
                <p className="text-destructive text-xs">
                  {form.formState.errors.region_id.message}
                </p>
              )}
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="invite-person-id">
              Person id <span className="text-brand-label font-medium normal-case">(optional)</span>
            </FieldLabel>
            <Input
              id="invite-person-id"
              type="text"
              placeholder="uuid — leave blank for a system-only account"
              className="font-mono text-xs"
              {...form.register("person_id")}
            />
            {form.formState.errors.person_id && (
              <p className="text-destructive text-xs">{form.formState.errors.person_id.message}</p>
            )}
          </Field>

          {serverMessage && (
            <p
              className={
                serverMessage.kind === "error" ? "text-destructive text-sm" : "text-success text-sm"
              }
            >
              {serverMessage.text}
            </p>
          )}

          <DialogFooter className="pt-1">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
