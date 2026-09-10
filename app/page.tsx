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

      {/* Logo and Wordmark Container */}
      <div className="flex flex-col items-center gap-4">
        {/* Tilted Logo */}
        <div className="rotate-6 transition-transform duration-300 hover:rotate-0">
          <BrandLogo height={200} mobileHeight={140} priority />
        </div>

        <h1 className="text-[48px] sm:text-[84px]">
          <BrandWordmark />
        </h1>
      </div>

      {/* Updated White Button with Drop Shadow */}
      <Button
        asChild
        variant="pill"
        size="pill"
        className="sm:min-w-[340px] bg-white text-slate-800 shadow-xl border border-transparent transition-all duration-300 hover:bg-gradient-to-r hover:from-[#ffdd00] hover:via-[#f4f4f4] hover:to-[#0099ff] hover:shadow-[0_0_25px_rgba(255,255,255,0.8)] hover:text-slate-900 hover:border-[var(--color-brand-white)]"
      >
        <a href="/apply">Ready for the START?</a>
      </Button>
    </main>
  );
}
