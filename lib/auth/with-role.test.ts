// The guard's contract, asserted where it matters: a refused action must not RUN.
//
// A wrapper that returns `unauthorized` *after* invoking the body would still look
// correct from the caller's side while having already minted a Drive upload session,
// queued an email or written a row. So every deny case here asserts the spy's call
// count is exactly 0, not merely that the result was a refusal.

import { beforeEach, describe, expect, test, vi } from "vitest";

import type { SessionContext } from "@/lib/auth/queries";
import type { OrgRole } from "@/lib/auth/route-access";

// The factory form never loads the real module, so `server-only` and `next/headers`
// are never pulled into the node test environment.
vi.mock("@/lib/auth/queries", () => ({
  getSessionContext: vi.fn(),
}));

const { getSessionContext } = await import("@/lib/auth/queries");
const { withAnyRole, withRole } = await import("@/lib/auth/with-role");

const mockedGetSessionContext = vi.mocked(getSessionContext);

/** A minimally-shaped context. Only `role` is read by the guard. */
function contextFor(role: OrgRole): SessionContext {
  return {
    user: { id: "00000000-0000-4000-a000-000000000003" },
    role,
    personId: "00000000-0000-4000-b000-000000000003",
    regionId: null,
    supabase: { marker: "caller-client" },
  } as unknown as SessionContext;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("withRole — denies without invoking the body", () => {
  test("an officer calling a crrd_admin action is refused and the body never runs", async () => {
    const body = vi.fn(async () => ({ ok: true as const, data: "written" }));
    mockedGetSessionContext.mockResolvedValue(contextFor("officer"));

    const action = withRole(["crrd_admin"], body);
    const result = await action(undefined);

    expect(result).toEqual({
      ok: false,
      error: { code: "unauthorized", message: expect.any(String) },
    });
    expect(body).toHaveBeenCalledTimes(0);
  });

  test("an anonymous caller is refused and the body never runs", async () => {
    const body = vi.fn(async () => ({ ok: true as const, data: "written" }));
    mockedGetSessionContext.mockResolvedValue(null);

    const action = withRole(["crrd_admin"], body);
    const result = await action(undefined);

    expect(result.ok).toBe(false);
    expect(body).toHaveBeenCalledTimes(0);
  });

  test("a signed-in account with no user_roles row is refused and the body never runs", async () => {
    // `getSessionContext` returns null for this case too — indistinguishable from no
    // session by design, because both mean "no capability".
    const body = vi.fn(async () => ({ ok: true as const, data: "written" }));
    mockedGetSessionContext.mockResolvedValue(null);

    const action = withRole(["exec_admin", "crrd_admin"], body);
    const result = await action(undefined);

    expect(result.ok).toBe(false);
    expect(body).toHaveBeenCalledTimes(0);
  });

  test("every non-listed tier is refused for the same action", async () => {
    const denied: readonly OrgRole[] = ["tech_admin", "officer", "regional_rep", "member"];

    for (const role of denied) {
      const body = vi.fn(async () => ({ ok: true as const, data: "written" }));
      mockedGetSessionContext.mockResolvedValue(contextFor(role));

      const action = withRole(["exec_admin", "crrd_admin"], body);
      const result = await action(undefined);

      expect(result, `${role} must be refused`).toEqual({
        ok: false,
        error: { code: "unauthorized", message: expect.any(String) },
      });
      expect(body, `${role} must not invoke the body`).toHaveBeenCalledTimes(0);
    }
  });

  test("the refusal does not disclose which role was required", async () => {
    const body = vi.fn(async () => ({ ok: true as const, data: "written" }));
    mockedGetSessionContext.mockResolvedValue(contextFor("officer"));

    const result = await withRole(["tech_admin"], body)(undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain("tech_admin");
      expect(result.error.message).not.toContain("officer");
    }
  });
});

describe("withRole — allows a listed tier exactly once", () => {
  test("crrd_admin runs the body once and its result is returned unchanged", async () => {
    const body = vi.fn(async () => ({ ok: true as const, data: "2026-014" }));
    mockedGetSessionContext.mockResolvedValue(contextFor("crrd_admin"));

    const action = withRole(["crrd_admin", "exec_admin"], body);
    const result = await action(undefined);

    expect(body).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, data: "2026-014" });
  });

  test("the body receives the caller's context and the input verbatim", async () => {
    const ctx = contextFor("officer");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest param widens TIn so any input type is accepted
    const body = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, data: null }));
    mockedGetSessionContext.mockResolvedValue(ctx);

    const input = { id: "6f1b1c2e-0000-4000-8000-000000000001" };
    await withRole(["officer"], body)(input);

    expect(body).toHaveBeenCalledTimes(1);
    expect(body).toHaveBeenCalledWith(ctx, input);
  });

  test("a failure returned by the body is passed through, not rewritten", async () => {
    const body = vi.fn(async () => ({
      ok: false as const,
      error: { code: "conflict" as const, message: "already decided" },
    }));
    mockedGetSessionContext.mockResolvedValue(contextFor("exec_admin"));

    const result = await withRole(["exec_admin"], body)(undefined);

    expect(result).toEqual({
      ok: false,
      error: { code: "conflict", message: "already decided" },
    });
    expect(body).toHaveBeenCalledTimes(1);
  });

  test("each of the listed tiers is allowed", async () => {
    const allowed: readonly OrgRole[] = ["crrd_admin", "exec_admin"];

    for (const role of allowed) {
      const body = vi.fn(async () => ({ ok: true as const, data: role }));
      mockedGetSessionContext.mockResolvedValue(contextFor(role));

      const result = await withRole(allowed, body)(undefined);

      expect(result, `${role} must be allowed`).toEqual({ ok: true, data: role });
      expect(body, `${role} must invoke the body once`).toHaveBeenCalledTimes(1);
    }
  });

  test("an empty role list allows nobody", async () => {
    const body = vi.fn(async () => ({ ok: true as const, data: null }));
    mockedGetSessionContext.mockResolvedValue(contextFor("exec_admin"));

    const result = await withRole([], body)(undefined);

    expect(result.ok).toBe(false);
    expect(body).toHaveBeenCalledTimes(0);
  });
});

describe("withAnyRole", () => {
  test("any signed-in tier runs the body", async () => {
    const roles: readonly OrgRole[] = [
      "exec_admin",
      "tech_admin",
      "crrd_admin",
      "officer",
      "regional_rep",
      "member",
    ];

    for (const role of roles) {
      const body = vi.fn(async () => ({ ok: true as const, data: role }));
      mockedGetSessionContext.mockResolvedValue(contextFor(role));

      const result = await withAnyRole(body)(undefined);

      expect(result, `${role} must be allowed`).toEqual({ ok: true, data: role });
      expect(body).toHaveBeenCalledTimes(1);
    }
  });

  test("an anonymous caller is still refused and the body never runs", async () => {
    const body = vi.fn(async () => ({ ok: true as const, data: null }));
    mockedGetSessionContext.mockResolvedValue(null);

    const result = await withAnyRole(body)(undefined);

    expect(result.ok).toBe(false);
    expect(body).toHaveBeenCalledTimes(0);
  });
});
