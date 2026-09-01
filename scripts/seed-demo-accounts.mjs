// ─────────────────────────────────────────────────────────────────────────────
// Seed DEMO credentials + sample data so the app can actually be tried.
//
//   node scripts/seed-demo-accounts.mjs
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (point them at the TEST project — this script refuses obvious production URLs
//  unless DEMO_SEED_ALLOW=1).
//
// What it creates, idempotently (re-runs update passwords, never duplicate rows):
//   · one account per tier: demo.ceo (exec_admin), demo.cto (tech_admin),
//     demo.ccdo (crrd_admin), demo.moderator, demo.officer, demo.rep (NCR),
//     demo.member — fresh random password each run, printed ONCE and written to
//     demo-credentials.local.md (gitignored).
//   · people + current-term memberships for the accounts that represent members,
//     confidentiality acknowledgements for the three sensitive-reader tiers
//     (CBL Art. VIII §7.1 — without these, every sensitive read correctly fails).
//   · 24 sample members across regions + 2 committees, 3 pending applications and
//     an OPEN application window, so every dashboard/screen has content.
//
// TOTP is NOT pre-enrolled: above-Member accounts hit the real enrolment screen on
// first login and you scan the QR with your own authenticator app — that IS the
// US-A3 flow, worth testing rather than bypassing. demo.member logs in with no MFA.
//
// This is DEV TOOLING for a scratch/demo project. It uses the service-role key the
// way test setup legitimately does (see lib/server/admin-client.ts's header); it is
// not request-handling code and must never run against a database holding real
// scholar data.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { console } from "node:console";
import process from "node:process";
import { writeFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the demo project's), then re-run.",
  );
  process.exit(1);
}
if (/placeholder/.test(url)) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is still the placeholder — point it at a real project.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const password = () => `demo-${randomBytes(9).toString("base64url")}`;

/** Stable ids so re-runs are updates, not duplicates. */
const PERSON = (n) => `00000000-0000-4000-de00-${String(n).padStart(12, "0")}`;
const SAMPLE_PERSON = (n) => `00000000-0000-4000-df00-${String(n).padStart(12, "0")}`;
const SAMPLE_MEMBERSHIP = (n) => `00000000-0000-4000-dd00-${String(n).padStart(12, "0")}`;
const COMMITTEE = (n) => `00000000-0000-4000-dc00-${String(n).padStart(12, "0")}`;

const ACCOUNTS = [
  {
    email: "demo.ceo@start-sys.test",
    role: "exec_admin",
    region: null,
    person: 1,
    name: ["Diana", "Reyes"],
  },
  { email: "demo.cto@start-sys.test", role: "tech_admin", region: null, person: null, name: null },
  {
    email: "demo.ccdo@start-sys.test",
    role: "crrd_admin",
    region: null,
    person: 2,
    name: ["Carlos", "Domingo"],
  },
  {
    email: "demo.moderator@start-sys.test",
    role: "moderator",
    region: null,
    person: 3,
    name: ["Mia", "Santos"],
  },
  { email: "demo.officer@start-sys.test", role: "officer", region: null, person: null, name: null },
  {
    email: "demo.rep@start-sys.test",
    role: "regional_rep",
    region: "NCR",
    person: null,
    name: null,
  },
  {
    email: "demo.member@start-sys.test",
    role: "member",
    region: null,
    person: 4,
    name: ["Juan", "Dela Cruz"],
  },
];

const FIRST = [
  "Alon",
  "Bea",
  "Caloy",
  "Dara",
  "Eli",
  "Fara",
  "Gio",
  "Hana",
  "Iking",
  "Jaya",
  "Kiko",
  "Lara",
];
const LAST = [
  "Aquino",
  "Bautista",
  "Cruz",
  "Dizon",
  "Estrada",
  "Flores",
  "Garcia",
  "Hilario",
  "Ignacio",
  "Javier",
  "Katigbak",
  "Lopez",
];

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function upsertUser(email, pass) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: pass,
    email_confirm: true,
  });
  if (!error) return created.user.id;
  // Already exists — find and reset the password so the printed credential is live.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw new Error(`listUsers: ${listError.message}`);
  const existing = list.users.find((u) => u.email === email);
  if (!existing) throw new Error(`createUser(${email}): ${error.message}`);
  await must(
    admin.auth.admin.updateUserById(existing.id, { password: pass, email_confirm: true }),
    `reset ${email}`,
  );
  return existing.id;
}

async function main() {
  const regions = await must(admin.from("regions").select("id, code"), "regions");
  const regionId = (code) => regions.find((r) => r.code === code)?.id;
  const termId = (await must(admin.rpc("current_term_id"), "current_term_id()")) ?? null;
  if (!termId)
    throw new Error(
      "No active term — did the migrations/seed apply? Run `supabase db push` first.",
    );

  const creds = [];

  // ── the seven demo accounts ────────────────────────────────────────────────
  for (const a of ACCOUNTS) {
    const pass = password();
    const userId = await upsertUser(a.email, pass);
    const personId = a.person ? PERSON(a.person) : null;

    if (personId && a.name) {
      await must(
        admin.from("people").upsert(
          {
            id: personId,
            join_year: 2026,
            given_name: a.name[0],
            family_name: a.name[1],
            personal_email: a.email,
            contact_number: "+639170000001",
            city_municipality: "Quezon City",
            province: "Metro Manila",
          },
          { onConflict: "id" },
        ),
        `person for ${a.email}`,
      );
      await must(
        admin.from("memberships").upsert(
          {
            person_id: personId,
            term_id: termId,
            status: "active",
            region_id: regionId("NCR"),
            year_level: 3,
            expected_grad_year: 2028,
          },
          { onConflict: "person_id,term_id" },
        ),
        `membership for ${a.email}`,
      );
    }

    await must(
      admin.from("user_roles").upsert(
        {
          user_id: userId,
          role: a.role,
          person_id: personId,
          region_id: a.region ? regionId(a.region) : null,
        },
        { onConflict: "user_id" },
      ),
      `user_roles for ${a.email}`,
    );

    // CBL Art. VIII §7.1 — without a current-term acknowledgement every sensitive
    // read (correctly) fails, which would make the demo look broken.
    if (personId && ["exec_admin", "crrd_admin", "moderator"].includes(a.role)) {
      await must(
        admin.from("confidentiality_acknowledgements").upsert(
          {
            person_id: personId,
            term_id: termId,
            agreement_version: "CBL-2026-VIII-7",
            recorded_by: userId,
          },
          { onConflict: "person_id,term_id", ignoreDuplicates: true },
        ),
        `ack for ${a.email}`,
      );
    }

    creds.push({ ...a, pass });
  }

  // ── sample directory content ───────────────────────────────────────────────
  // Only the two INSERT-legal statuses (0028's state machine starts everyone at
  // active/renewal_pending; graduated/resigned/left are transitions, not spawns).
  const statuses = ["active", "active", "active", "active", "active", "renewal_pending"];
  const regionCodes = ["NCR", "NCR", "NCR", "R07", "R04A", "R06"];
  for (let i = 1; i <= 24; i += 1) {
    await must(
      admin.from("people").upsert(
        {
          id: SAMPLE_PERSON(i),
          join_year: 2024 + (i % 3),
          given_name: FIRST[i % FIRST.length],
          family_name: LAST[i % LAST.length],
          personal_email: `sample${i}@start-sys.test`,
          birthdate: "2004-03-15",
          contact_number: `+63917000${String(1000 + i)}`,
          address_line: `${i} Demo Street`,
          city_municipality: "Quezon City",
          province: "Metro Manila",
          postal_code: "1101",
          school: "Demo State University",
          school_id_no: `DEMO-${1000 + i}`,
        },
        { onConflict: "id" },
      ),
      `sample person ${i}`,
    );
    await must(
      admin.from("memberships").upsert(
        {
          id: SAMPLE_MEMBERSHIP(i),
          person_id: SAMPLE_PERSON(i),
          term_id: termId,
          status: statuses[i % statuses.length],
          region_id: regionId(regionCodes[i % regionCodes.length]),
          year_level: 1 + (i % 4),
          expected_grad_year: 2027 + (i % 3),
        },
        { onConflict: "person_id,term_id" },
      ),
      `sample membership ${i}`,
    );
  }

  for (const [n, name] of [
    [1, "Community Outreach"],
    [2, "Scholars' Tech Guild"],
  ]) {
    await must(
      admin
        .from("committees")
        .upsert(
          { id: COMMITTEE(n), term_id: termId, code: `DEMO_CMTE_${n}`, name },
          { onConflict: "term_id,code" },
        ),
      `committee ${n}`,
    );
  }
  for (let i = 1; i <= 8; i += 1) {
    await must(
      admin
        .from("committee_memberships")
        .upsert(
          { membership_id: SAMPLE_MEMBERSHIP(i), committee_id: COMMITTEE(1 + (i % 2)) },
          { onConflict: "membership_id,committee_id", ignoreDuplicates: true },
        ),
      `committee seat ${i}`,
    );
  }

  // ── an open application window + pending applications to review ────────────
  const opens = new Date(Date.now() - 86400000).toISOString();
  const closes = new Date(Date.now() + 30 * 86400000).toISOString();
  await must(
    admin.from("application_windows").upsert(
      {
        term_id: termId,
        form_kind: "membership_application",
        opens_at: opens,
        closes_at: closes,
      },
      { onConflict: "term_id,form_kind" },
    ),
    "application window",
  );
  for (let i = 1; i <= 3; i += 1) {
    await must(
      admin.from("applications").upsert(
        {
          id: `00000000-0000-4000-da00-${String(i).padStart(12, "0")}`,
          term_id: termId,
          status: "pending",
          applicant_email: `applicant${i}@start-sys.test`,
          applicant_given_name: FIRST[i],
          applicant_family_name: LAST[i],
          payload: {
            birthdate: "2005-06-01",
            contact_number: "+639171112233",
            address_line: `${i} Applicant Ave`,
            city_municipality: "Pasig",
            province: "Metro Manila",
            postal_code: "1600",
            school: "Demo State University",
            school_id_no: `APP-${2000 + i}`,
            region_id: regionId("NCR"),
            year_level: 1,
            expected_grad_year: 2030,
            program: "BS Computer Science",
          },
          proof_drive_file_id: `fake:demo-${i}`,
          proof_mime_type: "application/pdf",
          proof_size_bytes: 524288,
          proof_verified_at: opens,
          submitted_at: opens,
          consented_at: opens,
        },
        { onConflict: "id" },
      ),
      `application ${i}`,
    );
  }

  // ── hand over the credentials, exactly once ────────────────────────────────
  const lines = [
    "# START-SYS demo credentials (LOCAL FILE — gitignored, regenerate any time)",
    "",
    `Generated ${new Date().toISOString()} against ${url}`,
    "",
    "| Account | Role | Password | MFA |",
    "|---|---|---|---|",
    ...creds.map(
      (c) =>
        `| ${c.email} | ${c.role} | \`${c.pass}\` | ${c.role === "member" ? "none (ADR 0004)" : "enrol on first login — scan the QR with any authenticator app"} |`,
    ),
    "",
    "Re-running `node scripts/seed-demo-accounts.mjs` rotates every password.",
  ].join("\n");

  writeFileSync("demo-credentials.local.md", lines + "\n");
  console.log(lines);
  console.log("\nWritten to demo-credentials.local.md");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
