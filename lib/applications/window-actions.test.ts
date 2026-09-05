// ─────────────────────────────────────────────────────────────────────────────
// BUILD_PLAN S4-T24. Two things are asserted here and one of them is counter-intuitive.
//
// 1. THE ROLE MATRIX, INCLUDING exec_admin. ADR 0003 grants the application window to
//    `crrd_admin` and `tech_admin` and to NOBODY ELSE — so the CEO and COO are refused,
//    which is the opposite of the shape most of this system has, where exec_admin is
//    the widest tier. It is asserted here explicitly, with its own test name, so a
//    future maintainer who "fixes" it by adding exec_admin to `WINDOW_WRITER_ROLES`
//    turns this red and has to read ADR 0003 before proceeding.
//
//    The load-bearing part of each refusal is not the returned code. It is that the
//    Supabase client is NEVER TOUCHED — `rpc` spy count 0 — which is what proves
//    `withRole` short-circuits before the body can mint a side effect.
//
// 2. THE CONFLICT PATH. An already-open period must not be silently re-scheduled out
//    from under applicants who are mid-submission, so it is refused with `conflict` and
//    NO upsert is issued. Asserted by the upsert spy count, not by the returned code
//    alone — a version that wrote first and returned `conflict` afterwards would pass a
//    code-only test and still move the closing time.
//
// This is a UNIT test with a mocked client, so it proves the ACTION's behaviour and
// nothing about the database. The policy half — `application_windows_insert` /
// `_update` naming the same two roles AND requiring `has_aal2()` — is asserted
// independently in `supabase/tests/023_terms_rls.sql`, and the end-to-end effect on
// `/apply` is asserted in `e2e/apply-with-upload.spec.ts`. If this file and the policy
// ever disagree, the policy is the answer (ARCHITECTURE.md §5).
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgRole } from "@/lib/auth/route-access";

const getSessionContext = vi.fn();

vi.mock("@/lib/auth/queries", () => ({
  getSessionContext: () => getSessionContext(),
}));

// `revalidatePath` is a Next server-runtime binding with no meaning outside a request.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { closeApplicationWindow, openApplicationWindow } =
  await import("@/lib/applications/window-actions");

const TERM_ID = "00000000-0000-4000-d000-000000000001";
const WINDOW_ID = "00000000-0000-4000-e000-000000000001";

const HOUR = 3_600_000;

const OPEN_INPUT = {
  form_kind: "membership_application" as const,
  opens_at: "2026-06-01T09:00:00+08:00",
  closes_at: "2026-06-30T17:00:00+08:00",
};

const CLOSE_INPUT = { form_kind: "membership_application" as const };

type MockOptions = {
  /** The row `findWindow` resolves, or null for "no window scheduled". */
  existing?: { id: string; opens_at: string; closes_at: string } | null;
  termId?: string | null;
  updateCount?: number;
};

/**
 * The narrow slice of supabase-js the two actions actually call, as spies.
 *
 * Deliberately shaped by hand rather than with a chain-proxy helper: the assertions
 * below are about WHICH statement was issued, and a proxy that answers every method
 * would make "upsert was never called" impossible to observe.
 */
function makeSupabase(options: MockOptions = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: options.existing ?? null, error: null });
  const selectEqEq = vi.fn(() => ({ maybeSingle }));
  const selectEq = vi.fn(() => ({ eq: selectEqEq }));
  const select = vi.fn(() => ({ eq: selectEq }));

  const upsert = vi.fn().mockResolvedValue({ error: null });

  const updateEq = vi.fn().mockResolvedValue({ error: null, count: options.updateCount ?? 1 });
  const update = vi.fn(() => ({ eq: updateEq }));

  const from = vi.fn(() => ({ select, upsert, update }));
  const rpc = vi.fn().mockResolvedValue({
    data: options.termId === undefined ? TERM_ID : options.termId,
    error: null,
  });

  return { client: { from, rpc }, from, rpc, select, upsert, update, updateEq };
}

function session(role: OrgRole, options: MockOptions = {}) {
  const mock = makeSupabase(options);
  return {
    mock,
    ctx: {
      user: { id: "00000000-0000-4000-a000-000000000003" },
      role,
      personId: null,
      regionId: null,
      supabase: mock.client,
    },
  };
}

beforeEach(() => {
  getSessionContext.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// The role matrix — ADR 0003
// ─────────────────────────────────────────────────────────────────────────────

describe("who may open or close the application period (ADR 0003)", () => {
  const REFUSED: OrgRole[] = [
    // ⚠ NOT A MISTAKE. The CEO and COO oversee records; opening a submission window is
    // the CRRD's operational act (PRD US-B4) or the CTO's system configuration.
    // `application_windows_insert` names exactly crrd_admin and tech_admin.
    "exec_admin",
    "officer",
    "regional_rep",
    "member",
  ];

  for (const role of REFUSED) {
    it(`refuses ${role} and never touches the database`, async () => {
      const { ctx, mock } = session(role);
      getSessionContext.mockResolvedValue(ctx);

      const opened = await openApplicationWindow(OPEN_INPUT);
      const closed = await closeApplicationWindow(CLOSE_INPUT);

      expect(opened.ok).toBe(false);
      if (!opened.ok) expect(opened.error.code).toBe("unauthorized");
      expect(closed.ok).toBe(false);
      if (!closed.ok) expect(closed.error.code).toBe("unauthorized");

      // The whole point: the guard runs BEFORE the body, so no statement is issued and
      // no audit row could be written on the way to being refused.
      expect(mock.rpc).toHaveBeenCalledTimes(0);
      expect(mock.from).toHaveBeenCalledTimes(0);
      expect(mock.upsert).toHaveBeenCalledTimes(0);
      expect(mock.update).toHaveBeenCalledTimes(0);
    });
  }

  it("refuses an anonymous caller", async () => {
    getSessionContext.mockResolvedValue(null);

    const result = await openApplicationWindow(OPEN_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unauthorized");
  });

  for (const role of ["crrd_admin", "tech_admin"] as OrgRole[]) {
    it(`allows ${role} to open a period when none is scheduled`, async () => {
      const { ctx, mock } = session(role, { existing: null });
      getSessionContext.mockResolvedValue(ctx);

      const result = await openApplicationWindow(OPEN_INPUT);

      expect(result.ok).toBe(true);
      expect(mock.upsert).toHaveBeenCalledTimes(1);
      expect(mock.upsert).toHaveBeenCalledWith(
        {
          term_id: TERM_ID,
          form_kind: "membership_application",
          opens_at: OPEN_INPUT.opens_at,
          closes_at: OPEN_INPUT.closes_at,
        },
        { onConflict: "term_id,form_kind" },
      );
      // Never an INSERT that could produce a second row for the same (term, kind), and
      // never a DELETE — `application_windows` is unique on that pair and this schema
      // has no DELETE policy anywhere.
      expect(mock.update).toHaveBeenCalledTimes(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// openApplicationWindow
// ─────────────────────────────────────────────────────────────────────────────

describe("openApplicationWindow", () => {
  it("refuses with conflict when a period is already open, WITHOUT writing", async () => {
    const now = Date.now();
    const { ctx, mock } = session("crrd_admin", {
      existing: {
        id: WINDOW_ID,
        opens_at: new Date(now - HOUR).toISOString(),
        closes_at: new Date(now + HOUR).toISOString(),
      },
    });
    getSessionContext.mockResolvedValue(ctx);

    const result = await openApplicationWindow(OPEN_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("conflict");
    // The assertion that matters: a version which wrote first and reported the conflict
    // afterwards would already have moved the closing time of a live period.
    expect(mock.upsert).toHaveBeenCalledTimes(0);
  });

  it("re-opens a term whose previous period has closed", async () => {
    const now = Date.now();
    const { ctx, mock } = session("crrd_admin", {
      existing: {
        id: WINDOW_ID,
        opens_at: new Date(now - 5 * HOUR).toISOString(),
        closes_at: new Date(now - HOUR).toISOString(),
      },
    });
    getSessionContext.mockResolvedValue(ctx);

    const result = await openApplicationWindow(OPEN_INPUT);

    expect(result.ok).toBe(true);
    expect(mock.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns not_found when there is no active term, and writes nothing", async () => {
    const { ctx, mock } = session("crrd_admin", { termId: null });
    getSessionContext.mockResolvedValue(ctx);

    const result = await openApplicationWindow(OPEN_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
    expect(mock.upsert).toHaveBeenCalledTimes(0);
  });

  it("rejects a closing time at or before the opening time, as a field error", async () => {
    const { ctx, mock } = session("crrd_admin");
    getSessionContext.mockResolvedValue(ctx);

    const result = await openApplicationWindow({
      ...OPEN_INPUT,
      closes_at: OPEN_INPUT.opens_at,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
      expect(result.error.fields?.["closes_at"]).toBeDefined();
    }
    expect(mock.upsert).toHaveBeenCalledTimes(0);
  });

  it("rejects a local time with no timezone — the eight-hour-skew guard", async () => {
    const { ctx, mock } = session("crrd_admin");
    getSessionContext.mockResolvedValue(ctx);

    // Exactly what an `<input type="datetime-local">` produces if the client forgets to
    // convert. Read against the server's clock this would be eight hours out in
    // Asia/Manila, with no error anywhere — so it fails loudly here instead.
    const result = await openApplicationWindow({
      ...OPEN_INPUT,
      opens_at: "2026-06-01T09:00",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
      expect(result.error.fields?.["opens_at"]).toBeDefined();
    }
    expect(mock.upsert).toHaveBeenCalledTimes(0);
  });

  it("rejects an unknown form_kind rather than scheduling a form that does not exist", async () => {
    const { ctx, mock } = session("crrd_admin");
    getSessionContext.mockResolvedValue(ctx);

    const result = await openApplicationWindow({ ...OPEN_INPUT, form_kind: "freeform" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
    expect(mock.upsert).toHaveBeenCalledTimes(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// closeApplicationWindow
// ─────────────────────────────────────────────────────────────────────────────

describe("closeApplicationWindow", () => {
  it("sets closes_at to now on the open row — an UPDATE, never a DELETE", async () => {
    const now = Date.now();
    const { ctx, mock } = session("crrd_admin", {
      existing: {
        id: WINDOW_ID,
        opens_at: new Date(now - HOUR).toISOString(),
        closes_at: new Date(now + HOUR).toISOString(),
      },
    });
    getSessionContext.mockResolvedValue(ctx);

    const result = await closeApplicationWindow(CLOSE_INPUT);

    expect(result.ok).toBe(true);
    expect(mock.update).toHaveBeenCalledTimes(1);

    const [values, options] = mock.update.mock.calls[0] as unknown as [
      Record<string, string>,
      { count: string },
    ];
    expect(options).toEqual({ count: "exact" });
    expect(Object.keys(values)).toEqual(["closes_at"]);
    // The server's clock, not a client value: a backdated closure would let the audit
    // row contradict an application the policy legitimately accepted.
    expect(Math.abs(Date.parse(values["closes_at"] as string) - now)).toBeLessThan(60_000);
    expect(mock.updateEq).toHaveBeenCalledWith("id", WINDOW_ID);
  });

  it("returns not_found when no period is open, without writing", async () => {
    const { ctx, mock } = session("crrd_admin", { existing: null });
    getSessionContext.mockResolvedValue(ctx);

    const result = await closeApplicationWindow(CLOSE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
    expect(mock.update).toHaveBeenCalledTimes(0);
  });

  it("returns not_found when the period has already closed", async () => {
    const now = Date.now();
    const { ctx, mock } = session("crrd_admin", {
      existing: {
        id: WINDOW_ID,
        opens_at: new Date(now - 5 * HOUR).toISOString(),
        closes_at: new Date(now - HOUR).toISOString(),
      },
    });
    getSessionContext.mockResolvedValue(ctx);

    const result = await closeApplicationWindow(CLOSE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
    expect(mock.update).toHaveBeenCalledTimes(0);
  });

  it("maps a policy-refused UPDATE (zero rows) to not_found, never unauthorized", async () => {
    // What an aal1 tech_admin session actually produces: `withRole` lets the role
    // through, `has_aal2()` in the policy does not, and PostgREST reports zero rows
    // affected rather than an error. CONVENTIONS §4.3 — "forbidden" would confirm the
    // row exists.
    const now = Date.now();
    const { ctx } = session("tech_admin", {
      existing: {
        id: WINDOW_ID,
        opens_at: new Date(now - HOUR).toISOString(),
        closes_at: new Date(now + HOUR).toISOString(),
      },
      updateCount: 0,
    });
    getSessionContext.mockResolvedValue(ctx);

    const result = await closeApplicationWindow(CLOSE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});
