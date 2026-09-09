// ─────────────────────────────────────────────────────────────────────────────
// Social-profile link normalization and validation.
//
// WHY THIS IS SHARED, when `lib/members/schema.ts` deliberately transcribes most of
// its formats rather than importing them: the note there is about SCHEMA STRICTNESS —
// two surfaces with two lifecycles, where loosening one must not loosen the other.
// What lives here is not strictness, it is the answer to "is this string a link to a
// Facebook profile", and that is one fact. If /apply accepted a link the member edit
// screen then refused, CRRD could not correct a record it had already approved.
//
// FINDING A5 (reviewer PDF, 2026-09-09, p1): `facebook.com/name` was refused, because
// the regex required a scheme and nobody types one. A human who copies their profile
// from the address bar gets `https://…`; a human who types it from memory does not.
// So: normalize first, validate second. The stored value is always absolute, so the
// RR contact view and the member detail page can render it as an href unchanged.
//
// The normalizer only ever ADDS a scheme. It never rewrites a host, so
// `https://twitter.com/x` is still refused rather than quietly "corrected".
// ─────────────────────────────────────────────────────────────────────────────

/** A leading scheme of any kind — `https://`, `http://`, and also `javascript:`. */
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Protocol-relative (`//facebook.com/x`), which a paste from some editors produces. */
const PROTOCOL_RELATIVE_RE = /^\/\//;

const FACEBOOK_HOST_RE = /^(www\.|m\.|web\.|mbasic\.)?(facebook\.com|fb\.com|fb\.me)$/i;
const INSTAGRAM_HOST_RE = /^(www\.)?instagram\.com$/i;
const GITHUB_HOST_RE = /^(www\.)?github\.com$/i;
const LINKEDIN_HOST_RE = /^([a-z]{2}\.|www\.)?linkedin\.com$/i;

/**
 * Give a typed profile link a scheme so it can be parsed and stored absolute.
 *
 * `facebook.com/juan` → `https://facebook.com/juan`. A string that already carries a
 * scheme is returned untouched — including `http://`, which the host checks below
 * still accept, and including `javascript:`, which they refuse. Empty input stays
 * empty so the caller's own "required" / "optional" rule is what speaks.
 */
export function normalizeProfileUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (PROTOCOL_RELATIVE_RE.test(trimmed)) return `https:${trimmed}`;
  if (HAS_SCHEME_RE.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * True when `value` is an http(s) URL on `hostRe` with something after the slash.
 *
 * Parsed with `URL` rather than matched with one long regex: `URL` is what a browser
 * and a mail client will do with the stored value, so agreeing with it is the point.
 * A path of `/` alone is not a profile.
 */
function isProfileUrlOn(value: string, hostRe: RegExp): boolean {
  const normalized = normalizeProfileUrl(value);
  if (normalized === "") return false;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (!hostRe.test(url.hostname)) return false;
  return url.pathname.length > 1;
}

export const isFacebookProfileUrl = (value: string) => isProfileUrlOn(value, FACEBOOK_HOST_RE);
export const isInstagramProfileUrl = (value: string) => isProfileUrlOn(value, INSTAGRAM_HOST_RE);
export const isGithubProfileUrl = (value: string) => isProfileUrlOn(value, GITHUB_HOST_RE);
export const isLinkedinProfileUrl = (value: string) => isProfileUrlOn(value, LINKEDIN_HOST_RE);
