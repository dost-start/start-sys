// Table-driven authorization matrix for the routing layer.
//
// Every cell is asserted individually — no loop that re-implements `canAccess` and
// then agrees with itself. The expectations below are written out by hand from PRD §2
// and the locked role model, so a change to `canAccess` shows up as a named failing
// test ("regional_rep may NOT reach /members") rather than as a count mismatch.
//
// This is a UX test. The security assertions for the same boundary live in pgTAP
// (`028_role_matrix_rowcounts.sql`, `029_role_matrix_columns.sql`) and in
// `e2e/rr-scope-leak.spec.ts`, which repeats itself with middleware disabled.

import { afterEach, describe, expect, test } from "vitest";

import {
  ADMIN_SYSTEM_PREFIX,
  canAccess,
  groupForPath,
  homeForRole,
  LOGIN_PATH,
  mfaGateEnabled,
  requiresMfa,
  ROUTE_GROUPS,
  UNAUTHORIZED_PATH,
  type OrgRole,
  type RouteGroup,
} from "@/lib/auth/route-access";

/** The eight actors: seven tiers plus the anonymous visitor. */
const ROLES = [
  "exec_admin",
  "tech_admin",
  "crrd_admin",
  "moderator",
  "officer",
  "regional_rep",
  "member",
] as const satisfies readonly OrgRole[];

type Actor = OrgRole | "anonymous";

const ACTORS: readonly Actor[] = [...ROLES, "anonymous"];

function roleOf(actor: Actor): OrgRole | null {
  return actor === "anonymous" ? null : actor;
}

/**
 * The columns of the matrix. `adminSystem` is split out of `admin` because it is the
 * one prefix inside a group with a narrower rule than the group.
 */
const COLUMNS = {
  public: ["/apply", "/renew", "/privacy"],
  auth: [LOGIN_PATH, "/auth/reset", "/auth/mfa/enroll", "/auth/mfa/verify", "/auth/callback"],
  admin: ["/dashboard", "/members", "/applications", "/renewals", "/campaigns", "/audit"],
  adminSystem: [ADMIN_SYSTEM_PREFIX, "/system/user-roles"],
  officer: ["/directory", "/committees"],
  rr: ["/region"],
  // The member portal is gone (0036: members hold no accounts). Kept as a column so
  // the assertion that NOBODY reaches it — not even the revoked tier — stays explicit.
  portal: ["/portal"],
} as const;

type Column = keyof typeof COLUMNS;

const COLUMN_NAMES = Object.keys(COLUMNS) as Column[];

/**
 * THE MATRIX. Hand-written, one row per actor.
 *
 *   admin        — SRS Roles: the three administrator groups reach the admin dashboard.
 *   adminSystem  — tech_admin alone (SRS: "CTO & DCTO-PD … configure the system").
 *   officer      — the read-only directory: officer plus the admin roles.
 *   rr           — the regional rep's own region (US-F1).
 *   portal       — nobody. The route no longer exists.
 *
 *   `moderator` (retired) and `member` (revoked) reach nothing but the public and
 *   auth surfaces — migration 0036.
 */
const EXPECTED: Record<Actor, Record<Column, boolean>> = {
  exec_admin: {
    public: true,
    auth: true,
    admin: true,
    adminSystem: false,
    officer: true,
    rr: false,
    portal: false,
  },
  tech_admin: {
    public: true,
    auth: true,
    admin: true,
    adminSystem: true,
    officer: true,
    rr: false,
    portal: false,
  },
  crrd_admin: {
    public: true,
    auth: true,
    admin: true,
    adminSystem: false,
    officer: true,
    rr: false,
    portal: false,
  },
  moderator: {
    public: true,
    auth: true,
    admin: false,
    adminSystem: false,
    officer: false,
    rr: false,
    portal: false,
  },
  officer: {
    public: true,
    auth: true,
    admin: false,
    adminSystem: false,
    officer: true,
    rr: false,
    portal: false,
  },
  regional_rep: {
    public: true,
    auth: true,
    admin: false,
    adminSystem: false,
    officer: false,
    rr: true,
    portal: false,
  },
  member: {
    public: true,
    auth: true,
    admin: false,
    adminSystem: false,
    officer: false,
    rr: false,
    portal: false,
  },
  anonymous: {
    public: true,
    auth: true,
    admin: false,
    adminSystem: false,
    officer: false,
    rr: false,
    portal: false,
  },
};

describe("canAccess — the role x route matrix", () => {
  for (const actor of ACTORS) {
    describe(actor, () => {
      for (const column of COLUMN_NAMES) {
        const allowed = EXPECTED[actor][column];

        for (const path of COLUMNS[column]) {
          test(`${actor} ${allowed ? "may" : "may NOT"} reach ${path}`, () => {
            expect(canAccess(roleOf(actor), path)).toBe(allowed);
          });
        }
      }
    });
  }
});

describe("canAccess — /system is tech_admin alone", () => {
  // Called out separately because it is the one narrowing inside a group, and the
  // one most likely to be widened by accident when a new admin screen is added.
  const others: readonly Actor[] = [
    "exec_admin",
    "crrd_admin",
    "moderator",
    "officer",
    "regional_rep",
    "member",
    "anonymous",
  ];

  test("tech_admin reaches /system", () => {
    expect(canAccess("tech_admin", "/system")).toBe(true);
  });

  test("tech_admin reaches /system/user-roles", () => {
    expect(canAccess("tech_admin", "/system/user-roles")).toBe(true);
  });

  test("tech_admin reaches a deeper /system path", () => {
    expect(canAccess("tech_admin", "/system/terms/2026-2027")).toBe(true);
  });

  for (const actor of others) {
    test(`${actor} is refused /system`, () => {
      expect(canAccess(roleOf(actor), "/system")).toBe(false);
    });

    test(`${actor} is refused /system/user-roles`, () => {
      expect(canAccess(roleOf(actor), "/system/user-roles")).toBe(false);
    });
  }
});

describe("canAccess — nested paths inherit their group", () => {
  test("exec_admin reaches an application detail page", () => {
    expect(canAccess("exec_admin", "/applications/6f1b1c2e-0000-4000-8000-000000000001")).toBe(
      true,
    );
  });

  test("exec_admin reaches a member detail page", () => {
    expect(canAccess("exec_admin", "/members/6f1b1c2e-0000-4000-8000-000000000001")).toBe(true);
  });

  test("officer is refused a member detail page", () => {
    expect(canAccess("officer", "/members/6f1b1c2e-0000-4000-8000-000000000001")).toBe(false);
  });

  test("regional_rep is refused a member detail page", () => {
    expect(canAccess("regional_rep", "/members/6f1b1c2e-0000-4000-8000-000000000001")).toBe(false);
  });
});

describe("canAccess — prefixes match whole segments, never substrings", () => {
  // `/members` must not swallow `/membership-policy`; `/system` must not swallow
  // `/systematic`. A bare `startsWith` would let an unrelated future route inherit an
  // admin rule silently.
  const lookalikes = ["/systematic", "/membership-policy", "/regionally", "/portalis", "/applyx"];

  for (const path of lookalikes) {
    test(`${path} belongs to no group`, () => {
      expect(groupForPath(path)).toBeNull();
    });

    test(`exec_admin is redirected away from ${path} (unknown path denies)`, () => {
      expect(canAccess("exec_admin", path)).toBe(false);
    });

    test(`anonymous is refused ${path}`, () => {
      expect(canAccess(null, path)).toBe(false);
    });
  }
});

describe("canAccess — the root and other ungrouped paths deny by default", () => {
  test("anonymous is refused /", () => {
    expect(canAccess(null, "/")).toBe(false);
  });

  for (const role of ROLES) {
    test(`${role} is denied / and is therefore sent home`, () => {
      expect(canAccess(role, "/")).toBe(false);
    });
  }
});

describe("canAccess — /unauthorized is reachable by any signed-in account", () => {
  for (const role of ROLES) {
    test(`${role} may see ${UNAUTHORIZED_PATH}`, () => {
      expect(canAccess(role, UNAUTHORIZED_PATH)).toBe(true);
    });
  }

  test("anonymous is not sent to the refusal page — they are sent to login", () => {
    expect(canAccess(null, UNAUTHORIZED_PATH)).toBe(false);
  });
});

describe("canAccess — trailing slashes are the same path", () => {
  test("/members/ is /members for an admin", () => {
    expect(canAccess("crrd_admin", "/members/")).toBe(true);
  });

  test("/members/ is /members for an officer", () => {
    expect(canAccess("officer", "/members/")).toBe(false);
  });

  test("/system/ is still tech_admin alone", () => {
    expect(canAccess("exec_admin", "/system/")).toBe(false);
    expect(canAccess("tech_admin", "/system/")).toBe(true);
  });
});

describe("groupForPath", () => {
  const cases: ReadonlyArray<[string, RouteGroup | null]> = [
    ["/apply", "public"],
    ["/privacy", "public"],
    ["/login", "auth"],
    ["/auth/reset", "auth"],
    ["/auth/mfa/enroll", "auth"],
    ["/auth/callback", "auth"],
    ["/dashboard", "admin"],
    ["/members", "admin"],
    ["/members/abc", "admin"],
    ["/applications", "admin"],
    ["/audit", "admin"],
    ["/system", "admin"],
    ["/system/user-roles", "admin"],
    ["/directory", "officer"],
    ["/committees", "officer"],
    ["/portal", null],
    ["/region", "rr"],
    ["/", null],
    [UNAUTHORIZED_PATH, null],
    ["/nope", null],
  ];

  for (const [path, expected] of cases) {
    test(`${path} -> ${expected ?? "null"}`, () => {
      expect(groupForPath(path)).toBe(expected);
    });
  }

  test("every declared prefix resolves back to its own group", () => {
    for (const group of Object.keys(ROUTE_GROUPS) as RouteGroup[]) {
      for (const prefix of ROUTE_GROUPS[group]) {
        expect(groupForPath(prefix)).toBe(group);
      }
    }
  });
});

describe("homeForRole", () => {
  const cases: ReadonlyArray<[OrgRole, string]> = [
    ["exec_admin", "/dashboard"],
    ["crrd_admin", "/dashboard"],
    ["tech_admin", "/system"],
    ["officer", "/directory"],
    ["regional_rep", "/region"],
    // The two dead labels (0036) land on the explicit refusal page, which any
    // signed-in account may see — so the redirect cannot loop.
    ["moderator", UNAUTHORIZED_PATH],
    ["member", UNAUTHORIZED_PATH],
  ];

  for (const [role, expected] of cases) {
    test(`${role} lands on ${expected}`, () => {
      expect(homeForRole(role)).toBe(expected);
    });
  }

  test("anonymous lands on the login page", () => {
    expect(homeForRole(null)).toBe(LOGIN_PATH);
  });

  test("the map is total over the seven tiers", () => {
    // A role added to `org_role` without a landing route would fall through to
    // `undefined` here rather than to a default, so this catches it at runtime too.
    for (const role of ROLES) {
      expect(typeof homeForRole(role)).toBe("string");
      expect(homeForRole(role).startsWith("/")).toBe(true);
    }
  });

  test("no role is sent home to a route its own tier cannot access", () => {
    // Guards the redirect loop: middleware sends a denied request to homeForRole(role),
    // and if that destination were itself denied the user would bounce forever.
    for (const role of ROLES) {
      expect(canAccess(role, homeForRole(role))).toBe(true);
    }
  });
});

describe("requiresMfa — mandatory above Member tier (PRD item 2 / US-A3)", () => {
  const mustEnrol: readonly OrgRole[] = [
    "exec_admin",
    "tech_admin",
    "crrd_admin",
    "moderator",
    "officer",
    "regional_rep",
  ];

  for (const role of mustEnrol) {
    test(`${role} must enrol a second factor`, () => {
      expect(requiresMfa(role)).toBe(true);
    });
  }

  test("member is the documented exception (ADR 0004)", () => {
    expect(requiresMfa("member")).toBe(false);
  });

  test("anonymous has no factor requirement", () => {
    expect(requiresMfa(null)).toBe(false);
  });
});

describe("mfaGateEnabled — the DEV_DISABLE_MFA escape hatch", () => {
  const original = process.env.DEV_DISABLE_MFA;

  afterEach(() => {
    if (original === undefined) delete process.env.DEV_DISABLE_MFA;
    else process.env.DEV_DISABLE_MFA = original;
  });

  test("is ON when the variable is absent — the only default a security gate may have", () => {
    delete process.env.DEV_DISABLE_MFA;
    expect(mfaGateEnabled()).toBe(true);
  });

  test("is OFF only for the exact string '1'", () => {
    process.env.DEV_DISABLE_MFA = "1";
    expect(mfaGateEnabled()).toBe(false);
  });

  // Fail CLOSED on anything ambiguous. A half-written variable, a shell quoting
  // accident or a copied "true" must leave the gate standing rather than silently
  // opening it — the failure a reader would never think to look for.
  for (const value of ["", "0", "true", "TRUE", "yes", "on", " 1", "1 ", "11", "false"]) {
    test(`stays ON for ${JSON.stringify(value)}`, () => {
      process.env.DEV_DISABLE_MFA = value;
      expect(mfaGateEnabled()).toBe(true);
    });
  }
});
