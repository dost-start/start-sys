import Link from "next/link";

import { getSessionContext } from "@/lib/auth/queries";

// ─────────────────────────────────────────────────────────────────────────────
// The tech_admin system index (BUILD_PLAN S2-T40). `/system` is served by
// `app/(admin)/system/page.tsx` — the parenthesised group is URL-invisible
// (route-access.ts). Guarded by `layout.tsx` in this directory (defence in
// depth) and by `middleware.ts` (the actual redirect a real user hits).
//
// Term/application-window management lives at `/applications/window` (BUILD_PLAN
// S4-T24, not yet built as of this slice) — linked here rather than duplicated.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function SystemIndexPage() {
  // Guaranteed non-null and tech_admin by the layout above; re-resolved here
  // rather than threaded through props, matching every other Server Component
  // page in this codebase.
  const ctx = await getSessionContext();

  const { data: activeTerm } = ctx
    ? await ctx.supabase
        .from("terms")
        .select("id, label, starts_on, ends_on, status")
        .eq("status", "active")
        .maybeSingle()
    : { data: null };

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">System</h1>
        <p className="text-muted-foreground text-sm">
          Configuration and access control — reserved to the Technical Admin (CBL Art. III §2.3; PRD
          §2 &quot;configure the system and control access&quot;).
        </p>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">Current term</h2>
        {activeTerm ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-muted-foreground">Label</dt>
            <dd className="col-span-1 sm:col-span-3">{activeTerm.label}</dd>
            <dt className="text-muted-foreground">Starts</dt>
            <dd>{activeTerm.starts_on}</dd>
            <dt className="text-muted-foreground">Ends</dt>
            <dd>{activeTerm.ends_on}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="uppercase">{activeTerm.status}</dd>
          </dl>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">
            No active term. `one_active_term` should make this state unreachable — treat it as an
            incident, not a normal empty state.
          </p>
        )}
      </section>

      <nav className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/system/user-roles"
          className="rounded-lg border p-4 text-sm font-medium transition-colors hover:bg-accent"
        >
          User roles
          <p className="text-muted-foreground mt-1 font-normal">
            Invite accounts and assign or revoke the seven access tiers (US-E3).
          </p>
        </Link>

        <Link
          href="/applications/window"
          className="rounded-lg border p-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
        >
          Application windows
          <p className="mt-1 font-normal">
            Open or close the application period (US-B4). Managed on the Applications surface —
            crrd_admin and tech_admin per ADR 0003.
          </p>
        </Link>
      </nav>
    </main>
  );
}
