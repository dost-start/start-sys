// The white footer strip under the public forms (Figma [FINAL] frame): emblem, the org
// tagline, the copyright line and the contact address. Social links are deliberately
// absent until the org supplies the URLs (open item, 2026-09-08).
import { BrandLogo } from "@/components/brand/brand-logo";
import {
  ORG_CONTACT_EMAIL,
  ORG_COPYRIGHT_YEAR,
  ORG_SHORT_NAME,
  ORG_TAGLINE,
} from "@/lib/brand/org";

export function BrandFooter() {
  return (
    <footer className="bg-card text-brand-body flex flex-col gap-4 px-6 py-6 shadow-[0_-1px_0_#eff0f2] sm:flex-row sm:items-center sm:justify-between sm:px-10">
      <div className="flex items-center gap-4">
        <BrandLogo height={44} />
        <div className="space-y-0.5">
          <p className="text-brand-ink text-sm font-semibold">{ORG_TAGLINE}</p>
          <p className="text-brand-label text-xs">
            © {ORG_COPYRIGHT_YEAR} {ORG_SHORT_NAME} · All rights reserved
          </p>
        </div>
      </div>
      <a
        href={`mailto:${ORG_CONTACT_EMAIL}`}
        className="text-brand-label hover:text-brand-ink text-xs no-underline"
      >
        {ORG_CONTACT_EMAIL}
      </a>
    </footer>
  );
}
