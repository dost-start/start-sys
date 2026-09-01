// The explicit "you cannot see this" page (BUILD_PLAN S2-T30/S2-T34,
// `lib/auth/route-access.ts`'s `UNAUTHORIZED_PATH`). Reached only by a signed-in
// account with no live `user_roles` row — an invite whose role assignment failed, or
// a revoked role. Never reached by a denied navigation between real tiers: those are
// sent HOME (`homeForRole`), not here, so this page never confirms that a
// particular admin route exists.
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Access pending — START-SYS",
};

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">No role is assigned to this account</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Your account is signed in, but no START-SYS role has been assigned to it yet. Contact a
        Technical Admin to have a role assigned — access takes effect on your next request, with no
        need to sign in again.
      </p>
      <Button asChild variant="outline">
        <a href="/login">Back to login</a>
      </Button>
    </main>
  );
}
