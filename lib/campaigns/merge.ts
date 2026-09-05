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

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

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

/** Every distinct token in a template, in order of first appearance. */
export function findMergeTokens(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(TOKEN_RE)) {
    const token = match[1];
    if (token !== undefined) seen.add(token);
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
