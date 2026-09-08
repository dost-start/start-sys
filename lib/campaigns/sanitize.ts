// ─────────────────────────────────────────────────────────────────────────────
// The pasted-HTML sanitizer (2026-09-07; SRS "Email Sending" — "send emails with an
// HTML format attached"; PRD US-G1).
//
// WHY THIS FILE EXISTS. Until now the composer accepted only Telegram-style markdown,
// and `lib/campaigns/markdown.ts` escaped the input FIRST, so the only tags that could
// reach a mailbox were the ones our own renderer emitted. That is a complete
// sanitisation story, and it is why ADR 0010 says the transport trusts the composer.
// The CCDO builds designed emails in an external template builder (Postcards, cloudHQ)
// and pastes the finished HTML into Gmail through a browser extension. To do that in
// START-SYS the composer has to accept markup it did not author — which means the
// escape-first guarantee is gone and an ALLOWLIST has to take its place.
//
// THE RULE: nothing survives that is not on a list in this file. `sanitize-html` drops
// every tag, attribute and style property it is not told to keep, so a tag we never
// thought about is dropped rather than passed. Additions are a reviewed decision.
//
// WHAT IS DELIBERATELY DROPPED, AND WHY (ADR 0014):
//   <script>, <iframe>, <object>, <embed>, <form>, <input>, <base>, <meta>, <link>
//       executable or navigational. `nonTextTags` makes their CONTENT vanish too, so a
//       stripped <script> does not leave its source code as visible text in the email.
//   on* attributes                event handlers.
//   <style> blocks and @media     a decision, not an oversight — see below.
//   href/src that is not https:   `javascript:` and `data:` in particular. Mail clients
//       block data: images on receive anyway, and a base64 banner times 600 recipients
//       is a large amount of bytes through an SMTP account capped at ~500 messages/day.
//   width/height/style values carrying url(), expression() or @import
//
// WHY <style> BLOCKS ARE DROPPED (Ethan, 2026-09-07: "let's drop, we'll add it if it's
// needed"). `sanitize-html` filters INLINE style properties one at a time, which is what
// `allowedStyles` below does. It cannot filter the CSS inside a <style> block: the block
// is kept whole or dropped whole. Kept whole means trusting pasted CSS — `url()` fetches,
// `@import` of a third-party stylesheet. Builders use <style> mainly for `@media` phone
// tweaks, and Gmail already strips <style> for non-Google accounts and forwarded mail, so
// no builder depends on it for the base layout. Cost: a multi-column template renders
// narrow on a phone instead of stacking; single-column templates (a banner, text, a
// button — what the CCDO's DataCamp mail is) are unaffected, because mail clients scale
// them to fit. Filtering the block with postcss is the documented follow-up if a template
// needs it.
//
// MERGE TOKENS. `{{given_name}}` is plain text and passes through untouched; it is
// substituted per recipient AFTER this runs, and every value is HTML-escaped at that
// point (lib/campaigns/merge.ts). A token inside an ATTRIBUTE would not be escaped by
// that path, so `assertNoTokensInAttributes()` refuses one before it can be stored.
// ─────────────────────────────────────────────────────────────────────────────

import sanitizeHtml from "sanitize-html";

/**
 * The largest pasted body accepted, in bytes of UTF-8 (Ethan, 2026-09-07: "warning is
 * 200 kb, no warning needed for 100kb"). A designed template from a builder is typically
 * 30-80 KB; 200 KB is generous headroom. Enforced by the zod schema, by the Server
 * Action after sanitising, and by a CHECK constraint on `email_campaigns.body_html`.
 *
 * Worth knowing rather than enforcing: Gmail appends "[Message clipped] View entire
 * message" past roughly 102 KB. A template over that still sends and still renders — the
 * reader clicks through. That is a design choice for whoever builds the template, so the
 * system does not second-guess it.
 */
export const HTML_BODY_MAX_BYTES = 200 * 1024;

/** Byte length, not string length — a 200 KB cap on a UTF-8 payload is about bytes. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Tags an email template legitimately needs. Table tags carry the layout (every serious
 * email template is a table), the rest is text and images. Anything absent is dropped.
 */
const ALLOWED_TAGS = [
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "colgroup",
  "col",
  "div",
  "p",
  "span",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "center",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "pre",
  "code",
  "a",
  "img",
  "br",
  "hr",
  "wbr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "ins",
  "small",
  "sub",
  "sup",
  "font",
] as const;

/**
 * Attributes, per tag. `style` is allowed but every PROPERTY inside it is filtered by
 * `allowedStyles` below, so `style` is not a hole. Presentational attributes
 * (align, valign, width, bgcolor…) are here because email clients honour them where they
 * ignore CSS — that is why builders emit them.
 */
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  "*": ["style", "class", "align", "valign", "dir", "lang", "title", "role"],
  a: ["href", "target", "rel", "name"],
  img: ["src", "alt", "width", "height", "border", "loading"],
  table: ["width", "height", "border", "cellpadding", "cellspacing", "bgcolor", "background"],
  td: ["width", "height", "colspan", "rowspan", "bgcolor", "background", "nowrap"],
  th: ["width", "height", "colspan", "rowspan", "bgcolor", "background", "nowrap"],
  tr: ["height", "bgcolor"],
  col: ["width", "span"],
  colgroup: ["width", "span"],
  font: ["color", "face", "size"],
  hr: ["width", "size", "noshade"],
};

/**
 * Inline CSS properties kept, matched against the property VALUE. `sanitize-html` drops
 * any property not named here and any value the pattern refuses — which is what keeps
 * `url(…)`, `expression(…)` and `\` escapes out without a CSS parser.
 *
 * The value patterns are deliberately broad on the safe properties (colour, length,
 * font) and there is no property here whose value is fetched or executed by a renderer.
 */
/**
 * A CSS value is safe when it is made only of ordinary value characters, plus colour
 * functions whose arguments are numeric. Bare parentheses are therefore IMPOSSIBLE, which
 * is what rules out `url(…)`, `expression(…)`, `image-set(…)` and every other fetch-or-
 * execute function in one pattern rather than a blocklist that has to be kept current.
 * No colon and no backslash either: no scheme, no CSS escape.
 *
 * Found by the test, not by review: an earlier pattern allowed bare parens and let
 * `color:expression(alert(1))` through — legacy IE, but exactly the class of value a
 * blocklist misses.
 */
const SAFE_VALUE = /^(?:(?:rgba?|hsla?)\([\d\s.,%]+\)|[#a-zA-Z0-9\s.,%/'"_-])+$/;

const ALLOWED_STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    color: [SAFE_VALUE],
    "background-color": [SAFE_VALUE],
    background: [SAFE_VALUE],
    "font-family": [SAFE_VALUE],
    "font-size": [SAFE_VALUE],
    "font-weight": [SAFE_VALUE],
    "font-style": [SAFE_VALUE],
    "line-height": [SAFE_VALUE],
    "letter-spacing": [SAFE_VALUE],
    "text-align": [SAFE_VALUE],
    "text-decoration": [SAFE_VALUE],
    "text-transform": [SAFE_VALUE],
    "vertical-align": [SAFE_VALUE],
    "white-space": [SAFE_VALUE],
    margin: [SAFE_VALUE],
    "margin-top": [SAFE_VALUE],
    "margin-right": [SAFE_VALUE],
    "margin-bottom": [SAFE_VALUE],
    "margin-left": [SAFE_VALUE],
    padding: [SAFE_VALUE],
    "padding-top": [SAFE_VALUE],
    "padding-right": [SAFE_VALUE],
    "padding-bottom": [SAFE_VALUE],
    "padding-left": [SAFE_VALUE],
    border: [SAFE_VALUE],
    "border-top": [SAFE_VALUE],
    "border-right": [SAFE_VALUE],
    "border-bottom": [SAFE_VALUE],
    "border-left": [SAFE_VALUE],
    "border-color": [SAFE_VALUE],
    "border-style": [SAFE_VALUE],
    "border-width": [SAFE_VALUE],
    "border-radius": [SAFE_VALUE],
    "border-collapse": [SAFE_VALUE],
    "border-spacing": [SAFE_VALUE],
    width: [SAFE_VALUE],
    "min-width": [SAFE_VALUE],
    "max-width": [SAFE_VALUE],
    height: [SAFE_VALUE],
    "min-height": [SAFE_VALUE],
    "max-height": [SAFE_VALUE],
    display: [SAFE_VALUE],
    "box-sizing": [SAFE_VALUE],
    "mso-line-height-rule": [SAFE_VALUE],
    "-webkit-text-size-adjust": [SAFE_VALUE],
    "-ms-text-size-adjust": [SAFE_VALUE],
  },
};

/**
 * Tags whose TEXT is discarded along with the tag. Without this, stripping `<script>`
 * leaves the JavaScript behind as visible text in the email body, and stripping
 * `<style>` leaves a wall of CSS — the exact reason this option exists.
 */
const NON_TEXT_TAGS = ["script", "style", "textarea", "option", "noscript", "title"];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedStyles: ALLOWED_STYLES,
  // https only. `mailto:` and `tel:` are legitimate in an email footer; both are inert
  // navigation, neither can execute. `data:` and `javascript:` are absent on purpose.
  allowedSchemes: ["https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https"] },
  allowedSchemesAppliedToAttributes: ["href", "src", "background"],
  // A protocol-relative `//host/x` inherits the page's scheme; in an email there is no
  // page, and clients resolve it inconsistently. Require an explicit https URL.
  allowProtocolRelative: false,
  nonTextTags: NON_TEXT_TAGS,
  // `class` is kept for builders that pair it with inline styles; since <style> blocks
  // are dropped, a class selector matches nothing and is inert either way.
  allowedClasses: false as unknown as sanitizeHtml.IOptions["allowedClasses"],
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: false,
  transformTags: {
    // Every surviving link opens in a new tab and cannot reach back into the opener.
    // `noopener` on a mail client is belt-and-braces; on a webmail preview pane it matters.
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
  },
};

/**
 * A `{{token}}` sitting inside an attribute value rather than in text.
 *
 * Three forms after `=`: quoted-double, quoted-single, and UNQUOTED (`href={{token}}` is
 * valid HTML5). The unquoted alternative is required — without it, a pasted template
 * using an unquoted attribute passed this check, then `sanitizeHtml` re-quoted the
 * attribute on output, and the token reached storage having never been rejected.
 */
const TOKEN_IN_ATTRIBUTE = /=\s*("[^"]*\{\{|'[^']*\{\{|(?!["'])[^\s>]*\{\{)/;

/** The one message for that case, shared by the schema (client + action) and this module. */
export const TOKEN_IN_ATTRIBUTE_MESSAGE =
  "A merge field appears inside an HTML attribute (for example in a link or an image address). " +
  "Merge fields can only be used in the visible text of the message.";

/** The predicate half of `assertNoTokensInAttributes`, for the zod schema. */
export function hasTokenInAttribute(html: string): boolean {
  return TOKEN_IN_ATTRIBUTE.test(html);
}

export class HtmlBodyError extends Error {
  readonly name = "HtmlBodyError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Merge values are HTML-escaped when substituted (merge.ts), which is correct for text
 * content and NOT sufficient inside an attribute — `href="{{given_name}}"` would let a
 * name shape a URL. Tokens in attributes are refused rather than escaped differently,
 * because there is no legitimate template that needs one and a second escaping rule is a
 * second thing to get wrong.
 */
export function assertNoTokensInAttributes(html: string): void {
  if (hasTokenInAttribute(html)) {
    throw new HtmlBodyError(TOKEN_IN_ATTRIBUTE_MESSAGE);
  }
}

/**
 * Sanitise a pasted HTML body. The RETURN VALUE is the only thing that may be stored or
 * sent; the input is never used again. Throws `HtmlBodyError` when the input cannot be
 * made safe (a merge token in an attribute) or is too large AFTER sanitising.
 *
 * Order matters: attributes are checked on the RAW input, because sanitising could
 * remove the attribute that carried the token and turn a refusal into a silent change.
 */
export function sanitizeCampaignHtml(rawHtml: string): string {
  assertNoTokensInAttributes(rawHtml);
  const clean = sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
  if (clean.trim() === "") {
    throw new HtmlBodyError(
      "Nothing usable was left after the message was checked for safety. " +
        "Paste the HTML your email builder exports, not a screenshot or a link to it.",
    );
  }
  if (byteLength(clean) > HTML_BODY_MAX_BYTES) {
    throw new HtmlBodyError(
      `The message is larger than ${Math.round(HTML_BODY_MAX_BYTES / 1024)} KB. ` +
        "Remove some images or use smaller ones.",
    );
  }
  return clean;
}

/**
 * A plain-text alternative derived from sanitised HTML. Not a renderer — block tags
 * become line breaks, links become "label (url)", everything else is text. ADR 0010:
 * spam filters penalise HTML-only mail from a gmail.com sender, so every message carries
 * one of these.
 */
export function htmlToText(cleanHtml: string): string {
  const withLinks = cleanHtml.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text === "" || text === href ? href : `${text} (${href})`;
    },
  );
  return withLinks
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|header|footer|blockquote)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
