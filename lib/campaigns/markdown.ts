// ─────────────────────────────────────────────────────────────────────────────
// Telegram-style markdown → email HTML (meeting 2026-09-05: "like Telegram's markdown").
//
// A deliberately SMALL, deterministic renderer with no dependency: the input is escaped
// FIRST, then a handful of inline marks and a few block forms are recognised, so no raw
// HTML the CRRD pastes can ever reach a recipient's mail client — the only tags that come
// out are the ones this file emits. That is the whole sanitisation story for THIS path,
// and it is why the markdown tab needs no allowlist. The composer's other tab accepts a
// designed template pasted from an email builder, where the escape-first guarantee cannot
// hold; that path goes through `lib/campaigns/sanitize.ts` instead (ADR 0014).
//
// Supported, and nothing else:
//   **bold**   __underline__   _italic_ or *italic*   ~~strike~~   `code`
//   [label](https://link)      ![alt](https://image)
//   "# " "## " "### " headings          "> " quote
//   "- " bullet list           "1. " numbered list     "---" divider
//   blank line → paragraph break;  single newline → <br>
//
// Every URL is checked: http(s) only, and anything else renders as plain text rather
// than as a link, so `javascript:` cannot survive the round trip.
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
  // Images BEFORE links: `![alt](url)` contains `[alt](url)`, so the link rule would
  // otherwise consume it and leave a stray "!".
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) => {
    const src = safeUrl(url);
    return src
      ? `<img src="${src}" alt="${alt}" style="max-width:100%;height:auto;display:block;border:0" />`
      : alt;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const href = safeUrl(url);
    return href
      ? `<a href="${href}" style="color:#1d4ed8;text-decoration:underline">${label}</a>`
      : label;
  });
  out = out.replace(
    /`([^`\n]+)`/g,
    '<code style="font-family:ui-monospace,monospace;background:#f3f4f6;padding:0 3px;border-radius:3px">$1</code>',
  );
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_\n]+)__/g, "<u>$1</u>");
  out = out.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  return out;
}

const BULLET = /^\s*-\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const QUOTE = /^\s*>\s?/;
const DIVIDER = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^\s*(#{1,3})\s+(.*)$/;

/** Heading sizes, chosen for email rather than for a web page: modest, and inline-styled. */
const HEADING_STYLE: Record<number, string> = {
  1: "margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700",
  2: "margin:0 0 10px;font-size:18px;line-height:1.35;font-weight:700",
  3: "margin:0 0 8px;font-size:16px;line-height:1.4;font-weight:600",
};

/** The body only — no <html>, no layout. `wrapEmailHtml` adds the frame. */
export function markdownToHtml(markdown: string): string {
  const blocks = markdown
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    if (block.trim() === "") continue;
    const lines = block.split("\n");

    if (DIVIDER.test(block.trim()) && lines.length === 1) {
      html.push('<hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0" />');
      continue;
    }

    if (lines.every((l) => BULLET.test(l))) {
      const items = lines.map((l) => `<li>${inline(escapeHtml(l.replace(BULLET, "")))}</li>`);
      html.push(`<ul style="margin:0 0 12px 20px;padding:0">${items.join("")}</ul>`);
      continue;
    }

    if (lines.every((l) => NUMBERED.test(l))) {
      const items = lines.map((l) => `<li>${inline(escapeHtml(l.replace(NUMBERED, "")))}</li>`);
      html.push(`<ol style="margin:0 0 12px 20px;padding:0">${items.join("")}</ol>`);
      continue;
    }

    if (lines.every((l) => QUOTE.test(l))) {
      const body = lines.map((l) => inline(escapeHtml(l.replace(QUOTE, "")))).join("<br>");
      html.push(
        '<blockquote style="margin:0 0 12px;padding:4px 0 4px 12px;border-left:3px solid #d1d5db;color:#4b5563">' +
          body +
          "</blockquote>",
      );
      continue;
    }

    // A mixed block: heading lines become headings, everything else joins into one
    // paragraph. This is what makes "## Title\nsome text" read the way it is typed.
    let paragraph: string[] = [];
    const flush = () => {
      if (paragraph.length === 0) return;
      html.push(`<p style="margin:0 0 12px">${paragraph.join("<br>")}</p>`);
      paragraph = [];
    };
    for (const line of lines) {
      const heading = HEADING.exec(line);
      if (heading) {
        flush();
        const level = (heading[1] ?? "#").length;
        const text = inline(escapeHtml(heading[2] ?? ""));
        html.push(`<h${level} style="${HEADING_STYLE[level] ?? ""}">${text}</h${level}>`);
        continue;
      }
      paragraph.push(inline(escapeHtml(line)));
    }
    flush();
  }

  return html.join("\n");
}

/** A plain-text alternative: marks stripped, links as "label (url)", bullets as "- ". */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string) =>
      alt.trim() === "" ? "" : `[${alt}]`,
    )
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, label: string, url: string) => `${label} (${url.trim()})`,
    )
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "—")
    .replace(/^\s*(#{1,3})\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
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

/**
 * The frame for a body that came from an email builder (ADR 0014). A designed template
 * carries its OWN width, background and padding — wrapping it in the 600px card above
 * would nest one card inside another and break the design the CCDO built. So this frame
 * is only the document shell plus the sender footer.
 */
export function wrapPastedEmailHtml(sanitizedHtml: string, subject: string): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:0">',
    sanitizedHtml,
    '<div style="padding:16px 24px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#6b7280;text-align:center">Sent by START-DOST through START-SYS.</div>',
    "</body></html>",
  ].join("\n");
}
