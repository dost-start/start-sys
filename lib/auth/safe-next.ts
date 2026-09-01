// ─────────────────────────────────────────────────────────────────────────────
// The ONE redirect-target allowlist (US-A1's "lands on the page they originally
// requested", CONVENTIONS §4.3's "never trust a client-supplied redirect target").
//
// Why not `startsWith("/") && !startsWith("//")`: the WHATWG URL parser treats a
// backslash as a slash in authority position for special schemes, so a browser
// resolves `Location: /\evil.example` to `https://evil.example`. The two checks a
// human writes first block `//` and miss `/\`. This helper parses the candidate
// against a fixed placeholder origin and accepts it ONLY when the parser agrees
// the result stays on that origin — the parser that will be attacked is the
// parser that decides.
//
// Shared by the login action and the client-side MFA verify redirect. Two copies
// of a redirect allowlist is how exactly one of them gets fixed.
// ─────────────────────────────────────────────────────────────────────────────

const PLACEHOLDER_ORIGIN = "https://safe-next.invalid";

/**
 * Return a same-origin path ("/x?y#z") when `next` is safe to redirect to, else null.
 * Safe means: a string, no backslashes, and the URL parser resolves it to a path on
 * the same origin it was parsed against.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== "string" || next.length === 0) return null;
  if (next.includes("\\")) return null;
  if (!next.startsWith("/")) return null;

  let parsed: URL;
  try {
    parsed = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return null;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
