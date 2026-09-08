// The public Membership Renewal Form (PRD US-G7, US-H5; SRS "Membership Renewal Form";
// meeting 2026-09-05 §D). Accountless, like /apply: a returning scholar identifies
// themselves by member ID + the email on file, updates their details, uploads the two
// documents, and CRRD approves. `dynamic = "force-dynamic"`: whether the renewal period
// is open is a database fact that flips between requests. `middleware.ts` excludes
// `/renew` from its auth matcher; no login is required or checked here.
//
// Brand edition (2026-09-08; design canvas `public_page("renew")`): the same surface,
// hero, four-step card and footer as /apply. The hero is passed INTO the client form so
// the success screen can render hero-less — one <main>, one <form>.
import type { Metadata } from "next";

import type { ProgramOption, UniversityOption } from "@/components/applications/academic-section";
import type { RegionOption } from "@/components/applications/membership-section";
import { RenewalClosed } from "@/components/applications/renewal-closed";
import { BrandBackground } from "@/components/brand/brand-background";
import { BrandFooter } from "@/components/brand/brand-footer";
import { BrandHero } from "@/components/brand/brand-hero";
import { getPublicWindowState } from "@/lib/applications/queries";
import { MEMBERSHIP_RENEWAL_FORM_KIND } from "@/lib/applications/window-schema";
import { createServerSupabase } from "@/lib/supabase/server";

import { RenewalForm } from "./renewal-form";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Renew your Membership — START-DOST",
  description: "Renew your START-DOST membership for the new term.",
};

async function listRegions(): Promise<RegionOption[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("regions")
    .select("id, code, name")
    .order("sort_order", { ascending: true });
  if (error || !data) return [];
  return data;
}

async function listUniversities(): Promise<UniversityOption[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("universities")
    .select("id, name, region_id, city_municipality")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error || !data) return [];
  return data;
}

async function listPrograms(): Promise<ProgramOption[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("programs")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error || !data) return [];
  return data;
}

export default async function RenewPage() {
  const windowState = await getPublicWindowState(MEMBERSHIP_RENEWAL_FORM_KIND);

  if (!windowState.open) {
    return (
      <main className="brand-surface flex min-h-screen flex-col">
        <BrandBackground />
        <div className="flex flex-1 items-center justify-center px-4 py-16 sm:px-10">
          <RenewalClosed />
        </div>
        <BrandFooter />
      </main>
    );
  }

  const [regions, universities, programs] = await Promise.all([
    listRegions(),
    listUniversities(),
    listPrograms(),
  ]);

  return (
    <main className="brand-surface flex min-h-screen flex-col">
      <BrandBackground />
      <RenewalForm
        hero={<BrandHero ctaLabel="Renew your START membership" ctaHref="#application-form" />}
        regions={regions}
        universities={universities}
        programs={programs}
      />
      <BrandFooter />
    </main>
  );
}
