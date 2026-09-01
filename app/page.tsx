// Day-1 placeholder landing page (BUILD_PLAN S1-T1 / S1-T4).
// Server Component by default — no 'use client'. Exists so Playwright has a
// target on Day 1 (S1-T9) and so the vendored Button is exercised by the
// build, not so this is the real landing page.
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">START-SYS</h1>
      <p className="max-w-md text-muted-foreground">
        Centralized Membership Information Management System for START-DOST.
      </p>
      <Button>Placeholder</Button>
    </main>
  );
}
