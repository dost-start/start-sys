// Environment parsing (BUILD_PLAN S7-T2).
//
// Two properties are worth a test here, and both of them are properties of a FAILURE:
//
//   1. Unsetting ANY required key throws, AND THE MESSAGE NAMES THAT KEY. A message
//      naming only the first missing variable produces a deploy-fail-fix-deploy loop,
//      once per variable — which is exactly the experience this module exists to
//      remove. So every required key gets its own case, generated from the declared key
//      list rather than hand-listed: a key added to the schema without a test is
//      impossible, because the loop reads the schema.
//
//   2. The naming rule refuses a secret carrying the NEXT_PUBLIC_ prefix. Next inlines
//      every NEXT_PUBLIC_* value into the client bundle, so a variable named
//      NEXT_PUBLIC_SERVICE_ROLE_KEY is published to every visitor by the build itself.
//      There is no runtime check that can undo that, which is why the check is on the
//      NAME and why it throws rather than warns.
//
// `lib/env-server.ts` is deliberately not imported: `server-only` throws under Vitest.
// Everything it wraps is `parseServerEnv`, which is tested here directly.

import { describe, expect, it } from "vitest";

import {
  assertSecretsAreNotPublic,
  getPublicEnv,
  parsePublicEnv,
  parseServerEnv,
  PUBLIC_ENV_KEYS,
  resetPublicEnvCache,
  SERVER_ENV_KEYS,
  serverEnvSchema,
} from "@/lib/env";

/** A complete, valid public environment. Values are shaped, never real. */
const VALID_PUBLIC = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-placeholder",
} as const;

/** A complete, valid server environment, including the optional Google block. */
const VALID_SERVER = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder",
  DOCUMENT_STORE: "fake",
  JOB_SHARED_SECRET: "job-secret-placeholder",
  RATE_LIMIT_HMAC_KEY: "hmac-placeholder",
  GOOGLE_SA_CLIENT_EMAIL: "sa@example.iam.gserviceaccount.com",
  GOOGLE_SA_PRIVATE_KEY: "key-placeholder",
  GOOGLE_DRIVE_SHARED_DRIVE_ID: "drive-placeholder",
  GOOGLE_DRIVE_PROOF_FOLDER_ID: "folder-placeholder",
  SENTRY_DSN: "https://example.ingest.sentry.io/1",
} as const;

/** Which server keys the schema treats as required, derived from the schema itself. */
const REQUIRED_SERVER_KEYS = SERVER_ENV_KEYS.filter(
  (key) => !serverEnvSchema.shape[key].safeParse(undefined).success,
);

function withoutKey(source: Record<string, string>, key: string): Record<string, string> {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

describe("parsePublicEnv", () => {
  it("accepts a complete public environment", () => {
    expect(parsePublicEnv(VALID_PUBLIC)).toEqual(VALID_PUBLIC);
  });

  // One case per declared public key, generated from the schema.
  for (const key of PUBLIC_ENV_KEYS) {
    it(`throws naming ${key} when it is missing`, () => {
      expect(() => parsePublicEnv(withoutKey({ ...VALID_PUBLIC }, key))).toThrow(key);
    });

    it(`throws naming ${key} when it is present but empty`, () => {
      // An empty string is the common real failure: the variable exists in Vercel with
      // nothing in it, which `process.env` access reports as "" rather than as undefined.
      expect(() => parsePublicEnv({ ...VALID_PUBLIC, [key]: "" })).toThrow(key);
    });
  }

  it("rejects a Supabase URL that is not a URL", () => {
    expect(() =>
      parsePublicEnv({ ...VALID_PUBLIC, NEXT_PUBLIC_SUPABASE_URL: "localhost" }),
    ).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("names EVERY missing key in one message, not just the first", () => {
    // The whole point of the module: one deploy, one complete list.
    let message = "";
    try {
      parsePublicEnv({});
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    for (const key of PUBLIC_ENV_KEYS) expect(message).toContain(key);
  });

  it("points the reader at .env.example rather than at a stack trace", () => {
    expect(() => parsePublicEnv({})).toThrow(/\.env\.example/);
  });
});

describe("parseServerEnv", () => {
  it("accepts a complete server environment", () => {
    expect(parseServerEnv(VALID_SERVER).SUPABASE_SERVICE_ROLE_KEY).toBe("service-role-placeholder");
  });

  for (const key of REQUIRED_SERVER_KEYS) {
    it(`throws naming ${key} when it is missing`, () => {
      expect(() => parseServerEnv(withoutKey({ ...VALID_SERVER }, key))).toThrow(key);
    });
  }

  it("names every missing required key in one message", () => {
    let message = "";
    try {
      parseServerEnv({});
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    for (const key of REQUIRED_SERVER_KEYS) expect(message).toContain(key);
  });

  it("treats the Google block as optional, so the ADR 0005 fallback can boot", () => {
    // A deployment on DOCUMENT_STORE=supabase_storage holds no Google credentials.
    // Demanding them here would make the documented fallback unbootable.
    const withoutGoogle = {
      SUPABASE_SERVICE_ROLE_KEY: VALID_SERVER.SUPABASE_SERVICE_ROLE_KEY,
      DOCUMENT_STORE: "supabase_storage",
      JOB_SHARED_SECRET: VALID_SERVER.JOB_SHARED_SECRET,
      RATE_LIMIT_HMAC_KEY: VALID_SERVER.RATE_LIMIT_HMAC_KEY,
    };

    const parsed = parseServerEnv(withoutGoogle);
    expect(parsed.GOOGLE_SA_PRIVATE_KEY).toBeUndefined();
    expect(parsed.DOCUMENT_STORE).toBe("supabase_storage");
  });

  it("normalises an empty optional variable to undefined rather than to an empty string", () => {
    const parsed = parseServerEnv({ ...VALID_SERVER, SENTRY_DSN: "" });
    expect(parsed.SENTRY_DSN).toBeUndefined();
  });

  it("rejects an unknown DOCUMENT_STORE rather than falling back to a default", () => {
    // Quietly selecting the fake store in production would accept a scholar's
    // Certificate of Registration into a temp directory and report success.
    expect(() => parseServerEnv({ ...VALID_SERVER, DOCUMENT_STORE: "gdrive" })).toThrow(
      "DOCUMENT_STORE",
    );
  });

  it("does not know SUPABASE_DB_URL or the B2 credentials", () => {
    // Deliberate absence, not an oversight: SUPABASE_DB_URL bypasses RLS entirely and
    // the app has no direct-Postgres path. They belong to GitHub Actions and Bitwarden.
    // If either name ever appears here, someone has given the web app the ability to
    // read every row in the database without a policy.
    for (const forbidden of [
      "SUPABASE_DB_URL",
      "B2_KEY_ID",
      "B2_APPLICATION_KEY",
      "B2_BUCKET",
      "B2_S3_ENDPOINT",
    ]) {
      expect(SERVER_ENV_KEYS).not.toContain(forbidden);
      expect(PUBLIC_ENV_KEYS).not.toContain(forbidden);
    }
  });
});

describe("assertSecretsAreNotPublic", () => {
  it("accepts the declared server keys", () => {
    expect(() => assertSecretsAreNotPublic(SERVER_ENV_KEYS)).not.toThrow();
  });

  it("rejects NEXT_PUBLIC_SERVICE_ROLE_KEY, naming it", () => {
    expect(() => assertSecretsAreNotPublic(["NEXT_PUBLIC_SERVICE_ROLE_KEY"])).toThrow(
      "NEXT_PUBLIC_SERVICE_ROLE_KEY",
    );
  });

  it("rejects any NEXT_PUBLIC_-prefixed secret and names all of them", () => {
    let message = "";
    try {
      assertSecretsAreNotPublic([
        "SUPABASE_SERVICE_ROLE_KEY",
        "NEXT_PUBLIC_GOOGLE_SA_PRIVATE_KEY",
        "NEXT_PUBLIC_JOB_SHARED_SECRET",
      ]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("NEXT_PUBLIC_GOOGLE_SA_PRIVATE_KEY");
    expect(message).toContain("NEXT_PUBLIC_JOB_SHARED_SECRET");
    // The compliant name must not be reported as an offender.
    expect(message).not.toContain("SUPABASE_SERVICE_ROLE_KEY,");
  });

  it("explains why the prefix is an instruction to the bundler, not a label", () => {
    expect(() => assertSecretsAreNotPublic(["NEXT_PUBLIC_X"])).toThrow(/client bundle/);
  });
});

describe("getPublicEnv", () => {
  it("does not cache a non-default source, so a test cannot poison the process", () => {
    resetPublicEnvCache();
    expect(getPublicEnv(VALID_PUBLIC)).toEqual(VALID_PUBLIC);

    const other = {
      NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "other-anon",
    } as const;

    expect(getPublicEnv(other)).toEqual(other);
    resetPublicEnvCache();
  });
});
