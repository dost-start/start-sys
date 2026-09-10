// ─────────────────────────────────────────────────────────────────────────────
// enrol-demo-mfa.mjs — enrol TOTP for every account that holds a role.
//
// WHY: `DEV_DISABLE_MFA` is being removed from Production (PRD MVP item 2 / US-A3:
// TOTP is mandatory above Member tier). Every account currently has ZERO factors, so
// the moment the flag goes they all land on the enrolment screen — including the CTO,
// who is the only role that can hand out roles.
//
// Enrolling BEFORE the flag is removed means nobody is locked out at any point.
//
// It also unblocks something that has been silently broken: `has_aal2()` guards writes
// to `user_roles`, `terms`, `application_windows`, `rr_region_grants` and
// `privacy_notice_versions`. An aal1 session gets `HTTP 200, 0 rows affected` — measured
// 2026-09-10 — so assigning a role or opening the application period through the app has
// never actually worked on this deployment. A verified factor is what makes aal2
// reachable and those writes real.
//
// ⚠ OUTPUT IS CREDENTIALS. The otpauth:// URIs it writes are the shared secrets. They go
// to `demo-credentials.local.md`, which .gitignore already covers. Do not paste them into
// a chat, and delete the file once they are in an authenticator app.
//
// Idempotent: an account with a verified factor whose secret we no longer hold is cleared
// through the Admin API first, because a verified factor cannot be unenrolled from an
// aal1 session — GoTrue refuses with "AAL2 required", and without the secret aal2 is
// unreachable. Same reasoning as e2e/fixtures/dashboard-seed.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { generate as generateOtp } from "otplib";
import { writeFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and");
  console.error("SUPABASE_SERVICE_ROLE_KEY must all be set.");
  process.exit(1);
}

// Passwords are `<name>123` for the demo accounts (see demo-credentials.local.md).
// Pass real ones as ACCOUNTS="email:password,email:password" to enrol other accounts.
const DEFAULT_ACCOUNTS = [
  ["demo.ceo@start-sys.test", "ceo123"],
  ["demo.cto@start-sys.test", "cto123"],
  ["demo.ccdo@start-sys.test", "ccdo123"],
  ["demo.dccdo@start-sys.test", "dccdo123"],
  ["demo.officer@start-sys.test", "officer123"],
  ["demo.rep@start-sys.test", "rep123"],
];

const accounts = process.env.ACCOUNTS
  ? process.env.ACCOUNTS.split(",").map((pair) => pair.split(":"))
  : DEFAULT_ACCOUNTS;

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function enrol(email, password) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });

  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) return { email, error: signInError.message };

  try {
    const { data: factors, error: listError } = await client.auth.mfa.listFactors();
    if (listError) return { email, error: listError.message };

    // Clear any existing factor. Doing this through the Admin API is deliberate: a
    // verified factor cannot be unenrolled from the aal1 session we are holding.
    for (const factor of factors.totp) {
      await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: session.user.id });
    }

    const { data: enrolled, error: enrolError } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "START-SYS",
    });
    if (enrolError) return { email, error: enrolError.message };

    const secret = enrolled.totp.secret;
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
      factorId: enrolled.id,
      code: await generateOtp({ secret }),
    });
    if (verifyError) return { email, error: verifyError.message };

    return { email, secret, uri: enrolled.totp.uri };
  } finally {
    // `scope: 'local'` — the default signs the user out EVERYWHERE, which would revoke a
    // session someone else is using.
    await client.auth.signOut({ scope: "local" });
  }
}

const results = [];
for (const [email, password] of accounts) {
  const result = await enrol(email, password);
  results.push(result);
  console.log(result.error ? `  ${email.padEnd(30)} FAILED: ${result.error}` : `  ${email.padEnd(30)} enrolled`);
}

const ok = results.filter((r) => !r.error);
if (ok.length > 0) {
  const body = [
    "# Demo account TOTP secrets",
    "",
    "⚠ These are credentials. This file is gitignored. Add each URI to an authenticator",
    "app (scan or paste), then delete this file.",
    "",
    `Generated ${new Date().toISOString()}.`,
    "",
    ...ok.flatMap((r) => [`## ${r.email}`, "", "```", r.uri, "```", ""]),
  ].join("\n");
  writeFileSync("demo-credentials.mfa.local.md", body);
  console.log(`\nWrote ${ok.length} otpauth URI(s) to demo-credentials.mfa.local.md`);
}

console.log(`\n${ok.length}/${results.length} enrolled.`);
if (ok.length !== results.length) process.exit(1);
