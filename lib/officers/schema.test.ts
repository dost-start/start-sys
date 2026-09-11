// ─────────────────────────────────────────────────────────────────────────────
// `officerCandidateSearchSchema` (Officer feedback 2026-09-11: appoint by name).
//
// ⚠ The whitelist is a SECURITY control: the first word of `q` is interpolated into a
// PostgREST filter string (lib/officers/candidate-match.ts). The refusals below are the
// point of this file; the acceptances only prove the whitelist is not so tight that a
// real name fails.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import {
  OFFICER_CANDIDATE_GROUP_STATUSES,
  OFFICER_CANDIDATE_GROUPS,
  OFFICER_CANDIDATE_QUERY_MAX_LENGTH,
  officerCandidateSearchSchema,
  type MembershipStatus,
} from "@/lib/officers/schema";

const WHITELIST_MESSAGE = "Use letters, numbers, spaces, periods, hyphens or apostrophes only.";

describe("officerCandidateSearchSchema accepts", () => {
  it.each(["Peña", "O'Neil", "dela Cruz", "2026-0001", "", "Ma. Clara", "Nuñez-Reyes"])(
    "%j",
    (q) => {
      expect(officerCandidateSearchSchema.safeParse({ q }).success).toBe(true);
    },
  );

  it("trims, and defaults the group to active", () => {
    expect(officerCandidateSearchSchema.parse({ q: "  dela Cruz  " })).toEqual({
      q: "dela Cruz",
      group: "active",
    });
  });

  it("turns a phone keyboard's curly apostrophe into a straight one", () => {
    expect(officerCandidateSearchSchema.parse({ q: "O’Neil" }).q).toBe("O'Neil");
  });

  it.each(OFFICER_CANDIDATE_GROUPS)("the %s group", (group) => {
    expect(officerCandidateSearchSchema.safeParse({ q: "a", group }).success).toBe(true);
  });
});

describe("officerCandidateSearchSchema refuses", () => {
  it.each(["a,b", "a%", "a(b)", '"a"', "a*", "a_b", "a\\b", "a:b", "a)", "a\tb"])(
    "%j, with the whitelist message",
    (q) => {
      const result = officerCandidateSearchSchema.safeParse({ q });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain(WHITELIST_MESSAGE);
    },
  );

  it(`a query over ${OFFICER_CANDIDATE_QUERY_MAX_LENGTH} characters, measured after trimming`, () => {
    const longest = "a".repeat(OFFICER_CANDIDATE_QUERY_MAX_LENGTH);
    expect(officerCandidateSearchSchema.safeParse({ q: `${longest}a` }).success).toBe(false);
    expect(officerCandidateSearchSchema.safeParse({ q: `  ${longest}  ` }).success).toBe(true);
  });

  it("an unknown group, including a membership status no group offers", () => {
    for (const group of ["terminated", "renewal_pending", "left", ""]) {
      expect(officerCandidateSearchSchema.safeParse({ q: "a", group }).success).toBe(false);
    }
  });

  it("an unknown key", () => {
    expect(officerCandidateSearchSchema.safeParse({ q: "a", member_id: "2026-0001" }).success).toBe(
      false,
    );
  });

  it("a missing or non-string q", () => {
    expect(officerCandidateSearchSchema.safeParse({}).success).toBe(false);
    expect(officerCandidateSearchSchema.safeParse({ q: 7 }).success).toBe(false);
  });
});

describe("OFFICER_CANDIDATE_GROUP_STATUSES", () => {
  it("maps each group to exactly its statuses", () => {
    expect(OFFICER_CANDIDATE_GROUP_STATUSES).toEqual({
      active: ["active"],
      graduated: ["graduated"],
      resigned: ["resigned", "left"],
    });
  });

  it("never offers terminated or renewal_pending", () => {
    const offered: MembershipStatus[] = Object.values(OFFICER_CANDIDATE_GROUP_STATUSES).flat();
    expect(offered).not.toContain("terminated");
    expect(offered).not.toContain("renewal_pending");
  });
});
