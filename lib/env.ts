// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT PARSING — one module, zod-validated, FAILING FAST AND NAMING EVERY
// MISSING KEY (BUILD_PLAN S7-T2).
//
// The failure this replaces: an unset env read is `undefined`, that `undefined`
// reaches Supabase or Google, and the error that surfaces three layers later names
// neither the variable nor the file. On a system a student officer inherits, "which of
// the fourteen variables did I forget" is not a question the stack trace should be
// asked to answer.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THE ACCESSORS ARE LAZY, AND WHY THIS IS SPLIT ACROSS TWO FILES
// ═══════════════════════════════════════════════════════════════════════════════
// LAZY: parsing at module load would break `pnpm build` and `pnpm typecheck` in CI,
// where no environment exists and none is needed — a build must not require a
// production secret. So nothing is read until the FIRST RUNTIME ACCESS, which is where
// a missing variable becomes a loud, named error instead of a silent `undefined`.
//
// SPLIT: `lib/env-server.ts` carries `import "server-only"`, so importing the SECRET
// half from a Client Component is a BUILD ERROR rather than a runtime surprise. That
// import also throws inside Vitest, which is exactly why the schemas and the pure parse
// functions live HERE, in a file a unit test can import — `lib/env.test.ts` proves the
// secret schema's behaviour without ever importing the server-only wrapper.
//
// ═══════════════════════════════════════════════════════════════════════════════
// TWO VARIABLES THAT ARE DELIBERATELY ABSENT
// ═══════════════════════════════════════════════════════════════════════════════
//   · SUPABASE_DB_URL — a direct `postgres://` superuser connection that BYPASSES ROW
//     LEVEL SECURITY entirely. It is the most dangerous secret in the system, and the
//     application has no direct-Postgres path by design (CLAUDE.md banned patterns;
//     ARCHITECTURE.md §1 "NO ORM"). It belongs to `.github/workflows/scheduled.yml`
//     (the `pg_dump`) and to Bitwarden, and to nowhere else. It must never become a
//     Vercel environment variable, and this schema not knowing its name is part of how
//     that stays true.
//   · B2_KEY_ID / B2_APPLICATION_KEY / B2_BUCKET / B2_S3_ENDPOINT — the off-provider
//     backup credentials. Same reasoning: GitHub Actions and Bitwarden only. The app
//     never writes a backup, so the app never holds the key that could delete one.
//
// Both are documented in `.env.example` as CI-only, and in
// `docs/runbooks/03-CREDENTIAL_ROTATION.md` with the surface each lives on.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

/** A minimal read-only view of `process.env`, so tests can pass a plain object. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

// ── The naming rule ──────────────────────────────────────────────────────────

/**
 * `NEXT_PUBLIC_` is not a label — it is an INSTRUCTION TO THE BUNDLER. Next inlines
 * every `NEXT_PUBLIC_*` value into the client JavaScript, so a secret carrying that
 * prefix is published to every visitor by the build itself, silently and irreversibly.
 * `NEXT_PUBLIC_SERVICE_ROLE_KEY` would hand an anonymous applicant an RLS bypass.
 *
 * Only two variables may carry the prefix (CLAUDE.md "Naming"): the Supabase URL and
 * the anon key, both of which are safe in a browser precisely because RLS is the
 * boundary rather than key secrecy.
 */
export const PUBLIC_PREFIX = "NEXT_PUBLIC_";

/**
 * Reject a secret variable that is named as if it were public.
 *
 * Runs at module load over the declared key sets — a pure check over string constants,
 * costing nothing and reading no environment. A violation is a THROW, not a warning:
 * there is no safe way to continue past a secret the bundler has been told to publish.
 *
 * @throws naming every offending key.
 */
export function assertSecretsAreNotPublic(names: readonly string[]): void {
  const offenders = names.filter((name) => name.startsWith(PUBLIC_PREFIX));

  if (offenders.length > 0) {
    throw new Error(
      `Environment naming violation: ${offenders.join(", ")} — a secret must never be ` +
        `named with the ${PUBLIC_PREFIX} prefix. Next.js inlines every ${PUBLIC_PREFIX}* ` +
        `value into the client bundle, so such a variable is published to every visitor ` +
        `by the build. Only NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY ` +
        `may carry it (CLAUDE.md "Naming").`,
    );
  }
}

// ── Schemas ──────────────────────────────────────────────────────────────────

/** Present and non-empty. An empty string is a variable somebody forgot to fill in. */
const required = z.string().trim().min(1);

/** Present-or-absent, and normalised so `""` reads as absent rather than as a value. */
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

/**
 * The two variables that reach the browser. Safe there by design: the URL is public,
 * and the anon key grants exactly what RLS permits an anonymous caller (ARCHITECTURE §5).
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: required.pipe(z.url()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required,
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * The server half.
 *
 * `DOCUMENT_STORE` is validated against the three driver names here as well as inside
 * `lib/documents/index.ts`, because a typo there must fail at boot rather than at the
 * moment an applicant uploads their Certificate of Registration.
 *
 * The Google variables are OPTIONAL at this layer and are asserted by the Drive driver
 * at first use: a deployment running `DOCUMENT_STORE=supabase_storage` (ADR 0005)
 * legitimately holds none of them, and demanding them would make the fallback
 * unbootable — which is the opposite of what a fallback is for.
 */
export const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: required,
  DOCUMENT_STORE: z.enum(["fake", "drive", "supabase_storage"]),
  JOB_SHARED_SECRET: required,
  RATE_LIMIT_HMAC_KEY: required,
  GOOGLE_SA_CLIENT_EMAIL: optional,
  GOOGLE_SA_PRIVATE_KEY: optional,
  GOOGLE_DRIVE_SHARED_DRIVE_ID: optional,
  GOOGLE_DRIVE_PROOF_FOLDER_ID: optional,
  SENTRY_DSN: optional,
  // Outbound mail (ADR 0010). The transport name is required so a deployment cannot
  // silently fall back to delivering nothing; the credentials are optional here and
  // asserted by lib/mail/ at first use when MAIL_TRANSPORT=gmail_smtp.
  MAIL_TRANSPORT: z.enum(["fake", "gmail_smtp"]),
  GMAIL_SMTP_USER: optional,
  GMAIL_SMTP_APP_PASSWORD: optional,
  MAIL_FROM_NAME: optional,
  MAIL_REPLY_TO: optional,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Every key each half declares. Used by the naming rule and by the error messages. */
export const PUBLIC_ENV_KEYS = Object.keys(publicEnvSchema.shape) as ReadonlyArray<
  keyof PublicEnv & string
>;

export const SERVER_ENV_KEYS = Object.keys(serverEnvSchema.shape) as ReadonlyArray<
  keyof ServerEnv & string
>;

// Enforced at module load, over constants, reading nothing.
assertSecretsAreNotPublic(SERVER_ENV_KEYS);

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Turn a zod failure into one message naming EVERY offending variable.
 *
 * "Every" is the requirement: a message naming only the first missing key produces a
 * deploy-fail-fix-deploy loop, once per variable, each round trip several minutes long.
 */
function describeFailure(half: "public" | "server", error: z.ZodError): string {
  const names = new Set<string>();

  for (const issue of error.issues) {
    const first = issue.path[0];
    names.add(typeof first === "string" ? first : "(unknown)");
  }

  return (
    `Environment: missing or invalid ${half} variable(s): ${[...names].sort().join(", ")}. ` +
    `Every variable this system reads is registered by name in .env.example — copy it to ` +
    `.env.local for development (\`cp .env.example .env.local\`). Production values live in ` +
    `the Vercel Production scope and in Bitwarden; see ` +
    `docs/runbooks/03-CREDENTIAL_ROTATION.md for which surface each one belongs on.`
  );
}

/**
 * Parse the public half. Pure — no caching, no `process.env` access of its own.
 *
 * @throws naming every missing or invalid public variable.
 */
export function parsePublicEnv(source: EnvSource): PublicEnv {
  const parsed = publicEnvSchema.safeParse(source);
  if (!parsed.success) throw new Error(describeFailure("public", parsed.error));
  return parsed.data;
}

/**
 * Parse the server half. Pure, for the same reason — and importantly IMPORTABLE FROM A
 * TEST, which `lib/env-server.ts` is not.
 *
 * @throws naming every missing or invalid server variable.
 */
export function parseServerEnv(source: EnvSource): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) throw new Error(describeFailure("server", parsed.error));
  return parsed.data;
}

// ── The lazy public accessor ─────────────────────────────────────────────────

let publicCache: PublicEnv | null = null;

/**
 * The validated public environment, parsed on first access and cached thereafter.
 *
 * Safe to call from a Client Component: it reads only the two `NEXT_PUBLIC_*` values,
 * which Next has already inlined into the bundle by the time this runs there.
 *
 * @param source overridable for tests. A non-default source is never cached, so a test
 *        cannot poison the cache for the process.
 * @throws naming every missing or invalid public variable.
 */
export function getPublicEnv(source: EnvSource = process.env): PublicEnv {
  const isProcessEnv = source === (process.env as EnvSource);

  if (isProcessEnv && publicCache !== null) return publicCache;

  const parsed = parsePublicEnv(source);
  if (isProcessEnv) publicCache = parsed;
  return parsed;
}

/** Drop the memoised public environment. Tests only; production never changes env. */
export function resetPublicEnvCache(): void {
  publicCache = null;
}
