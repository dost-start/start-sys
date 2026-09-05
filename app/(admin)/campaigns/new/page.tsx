// ─────────────────────────────────────────────────────────────────────────────
// `/campaigns/new` — the composer (PRD US-G1, US-G2, US-G3).
//
// The Server Component loads the choice lists behind the five filter axes (reference
// tables — a region, an affiliation, a position; nothing personal) and the site origin
// the form templates link to, then hands both to the client composer. The live count
// and the save go back through Server Actions that re-check the role and re-parse the
// schema; RLS refuses anyone else regardless.
// ─────────────────────────────────────────────────────────────────────────────
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CampaignComposer } from "@/components/campaigns/campaign-composer";
import { getSessionContext } from "@/lib/auth/queries";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/route-access";
import { listAudienceOptions } from "@/lib/campaigns/queries";
import { mailTransportName } from "@/lib/mail";
import { canSendCampaigns } from "@/lib/campaigns/roles";

export const dynamic = "force-dynamic";

/**
 * The origin the three form templates link to, from the request itself — so a preview
 * deployment links to its own `/apply`, and production to production's. Never from a
 * client-supplied value.
 */
async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const proto =
    requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function NewCampaignPage() {
  const ctx = await getSessionContext();
  if (ctx === null) redirect(LOGIN_PATH);
  if (!canSendCampaigns(ctx.role)) redirect(homeForRole(ctx.role));

  const [options, origin] = await Promise.all([listAudienceOptions(ctx), requestOrigin()]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Write the message once; each recipient gets it with their own name and details merged in.
          Messages go out through <code>{mailTransportName()}</code>.
        </p>
      </header>
      <CampaignComposer options={options} origin={origin} />
    </div>
  );
}
