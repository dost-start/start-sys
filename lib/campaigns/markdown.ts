// ─────────────────────────────────────────────────────────────────────────────
// Telegram-style markdown → email HTML (meeting 2026-09-05: "like Telegram's markdown").
//
// A deliberately SMALL, deterministic renderer with no dependency: the input is escaped
// FIRST, then a handful of inline marks and two block forms are recognised, so no raw
// HTML the CRRD pastes can ever reach a recipient's mail client — the only tags that come
// out are the ones this file emits. That is the whole sanitisation story, and it is why
// "paste raw HTML" is not offered (ADR 0010: the transport trusts the composer's output).
//
// Supported, and nothing else:
//   **bold**   __underline__   _italic_ or *italic*   ~~strike~~   `code`
//   [label](https://link)      lines starting "- " → a bullet list
//   blank line → paragraph break;  single newline → <br>
//
// Merge tokens (`{{given_name}}`) pass through untouched — lib/campaigns/merge.ts
// substitutes them per recipient AFTER rendering, HTML-escaping each value.
// ─────────────────────────────────────────────────────────────────────────────

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** Only http(s) links survive; anything else renders as plain text. */
function safeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  return /^https?:\/\/[^\s<>"']+$/i.test(trimmed) ? trimmed : null;
}

function inline(escaped: string): string {
  let out = escaped;
  // Links first, so their labels can still carry bold/italic.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const href = safeUrl(url);
    return href ? `<a href="${href}" style="color:#1d4ed8;text-decoration:underline">${label}</a>` : label;
  });
  out = out.replace(/`([^`\n]+)`/g, '<code style="font-family:ui-monospace,monospace;background:#f3f4f6;padding:0 3px;border-radius:3px">$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_\n]+)__/g, "<u>$1</u>");
  out = out.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  return out;
}

/** The body only — no <html>, no layout. `wrapEmailHtml` adds the frame. */
export function markdownToHtml(markdown: string): string {
  const blocks = markdown.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  const html: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length > 0 && lines.every((l) => /^\s*-\s+/.test(l))) {
      const items = lines.map((l) => `<li>${inline(escapeHtml(l.replace(/^\s*-\s+/, "")))}</li>`);
      html.push(`<ul style="margin:0 0 12px 20px;padding:0">${items.join("")}</ul>`);
      continue;
    }
    const paragraph = lines.map((l) => inline(escapeHtml(l))).join("<br>");
    html.push(`<p style="margin:0 0 12px">${paragraph}</p>`);
  }
  return html.join("\n");
}

/** A plain-text alternative: marks stripped, links as "label (url)", bullets as "- ". */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => `${label} (${url.trim()})`)
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .trim();
}

/** The table-based frame that survives Gmail and Outlook; the body html sits inside. */
export function wrapEmailHtml(bodyHtml: string, subject: string): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:0;background:#f6f7f9">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9"><tr><td align="center" style="padding:24px 12px">',
    '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px">',
    '<tr><td style="padding:24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111827">',
    bodyHtml,
    "</td></tr>",
    '<tr><td style="padding:0 24px 20px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#6b7280">Sent by START-DOST through START-SYS.</td></tr>',
    "</table></td></tr></table></body></html>",
  ].join("\n");
}
