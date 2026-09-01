// ─────────────────────────────────────────────────────────────────────────────
// BUILD_PLAN S5-T15's acceptance, asserted.
//
// THE LOAD-BEARING TEST IS THE FIRST ONE, and it is the only test in this repo that
// reads a migration off disk.
//
// The membership edge set exists twice — as an inline VALUES list inside
// `enforce_membership_transition()` (0028) and as `LEGAL_EDGES` in transitions.ts.
// Nothing else compares them: adding an edge to the SQL passes typecheck, passes lint,
// passes every other pgTAP file, and shows up as a status the editor silently refuses
// to offer. Adding one to the TypeScript alone shows up as a dropdown entry that raises
// 23514 when a CCDO clicks it.
//
// So this file parses the SQL. If the parse itself breaks — the sentinels renamed, the
// list reformatted — the test fails loudly rather than quietly comparing an empty set
// to an empty set, which is what the two guard assertions below are for.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Constants } from "@/database.types";
import {
  canTransition,
  isLegalEdge,
  isTerminalStatus,
  LEGAL_EDGES,
  legalNextStatuses,
  MEMBERSHIP_STATUS_LABELS,
  requiresWrittenGround,
  STATUS_WRITER_ROLES,
  TERMINATION_ROLE,
  type MembershipEdge,
  type MembershipStatus,
  type OrgRole,
} from "@/lib/members/transitions";

const MIGRATION_PATH = fileURLToPath(
  new URL("../../supabase/migrations/0028_membership_status_transitions.sql", import.meta.url),
);

const BEGIN_SENTINEL = "── BEGIN LEGAL EDGE LIST";
const END_SENTINEL = "── END LEGAL EDGE LIST";

/**
 * Extract the `('from', 'to')` pairs between 0028's sentinel comments.
 *
 * Scoped to the sentinels rather than the whole file so the two other quoted status
 * literals in that migration — the INSERT branch's `('active', 'renewal_pending')`
 * membership-birth check — cannot be mistaken for edges.
 */
function edgesFromMigration(): MembershipEdge[] {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  const begin = sql.indexOf(BEGIN_SENTINEL);
  const end = sql.indexOf(END_SENTINEL);
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error(
      `0028 no longer contains the BEGIN/END LEGAL EDGE LIST sentinels this test parses. ` +
        `Restore them, or this file silently stops guarding the SQL/TypeScript parity.`,
    );
  }

  const block = sql.slice(begin + BEGIN_SENTINEL.length, end);

  const pairs: MembershipEdge[] = [];
  const re = /\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/g;
  let match = re.exec(block);
  while (match !== null) {
    pairs.push({ from: match[1] as MembershipStatus, to: match[2] as MembershipStatus });
    match = re.exec(block);
  }
  return pairs;
}

const key = (edge: MembershipEdge): string => `${edge.from} -> ${edge.to}`;
const keySet = (edges: readonly MembershipEdge[]): string[] => edges.map(key).sort();

const ALL_STATUSES = Constants.public.Enums.membership_status;
const ALL_ROLES = Constants.public.Enums.org_role;

// ═════════════════════════════════════════════════════════════════════════════
// 1 — SQL / TypeScript parity. Positive control first.
// ═════════════════════════════════════════════════════════════════════════════

describe("LEGAL_EDGES mirrors 0028's inline VALUES list", () => {
  const parsed = edgesFromMigration();

  it("positive control: the parser actually found edges", () => {
    // Without this, a broken regex would compare [] to [] on a future refactor and
    // report green while guarding nothing.
    expect(parsed.length).toBeGreaterThan(0);
    expect(keySet(parsed)).toContain("active -> terminated");
  });

  it("positive control: every parsed value is a real membership_status", () => {
    for (const edge of parsed) {
      expect(ALL_STATUSES).toContain(edge.from);
      expect(ALL_STATUSES).toContain(edge.to);
    }
  });

  it("is set-equal to the SQL — adding an edge in one place and not the other fails here", () => {
    expect(keySet(LEGAL_EDGES)).toEqual(keySet(parsed));
  });

  it("has no duplicate edges on either side", () => {
    expect(new Set(keySet(LEGAL_EDGES)).size).toBe(LEGAL_EDGES.length);
    expect(new Set(keySet(parsed)).size).toBe(parsed.length);
  });

  it("has exactly the seven edges DATA_MODEL.md §3.1 draws", () => {
    expect(LEGAL_EDGES).toHaveLength(7);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — terminal statuses have no outgoing edge
// ═════════════════════════════════════════════════════════════════════════════

describe("terminal statuses", () => {
  const terminal: MembershipStatus[] = ["graduated", "resigned", "left"];

  it.each(terminal)("%s offers nothing to any role — a returning member gets a NEW row", (from) => {
    for (const role of ALL_ROLES) {
      expect(legalNextStatuses(from, role)).toEqual([]);
    }
    expect(isTerminalStatus(from)).toBe(true);
  });

  it.each(terminal)("%s -> active is not a legal edge at all (23514, not 42501)", (from) => {
    expect(isLegalEdge(from, "active")).toBe(false);
    expect(canTransition(from, "active", "exec_admin")).toBe(false);
  });

  it("active, renewal_pending and terminated are NOT terminal", () => {
    expect(isTerminalStatus("active")).toBe(false);
    expect(isTerminalStatus("renewal_pending")).toBe(false);
    // The one non-terminal ending in the schema — CBL Art. VII §3.2.5-3.2.6.
    expect(isTerminalStatus("terminated")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — the two terminated edges are exec_admin's, in BOTH directions
// ═════════════════════════════════════════════════════════════════════════════

describe("terminated is exec_admin only (CBL Art. VII §3.2.3, §3.2.5-3.2.6)", () => {
  it("exec_admin may record a termination", () => {
    expect(legalNextStatuses("active", "exec_admin")).toContain("terminated");
    expect(canTransition("active", "terminated", "exec_admin")).toBe(true);
  });

  it("exec_admin may reverse one on a successful appeal (US-D6, the only reversal)", () => {
    expect(legalNextStatuses("terminated", "exec_admin")).toEqual(["active"]);
    expect(canTransition("terminated", "active", "exec_admin")).toBe(true);
  });

  it("crrd_admin and moderator own every OTHER transition but not this one", () => {
    for (const role of ["crrd_admin", "moderator"] as const) {
      expect(legalNextStatuses("active", role)).toEqual(["graduated", "left", "resigned"]);
      expect(legalNextStatuses("active", role)).not.toContain("terminated");
      expect(canTransition("active", "terminated", role)).toBe(false);
      // The reversal is hidden from them too: memberships_update's USING half means
      // they cannot even see a terminated row for update.
      expect(legalNextStatuses("terminated", role)).toEqual([]);
      expect(canTransition("terminated", "active", role)).toBe(false);
    }
  });

  it.each(ALL_ROLES.filter((r) => r !== TERMINATION_ROLE))(
    "%s cannot cross either terminated edge",
    (role) => {
      expect(canTransition("active", "terminated", role)).toBe(false);
      expect(canTransition("terminated", "active", role)).toBe(false);
    },
  );

  it("flags both directions as requiring a written ground (PRD US-D5)", () => {
    expect(requiresWrittenGround("active", "terminated")).toBe(true);
    expect(requiresWrittenGround("terminated", "active")).toBe(true);
    expect(requiresWrittenGround("active", "left")).toBe(false);
    expect(requiresWrittenGround("renewal_pending", "active")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — roles with no UPDATE policy are offered nothing at all
// ═════════════════════════════════════════════════════════════════════════════

describe("roles that hold no UPDATE policy on memberships", () => {
  const readOnly: OrgRole[] = ["officer", "regional_rep", "tech_admin", "member"];

  it.each(readOnly)("%s gets an empty list from every status", (role) => {
    for (const from of ALL_STATUSES) {
      expect(legalNextStatuses(from, role)).toEqual([]);
    }
  });

  it("STATUS_WRITER_ROLES matches 0014's memberships_update policy exactly", () => {
    expect([...STATUS_WRITER_ROLES].sort()).toEqual(["crrd_admin", "exec_admin", "moderator"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — the whole role × status grid, so nothing is offered by accident
// ═════════════════════════════════════════════════════════════════════════════

describe("legalNextStatuses over the full grid", () => {
  it("only ever offers a status reachable by a legal edge", () => {
    for (const role of ALL_ROLES) {
      for (const from of ALL_STATUSES) {
        for (const to of legalNextStatuses(from, role)) {
          expect(isLegalEdge(from, to)).toBe(true);
        }
      }
    }
  });

  it("never offers a self-transition — an unchanged status is not a transition", () => {
    for (const role of ALL_ROLES) {
      for (const from of ALL_STATUSES) {
        expect(legalNextStatuses(from, role)).not.toContain(from);
      }
    }
  });

  it("returns a stable, sorted list so the dropdown order does not jitter", () => {
    const list = legalNextStatuses("active", "exec_admin");
    expect(list).toEqual([...list].sort());
    expect(list).toEqual(["graduated", "left", "resigned", "terminated"]);
  });

  it("renewal_pending offers approval and decline, to all three writer roles", () => {
    for (const role of STATUS_WRITER_ROLES) {
      expect(legalNextStatuses("renewal_pending", role)).toEqual(["active", "left"]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 — labels are total over the enum
// ═════════════════════════════════════════════════════════════════════════════

describe("MEMBERSHIP_STATUS_LABELS", () => {
  it("has a label for every generated status — a new one is a compile error, not a blank", () => {
    expect(Object.keys(MEMBERSHIP_STATUS_LABELS).sort()).toEqual([...ALL_STATUSES].sort());
  });
});
