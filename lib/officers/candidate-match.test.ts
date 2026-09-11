// ─────────────────────────────────────────────────────────────────────────────
// The appoint dialog's search rule (Officer feedback 2026-09-11: appoint by name).
//
// Prefix per word, every word must land, case-insensitive — and the database half: the
// exact filter string built from the first word, and its refusal to build one from
// anything outside the whitelist. The refusals are the security half of this file.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import {
  candidateNameFilter,
  MAX_QUERY_WORDS,
  matchesCandidateQuery,
  queryWords,
} from "@/lib/officers/candidate-match";
import { officerCandidateSearchSchema } from "@/lib/officers/schema";

const JUAN_SANTOS = { given_name: "Juan", family_name: "Santos", member_id: "2026-0001" };
const JUAN_MIGUEL = { given_name: "Juan Miguel", family_name: "Dela Cruz", member_id: null };
const MARIA_PENA = { given_name: "María", family_name: "Peña", member_id: "NCR-2025-0042" };

describe("matchesCandidateQuery", () => {
  it("matches a single letter that starts the given name", () => {
    expect(matchesCandidateQuery(JUAN_SANTOS, "j")).toBe(true);
  });

  it("matches a single letter that starts the family name", () => {
    expect(matchesCandidateQuery(JUAN_SANTOS, "s")).toBe(true);
  });

  it("refuses a letter that starts no token", () => {
    expect(matchesCandidateQuery(JUAN_SANTOS, "m")).toBe(false);
  });

  it("needs every word: 'juan san' finds Juan Santos, 'juan reyes' does not", () => {
    expect(matchesCandidateQuery(JUAN_SANTOS, "juan san")).toBe(true);
    expect(matchesCandidateQuery(JUAN_SANTOS, "juan reyes")).toBe(false);
  });

  it("is a prefix match, not a substring match: 'an' does not find Juan", () => {
    expect(matchesCandidateQuery(JUAN_SANTOS, "an")).toBe(false);
    expect(matchesCandidateQuery(JUAN_SANTOS, "tos")).toBe(false);
  });

  it("finds a second given name: 'miguel' finds Juan Miguel", () => {
    expect(matchesCandidateQuery(JUAN_MIGUEL, "miguel")).toBe(true);
    expect(matchesCandidateQuery(JUAN_MIGUEL, "mig dela")).toBe(true);
  });

  it("finds a later word of the family name: 'cruz' finds Dela Cruz", () => {
    expect(matchesCandidateQuery(JUAN_MIGUEL, "cruz")).toBe(true);
  });

  it("matches a member ID prefix, and only a prefix", () => {
    expect(matchesCandidateQuery(JUAN_SANTOS, "2026-00")).toBe(true);
    expect(matchesCandidateQuery(JUAN_SANTOS, "0001")).toBe(false);
  });

  it("never matches a member-ID query against someone with no member ID", () => {
    expect(matchesCandidateQuery(JUAN_MIGUEL, "2026")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesCandidateQuery(JUAN_SANTOS, "JUAN SANTOS")).toBe(true);
    expect(matchesCandidateQuery(JUAN_SANTOS, "jUaN sAn")).toBe(true);
    expect(matchesCandidateQuery(MARIA_PENA, "ncr-2025")).toBe(true);
  });

  it("folds accented letters by case and by Unicode composition", () => {
    expect(matchesCandidateQuery(MARIA_PENA, "PEÑA")).toBe(true);
    // "n" + U+0303 COMBINING TILDE, as some keyboards send it (escaped so no editor recomposes it).
    expect(matchesCandidateQuery(MARIA_PENA, "pen\u0303a")).toBe(true);
    // Accent-insensitive search is NOT promised: the database's ilike does not fold it either.
    expect(matchesCandidateQuery(MARIA_PENA, "pena")).toBe(false);
  });

  it("matches everyone on a blank query", () => {
    expect(matchesCandidateQuery(JUAN_SANTOS, "")).toBe(true);
    expect(matchesCandidateQuery(JUAN_SANTOS, "   ")).toBe(true);
  });
});

describe("queryWords", () => {
  it("splits on any run of whitespace and lower-cases", () => {
    expect(queryWords("  Dela   CRUZ ")).toEqual(["dela", "cruz"]);
  });

  it(`keeps at most ${MAX_QUERY_WORDS} words`, () => {
    expect(queryWords("a b c d e f")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("candidateNameFilter", () => {
  it("builds the exact PostgREST or-filter for one word", () => {
    expect(candidateNameFilter("dela")).toBe(
      'given_name.ilike."dela*",given_name.ilike."* dela*",' +
        'family_name.ilike."dela*",family_name.ilike."* dela*",member_id.ilike."dela*"',
    );
  });

  it("quotes words carrying a hyphen, apostrophe or period", () => {
    expect(candidateNameFilter("2026-00")).toContain('member_id.ilike."2026-00*"');
    expect(candidateNameFilter("o'neil")).toContain(`family_name.ilike."o'neil*"`);
    expect(candidateNameFilter("ma.")).toContain('given_name.ilike."ma.*"');
  });

  it.each([",", "(", ")", '"', "*", "%", "_", "\\", ":", "a b", "", "a,b", 'a"),id.eq.(x'])(
    "throws rather than build a filter from %j",
    (word) => {
      expect(() => candidateNameFilter(word)).toThrow();
    },
  );

  it("builds a filter from every word of every query the schema accepts", () => {
    for (const q of ["Peña", "O'Neil", "dela Cruz", "2026-0001", "Ma. Clara", "İSTANBUL"]) {
      const parsed = officerCandidateSearchSchema.parse({ q });
      for (const word of queryWords(parsed.q)) {
        expect(() => candidateNameFilter(word)).not.toThrow();
      }
    }
  });
});
