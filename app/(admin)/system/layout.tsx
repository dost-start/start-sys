import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/route-access";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side defence in depth for `/system*` (BUILD_PLAN S2-T34 / S2-T40).
// `middleware.ts` already refuses this path to everyone but `tech_admin`
// (`route-access.ts`'s `ADMIN_SYSTEM_PREFIX` check) — this layout exists so that
// deleting `middleware.ts` degrades UX, never confidentiality. If you find
// yourself relying on THIS check to keep a column secret, the RLS policy is
// wrong; fix the policy first (ARCHITECTURE.md §5).
// ─────────────────────────────────────────────────────────────────────────────

export default async function SystemLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();

  if (ctx === null) redirect(LOGIN_PATH);
  if (ctx.role !== "tech_admin") redirect(homeForRole(ctx.role));

  return <>{children}</>;
}
