// The rolling award-year window (A6). Worth a test because the rule is a DATE rule that
// nobody will re-derive: it turns over on 1 July, in Asia/Manila, and it is supposed to
// keep working every year with nobody editing a constant. The way this breaks is silently,
// next July, in front of applicants.
import { describe, expect, it } from "vitest";

import { awardYearOptions, awardYearWindow, AWARD_WINDOW_YEARS } from "@/lib/validation/award-year";

/** An instant, given as UTC. Manila is UTC+8, so 2027-06-30T16:00Z is 1 July 00:00 local. */
const at = (iso: string) => new Date(iso);

describe("awardYearWindow", () => {
  it("offers 2022–2026 on the day Ethan specified it (2026-09-09)", () => {
    expect(awardYearWindow(at("2026-09-09T02:00:00Z"))).toEqual({ min: 2022, max: 2026 });
  });

  it("has not turned over yet on 30 June 2027", () => {
    expect(awardYearWindow(at("2027-06-30T10:00:00Z"))).toEqual({ min: 2022, max: 2026 });
  });

  it("turns over on 1 July 2027 — 2022 drops, 2027 arrives", () => {
    expect(awardYearWindow(at("2027-07-01T02:00:00Z"))).toEqual({ min: 2023, max: 2027 });
  });

  it("turns over at MANILA midnight, not UTC midnight", () => {
    // 2027-06-30T16:00Z is 2027-07-01T00:00 in Manila. A UTC implementation would still
    // report the old window here, and would be eight hours late every single year.
    expect(awardYearWindow(at("2027-06-30T16:00:00Z"))).toEqual({ min: 2023, max: 2027 });
    // One minute earlier is still 30 June locally.
    expect(awardYearWindow(at("2027-06-30T15:59:00Z"))).toEqual({ min: 2022, max: 2026 });
  });

  it("holds the previous window through January — the turnover is NOT 1 January", () => {
    expect(awardYearWindow(at("2027-01-15T02:00:00Z"))).toEqual({ min: 2022, max: 2026 });
  });

  it("is always exactly five years wide", () => {
    for (const iso of ["2026-09-09", "2027-07-01", "2030-02-28", "2031-12-31"]) {
      const { min, max } = awardYearWindow(at(`${iso}T02:00:00Z`));
      expect(max - min + 1).toBe(AWARD_WINDOW_YEARS);
    }
  });
});

describe("awardYearOptions", () => {
  it("lists the window newest first, so the common answer is the top entry", () => {
    expect(awardYearOptions(at("2026-09-09T02:00:00Z"))).toEqual([2026, 2025, 2024, 2023, 2022]);
  });
});
