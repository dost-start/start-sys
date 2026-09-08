// The public-form hero from the Figma [FINAL] Membership Application frame: emblem,
// wordmark and one pill that scrolls to the form card. Pure markup — the anchor scroll
// needs no JavaScript (globals.css sets `scroll-behavior: smooth` on html).
import { BrandLogo } from "@/components/brand/brand-logo";
import { BrandWordmark } from "@/components/brand/brand-wordmark";
import { Button } from "@/components/ui/button";

export function BrandHero({ ctaLabel, ctaHref }: { ctaLabel: string; ctaHref: string }) {
  return (
    <div className="flex flex-col items-center gap-6 px-5 pt-14 pb-10 sm:gap-7 sm:pt-18 sm:pb-14">
      <BrandLogo height={150} mobileHeight={120} priority />
      <p className="text-[44px] sm:text-[64px]">
        <BrandWordmark />
      </p>
      <Button asChild variant="pill" size="pill">
        <a href={ctaHref}>
          {ctaLabel} <span aria-hidden="true">→</span>
        </a>
      </Button>
    </div>
  );
}
