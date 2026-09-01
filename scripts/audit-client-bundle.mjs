#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT-BUNDLE AUDIT — BUILD_PLAN S7-T10, wired into ci.yml's `js` job after Build.
//
// The invariant: NOTHING SERVER-ONLY REACHES THE BROWSER. `import "server-only"` is the
// primary net and it fires in the editor; this script is the second net, and it exists
// because the primary one has a gap — a plain `process.env.SOMETHING` in a file that
// drifts into a client boundary is inlined by the bundler with no error at all.
//
// It reads the BUILT ARTIFACT, not the source. That matters: what ships is the output of
// tree-shaking, inlining and code-splitting, and a source file can look server-only while
// a fragment of it ends up in a chunk.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY A SENSITIVE COLUMN NAME IS NOT, BY ITSELF, A FINDING
// ═══════════════════════════════════════════════════════════════════════════════
// The obvious version of this check — "fail if any name in SENSITIVE_KEYS appears in a
// client chunk" — is WRONG HERE, and it is worth writing down why so nobody re-adds it.
//
// The public application form is a Client Component. It MUST carry
// `name="birthdate"`, `name="contact_number"`, `name="address_line"` — because a form
// field's name is, by convention in this codebase, the database column name
// (CONVENTIONS.md §6: field name == schema key == column name). The admin member edit
// form is the same. A COLUMN NAME IS NOT PERSONAL DATA; a birthdate is. A check that
// cannot tell them apart fails on every build, gets marked `continue-on-error` within a
// week, and then protects nothing — which is worse than not having it, because the
// green check still reads as coverage.
//
// So this script fails on EVIDENCE, not on vocabulary:
//
//   1. FORBIDDEN LITERALS — `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, a PEM header,
//      an age secret key, `/rest/v1/people?select=*`. None of these has an innocent
//      reading in a browser bundle. Each means a server module was bundled.
//   2. SECRET ENV NAMES — every non-`NEXT_PUBLIC_` name registered in `.env.example`.
//      Next inlines `NEXT_PUBLIC_*` and leaves the rest behind; seeing one of the rest
//      means server code crossed the boundary.
//   3. PII-SHAPED DATA ACCESS — a sensitive column name inside a PostgREST select list
//      or REST URL (`select=birthdate,...`, `/rest/v1/people?...`). THIS is the shape of
//      a client reading PII directly, and it is what the naive check was reaching for.
//
// Sensitive names outside those shapes are reported as INFORMATION, not failure, so a
// reviewer can still see where they occur.
//
// ═══════════════════════════════════════════════════════════════════════════════
// VERIFY THE RED (S7-T10 acceptance, and the rule this repo runs on)
// ═══════════════════════════════════════════════════════════════════════════════
// A guard that has never failed is a guard nobody knows works. To see it red:
//   1. Add `console.log(process.env.SUPABASE_SERVICE_ROLE_KEY)` to a `'use client'`
//      component (and delete the `server-only` import that would stop it first).
//   2. `pnpm build && node scripts/audit-client-bundle.mjs`  → exit 1, naming the chunk
//      and the byte offset.
//   3. Revert. Re-run. → exit 0.
//
// Usage:  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//              scripts/audit-client-bundle.mjs [--dir .next]
// Exit:   0 clean · 1 findings · 2 nothing to audit (no build)
//
// The flag silences one cosmetic Node warning. This `.mjs` imports the `.ts` list
// directly — Node 24 strips the types — and Node notes that `package.json` has no
// `"type"` field. Importing the TypeScript module rather than copying the list is the
// point: a second copy of SENSITIVE_KEYS would drift from the Sentry scrub's copy, and
// the drift would be invisible because both files would still look correct.
// ═══════════════════════════════════════════════════════════════════════════════

// `console` and `process` are imported rather than taken from the global scope: the
// repo's flat ESLint config declares no environment globals, so an explicit import is
// what makes this file lintable without touching `eslint.config.mjs` — a file
// CLAUDE.md tells you to stop and ask before editing.
import console from "node:console";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { FORBIDDEN_CLIENT_LITERALS, SENSITIVE_KEYS } from "../lib/observability/sensitive-keys.ts";

const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const BUILD_DIR = dirFlag === -1 ? ".next" : (args[dirFlag + 1] ?? ".next");

/**
 * Directories inside the build output that are actually SERVED TO A BROWSER.
 *
 * `.next/server/**` is deliberately excluded: it is the server bundle, it is SUPPOSED
 * to contain the service-role key and every secret env name, and auditing it would
 * produce a wall of findings about correct code.
 */
const CLIENT_DIRS = [
  path.join(BUILD_DIR, "static", "chunks"),
  path.join(BUILD_DIR, "static", "css"),
];

/**
 * Environment names that legitimately survive into a client chunk.
 *
 * `NODE_ENV` is inlined by every bundler and appears in framework code; `CI`,
 * `NEXT_RUNTIME` and `TURBOPACK` are build-tool plumbing. None is a credential. Anything
 * NOT on this list and not `NEXT_PUBLIC_*` is a finding.
 */
const ENV_NAME_ALLOWLIST = new Set([
  "NODE_ENV",
  "CI",
  "NEXT_RUNTIME",
  "TURBOPACK",
  "__NEXT_PRIVATE_ORIGIN",
]);

/** Framework strings that would otherwise trip a literal match. Empty today; kept so an exemption is a reviewed diff rather than a quiet regex edit. */
const LITERAL_ALLOWLIST = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** `line:column` for a byte offset, so a finding points at a place and not just a file. */
function locate(content, index) {
  const before = content.slice(0, index);
  const line = before.split("\n").length;
  const column = index - (before.lastIndexOf("\n") + 1) + 1;
  return `${line}:${column}`;
}

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip what a scan must not read:
 *   · `//# sourceMappingURL=...` — a build artefact reference, not shipped logic.
 *   · `/*# sourceURL ... *\/` comments.
 * Offsets are preserved by replacing with same-length spaces, so a reported
 * line:column still points at the real place in the real file.
 */
function stripSourceMapRefs(content) {
  return content.replace(/\/[/*]#\s*source(?:Mapping)?URL=[^\s*]*(\*\/)?/g, (m) =>
    " ".repeat(m.length),
  );
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && /\.(js|mjs|css)$/.test(entry.name)) {
      // .map files are excluded by the extension test above: they are not served to a
      // browser by default and they legitimately contain original source text.
      yield full;
    }
  }
}

/** Every non-NEXT_PUBLIC_ variable name registered in `.env.example`. */
async function readSecretEnvNames() {
  let text;
  try {
    text = await readFile(".env.example", "utf8");
  } catch {
    console.error("::error::.env.example is missing — it is the register of every variable.");
    process.exit(2);
  }

  const names = [];
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (name.startsWith("NEXT_PUBLIC_")) continue;
    if (ENV_NAME_ALLOWLIST.has(name)) continue;
    names.push(name);
  }
  return names;
}

// ── The three checks ─────────────────────────────────────────────────────────

function findForbiddenLiterals(content, file, findings) {
  for (const literal of FORBIDDEN_CLIENT_LITERALS) {
    if (LITERAL_ALLOWLIST.includes(literal)) continue;
    let index = content.indexOf(literal);
    while (index !== -1) {
      findings.push({
        file,
        at: locate(content, index),
        rule: "forbidden-literal",
        detail: `"${literal}" — a server-only literal in a browser bundle means a server module was bundled.`,
      });
      // One finding per literal per file is enough to act on; keep the log readable.
      break;
    }
  }
}

function findSecretEnvNames(content, file, secretNames, findings) {
  for (const name of secretNames) {
    // Word-boundary match, so GOOGLE_SA_PRIVATE_KEY does not also report
    // GOOGLE_SA_PRIVATE_KEY_ID and a substring cannot masquerade as a hit.
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    const match = re.exec(content);
    if (match) {
      findings.push({
        file,
        at: locate(content, match.index),
        rule: "secret-env-name",
        detail: `"${name}" is a non-NEXT_PUBLIC_ variable. Next leaves those on the server; seeing one here means server code crossed the client boundary.`,
      });
    }
  }
}

/**
 * A sensitive column named inside a PostgREST select list or REST URL.
 *
 * This is the shape that actually matters: `select=given_name,birthdate` or
 * `/rest/v1/people?...`. A bare `"birthdate"` — a form field name — is not matched, on
 * purpose (see the header).
 */
function findPiiDataAccess(content, file, findings, info) {
  const SELECT_CONTEXT = /(?:\bselect=|\.select\(\s*["'`])([^"'`&\n]{0,400})/g;

  let match;
  while ((match = SELECT_CONTEXT.exec(content)) !== null) {
    const list = match[1];
    for (const key of SENSITIVE_KEYS) {
      if (new RegExp(`\\b${escapeRegExp(key)}\\b`).test(list)) {
        findings.push({
          file,
          at: locate(content, match.index),
          rule: "pii-data-access",
          detail: `a PostgREST select list in client code names the sensitive column "${key}". PII is read in Server Components and passed down already filtered (CLAUDE.md "Privacy").`,
        });
      }
    }
  }

  if (/\/rest\/v1\/people\b/.test(content)) {
    const index = content.search(/\/rest\/v1\/people\b/);
    findings.push({
      file,
      at: locate(content, index),
      rule: "pii-data-access",
      detail: `client code addresses /rest/v1/people directly. \`people\` carries every sensitive column; browsers read the directory view, never the table.`,
    });
  }

  // Informational only — never a failure. See the header for why.
  for (const key of SENSITIVE_KEYS) {
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`);
    if (re.test(content)) info.add(key);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await stat(BUILD_DIR);
  } catch {
    console.error(
      `::error::${BUILD_DIR} does not exist. This audit reads the BUILT ARTIFACT — run \`pnpm build\` first (in CI it runs immediately after the Build step).`,
    );
    process.exit(2);
  }

  const secretNames = await readSecretEnvNames();
  const findings = [];
  const informational = new Set();
  let scanned = 0;

  for (const dir of CLIENT_DIRS) {
    for await (const file of walk(dir)) {
      const raw = await readFile(file, "utf8");
      const content = stripSourceMapRefs(raw);
      scanned += 1;

      findForbiddenLiterals(content, file, findings);
      findSecretEnvNames(content, file, secretNames, findings);
      findPiiDataAccess(content, file, findings, informational);
    }
  }

  if (scanned === 0) {
    console.error(
      `::error::No client chunks found under ${CLIENT_DIRS.join(", ")}. Either the build did not produce a client bundle, or this script is looking in the wrong place — both mean the audit proved nothing, so it fails rather than reporting clean.`,
    );
    process.exit(2);
  }

  console.log(`Client bundle audit: scanned ${scanned} file(s) under ${BUILD_DIR}/static.`);
  console.log(`  secret env names checked: ${secretNames.length}`);
  console.log(`  forbidden literals checked: ${FORBIDDEN_CLIENT_LITERALS.length}`);

  if (informational.size > 0) {
    console.log("");
    console.log(
      `  note: sensitive COLUMN NAMES present in client code (expected — a form field's name is its column name; not a finding): ${[...informational].sort().join(", ")}`,
    );
  }

  if (findings.length === 0) {
    console.log("");
    console.log("PASS — no secrets, no secret env names, and no client-side PII reads.");
    process.exit(0);
  }

  console.log("");
  for (const f of findings) {
    console.error(`::error file=${f.file},line=${f.at.split(":")[0]}::[${f.rule}] ${f.detail}`);
    console.error(`  ${f.file}:${f.at}  (${f.rule})`);
  }
  console.error("");
  console.error(
    `FAIL — ${findings.length} finding(s). Something server-only is being served to browsers. The fix is to move the code behind a Server Component or a Server Action, never to add it to an allowlist (ARCHITECTURE.md §5; CLAUDE.md "Privacy").`,
  );
  process.exit(1);
}

await main();
