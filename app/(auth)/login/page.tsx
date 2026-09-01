// Server Component. Reads `?next=` so a caller redirected here by `middleware.ts`
// (US-A1) lands back where they were headed after a successful sign-in.
//
// No signup link, no "create an account" copy — accounts exist only by invitation
// (BUILD_PLAN S2-T33, S2-T39). Do not add either to this page.
import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">START-SYS</h1>
          <p className="text-sm text-muted-foreground">
            Centralized Membership Information Management System for START-DOST.
          </p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
