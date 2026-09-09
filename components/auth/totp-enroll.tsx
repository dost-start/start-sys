"use client";

// ─────────────────────────────────────────────────────────────────────────────
// TOTP enrolment screen (BUILD_PLAN S2-T36 / US-A3).
//
// Renders NO organizational data at any stage. An officer who has not enrolled sees
// this screen and an empty system — that is the requirement, not a side effect.
//
// The recovery codes live in component state and nowhere else. There is no route that
// re-renders them, no query that returns them, and navigating away loses them: the
// database stores only a salted digest. That is why the "I have saved these" step is
// an explicit, blocking confirmation rather than a toast. "Copy codes" and "Download"
// hand the same ten strings to the clipboard or to a local text file — they never
// leave the browser and are never logged.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { BrandLogo } from "@/components/brand/brand-logo";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { enrollTotp, verifyEnrolment, type TotpEnrolment } from "@/lib/auth/mfa-actions";

type Stage =
  | { kind: "starting" }
  | { kind: "scan"; enrolment: TotpEnrolment }
  | { kind: "codes"; codes: string[] };

type CopyTarget = "secret" | "codes";
type CopyState = { target: CopyTarget; ok: boolean };

const CARD_CLASS = "mx-auto w-full max-w-[900px] gap-7 px-7 py-9 sm:px-14 sm:py-12";

// The submit button sits in a row beside the sign-out control, which is itself a
// <form> (a Server Action) — so the button is associated by `form=` rather than
// nested, because a form inside a form is not valid HTML.
const FORM_ID = "totp-enroll-form";

const RECOVERY_CODES_FILENAME = "start-sys-recovery-codes.txt";

/** How long "Copied" / "Could not copy" stays on a button before it reads "Copy" again. */
const COPY_FEEDBACK_MS = 2000;

/** The card's header: emblem beside the stage's heading and one-line intro. */
function CardHeading({ id, title, intro }: { id: string; title: string; intro: string }) {
  return (
    <div className="flex items-center gap-4">
      <BrandLogo height={44} />
      <div className="flex flex-col gap-1">
        <h1 id={id} className="text-brand-ink text-2xl font-semibold">
          {title}
        </h1>
        <p className="text-muted-foreground text-sm">{intro}</p>
      </div>
    </div>
  );
}

/** One numbered step of the scan stage: a gradient disc, a bold title, then the body. */
function NumberedStep({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <span
        aria-hidden="true"
        className="bg-brand-gradient text-brand-ink grid size-[30px] shrink-0 place-items-center rounded-full text-sm font-bold"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-brand-ink font-semibold">
          <span className="sr-only">Step {number}: </span>
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

function downloadRecoveryCodes(codes: string[]) {
  const blob = new Blob([`${codes.join("\n")}\n`], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = RECOVERY_CODES_FILENAME;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function TotpEnroll({
  homePath,
  signOut,
}: {
  homePath: string;
  /** The sign-out control, rendered by the page (a Server Component) and passed in. */
  signOut?: ReactNode;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "starting" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copyState, setCopyState] = useState<CopyState | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React 19 StrictMode double-invokes effects in development. Without this ref the
  // second invocation enrolls a second factor, and the QR on screen is then the one
  // that was just unenrolled — a genuinely confusing failure.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const result = await enrollTotp();
      if (result.ok) {
        setStage({ kind: "scan", enrolment: result.data });
      } else {
        setError(result.error.message);
      }
    })();
  }, []);

  // A pending "Copied" reset must not fire on an unmounted component.
  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    };
  }, []);

  async function copyToClipboard(target: CopyTarget, text: string) {
    // The Clipboard API is absent on http:// origins and in some embedded browsers.
    // Nothing to do then except say so — the value stays readable on screen.
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    let ok = false;
    if (clipboard !== undefined && typeof clipboard.writeText === "function") {
      try {
        await clipboard.writeText(text);
        ok = true;
      } catch {
        // A refused write (permissions, focus lost) is reported on the button below
        // rather than thrown: the user can still copy by hand.
        ok = false;
      }
    }
    setCopyState({ target, ok });
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState(null), COPY_FEEDBACK_MS);
  }

  function copyLabel(target: CopyTarget, idle: string): string {
    if (copyState === null || copyState.target !== target) return idle;
    return copyState.ok ? "Copied" : "Could not copy";
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage.kind !== "scan" || busy) return;

    setBusy(true);
    setError(null);

    const result = await verifyEnrolment({ factorId: stage.enrolment.factorId, code });
    setBusy(false);

    if (result.ok) {
      setCode("");
      setStage({ kind: "codes", codes: result.data });
      return;
    }

    // Server field errors are attached to their input, never dropped into a toast
    // (CONVENTIONS §6).
    setError(result.error.fields?.["code"]?.[0] ?? result.error.message);
  }

  if (stage.kind === "codes") {
    return (
      <Card radius="hero" className={CARD_CLASS} aria-labelledby="codes-heading">
        <CardHeading
          id="codes-heading"
          title="Save your recovery codes"
          intro="These ten codes are shown once. Keep them somewhere safe and offline."
        />

        <ul className="bg-brand-field rounded-form text-brand-ink grid grid-cols-2 gap-x-8 gap-y-2.5 p-5 font-mono text-base tracking-wider">
          {stage.codes.map((recoveryCode) => (
            <li key={recoveryCode}>{recoveryCode}</li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copyToClipboard("codes", stage.codes.join("\n"))}
          >
            {copyLabel("codes", "Copy codes")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => downloadRecoveryCodes(stage.codes)}
          >
            Download
          </Button>
        </div>

        <Alert variant="warning" role="status">
          Each code works once. If you lose your phone, one of these codes is the only way back in.
        </Alert>

        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          <span>
            I have saved these codes somewhere I can reach without this device. I understand they
            will not be shown again.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="button"
            className="min-w-[200px]"
            disabled={!saved}
            onClick={() => {
              router.replace(homePath);
              router.refresh();
            }}
          >
            Continue
          </Button>
          {signOut}
        </div>
      </Card>
    );
  }

  return (
    <Card radius="hero" className={CARD_CLASS} aria-labelledby="enroll-heading">
      <CardHeading
        id="enroll-heading"
        title="Set up two-factor authentication"
        intro="Officer accounts need a second step at sign-in. This takes about a minute."
      />

      {stage.kind === "starting" ? (
        <p className="text-muted-foreground text-sm" role="status">
          Preparing your enrolment…
        </p>
      ) : (
        <div className="grid gap-10 sm:grid-cols-[260px_1fr] sm:items-start">
          <div className="flex flex-col items-center gap-3">
            {/*
              GoTrue returns the QR either as a data URI (`data:image/svg+xml;utf-8,…` —
              what the hosted auth server sends) or as a bare SVG document string. The
              data-URI shape must go through an <img>: injected as HTML, its prefix
              renders as literal text above the code. Both shapes come from the auth
              server for the caller's own factor — not remote markup and not user
              input — so no QR dependency is needed either way.
            */}
            <div className="border-border shadow-soft rounded-2xl border bg-white p-4">
              {stage.enrolment.qrCode.startsWith("data:") ? (
                // A plain <img> on purpose: the src is a data URI, not a network asset,
                // so next/image's loader/optimizer adds nothing here.
                <img src={stage.enrolment.qrCode} alt="Two-factor QR code" className="size-52" />
              ) : (
                <div
                  className="size-52 [&_svg]:size-52"
                  aria-label="Two-factor QR code"
                  dangerouslySetInnerHTML={{ __html: stage.enrolment.qrCode }}
                />
              )}
            </div>
            <p className="text-muted-foreground text-center text-sm">
              Scan with your authenticator app
            </p>
          </div>

          <div className="flex flex-col gap-6">
            <NumberedStep number={1} title="Install an authenticator app">
              <p className="text-muted-foreground text-sm">
                Google Authenticator, Authy or 1Password all work. Any app that shows 6-digit codes
                is fine.
              </p>
            </NumberedStep>

            <NumberedStep number={2} title="Scan the code, or type the key">
              <div className="flex items-center gap-2.5">
                <p className="bg-brand-field text-brand-ink min-w-0 flex-1 rounded-lg px-3 py-2.5 font-mono text-sm tracking-wider break-all">
                  {stage.enrolment.secret}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyToClipboard("secret", stage.enrolment.secret)}
                >
                  {copyLabel("secret", "Copy")}
                </Button>
              </div>
            </NumberedStep>

            <NumberedStep number={3} title="Enter the code the app shows">
              <form method="post" id={FORM_ID} onSubmit={onVerify}>
                <Field>
                  <FieldLabel htmlFor="code">Enter the 6-digit code from your app</FieldLabel>
                  <Input
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    aria-invalid={error !== null}
                    className="h-13 w-56 text-center font-mono text-2xl tracking-[0.3em]"
                  />
                </Field>
              </form>
            </NumberedStep>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <Button type="submit" form={FORM_ID} className="min-w-[240px]" disabled={busy}>
                {busy ? "Verifying…" : "Verify and continue"}
              </Button>
              {signOut}
            </div>
          </div>
        </div>
      )}

      {error !== null ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
