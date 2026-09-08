// The explicit "you cannot see this" page (BUILD_PLAN S2-T30/S2-T34,
// `lib/auth/route-access.ts`'s `UNAUTHORIZED_PATH`). Reached only by a signed-in
// account with no live `user_roles` row — an invite whose role assignment failed, or
// a revoked role. Never reached by a denied navigation between real tiers: those are
// sent HOME (`homeForRole`), not here, so this page never confirms that a
// particular admin route exists.
import type { Metadata } from "next";
import { LockIcon } from "lucide-react";

import { BrandBackground } from "@/components/brand/brand-background";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Access pending — START-SYS",
};

export default function UnauthorizedPage() {
  return (
    <main className="brand-surface flex min-h-screen items-center justify-center p-6 sm:p-10">
      <BrandBackground />
      <Card
        radius="hero"
        className="w-full max-w-[600px] items-center gap-4 px-7 py-9 text-center sm:px-14 sm:py-[52px]"
      >
        <span
          aria-hidden="true"
          className="bg-brand-field text-brand-label grid size-[52px] place-items-center rounded-full"
        >
          <LockIcon className="size-6" />
        </span>
        <h1 className="text-brand-ink text-2xl font-semibold tracking-tight">
          No role is assigned to this account
        </h1>
        <p className="text-muted-foreground max-w-md text-sm">
          Your account is signed in, but no START-SYS role has been assigned to it yet. Contact a
          Technical Admin to have a role assigned — access takes effect on your next request, with
          no need to sign in again.
        </p>
        <Button asChild variant="outline">
          <a href="/login">Back to login</a>
        </Button>
      </Card>
    </main>
  );
}
