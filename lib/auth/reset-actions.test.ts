// ─────────────────────────────────────────────────────────────────────────────
// US-A4, asserted rather than assumed (BUILD_PLAN S2-T38).
//
// The load-bearing assertion is NOT "returns unauthorized". It is `updateUser` having
// been called ZERO times: a guard that runs after the credential is written would pass
// a returns-unauthorized test and still let a stolen recovery link take over an
// admin account.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgRole } from "@/lib/auth/route-access";

const getSessionContext = vi.fn();

vi.mock("@/lib/auth/queries", () => ({
  getSessionContext: () => getSessionContext(),
}));

const { updatePassword } = await import("@/lib/auth/reset-actions");

/** A minimal session context: the two auth calls the action makes, and a role. */
function session({ aal, role }: { aal: "aal1" | "aal2"; role: OrgRole }) {
  const updateUser = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });
  const getAuthenticatorAssuranceLevel = vi
    .fn()
    .mockResolvedValue({ data: { currentLevel: aal, nextLevel: "aal2" }, error: null });

  return {
    ctx: {
      user: { id: "00000000-0000-4000-a000-000000000003" },
      role,
      personId: null,
      regionId: null,
      supabase: { auth: { updateUser, mfa: { getAuthenticatorAssuranceLevel } } },
    },
    updateUser,
  };
}

const VALID = { password: "correct-horse-battery", confirm: "correct-horse-battery" };

beforeEach(() => {
  getSessionContext.mockReset();
});

describe("updatePassword", () => {
  it("refuses a privileged aal1 session AND never calls updateUser", async () => {
    const { ctx, updateUser } = session({ aal: "aal1", role: "crrd_admin" });
    getSessionContext.mockResolvedValue(ctx);

    const result = await updatePassword(VALID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unauthorized");
    // The whole point of US-A4. Do not relax this.
    expect(updateUser).toHaveBeenCalledTimes(0);
  });

  it("allows a member at aal1 — the documented ADR 0004 exception", async () => {
    const { ctx, updateUser } = session({ aal: "aal1", role: "member" });
    getSessionContext.mockResolvedValue(ctx);

    const result = await updatePassword(VALID);

    expect(result.ok).toBe(true);
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it("allows a privileged account once the session is aal2", async () => {
    const { ctx, updateUser } = session({ aal: "aal2", role: "crrd_admin" });
    getSessionContext.mockResolvedValue(ctx);

    const result = await updatePassword(VALID);

    expect(result.ok).toBe(true);
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it("refuses an anonymous caller without touching the auth API", async () => {
    getSessionContext.mockResolvedValue(null);

    const result = await updatePassword(VALID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unauthorized");
  });

  it("rejects a mismatched confirmation as a field error, before any session read", async () => {
    const { ctx, updateUser } = session({ aal: "aal2", role: "exec_admin" });
    getSessionContext.mockResolvedValue(ctx);

    const result = await updatePassword({ password: "correct-horse-battery", confirm: "nope" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
      expect(result.error.fields?.["confirm"]).toBeDefined();
    }
    expect(updateUser).toHaveBeenCalledTimes(0);
  });
});
