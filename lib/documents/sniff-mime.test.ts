// Magic-byte sniffing and the bytes-vs-metadata rule. BUILD_PLAN S3-T10.
//
// The load-bearing case in this file is `mime_mismatch`: a PNG renamed `.pdf` and
// declared `application/pdf` must be refused. That single assertion is what stands
// between the allowlist and a file whose type nobody actually checked.

import { describe, expect, it } from "vitest";

import { resolveVerifiedMime, sniffMime } from "./sniff-mime";

/** Build a buffer whose first bytes are `head`, padded to `length` with zeroes. */
function withHeader(head: readonly number[], length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(head, 0);
  return bytes;
}

/** An ISO-BMFF header: 4 size bytes, `ftyp`, then a four-character brand. */
function isoBmff(brand: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x00, 0x00, 0x00, 0x18], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
  for (let i = 0; i < 4; i += 1) bytes[8 + i] = brand.charCodeAt(i);
  return bytes;
}

const PDF = withHeader([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const JPEG = withHeader([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("sniffMime — accepted formats", () => {
  it("identifies a PDF by its %PDF- header", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
  });

  it("identifies a JPEG by FF D8 FF", () => {
    expect(sniffMime(JPEG)).toBe("image/jpeg");
  });

  it("identifies a PNG by its full 8-byte signature", () => {
    expect(sniffMime(PNG)).toBe("image/png");
  });

  it.each(["heic", "heix", "mif1"])("identifies HEIC by the ftyp brand %s", (brand) => {
    expect(sniffMime(isoBmff(brand))).toBe("image/heic");
  });
});

describe("sniffMime — refusals (it must fail closed)", () => {
  it("returns null for an empty buffer", () => {
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(sniffMime(new TextEncoder().encode("Certificate of Registration"))).toBeNull();
  });

  it("returns null for a truncated PNG signature", () => {
    // Seven of the eight PNG bytes. A two-byte check would wrongly accept this.
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]))).toBeNull();
  });

  it("returns null for FF D8 without the third byte", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it("refuses an ISO-BMFF file whose brand is not a still-image HEIF brand", () => {
    // An MP4 video is ftyp-shaped. Accepting any ftyp would let unbounded video into a
    // store whose entire legal basis is "one proof-of-enrollment document".
    expect(sniffMime(isoBmff("isom"))).toBeNull();
    expect(sniffMime(isoBmff("mp42"))).toBeNull();
    expect(sniffMime(isoBmff("avif"))).toBeNull();
  });

  it("does not match ftyp appearing anywhere other than offset 4", () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x66, 0x74, 0x79, 0x70], 0);
    expect(sniffMime(bytes)).toBeNull();
  });
});

describe("resolveVerifiedMime", () => {
  it("accepts when the provider agrees with the bytes", () => {
    expect(resolveVerifiedMime("application/pdf", "application/pdf")).toEqual({
      ok: true,
      mimeType: "application/pdf",
    });
  });

  it("REJECTS a PNG declared as application/pdf — the renamed-file case", () => {
    expect(resolveVerifiedMime("application/pdf", "image/png")).toEqual({
      ok: false,
      reason: "mime_mismatch",
    });
  });

  it("rejects unidentifiable bytes regardless of what the provider claims", () => {
    expect(resolveVerifiedMime("application/pdf", null)).toEqual({
      ok: false,
      reason: "unidentifiable",
    });
    expect(resolveVerifiedMime(null, null)).toEqual({ ok: false, reason: "unidentifiable" });
  });

  it("trusts the bytes when the provider reports a type outside the allowlist", () => {
    // Drive and Supabase Storage both fall back to octet-stream for HEIC. There is no
    // contradiction to detect, so the sniff stands alone.
    expect(resolveVerifiedMime("application/octet-stream", "image/heic")).toEqual({
      ok: true,
      mimeType: "image/heic",
    });
    expect(resolveVerifiedMime(undefined, "image/jpeg")).toEqual({
      ok: true,
      mimeType: "image/jpeg",
    });
  });

  it("normalises charset parameters and casing before comparing", () => {
    expect(resolveVerifiedMime("Application/PDF; charset=binary", "application/pdf")).toEqual({
      ok: true,
      mimeType: "application/pdf",
    });
  });
});
