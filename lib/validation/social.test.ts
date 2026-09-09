// Profile-link normalization (A5). The reviewer's actual complaint was that
// `facebook.com/name` — what a person types — was refused. The risk in fixing that is
// over-correcting into accepting somebody else's host, so both halves are asserted.
import { describe, expect, it } from "vitest";

import {
  isFacebookProfileUrl,
  isGithubProfileUrl,
  isInstagramProfileUrl,
  isLinkedinProfileUrl,
  normalizeProfileUrl,
} from "@/lib/validation/social";

describe("normalizeProfileUrl", () => {
  it("adds https:// when there is no scheme", () => {
    expect(normalizeProfileUrl("facebook.com/juan")).toBe("https://facebook.com/juan");
  });

  it("leaves an existing scheme alone, including http", () => {
    expect(normalizeProfileUrl("http://facebook.com/juan")).toBe("http://facebook.com/juan");
    expect(normalizeProfileUrl("https://facebook.com/juan")).toBe("https://facebook.com/juan");
  });

  it("resolves a protocol-relative paste", () => {
    expect(normalizeProfileUrl("//facebook.com/juan")).toBe("https://facebook.com/juan");
  });

  it("trims, and leaves empty input empty so the required rule is what speaks", () => {
    expect(normalizeProfileUrl("  facebook.com/juan  ")).toBe("https://facebook.com/juan");
    expect(normalizeProfileUrl("   ")).toBe("");
  });

  it("does NOT invent a scheme for something that already has one", () => {
    // The host check refuses this; the normalizer must not disguise it as https first.
    expect(normalizeProfileUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
  });
});

describe("isFacebookProfileUrl", () => {
  it("accepts the forms a scholar actually types", () => {
    for (const value of [
      "facebook.com/juandelacruz",
      "www.facebook.com/juandelacruz",
      "m.facebook.com/juandelacruz",
      "web.facebook.com/juandelacruz",
      "mbasic.facebook.com/juandelacruz",
      "https://facebook.com/juan.dela.cruz.1",
      "http://fb.com/juan",
      "fb.me/juan",
      "https://www.facebook.com/profile.php?id=100000000000000",
    ]) {
      expect(isFacebookProfileUrl(value), value).toBe(true);
    }
  });

  it("refuses another host, even one the normalizer just gave a scheme to", () => {
    for (const value of [
      "https://twitter.com/juan",
      "twitter.com/juan",
      "https://notfacebook.com/juan",
      "https://facebook.com.evil.example/juan",
      "https://evil.example/facebook.com/juan",
    ]) {
      expect(isFacebookProfileUrl(value), value).toBe(false);
    }
  });

  it("refuses a host with no profile path, and refuses junk", () => {
    expect(isFacebookProfileUrl("facebook.com")).toBe(false);
    expect(isFacebookProfileUrl("facebook.com/")).toBe(false);
    expect(isFacebookProfileUrl("")).toBe(false);
    expect(isFacebookProfileUrl("not a url at all")).toBe(false);
  });

  it("refuses a non-http scheme", () => {
    expect(isFacebookProfileUrl("javascript:alert(1)")).toBe(false);
    expect(isFacebookProfileUrl("data:text/html,<script>")).toBe(false);
  });
});

describe("the optional networks (PR C1)", () => {
  it("each accepts its own host and refuses the others", () => {
    expect(isInstagramProfileUrl("instagram.com/juan")).toBe(true);
    expect(isInstagramProfileUrl("facebook.com/juan")).toBe(false);

    expect(isGithubProfileUrl("github.com/juan")).toBe(true);
    expect(isGithubProfileUrl("gitlab.com/juan")).toBe(false);

    expect(isLinkedinProfileUrl("linkedin.com/in/juan")).toBe(true);
    expect(isLinkedinProfileUrl("ph.linkedin.com/in/juan")).toBe(true);
    expect(isLinkedinProfileUrl("linked.in/juan")).toBe(false);
  });
});
