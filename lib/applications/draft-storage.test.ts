// PR D. The interesting cases are all failure cases: this module holds a scholar's
// birthdate and address on a device the org does not control, so what must be proven is
// what it REFUSES to store and how reliably it lets go.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDraft,
  draftKey,
  DRAFT_MAX_AGE_MS,
  hasDraft,
  loadDraft,
  saveDraft,
} from "@/lib/applications/draft-storage";

/** A minimal in-memory localStorage, plus a switch to make every call throw. */
function installStorage(): { store: Map<string, string>; breakIt: () => void } {
  const store = new Map<string, string>();
  let broken = false;
  const impl = {
    getItem: (k: string) => {
      if (broken) throw new Error("blocked");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("blocked");
      store.set(k, v);
    },
    removeItem: (k: string) => {
      if (broken) throw new Error("blocked");
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  vi.stubGlobal("window", { localStorage: impl });
  return { store, breakIt: () => (broken = true) };
}

let harness: ReturnType<typeof installStorage>;

beforeEach(() => {
  harness = installStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("what is never written", () => {
  it("drops the consent boxes — restoring a tick would be pre-ticking it (RA 10173)", () => {
    saveDraft("apply", {
      applicant_given_name: "Maria",
      consent_privacy_notice: true,
      consent_privacy_notice_version: "v2",
      certify_accuracy: true,
    });
    const raw = harness.store.get(draftKey("apply")) ?? "";
    expect(raw).not.toContain("consent_privacy_notice");
    expect(raw).not.toContain("certify_accuracy");
    expect(loadDraft("apply")).toEqual({ applicant_given_name: "Maria" });
  });

  it("drops the member ID — on /renew it is half the credential (0044)", () => {
    saveDraft("renew", { member_id: "2024-0012", contact_number: "09171234567" });
    expect(loadDraft("renew")).toEqual({ contact_number: "09171234567" });
  });

  it("drops objects, so a File handle can never be serialized", () => {
    saveDraft("apply", { applicant_given_name: "Maria", proof: { name: "cor.jpg" } });
    expect(loadDraft("apply")).toEqual({ applicant_given_name: "Maria" });
  });

  it("stores nothing at all for an untouched form", () => {
    saveDraft("apply", { applicant_given_name: "", middle_name: undefined, suffix: null });
    expect(harness.store.has(draftKey("apply"))).toBe(false);
    expect(loadDraft("apply")).toBeNull();
  });

  it("removes an existing draft when the form is emptied back out", () => {
    saveDraft("apply", { applicant_given_name: "Maria" });
    expect(hasDraft("apply")).toBe(true);
    saveDraft("apply", { applicant_given_name: "" });
    expect(hasDraft("apply")).toBe(false);
  });
});

describe("round trip and expiry", () => {
  it("saves and restores the ordinary fields", () => {
    saveDraft("apply", { applicant_given_name: "Maria", year_level: "2" });
    expect(loadDraft("apply")).toEqual({ applicant_given_name: "Maria", year_level: "2" });
  });

  it("keeps /apply and /renew in separate keys", () => {
    saveDraft("apply", { applicant_given_name: "Maria" });
    saveDraft("renew", { applicant_given_name: "Jose" });
    expect(loadDraft("apply")).toEqual({ applicant_given_name: "Maria" });
    expect(loadDraft("renew")).toEqual({ applicant_given_name: "Jose" });
  });

  it("discards — and DELETES — a draft past the maximum age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
    saveDraft("apply", { applicant_given_name: "Maria" });

    vi.setSystemTime(new Date(Date.now() + DRAFT_MAX_AGE_MS + 1_000));
    expect(loadDraft("apply")).toBeNull();
    // Not merely ignored: an expired draft must not sit on the device forever.
    expect(harness.store.has(draftKey("apply"))).toBe(false);
  });

  it("discards and deletes an unparseable entry rather than throwing", () => {
    harness.store.set(draftKey("apply"), "{not json");
    expect(loadDraft("apply")).toBeNull();
    expect(harness.store.has(draftKey("apply"))).toBe(false);
  });
});

describe("clearing", () => {
  it("removes the draft", () => {
    saveDraft("apply", { applicant_given_name: "Maria" });
    clearDraft("apply");
    expect(loadDraft("apply")).toBeNull();
  });
});

describe("when storage is unavailable", () => {
  it("a private window or blocked site data means no draft, never a thrown form", () => {
    harness.breakIt();
    expect(() => saveDraft("apply", { applicant_given_name: "Maria" })).not.toThrow();
    expect(loadDraft("apply")).toBeNull();
    expect(() => clearDraft("apply")).not.toThrow();
  });

  it("server-side rendering has no window at all", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("window", undefined);
    expect(loadDraft("apply")).toBeNull();
    expect(() => saveDraft("apply", { applicant_given_name: "Maria" })).not.toThrow();
  });
});
