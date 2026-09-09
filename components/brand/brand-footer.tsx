// The white footer strip under the public forms (Figma [FINAL] frame): emblem, the org
// tagline, the copyright line, the contact address and the org's social profiles.
//
// A7 (reviewer PDF 2026-09-09): the address is no longer a hardcoded mailbox on a domain
// the org does not own — it is derived from the mail environment at request time
// (`lib/brand/org-contact.ts`), so what a scholar is told to write to is what the org
// actually reads. Social links render only once `ORG_SOCIAL_LINKS` is non-empty; it is
// still empty because the org owes the exact URLs, and a guessed link on the org's own
// footer sends scholars to somebody else's page.
//
// SERVER COMPONENT ONLY. `org-contact` is `server-only` on purpose: it reads the
// environment, and a client bundle has no business doing that.
import { BrandLogo } from "@/components/brand/brand-logo";
import { ORG_COPYRIGHT_YEAR, ORG_SHORT_NAME, ORG_TAGLINE } from "@/lib/brand/org";
import { ORG_SOCIAL_LINKS, orgContactEmail } from "@/lib/brand/org-contact";

export function BrandFooter() {
  const contactEmail = orgContactEmail();

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
      <div className="flex flex-col gap-1.5 sm:items-end">
        <a
          href={`mailto:${contactEmail}`}
          className="text-brand-label hover:text-brand-ink text-xs no-underline"
        >
          {contactEmail}
        </a>
        {ORG_SOCIAL_LINKS.length > 0 ? (
          <ul className="m-0 flex list-none gap-3 p-0">
            {ORG_SOCIAL_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand-label hover:text-brand-ink text-xs no-underline"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </footer>
  );
}
