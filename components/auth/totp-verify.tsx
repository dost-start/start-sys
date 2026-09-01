"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The aal1 -> aal2 challenge (BUILD_PLAN S2-T36, S2-T37, S2-T38).
//
// Used in two places, and the second one is why this component exists separately from
// the enrolment screen:
//   1. `/auth/mfa/verify` — an enrolled account whose session is still aal1.
//   2. `/auth/reset` — US-A4: a privileged user must pass a second factor BEFORE a
//      new password is accepted. The reset page renders this first, with
//      `next=/auth/reset`, and then RE-READS the assurance level server-side rather
//      than trusting that this component ran.
//
// Renders no organizational data.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { verifyMfa } from "@/lib/auth/mfa-actions";
import { safeNextPath } from "@/lib/auth/safe-next";

export type TotpFactorOption = {
  id: string;
  friendlyName: string;
};

/**
 * Only a same-origin RELATIVE path is ever followed — an open redirect on the one
 * screen a user reaches from an emailed link is a phishing primitive. Delegates to
 * the ONE shared allowlist (`lib/auth/safe-next.ts`), which also rejects the
 * backslash-authority forms (`/\evil.example`) browsers resolve off-origin.
 */
function safeNext(next: string | null, fallback: string): string {
  return safeNextPath(next) ?? fallback;
}

export function TotpVerify({
  factors,
  next,
  homePath,
  heading = "Enter your authentication code",
  description = "Your session needs a second factor before it can continue.",
}: {
  factors: TotpFactorOption[];
  next: string | null;
  homePath: string;
  heading?: string;
  description?: string;
}) {
  const router = useRouter();
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    const result = await verifyMfa({ factorId, code });
    setBusy(false);

    if (result.ok) {
      // `refresh()` first so the server re-reads the now-aal2 session: the reset page
      // decides what to render from `getAuthenticatorAssuranceLevel()`, not from state.
      router.replace(safeNext(next, homePath));
      router.refresh();
      return;
    }

    setError(result.error.fields?.["code"]?.[0] ?? result.error.message);
  }

  if (factors.length === 0) {
    return (
      <section className="mx-auto w-full max-w-md space-y-3">
        <h1 className="text-xl font-semibold">No authenticator enrolled</h1>
        <p className="text-muted-foreground text-sm">
          This account has no second factor yet. Set one up before continuing.
        </p>
        <Button type="button" onClick={() => router.replace("/auth/mfa/enroll")}>
          Set up two-factor authentication
        </Button>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6" aria-labelledby="verify-heading">
      <div className="space-y-2">
        <h1 id="verify-heading" className="text-xl font-semibold">
          {heading}
        </h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        {factors.length > 1 ? (
          <>
            <label htmlFor="factor" className="block text-sm font-medium">
              Authenticator
            </label>
            <select
              id="factor"
              name="factor"
              value={factorId}
              onChange={(event) => setFactorId(event.target.value)}
              className="border-input h-9 w-full rounded-md border px-3 text-sm"
            >
              {factors.map((factor) => (
                <option key={factor.id} value={factor.id}>
                  {factor.friendlyName}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <label htmlFor="code" className="block text-sm font-medium">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-invalid={error !== null}
          className="border-input h-9 w-40 rounded-md border px-3 font-mono text-sm"
        />

        <Button type="submit" disabled={busy}>
          {busy ? "Verifying…" : "Verify"}
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
