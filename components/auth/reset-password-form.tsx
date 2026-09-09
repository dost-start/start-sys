"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The new-password form (BUILD_PLAN S2-T38 / US-A4).
//
// This form is NOT the gate. It is only reachable after `/auth/reset` has re-read the
// assurance level server-side, and `updatePassword()` re-asserts it again before
// touching the credential — so submitting this form from a hand-crafted request
// changes nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updatePassword } from "@/lib/auth/reset-actions";

const CARD_CLASS = "mx-auto w-full max-w-[560px] gap-6 px-7 py-9 sm:px-14 sm:py-12";

export function ResetPasswordForm({ homePath }: { homePath: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    setFieldErrors({});

    const result = await updatePassword({ password, confirm });
    setBusy(false);

    if (result.ok) {
      setPassword("");
      setConfirm("");
      setDone(true);
      router.replace(homePath);
      router.refresh();
      return;
    }

    setFieldErrors(result.error.fields ?? {});
    setError(result.error.message);
  }

  if (done) {
    return (
      <Card radius="hero" className={CARD_CLASS}>
        <p className="text-sm" role="status">
          Your password has been changed. Redirecting…
        </p>
      </Card>
    );
  }

  return (
    <Card radius="hero" className={CARD_CLASS} aria-labelledby="reset-heading">
      <div className="flex flex-col gap-2">
        <h1 id="reset-heading" className="text-brand-ink text-2xl font-semibold">
          Set a new password
        </h1>
        <p className="text-muted-foreground text-sm">Use at least 12 characters.</p>
      </div>

      <form method="post" onSubmit={onSubmit} className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors["password"] !== undefined}
          />
          {fieldErrors["password"]?.map((message) => (
            <p key={message} className="text-destructive text-sm">
              {message}
            </p>
          ))}
        </Field>

        <Field>
          <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            aria-invalid={fieldErrors["confirm"] !== undefined}
          />
          {fieldErrors["confirm"]?.map((message) => (
            <p key={message} className="text-destructive text-sm">
              {message}
            </p>
          ))}
        </Field>

        <div className="pt-1">
          <Button type="submit" className="min-w-[220px]" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </Button>
        </div>
      </form>

      {error !== null ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
