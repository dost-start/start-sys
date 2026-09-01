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
import { updatePassword } from "@/lib/auth/reset-actions";

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
      <p className="text-sm" role="status">
        Your password has been changed. Redirecting…
      </p>
    );
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6" aria-labelledby="reset-heading">
      <div className="space-y-2">
        <h1 id="reset-heading" className="text-xl font-semibold">
          Set a new password
        </h1>
        <p className="text-muted-foreground text-sm">Use at least 12 characters.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors["password"] !== undefined}
            className="border-input h-9 w-full rounded-md border px-3 text-sm"
          />
          {fieldErrors["password"]?.map((message) => (
            <p key={message} className="text-destructive text-sm">
              {message}
            </p>
          ))}
        </div>

        <div className="space-y-1">
          <label htmlFor="confirm" className="block text-sm font-medium">
            Confirm new password
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            aria-invalid={fieldErrors["confirm"] !== undefined}
            className="border-input h-9 w-full rounded-md border px-3 text-sm"
          />
          {fieldErrors["confirm"]?.map((message) => (
            <p key={message} className="text-destructive text-sm">
              {message}
            </p>
          ))}
        </div>

        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>

      {error !== null ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
