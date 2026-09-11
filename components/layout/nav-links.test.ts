// Officer feedback 2026-09-11: the Application period page had no sidebar link. These pin
// where the link sits and that the longest-prefix rule still highlights the right item.
import { describe, expect, it } from "vitest";

import { activeLink, ADMIN_NAV_LINKS } from "@/components/layout/nav-links";

const SOME_ID = "3f1c2a9e-1b2c-4d5e-8f90-123456789abc";

describe("ADMIN_NAV_LINKS", () => {
  it("lists Application period directly after Renewals", () => {
    const renewals = ADMIN_NAV_LINKS.findIndex((link) => link.href === "/renewals");
    expect(renewals).toBeGreaterThanOrEqual(0);
    expect(ADMIN_NAV_LINKS[renewals + 1]).toEqual({
      href: "/applications/window",
      label: "Application period",
    });
  });
});

describe("activeLink over the admin links", () => {
  it.each([
    ["/applications", "Applications"],
    [`/applications/${SOME_ID}`, "Applications"],
    ["/applications/window", "Application period"],
    ["/renewals", "Renewals"],
    [`/renewals/${SOME_ID}`, "Renewals"],
  ])("%s highlights %s", (pathname, label) => {
    expect(activeLink(ADMIN_NAV_LINKS, pathname)?.label).toBe(label);
  });

  it("does not treat a longer path segment as a prefix", () => {
    expect(activeLink(ADMIN_NAV_LINKS, "/applications-archive")).toBeNull();
  });
});
