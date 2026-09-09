// PR E. Small module, but it sits in front of the only public write path, so the two
// behaviours that matter are proven: it does not cache a failed read, and it lets go.
import { afterEach, describe, expect, it, vi } from "vitest";

import { cachedReference, resetReferenceCache } from "@/lib/applications/reference-cache";

afterEach(() => {
  resetReferenceCache();
  vi.useRealTimers();
});

describe("cachedReference", () => {
  it("loads once and serves the memo after that", async () => {
    const load = vi.fn().mockResolvedValue([{ id: "a" }]);
    expect(await cachedReference("k", load)).toEqual([{ id: "a" }]);
    expect(await cachedReference("k", load)).toEqual([{ id: "a" }]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keys are independent", async () => {
    const a = vi.fn().mockResolvedValue([1]);
    const b = vi.fn().mockResolvedValue([2]);
    expect(await cachedReference("a", a)).toEqual([1]);
    expect(await cachedReference("b", b)).toEqual([2]);
    expect(await cachedReference("a", a)).toEqual([1]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("re-loads once the TTL has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
    const load = vi.fn().mockResolvedValue([{ id: "a" }]);
    await cachedReference("k", load, 1000);
    vi.setSystemTime(new Date(Date.now() + 1001));
    await cachedReference("k", load, 1000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache an empty result — a transient read failure must not stick", async () => {
    // The page's own readers return [] on error rather than throwing, so an empty array
    // here is far more likely to be a blip than a fact. Caching it would leave the form
    // unfillable for the whole TTL.
    const load = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: "a" }]);
    expect(await cachedReference("k", load)).toEqual([]);
    expect(await cachedReference("k", load)).toEqual([{ id: "a" }]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not swallow a thrown load, and does not cache it either", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue([{ id: "a" }]);
    await expect(cachedReference("k", load)).rejects.toThrow("down");
    expect(await cachedReference("k", load)).toEqual([{ id: "a" }]);
  });
});
