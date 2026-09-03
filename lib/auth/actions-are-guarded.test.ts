// ─────────────────────────────────────────────────────────────────────────────
// THE STRUCTURAL GUARANTEE (BUILD_PLAN S3-T14).
//
// CONVENTIONS.md §0 rule 6 says every Server Action opens with `withRole([...])`. A
// rule that lives only in a document is a rule that holds until the night someone is
// tired. This test reads the SOURCE of every action module in `lib/` and asserts that
// every exported action is wrapped in `withRole`, `withAnyRole` or `withPublic` — or
// appears, with a written reason, in the small allowlist below.
//
// ⚠ THE RED IS PERMANENTLY ENCODED. A guard test that has never failed is a guard test
// nobody knows works, and this one is trivially easy to write so that it passes on
// everything. `describe("the detector itself")` at the bottom feeds it inline source
// fixtures — an unwrapped action it MUST flag, and wrapped ones it must NOT — so the
// detector is checked against a known-bad input on every single run, not once by hand
// in September 2026.
//
// It is a REGEX ON SOURCE, not a type check, and that is the point: the compiler
// cannot tell a guarded action from an unguarded one, because both are just a function
// returning `Promise<ActionResult<T>>`.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LIB_ROOT = join(REPO_ROOT, "lib");

/** The three wrappers that count as a guard. Nothing else does. */
const GUARDS = ["withRole", "withAnyRole", "withPublic"];

/**
 * Exports that are deliberately unguarded, each with the reason.
 *
 * Every entry here is an AUTHENTICATION action: it either establishes the session or
 * operates on the caller's own credential, so there is no role to check yet, or the
 * check is "any signed-in account". They carry their own server-side guards instead —
 * `updatePassword` re-reads AAL server-side (US-A4), the MFA actions require a session
 * from `getUser()`.
 *
 * ⚠ Adding a line here is a security decision, not a formality. It needs a reason in
 * the PR and, per CONVENTIONS §7.3, a matching test that proves whatever guard the
 * action carries instead. Nothing in `lib/applications/` may ever appear here: the
 * intake actions are wrapped in `withPublic`, which exists precisely so that "public"
 * is stated rather than inferred from an absence.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; name: string; reason: string }> = [
  {
    file: "lib/auth/actions.ts",
    name: "signIn",
    reason:
      "Signing in is how a role is established; there is none to check yet. Guarded instead " +
      "by Supabase Auth plus a single generic failure message (S2-T33).",
  },
  {
    file: "lib/auth/actions.ts",
    name: "signOut",
    reason:
      "Ends the CALLER'S OWN session and nothing else — scope 'local', no id parameter, so " +
      "there is no target to authorize against. A role gate here could only refuse someone " +
      "the right to log out. Ending another user's session is auth.admin.signOut on the " +
      "service-role client, which lives behind lib/server/admin-client.ts.",
  },
  {
    file: "lib/auth/mfa-actions.ts",
    name: "enrollTotp",
    reason:
      "Every signed-in account above member MUST enrol (US-A3); gating on a tier would " +
      "make the mandatory-enrolment screen unreachable for the tier that needs it.",
  },
  {
    file: "lib/auth/mfa-actions.ts",
    name: "verifyEnrolment",
    reason: "Completes the caller's own enrolment. Same reasoning as enrollTotp.",
  },
  {
    file: "lib/auth/mfa-actions.ts",
    name: "verifyMfa",
    reason:
      "Raises the caller's own session from aal1 to aal2. Runs before the session is " +
      "privileged enough for any role gate to be meaningful.",
  },
  {
    file: "lib/auth/reset-actions.ts",
    name: "updatePassword",
    reason:
      "US-A4. Runs on a recovery-link session and carries its OWN server-side guard — it " +
      "re-reads the assurance level and refuses aal1 for any role above member " +
      "(reset-actions.test.ts asserts updateUser is never called).",
  },
];

// ── Source scanning ──────────────────────────────────────────────────────────

/**
 * Strip comments and string literals from TypeScript source.
 *
 * NOT optional, and not a nicety. `lib/auth/mfa-actions.ts` contains the sentence
 * "Deliberately NOT wrapped in `withRole([...])`" in a comment. A naive regex would
 * read that as a guard and pass the file — the exact false negative that would make
 * this whole test worthless.
 */
function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === "//") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }

    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }

    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      // Replaced by a placeholder so token boundaries survive.
      out += '""';
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

type ExportedAction = { name: string; guarded: boolean };

/**
 * Find every exported ACTION in a module and say whether it is wrapped.
 *
 * Two forms are recognised, because both appear in this codebase:
 *   `export const approveApplication = withRole([...], async (ctx, input) => {...})`
 *   `export async function signIn(...) {...}`
 *
 * `export type` / `export interface` and plain constant exports are ignored — a
 * `const` is only treated as an action when its initializer is a guard call or a
 * function expression.
 */
export function findExportedActions(source: string): ExportedAction[] {
  const code = stripCommentsAndStrings(source);
  const found: ExportedAction[] = [];

  const constExport = /export\s+const\s+([A-Za-z0-9_$]+)\s*(?::[^=]*?)?=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = constExport.exec(code)) !== null) {
    const name = match[1];
    if (name === undefined) continue;

    const initializer = code.slice(
      match.index + match[0].length,
      match.index + match[0].length + 40,
    );
    const guarded = GUARDS.some(
      (guard) => initializer.includes(`${guard}(`) || initializer.includes(`${guard}<`),
    );

    // A const that is neither a guard call nor a function is not an action.
    const isFunction = /^(async\s+)?(\(|function\b)/.test(initializer.trimStart());
    if (!guarded && !isFunction) continue;

    found.push({ name, guarded });
  }

  const fnExport = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g;
  while ((match = fnExport.exec(code)) !== null) {
    const name = match[1];
    if (name === undefined) continue;
    // A `function` declaration is never wrapped — wrapping produces a `const`.
    found.push({ name, guarded: false });
  }

  return found;
}

/** Every `*actions.ts` under `lib/`, excluding tests. */
function actionModules(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...actionModules(full));
      continue;
    }
    if (entry.name.endsWith(".test.ts")) continue;
    // `*actions.ts`, not `actions.ts` — `mfa-actions.ts`, `role-actions.ts` and
    // `window-actions.ts` are action modules too, and a filename-exact glob would
    // silently exempt them.
    if (entry.name.endsWith("actions.ts")) out.push(full);
  }
  return out;
}

const MODULES = actionModules(LIB_ROOT).map((full) => ({
  path: relative(REPO_ROOT, full).split("\\").join("/"),
  source: readFileSync(full, "utf8"),
}));

function isAllowlisted(file: string, name: string): boolean {
  return ALLOWLIST.some((entry) => entry.file === file && entry.name === name);
}

// ── The assertions ───────────────────────────────────────────────────────────

describe("every Server Action is guarded", () => {
  it("finds action modules at all — a zero-length scan would pass vacuously", () => {
    expect(MODULES.length).toBeGreaterThan(0);
    expect(MODULES.map((m) => m.path)).toContain("lib/auth/actions.ts");
  });

  it.each(MODULES.map((m) => [m.path, m.source] as const))(
    "%s exports only guarded or explicitly allowlisted actions",
    (path, source) => {
      const unguarded = findExportedActions(source)
        .filter((action) => !action.guarded)
        .filter((action) => !isAllowlisted(path, action.name))
        .map((action) => action.name);

      expect(
        unguarded,
        `${path} exports ${unguarded.join(", ")} without withRole/withAnyRole/withPublic. ` +
          `Wrap it, or add it to ALLOWLIST in this file with a written reason and a test ` +
          `that proves the guard it carries instead.`,
      ).toEqual([]);
    },
  );

  it("keeps the allowlist from rotting — every entry names a real, still-unguarded export", () => {
    for (const entry of ALLOWLIST) {
      const module = MODULES.find((m) => m.path === entry.file);
      expect(module, `ALLOWLIST names ${entry.file}, which no longer exists`).toBeDefined();

      const actions = findExportedActions(module?.source ?? "");
      const action = actions.find((a) => a.name === entry.name);
      expect(
        action,
        `ALLOWLIST names ${entry.file}#${entry.name}, which is not exported`,
      ).toBeDefined();
      // If it has since been wrapped, delete the exemption rather than leaving a
      // standing "this one is allowed to be unguarded" note next to a guarded action.
      expect(
        action?.guarded,
        `${entry.file}#${entry.name} is now guarded — remove it from ALLOWLIST`,
      ).toBe(false);
      expect(entry.reason.length).toBeGreaterThan(30);
    }
  });

  it("never exempts an intake action — those are wrapped in withPublic by design", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.file.startsWith("lib/applications/")).toBe(false);
    }
  });
});

// ── The permanently encoded red ──────────────────────────────────────────────

describe("the detector itself", () => {
  const UNGUARDED_FIXTURE = `
"use server";
import { type ActionResult, ok } from "@/lib/action-result";

export async function deleteEverything(input: unknown): Promise<ActionResult<null>> {
  return ok(null);
}
`;

  const GUARDED_CONST_FIXTURE = `
"use server";
export const approveApplication = withRole(["crrd_admin"], async (ctx, input) => {
  return ok(null);
});
`;

  const PUBLIC_FIXTURE = `
"use server";
export const startApplication = withPublic(
  { rateLimit: { bucket: "apply_ip", limit: 10 }, schema: startApplicationSchema },
  async (ctx, input) => ok(null),
);
`;

  const COMMENT_TRAP_FIXTURE = `
"use server";
// Deliberately NOT wrapped in \`withRole([...])\`: every signed-in account may enrol.
export async function enrollTotp(): Promise<ActionResult<null>> {
  return ok(null);
}
`;

  it("FLAGS an unwrapped exported action", () => {
    // This is the red. If this ever passes trivially, the detector has stopped working
    // and every "green" above means nothing.
    const found = findExportedActions(UNGUARDED_FIXTURE);
    expect(found).toContainEqual({ name: "deleteEverything", guarded: false });
  });

  it("accepts a withRole-wrapped const", () => {
    expect(findExportedActions(GUARDED_CONST_FIXTURE)).toContainEqual({
      name: "approveApplication",
      guarded: true,
    });
  });

  it("accepts a withPublic-wrapped const", () => {
    expect(findExportedActions(PUBLIC_FIXTURE)).toContainEqual({
      name: "startApplication",
      guarded: true,
    });
  });

  it("is NOT fooled by the word withRole appearing in a comment", () => {
    // The exact false negative this file would otherwise ship with: mfa-actions.ts
    // really does contain that sentence.
    expect(findExportedActions(COMMENT_TRAP_FIXTURE)).toContainEqual({
      name: "enrollTotp",
      guarded: false,
    });
  });

  it("ignores type and plain-constant exports", () => {
    const source = `
export type InviteUserAction = (input: unknown) => Promise<ActionResult<null>>;
export const GENERIC_LOGIN_ERROR = "Invalid email or password";
export const APPLICATION_PAYLOAD_KEYS = ["birthdate", "contact_number"];
`;
    expect(findExportedActions(source)).toEqual([]);
  });
});
