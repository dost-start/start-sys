import { describe, expect, it } from "vitest";

import {
  assertNoTokensInAttributes,
  byteLength,
  HTML_BODY_MAX_BYTES,
  HtmlBodyError,
  htmlToText,
  sanitizeCampaignHtml,
} from "./sanitize";

// A cut-down version of what an email builder (Postcards, cloudHQ, Stripo) exports: a
// table layout, inline styles, a hosted image, a link. Everything here must SURVIVE.
const BUILDER_TEMPLATE = `
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;max-width:600px">
  <tr><td align="center" style="padding:24px">
    <img src="https://cdn.example.com/banner.png" alt="START DataCamp" width="552" />
    <h1 style="font-family:Arial,sans-serif;font-size:24px;color:#111827">Congratulations, {{given_name}}!</h1>
    <p style="font-size:15px;line-height:1.5">Your START DataCamp Scholarship is here.</p>
    <a href="https://www.facebook.com/STARTDOST" style="color:#1d4ed8">Go to link</a>
  </td></tr>
</table>`;

describe("sanitizeCampaignHtml — what a real builder template needs, kept", () => {
  it("keeps the table layout, inline styles, https images and links", () => {
    const clean = sanitizeCampaignHtml(BUILDER_TEMPLATE);
    expect(clean).toContain("<table");
    expect(clean).toContain('width="600"');
    expect(clean).toContain("background-color:#ffffff");
    expect(clean).toContain('src="https://cdn.example.com/banner.png"');
    expect(clean).toContain('alt="START DataCamp"');
    expect(clean).toContain("<h1");
    expect(clean).toContain('href="https://www.facebook.com/STARTDOST"');
  });

  it("leaves merge tokens in the text for merge.ts to substitute later", () => {
    expect(sanitizeCampaignHtml(BUILDER_TEMPLATE)).toContain("{{given_name}}");
  });

  it("sends every surviving link to a new tab with noopener", () => {
    const clean = sanitizeCampaignHtml('<p><a href="https://x.example/y">go</a></p>');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });
});

describe("sanitizeCampaignHtml — what must never survive", () => {
  it("drops <script> AND its source, so the code does not become visible text", () => {
    const clean = sanitizeCampaignHtml('<p>hi</p><script>alert("x")</script>');
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert");
    expect(clean).toContain("<p>hi</p>");
  });

  it("drops <style> blocks and their CSS entirely (Ethan, 2026-09-07 — added later if needed)", () => {
    const clean = sanitizeCampaignHtml(
      "<style>@media (max-width:600px){.col{width:100%}} .x{background:url(https://evil.example/t.png)}</style><p>body</p>",
    );
    expect(clean).not.toContain("<style");
    expect(clean).not.toContain("@media");
    expect(clean).not.toContain("evil.example");
    expect(clean).toContain("<p>body</p>");
  });

  it("drops every on* event handler", () => {
    const clean = sanitizeCampaignHtml(
      `<p onclick="steal()" onmouseover="x()"><img src="https://a.example/b.png" onerror="alert(1)" /></p>`,
    );
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onmouseover");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("steal");
  });

  it("refuses javascript: and data: URLs on links and images", () => {
    const link = sanitizeCampaignHtml(`<p><a href="javascript:alert(1)">click</a></p>`);
    expect(link).not.toContain("javascript:");
    expect(link).toContain("click");

    const img = sanitizeCampaignHtml(
      `<p><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="x" /></p>`,
    );
    expect(img).not.toContain("data:");
  });

  it("drops http (non-TLS) and protocol-relative image sources", () => {
    const clean = sanitizeCampaignHtml(
      `<p><img src="http://cdn.example.com/a.png" alt="a" /><img src="//cdn.example.com/b.png" alt="b" /></p>`,
    );
    expect(clean).not.toContain("http://cdn.example.com");
    expect(clean).not.toContain("//cdn.example.com/b.png");
  });

  it("drops iframe, form, input, object, embed, base, meta and link tags", () => {
    const clean = sanitizeCampaignHtml(
      `<p>keep</p><iframe src="https://x.example"></iframe><form action="https://x.example/steal">` +
        `<input name="password" /></form><object data="x"></object><embed src="x" />` +
        `<base href="https://x.example/" /><meta http-equiv="refresh" content="0" />` +
        `<link rel="stylesheet" href="https://x.example/a.css" />`,
    );
    for (const tag of [
      "<iframe",
      "<form",
      "<input",
      "<object",
      "<embed",
      "<base",
      "<meta",
      "<link",
    ]) {
      expect(clean).not.toContain(tag);
    }
    expect(clean).toContain("<p>keep</p>");
  });

  it("drops a style property carrying url() or expression()", () => {
    const clean = sanitizeCampaignHtml(
      `<div style="background-image:url(https://evil.example/x.png);width:100%;color:red">x</div>`,
    );
    expect(clean).not.toContain("evil.example");
    expect(clean).not.toContain("background-image");
    // The safe properties beside it survive — this is a property filter, not a style purge.
    expect(clean).toContain("width:100%");
    expect(clean).toContain("color:red");
  });

  it("drops a style property whose value is not in the safe value shape", () => {
    const clean = sanitizeCampaignHtml(
      `<div style="color:expression(alert(1));padding:8px">x</div>`,
    );
    expect(clean).not.toContain("expression");
    expect(clean).toContain("padding:8px");
  });

  it("keeps rgb()/rgba() colours — the value pattern bans bare parens, not colour functions", () => {
    const clean = sanitizeCampaignHtml(
      `<div style="color:rgb(17, 24, 39);background-color:rgba(255,255,255,0.9)">x</div>`,
    );
    expect(clean).toContain("rgb(17, 24, 39)");
    expect(clean).toContain("rgba(255,255,255,0.9)");
  });

  it("drops any other function call in a style value, url() and expression() included", () => {
    for (const value of [
      "background:url(https://evil.example/x.png)",
      "width:calc(100% - 10px)",
      "color:image-set(https://evil.example/a.png)",
    ]) {
      const clean = sanitizeCampaignHtml(`<div style="${value};padding:8px">x</div>`);
      expect(clean).not.toContain("(");
      expect(clean).toContain("padding:8px");
    }
  });

  it("drops an unknown tag but keeps its text", () => {
    const clean = sanitizeCampaignHtml("<marquee>scrolling</marquee><custom-el>text</custom-el>");
    expect(clean).not.toContain("<marquee");
    expect(clean).not.toContain("<custom-el");
    expect(clean).toContain("scrolling");
    expect(clean).toContain("text");
  });
});

describe("merge tokens in attributes are refused, not escaped", () => {
  it("refuses a token inside a double-quoted attribute", () => {
    expect(() =>
      assertNoTokensInAttributes('<a href="https://x.example/{{given_name}}">x</a>'),
    ).toThrow(HtmlBodyError);
    expect(() => sanitizeCampaignHtml('<a href="https://x.example/{{member_id}}">x</a>')).toThrow(
      /attribute/i,
    );
  });

  it("refuses a token inside a single-quoted attribute", () => {
    expect(() =>
      sanitizeCampaignHtml("<img src='https://x.example/{{member_id}}.png' alt='x' />"),
    ).toThrow(HtmlBodyError);
  });

  it("refuses a token inside an UNQUOTED attribute (valid HTML5, easy to miss)", () => {
    expect(() => assertNoTokensInAttributes("<a href={{given_name}}>x</a>")).toThrow(HtmlBodyError);
    expect(() => sanitizeCampaignHtml("<img src={{member_id}} alt=x />")).toThrow(/attribute/i);
  });

  it("allows a token in visible text", () => {
    expect(() => assertNoTokensInAttributes("<p>Hi {{given_name}}</p>")).not.toThrow();
  });
});

describe("size", () => {
  it("counts bytes, not characters", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("Peña")).toBe(5);
  });

  it("refuses a body over 200 KB after sanitising", () => {
    const huge = `<p>${"x".repeat(HTML_BODY_MAX_BYTES + 100)}</p>`;
    expect(() => sanitizeCampaignHtml(huge)).toThrow(/larger than 200 KB/);
  });

  it("accepts a body just under the cap", () => {
    const big = `<p>${"x".repeat(HTML_BODY_MAX_BYTES - 100)}</p>`;
    expect(byteLength(sanitizeCampaignHtml(big))).toBeLessThanOrEqual(HTML_BODY_MAX_BYTES);
  });

  it("refuses a body that sanitises to nothing", () => {
    expect(() => sanitizeCampaignHtml("<script>alert(1)</script>")).toThrow(/nothing usable/i);
  });
});

describe("htmlToText — the plain-text alternative", () => {
  it("turns links into label (url) and blocks into line breaks", () => {
    const text = htmlToText(
      '<p>Hi {{given_name}}</p><p>See <a href="https://x.example/y">the form</a>.</p>',
    );
    expect(text).toContain("Hi {{given_name}}");
    expect(text).toContain("the form (https://x.example/y)");
  });

  it("strips tags, unescapes entities and collapses blank runs", () => {
    const text = htmlToText("<div>A&nbsp;&amp;&nbsp;B</div><br><br><br><div>C</div>");
    expect(text).toContain("A & B");
    expect(text).toContain("C");
    expect(text).not.toContain("<");
    expect(text).not.toContain("\n\n\n");
  });

  it("renders list items as dashes", () => {
    expect(htmlToText("<ul><li>one</li><li>two</li></ul>")).toContain("- one");
  });
});
