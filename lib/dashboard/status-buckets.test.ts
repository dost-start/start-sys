// Zero-filling (BUILD_PLAN S6-T6).
//
// The assertions that matter are the ones about NOT hand-typing a list: the bucket count
// equals the number of members in the GENERATED enum, and the label map is total over
// that union. A test that hard-codes "six statuses" would pass forever while the seventh
// silently stopped appearing on every dashboard — so the expected count is read from
// `Constants` too, and the guard against that test being vacuous is the separate
// assertion that the enum is non-empty and contains the statuses the CBL requires.
import { describe, expect, it } from "vitest";

import { Constants } from "@/database.types";
import {
  MEMBERSHIP_STATUS_LABELS,
  MEMBERSHIP_STATUS_ORDER,
  membershipStatusLabel,
  toCommitteeBuckets,
  UNASSIGNED_COMMITTEE_LABEL,
  zeroFillRegions,
  zeroFillStatuses,
  totalFromStatuses,
} from "@/lib/dashboard/status-buckets";
import type {
  CommitteeCountRow,
  RegionCountRow,
  RegionRef,
  StatusCountRow,
} from "@/lib/dashboard/types";

const TERM = "11111111-1111-4111-8111-111111111111";
const REGION_A = "22222222-2222-4222-8222-222222222222";
const REGION_B = "33333333-3333-4333-8333-333333333333";
const COMMITTEE_A = "44444444-4444-4444-8444-444444444444";

const statusRow = (status: StatusCountRow["status"], count: number): StatusCountRow => ({
  term_id: TERM,
  status,
  member_count: count,
});

const REGIONS: RegionRef[] = [
  {
    id: REGION_A,
    code: "NCR",
    name: "National Capital Region",
    island_group: "Luzon",
    sort_order: 1,
  },
  { id: REGION_B, code: "R07", name: "Central Visayas", island_group: "Visayas", sort_order: 11 },
];

describe("MEMBERSHIP_STATUS_ORDER / MEMBERSHIP_STATUS_LABELS", () => {
  it("is the generated enum, not a hand-typed literal", () => {
    expect(MEMBERSHIP_STATUS_ORDER).toEqual(Constants.public.Enums.membership_status);
  });

  it("labels every generated status and nothing else", () => {
    // Total in both directions: a status added to the enum without a label is caught by
    // the first assertion; a stale label for a removed status by the second.
    for (const status of Constants.public.Enums.membership_status) {
      expect(MEMBERSHIP_STATUS_LABELS[status]).toBeTypeOf("string");
      expect(MEMBERSHIP_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
    expect(Object.keys(MEMBERSHIP_STATUS_LABELS).sort()).toEqual(
      [...Constants.public.Enums.membership_status].sort(),
    );
  });

  it("distinguishes terminated from left (CBL Art. VII §3 vs a lapsed renewal)", () => {
    // Collapsing these labels would make an Executive Board removal read the same as an
    // unreturned renewal form on an admin dashboard.
    expect(membershipStatusLabel("terminated")).not.toBe(membershipStatusLabel("left"));
  });
});

describe("zeroFillStatuses", () => {
  it("returns one bucket per generated status, in enum order", () => {
    const buckets = zeroFillStatuses([statusRow("active", 7)]);
    expect(buckets).toHaveLength(Constants.public.Enums.membership_status.length);
    expect(buckets.map((b) => b.status)).toEqual([...Constants.public.Enums.membership_status]);
  });

  it("renders 0 for every status on an empty term rather than an empty panel", () => {
    // PRD US-H2: the morning after rollover the correct screen is honest zeros.
    const buckets = zeroFillStatuses([]);
    expect(buckets).toHaveLength(Constants.public.Enums.membership_status.length);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it("carries the counts the view returned", () => {
    const buckets = zeroFillStatuses([statusRow("active", 7), statusRow("graduated", 2)]);
    const byStatus = new Map(buckets.map((b) => [b.status, b.count]));
    expect(byStatus.get("active")).toBe(7);
    expect(byStatus.get("graduated")).toBe(2);
    expect(byStatus.get("resigned")).toBe(0);
  });

  it("sums duplicate rows for one status instead of taking the last", () => {
    // The view groups by (term_id, status) so duplicates cannot occur today; summing
    // means a future view that groups more finely degrades to a correct total rather
    // than to a silently understated one.
    const buckets = zeroFillStatuses([statusRow("active", 3), statusRow("active", 4)]);
    expect(buckets.find((b) => b.status === "active")?.count).toBe(7);
  });

  it("totals to the term headcount — the status panel DOES reconcile", () => {
    const buckets = zeroFillStatuses([statusRow("active", 7), statusRow("left", 2)]);
    expect(totalFromStatuses(buckets)).toBe(9);
  });
});

describe("zeroFillRegions", () => {
  const regionRow = (regionId: string, count: number): RegionCountRow => ({
    term_id: TERM,
    region_id: regionId,
    region_code: regionId === REGION_A ? "NCR" : "R07",
    region_name: regionId === REGION_A ? "National Capital Region" : "Central Visayas",
    island_group: regionId === REGION_A ? "Luzon" : "Visayas",
    sort_order: regionId === REGION_A ? 1 : 11,
    member_count: count,
  });

  it("fills a region with no members at 0 and keeps sort_order", () => {
    const buckets = zeroFillRegions(REGIONS, [regionRow(REGION_A, 9)]);
    expect(buckets.map((b) => [b.region_code, b.count])).toEqual([
      ["NCR", 9],
      ["R07", 0],
    ]);
  });

  it("orders by sort_order regardless of the order regions arrive in", () => {
    const buckets = zeroFillRegions([...REGIONS].reverse(), []);
    expect(buckets.map((b) => b.sort_order)).toEqual([1, 11]);
  });

  it("fills only the regions passed — a rep's own region(s), not all 18", () => {
    // The zero-fill set is a LABELLING decision, never a scope decision: the counts come
    // from the security_invoker view either way (ADR 0007).
    const repRegions = REGIONS.filter((r) => r.id === REGION_B);
    const buckets = zeroFillRegions(repRegions, [regionRow(REGION_B, 5)]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.count).toBe(5);
  });

  it("drops a count for a region absent from the reference list", () => {
    const orphan = regionRow("55555555-5555-4555-8555-555555555555", 99);
    const buckets = zeroFillRegions(REGIONS, [orphan]);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });
});

describe("toCommitteeBuckets", () => {
  const committeeRow = (
    committeeId: string | null,
    name: string | null,
    count: number,
  ): CommitteeCountRow => ({
    term_id: TERM,
    committee_id: committeeId,
    committee_code: committeeId === null ? null : "OUTREACH",
    committee_name: name,
    member_count: count,
  });

  it("labels the null committee as the unassigned bucket", () => {
    const buckets = toCommitteeBuckets([committeeRow(null, null, 12)]);
    expect(buckets[0]?.committee_id).toBeNull();
    expect(buckets[0]?.committee_name).toBe(UNASSIGNED_COMMITTEE_LABEL);
  });

  it("preserves the order it was given (queries.ts sorts, unassigned last)", () => {
    const buckets = toCommitteeBuckets([
      committeeRow(COMMITTEE_A, "Outreach", 4),
      committeeRow(null, null, 12),
    ]);
    expect(buckets.map((b) => b.committee_id)).toEqual([COMMITTEE_A, null]);
  });

  it("does not reconcile to a headcount — a member may hold two seats", () => {
    // CBL Art. III §5 sets no limit. The panel is captioned, never "fixed" by picking one
    // committee per member (ADR 0007 §4).
    const buckets = toCommitteeBuckets([
      committeeRow(COMMITTEE_A, "Outreach", 5),
      committeeRow("66666666-6666-4666-8666-666666666666", "Tech", 5),
    ]);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(10);
  });
});
