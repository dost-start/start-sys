// The public membership application portal (BUILD_PLAN S3-T17; PRD US-B1, item 5).
//
// `dynamic = "force-dynamic"` + `fetchCache = "force-no-store"`: whether the window
// is open is a database fact that can flip between two requests (a CRRD admin
// closing it mid-morning), and a cached "open" render served after closing time would
// contradict `applications_insert_anon` — the page would show a form the database
// refuses. `middleware.ts` already excludes this route from its auth matcher; no
// login is required or checked here.
import type { Metadata } from "next";

import { ApplicationClosed } from "@/components/applications/application-closed";
import { getPublicWindowState } from "@/lib/applications/queries";
import { createServerSupabase } from "@/lib/supabase/server";

import { ApplicationForm } from "./application-form";
import type { RegionOption } from "@/components/applications/membership-section";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Apply for Membership — START-DOST",
  description: "Submit a START-DOST membership application.",
};

/**
 * The region dropdown's options — an ordinary anonymous read (`grant select on
 * public.regions to anon`, 0015_grants.sql), fetched server-side so no client
 * component ever needs its own Supabase client.
 */
async function listApplyRegions(): Promise<RegionOption[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("regions")
    .select("id, code, name")
    .order("sort_order", { ascending: true });

  // An empty/errored read here is not fatal to the page — MembershipSection renders
  // an explicit "regions could not be loaded" notice rather than a form nobody can
  // complete, which is better than a 500 for what is likely a transient blip.
  if (error || !data) return [];
  return data;
}

export default async function ApplyPage() {
  const windowState = await getPublicWindowState();

  if (!windowState.open) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-6">
        <ApplicationClosed window={windowState} />
      </main>
    );
  }

  const regions = await listApplyRegions();

  return (
    <main className="flex min-h-screen flex-col items-center bg-muted/30 px-4 py-10 sm:px-6">
      <div className="w-full max-w-2xl space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            START-DOST Membership Application
          </h1>
          <p className="text-sm text-muted-foreground">
            Fill in your details below — this takes about ten minutes. Have your Certificate of
            Registration or scholar ID ready to upload.
          </p>
        </header>

        <ApplicationForm regions={regions} />
      </div>
    </main>
  );
}
