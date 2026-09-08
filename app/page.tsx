// The public splash at `/` (brand restyle, 2026-09-08): emblem, wordmark, the
// application call-to-action and the officer sign-in link. Reachable anonymously since
// the middleware change of 2026-09-08 excluded `/` from the auth matcher. Renders no
// organizational data and calls no Server Action — nothing here needs RLS reasoning.
//
// Server Component by default. e2e/smoke.spec.ts pins `heading "START-SYS"`: the <h1>
// wraps the wordmark <span>, so its accessible name is exactly the wordmark's text.
import { BrandBackground } from "@/components/brand/brand-background";
import { BrandLogo } from "@/components/brand/brand-logo";
import { BrandWordmark } from "@/components/brand/brand-wordmark";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="brand-surface flex min-h-screen flex-col items-center justify-center gap-7 p-6 sm:gap-9">
      <BrandBackground />
      <BrandLogo height={200} mobileHeight={140} priority />
      <h1 className="text-[48px] sm:text-[84px]">
        <BrandWordmark />
      </h1>
      <Button asChild variant="pill" size="pill" className="sm:min-w-[440px]">
        <a href="/apply">Ready for the START?</a>
      </Button>
      <a href="/login" className="text-brand-body text-sm no-underline hover:underline">
        Officer sign in <span aria-hidden="true">→</span>
      </a>
    </main>
  );
}
