// ─────────────────────────────────────────────────────────────────────────────
// The three MIME lists, and the rules that keep them from collapsing into one.
//
// Since 0060 there are three, and they answer three different questions:
//   ALLOWED_MIME    — what INTAKE accepts.            PDF only.
//   SNIFFABLE_MIME  — what the SNIFFER can identify.  Four; may grow.
//   SERVABLE_MIME   — what the PROXY may emit.        Four; frozen, may only shrink.
//
// Every test below exists because collapsing two of them is a plausible, well-meant
// future edit that would break something quietly. The assertions are the reason.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIME,
  SERVABLE_MIME,
  SNIFFABLE_MIME,
  isAllowedMime,
  isServableMime,
} from "./types";

describe("SERVABLE_MIME — what the proof proxy may put in a Content-Type", () => {
  it("is exactly the four types intake accepted before the PDF-only narrowing", () => {
    // Written as a literal, deliberately: if this were derived from SNIFFABLE_MIME,
    // teaching the sniffer a new format (to improve a rejection message) would silently
    // widen what the proxy is willing to hand a browser.
    expect([...SERVABLE_MIME]).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/heic",
    ]);
  });

  it("contains every type intake still accepts — a type we take must be one we can serve", () => {
    for (const mime of ALLOWED_MIME) {
      expect(isServableMime(mime)).toBe(true);
    }
  });

  it("still serves image/heic — the exact row class that regressed to a 500", () => {
    // A pre-0060 iPhone submission. The viewer has a dedicated notice branch for it; the
    // proxy has to reach that branch rather than failing before it.
    expect(isServableMime("image/heic")).toBe(true);
    expect(isServableMime("image/jpeg")).toBe(true);
    expect(isServableMime("image/png")).toBe(true);
  });

  it("refuses anything script-bearing, and anything not on the closed list", () => {
    // svg+xml and text/html are named individually rather than folded into a loop: this
    // route streams user-uploaded bytes, so its Content-Type is a stored-XSS delivery
    // mechanism, and both of these execute in the viewer's origin.
    expect(isServableMime("image/svg+xml")).toBe(false);
    expect(isServableMime("text/html")).toBe(false);
    expect(isServableMime("application/javascript")).toBe(false);

    // Not a stored value we ever wrote, and not one to start tolerating here.
    expect(isServableMime("application/octet-stream")).toBe(false);
    expect(isServableMime("")).toBe(false);

    // The stored column holds a bare type. A parameterised one means something upstream
    // wrote a raw header into the column, which is a bug to surface, not to accept.
    expect(isServableMime("application/pdf; charset=utf-8")).toBe(false);

    // Never accepted by any gate (0019 through 0045), so it cannot be in a stored row —
    // even though proof-document-viewer.tsx lists it defensively.
    expect(isServableMime("image/heif")).toBe(false);
  });
});

describe("ALLOWED_MIME — what intake accepts", () => {
  it("is PDF alone", () => {
    expect([...ALLOWED_MIME]).toEqual(["application/pdf"]);
  });

  it("does NOT accept the image types, even though the proxy can still serve them", () => {
    // THE TEST THAT CATCHES THE WRONG FIX. If someone reaches for isServableMime inside
    // assertAcceptableUpload "for symmetry", the PDF-only narrowing is silently undone
    // and the HEIC trap comes back with it.
    expect(isAllowedMime("image/jpeg")).toBe(false);
    expect(isAllowedMime("image/png")).toBe(false);
    expect(isAllowedMime("image/heic")).toBe(false);
  });
});

describe("the three lists stay distinct", () => {
  it("keeps intake strictly narrower than serving", () => {
    // The moment these are equal, either intake widened or legacy documents stopped
    // being readable. Both are regressions; neither would fail any other test here.
    expect(ALLOWED_MIME.length).toBeLessThan(SERVABLE_MIME.length);
  });

  it("does not assume the sniffer and the proxy agree, even while they coincide", () => {
    // They have the same members today. This asserts the RELATIONSHIP that must hold —
    // anything servable must be identifiable — rather than the coincidence, so growing
    // SNIFFABLE_MIME stays legal and growing SERVABLE_MIME does not become automatic.
    for (const mime of SERVABLE_MIME) {
      expect(SNIFFABLE_MIME as readonly string[]).toContain(mime);
    }
  });
});
