// Server Component. Reads `?next=` so a caller redirected here by `middleware.ts`
// (US-A1) lands back where they were headed after a successful sign-in.
//
// `?reason=idle` means the session was ended after an hour without activity (Officer
// feedback 2026-09-11: auto logout); the page says so above the form.
//
// No signup link, no "create an account" copy — accounts exist only by invitation
// (BUILD_PLAN S2-T33, S2-T39). Do not add either to this page.
import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { BrandBackground } from "@/components/brand/brand-background";
import { BrandLogo } from "@/components/brand/brand-logo";
import { BrandWordmark } from "@/components/brand/brand-wordmark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { IDLE_LOGOUT_REASON } from "@/lib/auth/idle";
import { ORG_SYSTEM_DESCRIPTION } from "@/lib/brand/org";

export const metadata: Metadata = {
  title: "Log in — START-SYS",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const nextRaw = params.next;
  const next = typeof nextRaw === "string" ? nextRaw : undefined;
  const loggedOutForIdle = params.reason === IDLE_LOGOUT_REASON;

  return (
    <main className="brand-surface flex min-h-screen items-center justify-center p-6 sm:p-10">
      <BrandBackground />
      <Card
        radius="hero"
        className="w-full max-w-[820px] gap-6 px-7 py-9 sm:px-[72px] sm:py-[52px]"
      >
        <div className="flex flex-col items-center gap-2.5">
          <BrandLogo height={84} priority />
          <h1 className="text-3xl sm:text-[38px]">
            <BrandWordmark />
          </h1>
          <p className="text-muted-foreground text-center text-sm">{ORG_SYSTEM_DESCRIPTION}</p>
        </div>
        {loggedOutForIdle && (
          // role="status", not "alert": e2e/fixtures/auth.ts reads the form's one alert.
          <Alert variant="info" role="status">
            <AlertDescription>
              You were logged out after 1 hour of inactivity. Log in again to continue.
            </AlertDescription>
          </Alert>
        )}
        <LoginForm next={next} />
      </Card>
    </main>
  );
}
