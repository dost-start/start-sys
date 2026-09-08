import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth/queries";

// ─────────────────────────────────────────────────────────────────────────────
// The tech_admin system index (BUILD_PLAN S2-T40). `/system` is served by
// `app/(admin)/system/page.tsx` — the parenthesised group is URL-invisible
// (route-access.ts). Guarded by `layout.tsx` in this directory (defence in
// depth) and by `middleware.ts` (the actual redirect a real user hits).
//
// Term/application-window management lives at `/applications/window` (BUILD_PLAN
// S4-T24, not yet built as of this slice) — linked here rather than duplicated.
//
// Brand restyle (2026-09-08, docs/design/canvas/boards_admin.py `system`): the app shell
// already renders the one <main>, so this page is a plain <div>; the page title lives in
// the shell's top bar, so the <h1> here is screen-reader-only.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

/** The design canvas's `.label`, for the four term facts. */
const TERM_LABEL_CLASS = "text-brand-label text-xs font-semibold tracking-[0.08em] uppercase";

/** A whole Card as a link — the two navigation tiles. */
const NAV_CARD_CLASS =
  "bg-card rounded-form shadow-soft flex flex-col gap-1.5 p-5 no-underline transition-[filter] hover:brightness-[0.98] focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none sm:p-6";

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
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="sr-only">System</h1>
        <p className="text-brand-body max-w-3xl text-sm">
          Configuration and access control — reserved to the Technical Admin (CBL Art. III §2.3; PRD
          §2 &quot;configure the system and control access&quot;).
        </p>
      </header>

      <Card className="gap-4 p-5 sm:p-6">
        <CardTitle>Current term</CardTitle>
        {activeTerm ? (
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <dt className={TERM_LABEL_CLASS}>Label</dt>
              <dd className="text-brand-ink font-medium">{activeTerm.label}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className={TERM_LABEL_CLASS}>Starts</dt>
              <dd className="text-brand-ink font-medium">{activeTerm.starts_on}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className={TERM_LABEL_CLASS}>Ends</dt>
              <dd className="text-brand-ink font-medium">{activeTerm.ends_on}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className={TERM_LABEL_CLASS}>Status</dt>
              <dd className="text-brand-ink font-medium uppercase">{activeTerm.status}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-brand-label text-sm">
            No active term. `one_active_term` should make this state unreachable — treat it as an
            incident, not a normal empty state.
          </p>
        )}
      </Card>

      <nav className="grid gap-4 sm:grid-cols-2">
        <Link href="/system/user-roles" className={NAV_CARD_CLASS}>
          <span className="text-brand-ink text-lg leading-tight font-semibold">User roles</span>
          <p className="text-brand-label text-sm">
            Invite accounts and assign or revoke the seven access tiers (US-E3).
          </p>
        </Link>

        <Link href="/applications/window" className={NAV_CARD_CLASS}>
          <span className="text-brand-ink text-lg leading-tight font-semibold">
            Application windows
          </span>
          <p className="text-brand-label text-sm">
            Open or close the application period (US-B4). Managed on the Applications surface —
            crrd_admin and tech_admin per ADR 0003.
          </p>
        </Link>
      </nav>
    </div>
  );
}
