import { describe, expect, it } from "vitest";

import {
  assertMergeTokensKnown,
  findMergeTokens,
  MERGE_FIELDS,
  mergeHtml,
  mergeText,
  UnknownMergeTokenError,
  unknownMergeTokens,
} from "./merge";

const PAYLOAD = {
  given_name: "María <Ana>",
  family_name: "Peña",
  member_id: "2026-0007",
  join_year: 2026,
  region_name: "NCR",
  island_group: "Luzon",
  term_label: "2026-2027",
  year_level: 2,
  committee_name: null,
  department_name: null,
};

describe("merge tokens", () => {
  it("finds distinct tokens in order, tolerating inner whitespace", () => {
    expect(findMergeTokens("{{ given_name }} and {{member_id}} and {{given_name}}")).toEqual([
      "given_name",
      "member_id",
    ]);
  });

  it("knows exactly the ten v_email_merge_fields columns", () => {
    expect(MERGE_FIELDS).toHaveLength(10);
    expect(unknownMergeTokens("{{given_name}} {{region_name}} {{department_name}}")).toEqual([]);
  });

  it("an unknown token FAILS the send rather than shipping {{frist_name}} to 600 scholars", () => {
    expect(unknownMergeTokens("Hi {{frist_name}}")).toEqual(["frist_name"]);
    expect(() => assertMergeTokensKnown("Hi {{frist_name}}")).toThrow(UnknownMergeTokenError);
    expect(() => mergeText("{{birthdate}}", PAYLOAD)).toThrow(/birthdate/);
  });

  it("a sensitive column is not a token — birthdate and contact_number are simply unknown", () => {
    expect(unknownMergeTokens("{{contact_number}} {{birthdate}} {{personal_email}}")).toEqual([
      "contact_number",
      "birthdate",
      "personal_email",
    ]);
  });

  it("substitutes plain text verbatim and HTML with every value escaped", () => {
    expect(mergeText("Hi {{given_name}} ({{member_id}})", PAYLOAD)).toBe(
      "Hi María <Ana> (2026-0007)",
    );
    expect(mergeHtml("<p>Hi {{given_name}}</p>", PAYLOAD)).toBe("<p>Hi María &lt;Ana&gt;</p>");
  });

  it("renders a null merge value as empty rather than the word null", () => {
    expect(mergeText("Committee: {{committee_name}}.", PAYLOAD)).toBe("Committee: .");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression, found 2026-09-07 while looking at the template the CCDO pasted into
// Gmail, which used `{{First Name}}`. Before the fix, a token with a space in it
// matched no pattern at all: it was not substituted AND not reported, so it went out
// to the recipient as literal text — the exact outcome US-G3 forbids.
// ─────────────────────────────────────────────────────────────────────────────
describe("a token that is brace-shaped but not a field is UNKNOWN, never literal text", () => {
  it("catches {{First Name}} — the spelling other mail-merge tools use", () => {
    expect(unknownMergeTokens("Congratulations, {{First Name}}!")).toEqual(["First Name"]);
    expect(() => assertMergeTokensKnown("Congratulations, {{First Name}}!")).toThrow(
      UnknownMergeTokenError,
    );
    expect(() => mergeText("Hi {{First Name}}", PAYLOAD)).toThrow(/First Name/);
    expect(() => mergeHtml("<p>Hi {{First Name}}</p>", PAYLOAD)).toThrow(/First Name/);
  });

  it("catches the other shapes a person reasonably tries", () => {
    expect(unknownMergeTokens("{{first name}} {{Given Name}} {{name}} {{}}")).toEqual([
      "first name",
      "Given Name",
      "name",
      "",
    ]);
  });

  it("still treats inner whitespace around a REAL field as the same token", () => {
    expect(unknownMergeTokens("{{ given_name }}")).toEqual([]);
    expect(mergeText("{{ given_name }}", PAYLOAD)).toBe("María <Ana>");
  });
});
