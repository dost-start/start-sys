// ─────────────────────────────────────────────────────────────────────────────
// The org's PUBLIC contact block: the address a scholar writes to, and the social
// profiles the footer links.
//
// FINDING A7 (reviewer PDF 2026-09-09, p1): every public surface — the footer, the
// closed-window screens, the success screen and the privacy notice — printed
// `crrd@start-dost.org`, and START-DOST does not own `start-dost.org` (PRD OQ-10 is
// still open). An address on a domain nobody owns is worse than no address: mail to it
// does not bounce back to the sender in any useful way, it simply never arrives, and an
// applicant who needs a birthdate corrected concludes the org ignored them.
//
// WHY THIS IS DERIVED FROM THE MAIL ENVIRONMENT RATHER THAN A NEW CONSTANT: the org
// already runs outbound mail from a real, org-held Gmail account (ADR 0010) — that
// address is configured, monitored, and is where a reply to any system email already
// lands. Deriving the contact address from it means the address a scholar is TOLD to
// write to is the same address the org actually reads, by construction, and nobody has
// to remember to keep two settings in step. It also means this fixes itself the moment
// the org moves to a domain: `MAIL_REPLY_TO` changes, and every public page follows.
//
// ⚠ WHY THIS READS `process.env` DIRECTLY INSTEAD OF `getServerEnv()`: that accessor
// parses the WHOLE server schema and throws naming every missing required key, which is
// exactly right at the moment a request needs a service-role key — and exactly wrong
// here. `/privacy` and the closed-window screens must render on a deployment that has
// no mail configured at all, and a build must never require a production credential
// (BUILD_PLAN S7-T2). Both keys read below are declared in `.env.example`, so S1-T24's
// env-coverage grep still covers them, and neither is a secret.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

/**
 * The last-resort address, used only when no mail transport is configured — a local
 * dev box, or a preview with an empty environment.
 *
 * Deliberately NOT the old `crrd@start-dost.org`: `example.invalid` cannot be
 * mistaken for a real mailbox by a reviewer looking at a screenshot, and `.invalid`
 * is reserved by RFC 2606 precisely so it can never resolve. If this string ever
 * reaches production, the environment is misconfigured and it should look like it.
 */
const UNCONFIGURED_CONTACT_EMAIL = "contact-not-configured@start-dost.example.invalid";

/** A very loose shape check. Not validation — a guard against a blank or a stray name. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The address public pages tell people to write to.
 *
 * `MAIL_REPLY_TO` first, because that is the address the org has explicitly chosen for
 * replies; `GMAIL_SMTP_USER` second, because with no reply-to set that is where replies
 * to system mail already go (`lib/mail/gmail-smtp-transport.ts`).
 */
export function orgContactEmail(): string {
  for (const candidate of [process.env.MAIL_REPLY_TO, process.env.GMAIL_SMTP_USER]) {
    const value = (candidate ?? "").trim();
    if (value !== "" && LOOKS_LIKE_EMAIL.test(value)) return value;
  }
  return UNCONFIGURED_CONTACT_EMAIL;
}

/** True when the address above is a real configured mailbox rather than the placeholder. */
export function hasConfiguredContactEmail(): boolean {
  return orgContactEmail() !== UNCONFIGURED_CONTACT_EMAIL;
}

export type OrgSocialLink = { label: string; href: string };

/**
 * The org's public social profiles, rendered by the footer.
 *
 * ⚠ STILL EMPTY, AND THAT IS THE HONEST STATE. Ethan owes the exact Facebook, Instagram
 * and LinkedIn URLs (open item, brand restyle plan 2026-09-08; reviewer PDF A7). The
 * footer renders nothing at all while this list is empty rather than showing dead icons,
 * and adding them later is this one array — no component change, no layout change.
 *
 * Guessing a URL is not an option: a wrong link on the org's own footer sends scholars
 * to somebody else's page.
 */
export const ORG_SOCIAL_LINKS: ReadonlyArray<OrgSocialLink> = [];
