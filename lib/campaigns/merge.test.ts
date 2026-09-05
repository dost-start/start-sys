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
