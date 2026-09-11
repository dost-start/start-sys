// ─────────────────────────────────────────────────────────────────────────────
// EVERY TEMPLATE LINK MUST POINT AT A FORM THAT EXISTS (QA 2026-09-11, CAMPAIGNS-04).
//
// `committee_call` shipped with `formPath: "/committee-apply"`, a route that has never
// existed. The failure was not a 404: the path is not in `ROUTE_GROUPS.public` and not
// excluded by middleware's matcher, so every member who opened the link from their inbox
// was redirected to `/login` — a wall they can never pass, because members hold no
// accounts (SRS 2026-09-05). A campaign is the one artefact the org cannot recall once
// sent, so this is checked by CI rather than by reading the template.
//
// The link target is checked THREE ways, because each catches a different mistake and a
// path can pass any two while failing the third:
//   1. ROUTE_GROUPS.public   — `canAccess` lets an anonymous visitor through.
//   2. app/(public)/ on disk — a page actually renders there.
//   3. middleware's matcher  — the request is never intercepted by the auth gate.
// Adding `/committee-apply` to ROUTE_GROUPS without building the page passes (1) and
// still fails (2) and (3).
//
// ⚠ THE RED IS PERMANENTLY ENCODED. `describe("the check itself")` feeds the three checks
// the exact path this test was written for, so they are proven against a known-bad input
// on every run — not once by hand in September 2026.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ROUTE_GROUPS } from "@/lib/auth/route-access";

import { TEMPLATE_KEYS, TEMPLATES, templateFormUrl, type CampaignTemplate } from "./templates";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PUBLIC_ROUTE_ROOT = join(REPO_ROOT, "app", "(public)");

/** The templates that link to a form. Freeform links nowhere and is exempt by design. */
const LINKING_TEMPLATES = TEMPLATE_KEYS.map((key) => TEMPLATES[key]).filter(
  (template): template is CampaignTemplate & { formPath: string } => template.formPath !== null,
);

// ── The three checks, each usable on an arbitrary path ───────────────────────

/** 1. The path is a declared public prefix, so `canAccess(null, path)` is true. */
function isDeclaredPublic(formPath: string): boolean {
  return ROUTE_GROUPS.public.some((prefix) => prefix === formPath);
}

/** 2. A page renders there. Route groups are URL-invisible: `/apply` is `(public)/apply`. */
function hasPublicPage(formPath: string): boolean {
  return existsSync(join(PUBLIC_ROUTE_ROOT, formPath.replace(/^\//, ""), "page.tsx"));
}

/**
 * 3. Middleware does not intercept the path.
 *
 * The matcher is read from `middleware.ts` as SOURCE and unescaped with `JSON.parse`,
 * rather than imported: importing that module would execute `lib/supabase/middleware` and
 * its environment reads, and this test must not need a session to run. Anchoring the
 * pattern models Next's whole-path match, which is exact for the literal paths here.
 */
function middlewareMatcher(): RegExp {
  const source = readFileSync(join(REPO_ROOT, "middleware.ts"), "utf8");
  const literal = /matcher:\s*\[\s*("(?:[^"\\]|\\.)*")/.exec(source)?.[1];
  if (literal === undefined) {
    throw new Error("could not find config.matcher in middleware.ts");
  }
  const parsed: unknown = JSON.parse(literal);
  if (typeof parsed !== "string") {
    throw new Error("config.matcher in middleware.ts is not a string literal");
  }
  return new RegExp(`^${parsed}$`);
}

const MATCHER = middlewareMatcher();

function isExcludedFromMiddleware(formPath: string): boolean {
  return !MATCHER.test(formPath);
}

// ── The assertions ───────────────────────────────────────────────────────────

describe("every campaign template links to a real public route", () => {
  it("finds linking templates at all — a zero-length scan would pass vacuously", () => {
    expect(LINKING_TEMPLATES.length).toBeGreaterThan(0);
    expect(LINKING_TEMPLATES.map((template) => template.formPath)).toContain("/apply");
  });

  it.each(LINKING_TEMPLATES.map((template) => [template.key, template.formPath] as const))(
    "%s links to %s, which is declared public, renders a page, and bypasses middleware",
    (key, formPath) => {
      expect(
        isDeclaredPublic(formPath),
        `${key} links to ${formPath}, which is not in ROUTE_GROUPS.public — an anonymous ` +
          `visitor is refused by canAccess and sent to /login.`,
      ).toBe(true);

      expect(
        hasPublicPage(formPath),
        `${key} links to ${formPath}, but app/(public)${formPath}/page.tsx does not exist. ` +
          `Build the form before shipping a template that mails members a link to it.`,
      ).toBe(true);

      expect(
        isExcludedFromMiddleware(formPath),
        `${key} links to ${formPath}, which middleware's matcher intercepts — the recipient ` +
          `is redirected to /login before the page renders.`,
      ).toBe(true);
    },
  );

  it("keeps freeform linkless — it is the one template with no form", () => {
    expect(TEMPLATES.freeform.formPath).toBeNull();
    expect(templateFormUrl(TEMPLATES.freeform, "https://example.org")).toBeNull();
  });

  it("bakes the origin into the link", () => {
    expect(templateFormUrl(TEMPLATES.membership_application_invite, "https://example.org")).toBe(
      "https://example.org/apply",
    );
  });

  it("offers no committee template while /committee-apply does not exist (CAMPAIGNS-04)", () => {
    expect(TEMPLATE_KEYS.map(String)).not.toContain("committee_call");
    // The guard, not the symptom: when the form ships, this is the line that tells you the
    // template may come back.
    expect(hasPublicPage("/committee-apply")).toBe(false);
  });
});

// ── The permanently encoded red ──────────────────────────────────────────────

describe("the check itself", () => {
  /** The exact path the removed `committee_call` template linked to (CAMPAIGNS-04). */
  const REMOVED_COMMITTEE_FORM_PATH = "/committee-apply";

  it("FLAGS a path that is not declared public", () => {
    expect(isDeclaredPublic(REMOVED_COMMITTEE_FORM_PATH)).toBe(false);
  });

  it("FLAGS a path with no page behind it", () => {
    expect(hasPublicPage(REMOVED_COMMITTEE_FORM_PATH)).toBe(false);
  });

  it("FLAGS a path middleware intercepts — the login wall members cannot pass", () => {
    expect(isExcludedFromMiddleware(REMOVED_COMMITTEE_FORM_PATH)).toBe(false);
  });

  it("PASSES all three for the forms that really are public", () => {
    for (const formPath of ["/apply", "/renew"]) {
      expect(isDeclaredPublic(formPath)).toBe(true);
      expect(hasPublicPage(formPath)).toBe(true);
      expect(isExcludedFromMiddleware(formPath)).toBe(true);
    }
  });
});
