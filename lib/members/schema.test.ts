// ─────────────────────────────────────────────────────────────────────────────
// BUILD_PLAN S5-T16's acceptance, asserted.
//
// Two of these compare the schema to SQL rather than to itself:
//
//   · `MEMBER_PATCHABLE_KEYS` against `update_member_record()`'s inline whitelist,
//     parsed out of 0030. A key here the function refuses is a form field that always
//     errors; a key the function allows but the schema strips is a field a CCDO edits
//     and silently loses.
//
//   · `ENDED_REASON_MIN_LENGTH` against the floor in 0028's CHECK and trigger. Set it
//     lower and a reviewer types eight characters and gets a 23514 with no field to
//     attach it to.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildMemberPatch,
  ENDED_REASON_MIN_LENGTH,
  ENDING_STATUSES,
  isEndingStatus,
  MEMBER_NON_PATCHABLE_KEYS,
  MEMBER_PATCHABLE_KEYS,
  memberUpdateSchema,
  membershipStatusUpdateSchema,
} from "@/lib/members/schema";

const PERSON = "88888888-8888-4888-8888-888888888888";
const MEMBERSHIP = "99999999-9999-4999-8999-999999999999";
const NOW_ISO = "2026-09-05T02:00:00.000Z";

/** A minimal valid update: identity, concurrency token, one changed field. */
const baseUpdate = {
  person_id: PERSON,
  expected_updated_at: NOW_ISO,
  given_name: "Maria",
};

const migration = (file: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../supabase/migrations/${file}`, import.meta.url)),
    "utf8",
  );

// ═════════════════════════════════════════════════════════════════════════════
// 1 — the whitelist matches update_member_record()
// ═════════════════════════════════════════════════════════════════════════════

describe("MEMBER_PATCHABLE_KEYS mirrors 0041's whitelist (update_member_record v2)", () => {
  /**
   * Pull the `k not in ( ... )` list out of `update_member_record()`. Scoped to the text
   * after `where k not in (` so the function's other quoted literals cannot be swept in.
   */
  function whitelistFromMigration(): string[] {
    const sql = migration("0041_approve_and_record_v2.sql");
    const marker = "where k not in (";
    const start = sql.indexOf(marker);
    if (start === -1) {
      throw new Error(
        "0041 no longer contains update_member_record()'s `where k not in (` whitelist that " +
          "this test parses. Restore it, or the schema/SQL parity is unguarded.",
      );
    }
    const end = sql.indexOf(")", start);
    const block = sql.slice(start + marker.length, end);
    return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string).sort();
  }

  const parsed = whitelistFromMigration();

  it("positive control: the parser found a non-empty whitelist", () => {
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed).toContain("birthdate");
  });

  it("is set-equal to the SQL whitelist", () => {
    expect([...MEMBER_PATCHABLE_KEYS].sort()).toEqual(parsed);
  });

  it("has nineteen keys and no duplicates", () => {
    expect(MEMBER_PATCHABLE_KEYS).toHaveLength(19);
    expect(new Set(MEMBER_PATCHABLE_KEYS).size).toBe(19);
  });

  it("names none of the columns that must never be patchable", () => {
    for (const forbidden of MEMBER_NON_PATCHABLE_KEYS) {
      expect(MEMBER_PATCHABLE_KEYS as readonly string[]).not.toContain(forbidden);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — the reason floor matches the database
// ═════════════════════════════════════════════════════════════════════════════

describe("ENDED_REASON_MIN_LENGTH matches 0028", () => {
  it("is 10, the floor both the CHECK and the trigger enforce", () => {
    expect(ENDED_REASON_MIN_LENGTH).toBe(10);
  });

  it("appears as the floor in 0028's CHECK and in its trigger body", () => {
    const sql = migration("0028_membership_status_transitions.sql");
    const floors = [
      ...sql.matchAll(/coalesce\(length\(btrim\([a-z_.]+\)\),\s*0\)\s*[<>]=?\s*(\d+)/g),
    ].map((m) => Number(m[1]));
    expect(floors.length).toBeGreaterThan(0);
    for (const floor of floors) expect(floor).toBe(ENDED_REASON_MIN_LENGTH);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — memberUpdateSchema: the whitelist, enforced client-side
// ═════════════════════════════════════════════════════════════════════════════

describe("memberUpdateSchema — strictness", () => {
  it("accepts a minimal valid patch", () => {
    expect(memberUpdateSchema.safeParse(baseUpdate).success).toBe(true);
  });

  it.each(["member_id", "join_year", "id", "redacted_at", "status"])(
    "refuses %s — the exact key an over-helpful form would add",
    (key) => {
      const result = memberUpdateSchema.safeParse({ ...baseUpdate, [key]: "2099-001" });
      expect(result.success).toBe(false);
    },
  );

  it("refuses an unknown key rather than forwarding it to a 22023", () => {
    expect(memberUpdateSchema.safeParse({ ...baseUpdate, nickname: "x" }).success).toBe(false);
  });

  it("refuses a patch that changes nothing", () => {
    const result = memberUpdateSchema.safeParse({
      person_id: PERSON,
      expected_updated_at: NOW_ISO,
    });
    expect(result.success).toBe(false);
  });

  it("requires expected_updated_at — optimistic concurrency is not opt-out (US-D1)", () => {
    const result = memberUpdateSchema.safeParse({ person_id: PERSON, given_name: "Maria" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "expected_updated_at")).toBe(true);
    }
  });

  it("requires a real uuid for person_id", () => {
    expect(memberUpdateSchema.safeParse({ ...baseUpdate, person_id: "nope" }).success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — formats
// ═════════════════════════════════════════════════════════════════════════════

describe("memberUpdateSchema — formats", () => {
  const parse = (patch: Record<string, unknown>) =>
    memberUpdateSchema.safeParse({ person_id: PERSON, expected_updated_at: NOW_ISO, ...patch });

  describe("birthdate", () => {
    it("accepts an ISO date", () => {
      expect(parse({ birthdate: "2004-03-17" }).success).toBe(true);
    });

    it("refuses a future date of birth", () => {
      const nextYear = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const result = parse({ birthdate: nextYear });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(["birthdate"]);
      }
    });

    it("refuses a mistyped century", () => {
      expect(parse({ birthdate: "0204-03-17" }).success).toBe(false);
    });

    it("refuses a non-ISO date rather than coercing it", () => {
      expect(parse({ birthdate: "17/03/2004" }).success).toBe(false);
      expect(parse({ birthdate: "March 17, 2004" }).success).toBe(false);
    });
  });

  describe("contact_number — permissive, both PH forms", () => {
    it.each(["09171234567", "+639171234567", "0917 123 4567", "+63 917-123-4567", "(0917)1234567"])(
      "accepts %s",
      (value) => {
        expect(parse({ contact_number: value }).success).toBe(true);
      },
    );

    it.each(["12345", "639171234567", "0817123456", "abcdefghijk", "091712345678"])(
      "refuses %s",
      (value) => {
        expect(parse({ contact_number: value }).success).toBe(false);
      },
    );
  });

  describe("postal_code — exactly four digits", () => {
    it("accepts 1101", () => {
      expect(parse({ postal_code: "1101" }).success).toBe(true);
    });

    it.each(["110", "11011", "11o1", "1101 "])("refuses %s", (value) => {
      // The trailing-space case is accepted after trim; assert on the trimmed value.
      const result = parse({ postal_code: value });
      expect(result.success).toBe(value.trim().length === 4 && /^\d{4}$/.test(value.trim()));
    });
  });

  describe("personal_email", () => {
    it("trims before validating, so a pasted trailing space is not an error", () => {
      const result = parse({ personal_email: "  scholar@example.com  " });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.personal_email).toBe("scholar@example.com");
    });

    it("refuses a malformed address", () => {
      expect(parse({ personal_email: "scholar@" }).success).toBe(false);
    });
  });

  describe("names", () => {
    it("refuses a blank given_name — people.given_name is NOT NULL with a non-blank CHECK", () => {
      expect(parse({ given_name: "   " }).success).toBe(false);
    });

    it("refuses a blank family_name", () => {
      expect(parse({ family_name: "" }).success).toBe(false);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — the absent / null / value distinction
// ═════════════════════════════════════════════════════════════════════════════

describe("buildMemberPatch — absent means 'leave alone', empty means 'clear'", () => {
  it("includes only the keys that were sent", () => {
    const parsed = memberUpdateSchema.parse({ ...baseUpdate, school: "PUP" });
    const patch = buildMemberPatch(parsed);
    expect(Object.keys(patch).sort()).toEqual(["given_name", "school"]);
  });

  it("maps an empty string to null, so a cleared box actually clears the column", () => {
    // Mapping "" to `undefined` would silently discard the intent and leave the old
    // value in the database — the screen says one thing and the record says another.
    const parsed = memberUpdateSchema.parse({
      person_id: PERSON,
      expected_updated_at: NOW_ISO,
      address_line: "",
    });
    const patch = buildMemberPatch(parsed);
    expect(Object.hasOwn(patch, "address_line")).toBe(true);
    expect(patch.address_line).toBeNull();
  });

  it("never emits a non-patchable key even if one somehow reached the parsed object", () => {
    const parsed = memberUpdateSchema.parse({ ...baseUpdate, suffix: "Jr." });
    const patch = buildMemberPatch(parsed);
    for (const forbidden of MEMBER_NON_PATCHABLE_KEYS) {
      expect(Object.hasOwn(patch, forbidden)).toBe(false);
    }
    expect(Object.hasOwn(patch, "person_id")).toBe(false);
    expect(Object.hasOwn(patch, "expected_updated_at")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 — membershipStatusUpdateSchema
// ═════════════════════════════════════════════════════════════════════════════

describe("membershipStatusUpdateSchema", () => {
  const parse = (input: Record<string, unknown>) =>
    membershipStatusUpdateSchema.safeParse({ membership_id: MEMBERSHIP, ...input });

  const TEN = "unresponsive since June";

  it("accepts a non-ending transition with no reason", () => {
    expect(parse({ status: "active", from_status: "renewal_pending" }).success).toBe(true);
  });

  it.each(ENDING_STATUSES)("requires a reason for %s", (status) => {
    const result = parse({ status });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "ended_reason")).toBe(true);
    }
  });

  it.each(ENDING_STATUSES)("accepts %s with a >=10-character ground", (status) => {
    expect(parse({ status, ended_reason: TEN }).success).toBe(true);
  });

  it("refuses a nine-character ground — the floor matches the database exactly", () => {
    const nine = "a".repeat(ENDED_REASON_MIN_LENGTH - 1);
    expect(parse({ status: "terminated", ended_reason: nine }).success).toBe(false);
    expect(
      parse({ status: "terminated", ended_reason: "a".repeat(ENDED_REASON_MIN_LENGTH) }).success,
    ).toBe(true);
  });

  it("refuses whitespace padded out to ten characters", () => {
    expect(parse({ status: "left", ended_reason: "   ok     " }).success).toBe(false);
  });

  it("requires a FRESH ground on the terminated -> active reinstatement (US-D6)", () => {
    // The target is `active`, which is not an ending status — only `from_status` reveals
    // that 0028 will demand a ground. A reinstatement that inherits the termination's own
    // reason reads as if the Board terminated someone in order to reinstate them.
    const without = parse({ status: "active", from_status: "terminated" });
    expect(without.success).toBe(false);
    if (!without.success) {
      expect(without.error.issues.some((i) => i.path[0] === "ended_reason")).toBe(true);
    }
    expect(parse({ status: "active", from_status: "terminated", ended_reason: TEN }).success).toBe(
      true,
    );
  });

  it("cites the Constitution in the termination message and not in the ordinary one", () => {
    const terminated = parse({ status: "terminated" });
    const left = parse({ status: "left" });
    if (!terminated.success) {
      expect(terminated.error.issues[0]?.message).toContain("Art. VII");
    }
    if (!left.success) {
      expect(left.error.issues[0]?.message).not.toContain("Art. VII");
    }
  });

  it("refuses an unknown status and an unknown key", () => {
    expect(parse({ status: "expired" }).success).toBe(false);
    expect(parse({ status: "active", surprise: 1 }).success).toBe(false);
  });

  it("isEndingStatus agrees with ENDING_STATUSES", () => {
    expect(isEndingStatus("active")).toBe(false);
    expect(isEndingStatus("renewal_pending")).toBe(false);
    for (const status of ENDING_STATUSES) expect(isEndingStatus(status)).toBe(true);
  });
});
