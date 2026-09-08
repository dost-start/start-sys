import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  markdownToHtml,
  markdownToText,
  wrapEmailHtml,
  wrapPastedEmailHtml,
} from "./markdown";

describe("markdownToHtml — the Telegram-style subset", () => {
  it("renders the inline marks", () => {
    const html = markdownToHtml("**bold** __under__ _ital_ *ital2* ~~gone~~ `code`");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<u>under</u>");
    expect(html).toContain("<em>ital</em>");
    expect(html).toContain("<em>ital2</em>");
    expect(html).toContain("<s>gone</s>");
    expect(html).toContain(">code</code>");
  });

  it("renders http(s) links and refuses everything else", () => {
    expect(markdownToHtml("[Apply](https://start.example/apply)")).toContain(
      '<a href="https://start.example/apply"',
    );
    const bad = markdownToHtml("[click](javascript:alert(1))");
    expect(bad).not.toContain("<a ");
    expect(bad).toContain("click");
  });

  it("escapes raw HTML — the CRRD cannot inject markup, only use the marks", () => {
    const html = markdownToHtml('<script>alert("x")</script> & <b>no</b>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).not.toContain("<b>");
  });

  it("makes paragraphs from blank lines, <br> from single newlines, lists from dashes", () => {
    const html = markdownToHtml("line one\nline two\n\n- a\n- b\n\nlast");
    expect(html).toContain("line one<br>line two");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>a</li><li>b</li>");
    expect((html.match(/<p /g) ?? []).length).toBe(2);
  });

  it("leaves merge tokens alone for merge.ts to substitute later", () => {
    expect(markdownToHtml("Hi {{given_name}}")).toContain("{{given_name}}");
  });
});

describe("markdownToText", () => {
  it("strips marks and expands links", () => {
    expect(markdownToText("**Hi** _there_ [Apply](https://x.y/z)")).toBe(
      "Hi there Apply (https://x.y/z)",
    );
  });
});

describe("wrapEmailHtml", () => {
  it("is a table-based document with the subject as its title, escaped", () => {
    const doc = wrapEmailHtml("<p>x</p>", 'A <"subject">');
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("<title>A &lt;&quot;subject&quot;&gt;</title>");
    expect(doc).toContain('<table role="presentation"');
    expect(doc).toContain("<p>x</p>");
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters and nothing else", () => {
    expect(escapeHtml(`&<>"' ok`)).toBe("&amp;&lt;&gt;&quot;&#39; ok");
  });
});

describe("markdownToHtml — the 2026-09-07 additions (ADR 0014)", () => {
  it("renders one, two and three hashes as h1, h2 and h3", () => {
    const html = markdownToHtml("# One\n\n## Two\n\n### Three");
    expect(html).toContain("<h1 ");
    expect(html).toContain(">One</h1>");
    expect(html).toContain(">Two</h2>");
    expect(html).toContain(">Three</h3>");
  });

  it("renders four hashes as ordinary text, not an h4", () => {
    expect(markdownToHtml("#### Four")).not.toContain("<h4");
  });

  it("splits a heading away from the text under it in the same block", () => {
    const html = markdownToHtml("## Title\nbody text");
    expect(html).toContain(">Title</h2>");
    expect(html).toContain('<p style="margin:0 0 12px">body text</p>');
  });

  it("renders an https image and refuses any other scheme", () => {
    const good = markdownToHtml("![Banner](https://cdn.example.com/a.png)");
    expect(good).toContain('<img src="https://cdn.example.com/a.png"');
    expect(good).toContain('alt="Banner"');
    expect(good).toContain("max-width:100%");

    const bad = markdownToHtml("![x](javascript:alert(1))");
    expect(bad).not.toContain("<img");
    expect(bad).toContain("x");
  });

  it("does not let an image be swallowed by the link rule", () => {
    const html = markdownToHtml("![alt](https://x.example/i.png)");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain(">!");
  });

  it("renders a numbered list, with either 1. or 1) ", () => {
    const html = markdownToHtml("1. first\n2. second");
    expect(html).toContain("<ol");
    expect(html).toContain("<li>first</li><li>second</li>");
    expect(markdownToHtml("1) a\n2) b")).toContain("<ol");
  });

  it("renders a quote block", () => {
    const html = markdownToHtml("> quoted line\n> second line");
    expect(html).toContain("<blockquote");
    expect(html).toContain("quoted line<br>second line");
  });

  it("renders three or more dashes as a divider", () => {
    expect(markdownToHtml("above\n\n---\n\nbelow")).toContain("<hr ");
    expect(markdownToHtml("***")).toContain("<hr ");
  });

  it("still escapes raw HTML in every new block form", () => {
    const html = markdownToHtml("# <script>x</script>\n\n> <b>q</b>\n\n1. <i>n</i>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("markdownToText — the additions", () => {
  it("drops heading and quote markers and names an image by its alt text", () => {
    const text = markdownToText("## Title\n\n> quoted\n\n![Banner](https://x.example/a.png)");
    expect(text).toContain("Title");
    expect(text).not.toContain("##");
    expect(text).toContain("quoted");
    expect(text).not.toContain(">");
    expect(text).toContain("[Banner]");
    expect(text).not.toContain("https://x.example/a.png");
  });

  it("renders a divider as a dash rather than three", () => {
    expect(markdownToText("a\n\n---\n\nb")).toContain("\u2014");
  });
});

describe("wrapPastedEmailHtml", () => {
  it("adds only the document shell and the footer — never a second card around the design", () => {
    const doc = wrapPastedEmailHtml('<table width="600"><tr><td>x</td></tr></table>', "Subj");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("<title>Subj</title>");
    expect(doc).toContain('<table width="600">');
    expect(doc).toContain("Sent by START-DOST through START-SYS.");
    // The markdown frame's 600px card must NOT be here — the template carries its own.
    expect(doc).not.toContain("border-radius:8px");
  });

  it("escapes the subject in the title", () => {
    expect(wrapPastedEmailHtml("<p>x</p>", 'A <"s">')).toContain(
      "<title>A &lt;&quot;s&quot;&gt;</title>",
    );
  });
});
