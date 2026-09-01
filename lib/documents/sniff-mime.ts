// ─────────────────────────────────────────────────────────────────────────────
// Magic-byte sniffing, and the rule for what happens when the bytes and the metadata
// disagree. BUILD_PLAN S3-T10.
//
// WHY THIS EXISTS: `Content-Type` is a claim, and the claim is made by whoever uploaded
// the file. A `.pdf` extension is a claim. A provider's stored `mimeType` is usually
// just the claim echoed back. The only thing that is not a claim is the first few bytes
// of the file, so those are what decide.
//
// WHAT THIS IS NOT: a virus scanner. Google Drive does not scan files under 100MB on
// upload (ARCHITECTURE.md §4.1, "Residual risk, stated plainly"), and neither does this.
// A well-formed but malicious PDF passes every check here. The mitigation is the
// allowlist plus viewing through the browser's own sandboxed viewer in an iframe rather
// than downloading (S4-T20) — not this function.
// ─────────────────────────────────────────────────────────────────────────────

import { type AllowedMime, isAllowedMime } from "./types";

/** `%PDF-` — the PDF header, per ISO 32000-1 §7.5.2. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * `FF D8 FF` — SOI followed by the first marker. Deliberately three bytes, not two:
 * `FF D8` alone matches too readily.
 */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/** `89 50 4E 47 0D 0A 1A 0A` — the full 8-byte PNG signature, per RFC 2083 §3.1. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** ISO-BMFF: bytes 4..8 are the literal `ftyp` box type. */
const FTYP_AT_OFFSET_4 = [0x66, 0x74, 0x79, 0x70];

/**
 * The ISO-BMFF major brands accepted as HEIC, at bytes 8..12.
 *
 * `heic` and `heix` are HEVC-in-HEIF still images; `mif1` is the generic HEIF image
 * brand that some iOS versions and most Android HEIF encoders write.
 *
 * This list is deliberately NARROW and FAILS CLOSED. An unrecognised brand is refused
 * rather than guessed at, and the applicant is asked to re-upload (S4-T20 renders that
 * message). The alternative — accepting any `ftyp` — would accept MP4 video, which is
 * not a Certificate of Registration and would sit in the store as unbounded PII we have
 * no basis to hold. Widening this list is a deliberate, reviewed change, not a bug fix.
 */
const HEIC_BRANDS = ["heic", "heix", "mif1"] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/** ASCII slice, used only for the four-character ISO-BMFF brand. */
function asciiAt(bytes: Uint8Array, start: number, length: number): string | null {
  if (bytes.length < start + length) return null;
  let out = "";
  for (let i = start; i < start + length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) return null;
    out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * Identify a proof-of-enrollment document from its leading bytes.
 *
 * @param bytes the first bytes of the object. `SNIFF_BYTES` (512) is plenty — every
 *              signature checked here lives in the first 12.
 * @returns the identified MIME type, or `null` when the bytes are not one of the four
 *          accepted formats. **`null` means reject** — never "probably fine".
 */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (startsWith(bytes, PDF_SIGNATURE)) return "application/pdf";
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "image/jpeg";

  if (startsWith(bytes, FTYP_AT_OFFSET_4, 4)) {
    const brand = asciiAt(bytes, 8, 4);
    if (brand !== null && (HEIC_BRANDS as readonly string[]).includes(brand)) {
      return "image/heic";
    }
  }

  return null;
}

/**
 * Decide the type of a stored object from its bytes and the provider's own metadata,
 * and refuse when they disagree.
 *
 * ONE RULE, TWO CONSUMERS (the Drive driver and the Supabase Storage driver), so the two
 * cannot drift into disagreeing about what is acceptable:
 *
 *   1. **Bytes that cannot be identified are refused.** Fail closed. We are storing a
 *      government-scholarship document on behalf of a minor-or-near-minor; "we could not
 *      tell what it was, so we kept it" is not a defensible position under RA 10173.
 *
 *   2. **The sniffed type is AUTHORITATIVE.** Provider metadata is usually the client's
 *      own `Content-Type` echoed back, so it is a claim wearing a uniform.
 *
 *   3. **A provider type that is itself an accepted type must MATCH the sniff.** This is
 *      the case S3-T10's acceptance names: a PNG renamed `.pdf` and declared
 *      `application/pdf` is rejected. Where the provider reports something outside the
 *      allowlist — `application/octet-stream` is what Drive and Storage both fall back to
 *      for HEIC — there is no contradiction to detect, and rule 2 stands on its own.
 *
 * @throws never — returns a discriminated result so each driver can delete the object
 *         before surfacing the failure.
 */
export function resolveVerifiedMime(
  providerMime: string | null | undefined,
  sniffed: AllowedMime | null,
): { ok: true; mimeType: AllowedMime } | { ok: false; reason: "unidentifiable" | "mime_mismatch" } {
  if (sniffed === null) {
    return { ok: false, reason: "unidentifiable" };
  }

  const declared = (providerMime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

  if (declared !== "" && isAllowedMime(declared) && declared !== sniffed) {
    return { ok: false, reason: "mime_mismatch" };
  }

  return { ok: true, mimeType: sniffed };
}
