// The org's own social links, checked against the same host validators `/apply` applies to
// an applicant's (PR C1, `lib/validation/social.ts`).
//
// WHY THIS IS WORTH A TEST FOR THREE CONSTANTS: they render in the footer of every public
// page, and a typo does not fail anything — it silently sends scholars to a page the org
// does not control, or to a 404 that looks like the org is defunct. Holding the org to the
// rule it holds applicants to is close to free.
//
// `ORG_SOCIAL_LINKS` is imported from a `server-only` module; Vitest aliases that away
// (test-stubs/server-only.ts), which is exactly what the stub exists for.
import { describe, expect, it } from "vitest";

import { ORG_SOCIAL_LINKS } from "@/lib/brand/org-contact";
import {
  isFacebookProfileUrl,
  isInstagramProfileUrl,
  isLinkedinProfileUrl,
} from "@/lib/validation/social";

const CHECKS: Record<string, (value: string) => boolean> = {
  Facebook: isFacebookProfileUrl,
  Instagram: isInstagramProfileUrl,
  LinkedIn: isLinkedinProfileUrl,
};

describe("ORG_SOCIAL_LINKS", () => {
  it("names the three networks the org actually has, once each", () => {
    expect(ORG_SOCIAL_LINKS.map((l) => l.label)).toEqual(["Facebook", "Instagram", "LinkedIn"]);
  });

  it("every link is on the host its label claims", () => {
    for (const link of ORG_SOCIAL_LINKS) {
      const check = CHECKS[link.label];
      expect(check, `no host check for ${link.label}`).toBeDefined();
      expect(check?.(link.href), `${link.label}: ${link.href}`).toBe(true);
    }
  });

  it("every link is absolute https — a footer href is not resolved against a page", () => {
    for (const link of ORG_SOCIAL_LINKS) {
      expect(link.href.startsWith("https://"), link.href).toBe(true);
    }
  });

  it("carries no tracking or view-state parameters", () => {
    // The LinkedIn URL arrived as `/posts/?feedView=all`. A query string copied out of
    // somebody's address bar is not a stable public address.
    for (const link of ORG_SOCIAL_LINKS) {
      expect(new URL(link.href).search, link.href).toBe("");
    }
  });
});
