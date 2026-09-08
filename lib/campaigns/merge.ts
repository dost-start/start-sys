// ─────────────────────────────────────────────────────────────────────────────
// Mail merge (PRD US-G3): `{{token}}` substitution against the whitelist of
// `v_email_merge_fields` columns, and NOTHING else.
//
// Two properties are load-bearing (ARCHITECTURE.md §4.2):
//   • an unknown token THROWS — the send fails before a single message goes out, rather
//     than shipping a literal `{{frist_name}}` to 600 scholars;
//   • every value is HTML-escaped when merging into HTML — a name containing markup
//     cannot inject into another recipient's mail.
// ─────────────────────────────────────────────────────────────────────────────

import { escapeHtml } from "./markdown";

/** Exactly the columns of `v_email_merge_fields` that a body may reference (0043). */
export const MERGE_FIELDS = [
  "given_name",
  "family_name",
  "member_id",
  "join_year",
  "region_name",
  "island_group",
  "term_label",
  "year_level",
  "committee_name",
  "department_name",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

export type MergePayload = Partial<Record<MergeField, string | number | null>>;

/** What a substitutable token looks like: a whitelist field name, whitespace tolerated. */
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * What a token ATTEMPT looks like: any `{{…}}` at all.
 *
 * Both patterns exist because the strict one alone was a hole. `{{First Name}}` — the
 * spelling every other mail-merge tool uses, and the one on the template the CCDO
 * pasted on 2026-09-07 — does not match `TOKEN_RE` (the space breaks it), so it was
 * neither substituted nor reported: it went out to the recipient as the literal text
 * `{{First Name}}`. That is precisely the failure US-G3 exists to prevent
 * ("an unrecognized merge token fails the send with a clear error rather than shipping
 * literal placeholder text to recipients"). Anything brace-wrapped that is not a
 * whitelist field is now an unknown token.
 */
const TOKEN_ATTEMPT_RE = /\{\{([^{}]*)\}\}/g;

export class UnknownMergeTokenError extends Error {
  readonly name = "UnknownMergeTokenError";
  readonly tokens: readonly string[];
  constructor(tokens: readonly string[]) {
    super(
      `Unknown merge token${tokens.length > 1 ? "s" : ""}: ${tokens.map((t) => `{{${t}}}`).join(", ")}. ` +
        `Allowed: ${MERGE_FIELDS.map((f) => `{{${f}}}`).join(", ")}.`,
    );
    this.tokens = tokens;
  }
}

function isMergeField(value: string): value is MergeField {
  return (MERGE_FIELDS as readonly string[]).includes(value);
}

/**
 * Every distinct token ATTEMPT in a template, trimmed, in order of first appearance.
 * `{{ given_name }}` and `{{given_name}}` are one token; `{{First Name}}` is a token
 * too — an unknown one — rather than invisible text.
 */
export function findMergeTokens(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(TOKEN_ATTEMPT_RE)) {
    const token = match[1];
    if (token !== undefined) seen.add(token.trim());
  }
  return [...seen];
}

/** The tokens a template uses that the whitelist does not know. Empty means safe to send. */
export function unknownMergeTokens(template: string): string[] {
  return findMergeTokens(template).filter((t) => !isMergeField(t));
}

/** Throws UnknownMergeTokenError; use before a campaign is created, and again before it is sent. */
export function assertMergeTokensKnown(template: string): void {
  const unknown = unknownMergeTokens(template);
  if (unknown.length > 0) throw new UnknownMergeTokenError(unknown);
}

function valueOf(payload: MergePayload, field: MergeField): string {
  const value = payload[field];
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Substitute into plain text (the subject, the text alternative). Throws on an unknown token. */
export function mergeText(template: string, payload: MergePayload): string {
  assertMergeTokensKnown(template);
  return template.replace(TOKEN_RE, (_m, token: string) => valueOf(payload, token as MergeField));
}

/** Substitute into rendered HTML, escaping every value. Throws on an unknown token. */
export function mergeHtml(templateHtml: string, payload: MergePayload): string {
  assertMergeTokensKnown(templateHtml);
  return templateHtml.replace(TOKEN_RE, (_m, token: string) =>
    escapeHtml(valueOf(payload, token as MergeField)),
  );
}
