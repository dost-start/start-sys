import { describe, expect, it } from "vitest";

import { escapeHtml, markdownToHtml, markdownToText, wrapEmailHtml } from "./markdown";

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
