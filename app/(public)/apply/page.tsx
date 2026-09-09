// The public membership application portal (BUILD_PLAN S3-T17; PRD US-B1, item 5).
//
// `dynamic = "force-dynamic"` + `fetchCache = "force-no-store"`: whether the window
// is open is a database fact that can flip between two requests (a CRRD admin
// closing it mid-morning), and a cached "open" render served after closing time would
// contradict `applications_insert_anon` — the page would show a form the database
// refuses. `middleware.ts` already excludes this route from its auth matcher; no
// login is required or checked here.
//
// Brand edition (2026-09-08; design canvas `public_page("apply")`): the brand surface,
// the emblem + wordmark hero with one pill that scrolls to the form card, the four-step
// card, and the footer strip. The hero is passed INTO the client form so the success
// screen can render hero-less, as the canvas draws it — one <main>, one <form>.
import type { Metadata } from "next";

import { ApplicationClosed } from "@/components/applications/application-closed";
import { BrandBackground } from "@/components/brand/brand-background";
import { BrandFooter } from "@/components/brand/brand-footer";
import { BrandHero } from "@/components/brand/brand-hero";
import { orgContactEmail } from "@/lib/brand/org-contact";
import { getPublicWindowState } from "@/lib/applications/queries";
import { cachedReference } from "@/lib/applications/reference-cache";
import { createServerSupabase } from "@/lib/supabase/server";

import { ApplicationForm } from "./application-form";
import type { RegionOption } from "@/components/applications/membership-section";
import type { ProgramOption, UniversityOption } from "@/components/applications/academic-section";

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
  // PR E: memoised per process for REFERENCE_TTL_MS. Reference rows change only in a
  // migration; the window state above is deliberately NOT cached.
  return cachedReference<RegionOption>("regions", async () => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("regions")
      .select("id, code, name, psgc_code")
      .order("sort_order", { ascending: true });

    // An empty/errored read here is not fatal to the page — MembershipSection renders
    // an explicit "regions could not be loaded" notice rather than a form nobody can
    // complete, which is better than a 500 for what is likely a transient blip.
    if (error || !data) return [];
    return data;
  });
}

/**
 * The two SRS choice lists (0037), read as anon — both tables grant SELECT to anon so the
 * public form can render before anyone signs in. Inactive rows are hidden from new
 * applicants but stay readable by reviewers.
 */
async function listApplyUniversities(): Promise<UniversityOption[]> {
  // PR E: memoised per process for REFERENCE_TTL_MS. Reference rows change only in a
  // migration; the window state above is deliberately NOT cached.
  return cachedReference<UniversityOption>("universities", async () => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("universities")
      .select("id, name, region_id, city_municipality")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error || !data) return [];
    return data;
  });
}

async function listApplyPrograms(): Promise<ProgramOption[]> {
  // PR E: memoised per process for REFERENCE_TTL_MS. Reference rows change only in a
  // migration; the window state above is deliberately NOT cached.
  return cachedReference<ProgramOption>("programs", async () => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("programs")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error || !data) return [];
    return data;
  });
}

export default async function ApplyPage() {
  const windowState = await getPublicWindowState();
  // A7: one resolution, both branches. `org-contact` is server-only, so this is the
  // boundary where the address stops being an environment read and becomes a prop.
  const contactEmail = orgContactEmail();

  if (!windowState.open) {
    return (
      <main className="brand-surface flex min-h-screen flex-col">
        <BrandBackground />
        <div className="flex flex-1 items-center justify-center px-4 py-16 sm:px-10">
          <ApplicationClosed window={windowState} contactEmail={contactEmail} />
        </div>
        <BrandFooter />
      </main>
    );
  }

  const [regions, universities, programs] = await Promise.all([
    listApplyRegions(),
    listApplyUniversities(),
    listApplyPrograms(),
  ]);

  return (
    <main className="brand-surface flex min-h-screen flex-col">
      <BrandBackground />
      <ApplicationForm
        hero={
          <BrandHero ctaLabel="Become part of the START Community" ctaHref="#application-form" />
        }
        regions={regions}
        universities={universities}
        programs={programs}
        contactEmail={contactEmail}
      />
      <BrandFooter />
    </main>
  );
}
