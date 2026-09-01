// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/apply-with-upload.spec.ts — the SECOND of the six locked Playwright flows
// (BUILD_PLAN S3-T23, ARCHITECTURE.md §1 "Testing & quality").
//
// PRD MVP items 5, 6, 7 · US-B1, US-B2, US-B3, US-B4.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE FOUR THINGS THIS FILE PROVES, AND WHY EACH NEEDS A BROWSER
// ═══════════════════════════════════════════════════════════════════════════════
//
// (a) A ~6.5MB Certificate of Registration reaches the document store.
//     THE SIZE IS THE ASSERTION. Vercel caps a function request body at 4.5MB, so a
//     smaller fixture would pass even if the bytes were wrongly routed through a Route
//     Handler — and the flow would then fail on the first real applicant's phone photo.
//     The proof is not "the success screen appeared": it is that
//     `applications.proof_size_bytes` equals the file's real byte count, which can only
//     be true if the bytes arrived AND the server re-read the provider's own metadata
//     instead of believing the browser (S3-T16, ARCHITECTURE.md §4.1 step 5).
//
// (b) A closed window is refused AT THE DATA LAYER, not by a hidden link. The spec
//     closes the window and then INSERTs directly with the anon key, bypassing the page
//     entirely. If that insert succeeds, the `applications_insert_anon` policy is wrong
//     and no amount of UI would save it (US-B4). This is the case whose RED must be
//     observed once, by commenting out the policy's window predicate.
//
// (c) A duplicate email produces a BYTE-IDENTICAL response. The partial unique index
//     (`WHERE status <> 'draft'`, S3-T4) and `finalize_application()`'s swallowed
//     unique-violation exist so the form is not an oracle for "has this person already
//     applied here?". Comparing the two success screens is what makes that true rather
//     than intended.
//
// (d) Two refusals with different shapes and different end states:
//       · oversize (12MB) → refused CLIENT-SIDE, so there is no row at all;
//       · a text file named `.pdf` → the browser declares `application/pdf`, every
//         client gate passes, the bytes really upload, and only `verifyUpload()`'s
//         magic-byte sniff disagrees. End state: exactly one row, still `draft`.
//     Asserting the different end states is the point — they are different mechanisms.
//
// ═══════════════════════════════════════════════════════════════════════════════
// TWO OPERATIONAL RULES THIS FILE FOLLOWS
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. NO DELETES, EVER. There is no DELETE policy anywhere in this schema and none may
//    be added (CLAUDE.md; DATA_MODEL.md §13 rule 2), and a test suite is not an excuse
//    to grow one. Isolation comes from a UNIQUE EMAIL PER RUN instead; rows accumulate
//    in a scratch database and are swept by `purge_abandoned_drafts()` (0020) like any
//    other abandoned draft.
//
// 2. THE APPLICATION WINDOW IS GLOBAL STATE. `application_windows` is UNIQUE
//    (term_id, form_kind) — there is exactly one row for the current term, and case (b)
//    must close it. Playwright runs chromium, firefox and webkit CONCURRENTLY, so
//    without a mutex case (b) would close the window out from under case (a) in another
//    project and the flow would fail for a reason that has nothing to do with the code.
//    `withWindowLock()` below is a cross-process lockfile that serialises every test in
//    this file across all workers and all projects, and every test re-opens the window
//    for itself first, so no test depends on the order of any other.
//
// DRIVER: CI runs this with `DOCUMENT_STORE=fake` for determinism (S3-T23). Nothing
//   below is driver-specific — no ref is parsed, no provider is named — so the same
//   spec passes against Drive or Supabase Storage locally. That is the point of the
//   `lib/documents/` boundary (ADR 0005).
//
// The whole file skips without SUPABASE_SERVICE_ROLE_KEY: the window manipulation and
//   the database assertions are privileged reads, and a DB-less clone should still get
//   a green `pnpm test:e2e` rather than a wall of connection errors (e2e/global-setup.ts).
// ═══════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import { open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  cleanupCorFixtures,
  makeCorPhoto,
  makeDisguisedTextAsPdf,
  makeOversizeCor,
  type GeneratedProofFile,
} from "./fixtures/make-cor-fixture";

// ─────────────────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────────────────

const HAS_SERVICE_KEY = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by apply-with-upload.spec.ts`);
  return value;
}

/**
 * Service-role client. Legitimate here for the same reason it is legitimate in
 * `e2e/fixtures/auth.ts`: this is TEST SETUP AND ASSERTION, not request-handling code.
 * CLAUDE.md's ban is on `app/` importing the service-role client, and there is no other
 * way to read `applications` — it has, correctly, no anon SELECT policy at all.
 */
function adminClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * A client carrying the ANON key and no session — exactly what an applicant's browser
 * holds. Case (b) uses it to attack the database directly, so the refusal is proven to
 * come from the policy rather than from the page.
 */
function anonClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** A fresh applicant identity per submission. Isolation WITHOUT a delete. */
function uniqueApplicantEmail(label: string): string {
  return `apply-${label}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}@fixture.start-sys.test`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The cross-project mutex — see operational rule 2 in the header
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_PATH = join(tmpdir(), "start-sys-e2e-apply-window.lock");

/** Long enough for a 12MB upload on a loaded CI runner; short enough to self-heal. */
const LOCK_STALE_MS = 120_000;

/**
 * Exclusive across processes via `O_CREAT | O_EXCL`, which is atomic on every platform
 * Playwright runs on. A crashed worker leaves a stale lock, so a lock older than
 * `LOCK_STALE_MS` is broken rather than waited on forever — a hung suite teaches people
 * to skip the suite.
 */
async function withWindowLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_STALE_MS + 30_000;

  for (;;) {
    try {
      const handle = await open(LOCK_PATH, "wx");
      await handle.close();
      break;
    } catch {
      const age = await stat(LOCK_PATH)
        .then((s) => Date.now() - s.mtimeMs)
        .catch(() => Number.POSITIVE_INFINITY);

      if (age > LOCK_STALE_MS) {
        await rm(LOCK_PATH, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for the application-window lock (${LOCK_PATH}).`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  try {
    return await fn();
  } finally {
    await rm(LOCK_PATH, { force: true }).catch(() => undefined);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Application-window control
// ─────────────────────────────────────────────────────────────────────────────
//
// UPSERT on the (term_id, form_kind) unique constraint — never an INSERT that would
// collide, and never a DELETE. Opening and closing a window is exactly what S4-T24's
// admin screen will do through the caller's client; here it is done with the service
// role because no window-management UI exists yet in this slice.

const MEMBERSHIP_FORM_KIND = "membership_application";

async function currentTermId(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin.rpc("current_term_id");
  if (error) throw error;
  if (!data) {
    throw new Error(
      "No active term. Run `pnpm db:reset` — 0016_seed.sql seeds the bootstrap term.",
    );
  }
  return data as string;
}

async function setWindow(admin: SupabaseClient, opensAt: Date, closesAt: Date): Promise<void> {
  const termId = await currentTermId(admin);
  const { error } = await admin.from("application_windows").upsert(
    {
      term_id: termId,
      form_kind: MEMBERSHIP_FORM_KIND,
      opens_at: opensAt.toISOString(),
      closes_at: closesAt.toISOString(),
    },
    { onConflict: "term_id,form_kind" },
  );
  if (error) throw error;
}

/** Open now → +1 day. Idempotent, and every test calls it for itself. */
async function openWindow(admin: SupabaseClient): Promise<void> {
  const now = Date.now();
  await setWindow(admin, new Date(now - 60_000), new Date(now + 86_400_000));
}

/** A window that opened two hours ago and closed a minute ago: closed, not absent. */
async function closeWindow(admin: SupabaseClient): Promise<void> {
  const now = Date.now();
  await setWindow(admin, new Date(now - 7_200_000), new Date(now - 60_000));
}

// ─────────────────────────────────────────────────────────────────────────────
// Database assertions
// ─────────────────────────────────────────────────────────────────────────────

type ApplicationRow = {
  id: string;
  status: string;
  proof_size_bytes: number | null;
  proof_mime_type: string | null;
  proof_drive_file_id: string | null;
  submitted_at: string | null;
};

async function applicationsFor(
  admin: SupabaseClient,
  applicantEmail: string,
): Promise<ApplicationRow[]> {
  const { data, error } = await admin
    .from("applications")
    .select("id, status, proof_size_bytes, proof_mime_type, proof_drive_file_id, submitted_at")
    .eq("applicant_email", applicantEmail);
  if (error) throw error;
  return (data ?? []) as ApplicationRow[];
}

const pendingOnly = (rows: ApplicationRow[]) => rows.filter((r) => r.status === "pending");

// ═══════════════════════════════════════════════════════════════════════════════
// THE PAGE OBJECT — every selector for /apply lives HERE and nowhere else
// ═══════════════════════════════════════════════════════════════════════════════
//
// One place to fix when S3-T17…T21 settle their markup, rather than four. Accessible
// selectors only (role + label), which means these specs also assert the form is
// operable by label and keyboard — the Usability NFR tested for free.
//
// The labels are the ones the zod schema's own messages name (lib/applications/schema.ts):
// "First name", "Last name", "Date of birth", "Street address", "School ID number",
// "Degree program", "Year level", "Expected year of graduation", "Region". If a label
// changes, it changes in one place here.

const applyScreens = {
  form: (page: Page) => page.locator("form").first(),

  givenName: (page: Page) => page.getByLabel(/first name|given name/i),
  middleName: (page: Page) => page.getByLabel(/middle name/i),
  familyName: (page: Page) => page.getByLabel(/last name|family name|surname/i),
  email: (page: Page) => page.getByLabel(/e-?mail/i),
  birthdate: (page: Page) => page.getByLabel(/date of birth|birthdate/i),
  contactNumber: (page: Page) => page.getByLabel(/contact number|mobile/i),
  addressLine: (page: Page) => page.getByLabel(/street address|address line/i),
  city: (page: Page) => page.getByLabel(/city|municipality/i),
  province: (page: Page) => page.getByLabel(/province/i),
  postalCode: (page: Page) => page.getByLabel(/postal code|zip/i),

  school: (page: Page) => page.getByLabel(/^school$|school name/i),
  schoolIdNo: (page: Page) => page.getByLabel(/school id/i),
  program: (page: Page) => page.getByLabel(/program|course|degree/i),
  yearLevel: (page: Page) => page.getByLabel(/year level/i),
  expectedGradYear: (page: Page) => page.getByLabel(/graduat/i),

  region: (page: Page) => page.getByLabel(/region/i),

  /** `input[type=file]` rather than a label: the widget may wrap it in a drop zone. */
  proofInput: (page: Page) => page.locator('input[type="file"]').first(),

  /** Advance a multi-section form. Absent when all sections render on one page. */
  next: (page: Page) => page.getByRole("button", { name: /next|continue/i }),
  submit: (page: Page) => page.getByRole("button", { name: /submit|send application|apply/i }),

  /** US-B3: the success + pending screen, rendered IN PLACE — no /apply/{id}. */
  success: (page: Page) => page.getByText(/pending|received|thank you|submitted/i).first(),

  /** The closed state (US-B4). No form fields; explains when applications closed. */
  closed: (page: Page) => page.getByText(/closed|not (currently )?open|not accepting/i).first(),

  error: (page: Page) => page.getByRole("alert").first(),

  /** The determinate upload bar (S3-T19). Best-effort — see `attachProof`. */
  progress: (page: Page) => page.getByRole("progressbar").first(),
};

/** Fill a control only if this section currently renders it. */
async function fillIfPresent(locator: Locator, value: string): Promise<boolean> {
  const target = locator.first();
  if ((await target.count()) === 0) return false;
  if (!(await target.isVisible().catch(() => false))) return false;
  await target.fill(value);
  return true;
}

/** Choose the first real option of a `<select>` (or a combobox that behaves like one). */
async function selectFirstRealOption(locator: Locator): Promise<boolean> {
  const target = locator.first();
  if ((await target.count()) === 0) return false;
  if (!(await target.isVisible().catch(() => false))) return false;

  const values = await target
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLOptionElement).value).filter((v) => v.length > 0),
    );
  if (values.length === 0) return false;
  await target.selectOption(values[0]!);
  return true;
}

type ApplicantFields = {
  email: string;
  givenName?: string;
  familyName?: string;
};

/**
 * Fill every section of the form, tolerating both shapes S3-T18 may ship: four stepped
 * sections behind Next buttons, or all four on one scrolling page (the pre-agreed
 * fallback in the S3 risk table). The loop fills whatever is currently rendered, clicks
 * Next if one exists, and repeats — so neither shape needs its own spec.
 */
async function fillApplicationForm(page: Page, applicant: ApplicantFields): Promise<void> {
  const values: Array<[Locator, string]> = [];
  const push = (l: Locator, v: string) => values.push([l, v]);

  for (let section = 0; section < 6; section += 1) {
    push(applyScreens.givenName(page), applicant.givenName ?? "Applicant");
    push(applyScreens.middleName(page), "Test");
    push(applyScreens.familyName(page), applicant.familyName ?? "Fixture");
    push(applyScreens.email(page), applicant.email);
    push(applyScreens.birthdate(page), "2004-06-15");
    push(applyScreens.contactNumber(page), "09171234500");
    push(applyScreens.addressLine(page), "12 E2E Street, Barangay Fixture");
    push(applyScreens.city(page), "Quezon City");
    push(applyScreens.province(page), "Metro Manila");
    push(applyScreens.postalCode(page), "1101");
    push(applyScreens.school(page), "University of the Philippines Diliman");
    push(applyScreens.schoolIdNo(page), "E2E-2026-0001");
    push(applyScreens.program(page), "BS Computer Science");
    push(applyScreens.yearLevel(page), "2");
    push(applyScreens.expectedGradYear(page), "2029");

    for (const [locator, value] of values) {
      await fillIfPresent(locator, value).catch(() => undefined);
    }
    values.length = 0;

    // Region is a select over the 18 seeded regions, populated by an ordinary anon read.
    await selectFirstRealOption(applyScreens.region(page)).catch(() => undefined);

    // Consent (RA 10173, captured AT COLLECTION). Every VISIBLE checkbox is ticked; the
    // honeypot input is hidden by design and is therefore left untouched, which is
    // exactly the behaviour the honeypot is testing for.
    const boxes = applyScreens.form(page).locator('input[type="checkbox"]:visible');
    for (let i = 0; i < (await boxes.count()); i += 1) {
      await boxes
        .nth(i)
        .check()
        .catch(() => undefined);
    }

    const next = applyScreens.next(page);
    if (
      (await next.count()) > 0 &&
      (await next
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      await next.first().click();
      await page.waitForTimeout(150);
      continue;
    }
    break;
  }
}

/**
 * Attach the proof file and wait for the direct PUT to finish.
 *
 * The progress bar is checked BEST-EFFORT and never gates the test: on a loopback PUT to
 * the fake store a 6MB upload can complete between two polls, and an assertion that
 * fails because the machine was fast is an assertion that gets deleted. The load-bearing
 * proof that the bytes really moved is `proof_size_bytes` in the database.
 */
async function attachProof(page: Page, file: GeneratedProofFile): Promise<void> {
  await applyScreens.proofInput(page).setInputFiles(file.path);

  // If the widget renders a determinate bar, wait for it to finish rather than racing
  // the submit button against an in-flight PUT. If it renders none — or the upload is
  // deferred to submit — this is a no-op and the test proceeds.
  const bar = applyScreens.progress(page);
  if ((await bar.count()) > 0) {
    await expect
      .poll(async () => bar.getAttribute("aria-valuenow").catch(() => null), {
        timeout: 120_000,
      })
      .not.toBe("0");
  }
}

/** Attach bytes the browser will type from a name we choose. Used for the disguised PDF. */
async function attachProofAsBuffer(
  page: Page,
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<void> {
  await applyScreens.proofInput(page).setInputFiles({ name: fileName, mimeType, buffer });
}

/**
 * S3-T18 rejects a submission made less than three seconds after mount, because a human
 * cannot fill this form that fast and a bot can. Filling it above normally takes longer,
 * but a fast machine with a one-page form can beat the floor — so wait explicitly rather
 * than depend on wall-clock luck.
 */
async function waitOutHoneypotFloor(page: Page): Promise<void> {
  await page.waitForTimeout(3_500);
}

/**
 * Submit and wait for the success screen. Generous timeout: this awaits a 6.5MB direct
 * PUT plus the server-side re-verification of the provider's metadata.
 */
async function submitAndExpectSuccess(page: Page): Promise<string> {
  await waitOutHoneypotFloor(page);
  await applyScreens.submit(page).first().click();
  await expect(applyScreens.success(page)).toBeVisible({ timeout: 120_000 });

  // The whole rendered confirmation, not just the matched sentence: case (c) compares
  // two of these byte for byte, and a difference hiding in a subheading would be exactly
  // the kind of "you have already applied" tell the design forbids.
  const main = page.locator("main");
  const scope = (await main.count()) > 0 ? main.first() : page.locator("body");
  return (await scope.innerText()).trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE SPECS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Epic B — public application intake", () => {
  test.skip(
    !HAS_SERVICE_KEY,
    "application-window control and the database assertions need SUPABASE_SERVICE_ROLE_KEY",
  );

  // The application window is a single row shared by every worker and every browser
  // project; serial mode plus `withWindowLock` is what keeps case (b) from closing it
  // under case (a). See operational rule 2 in the file header.
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test.afterAll(async () => {
    await cleanupCorFixtures();
    // Leave the window OPEN. Any other suite that reaches /apply expects the seeded,
    // open state, and a test that leaves global state broken breaks the next suite.
    if (HAS_SERVICE_KEY) await openWindow(adminClient()).catch(() => undefined);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (a) The happy path — desktop and 375px, and THE SIZE IS THE ASSERTION
  // ───────────────────────────────────────────────────────────────────────────

  for (const viewport of [
    { label: "desktop", width: 1280, height: 900 },
    { label: "375px mobile", width: 375, height: 812 },
  ] as const) {
    test(`an applicant submits with a 6.5MB proof of enrollment on ${viewport.label} (US-B1, US-B2, US-B3)`, async ({
      page,
    }) => {
      await withWindowLock(async () => {
        const admin = adminClient();
        await openWindow(admin);

        const applicantEmail = uniqueApplicantEmail(`happy-${viewport.width}`);
        const cor = await makeCorPhoto();

        // The fixture must be above Vercel's 4.5MB body cap or this test proves nothing
        // about the direct PUT. Asserted, not assumed — see make-cor-fixture.ts.
        expect(cor.byteLength).toBeGreaterThan(4.5 * 1024 * 1024);

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/apply");
        await expect(applyScreens.email(page).first()).toBeVisible();

        await fillApplicationForm(page, { email: applicantEmail });
        await attachProof(page, cor);

        await submitAndExpectSuccess(page);

        // US-B3: the confirmation is rendered IN PLACE. No per-application URL exists,
        // because there is no anon SELECT policy to serve one and a guessable status URL
        // would be an enumeration surface (S3-T16's header).
        expect(page.url()).not.toMatch(/\/apply\/[0-9a-f-]{36}/i);

        // The page body must not scroll horizontally at 375px — this form is filled on a
        // phone, and the PRD's Compatibility NFR names mobile explicitly.
        if (viewport.width === 375) {
          const overflows = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          );
          expect(overflows).toBe(false);
        }

        // ── THE LOAD-BEARING ASSERTION ──────────────────────────────────────
        const rows = await applicationsFor(admin, applicantEmail);
        const pending = pendingOnly(rows);

        expect(pending).toHaveLength(1);
        const row = pending[0]!;

        // Equal to the file's REAL byte count. This can only hold if the bytes reached
        // the store and the server re-read the provider's own metadata: the client
        // declares a size too, and if that claim were trusted this number could be
        // anything (S3-T16 rule 3).
        expect(row.proof_size_bytes).toBe(cor.byteLength);
        expect(row.proof_mime_type).toBe("image/jpeg");
        expect(row.proof_drive_file_id).not.toBeNull();
        expect(row.submitted_at).not.toBeNull();
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // (b) A closed window — refused BY THE DATABASE (US-B4)
  // ───────────────────────────────────────────────────────────────────────────

  test("a closed application period refuses submissions at the data layer, not by hiding the form (US-B4)", async ({
    page,
  }) => {
    await withWindowLock(async () => {
      const admin = adminClient();
      await closeWindow(admin);

      try {
        // 1. The page tells the truth about being closed, and offers no form to fill.
        await page.goto("/apply");
        await expect(applyScreens.closed(page)).toBeVisible();
        expect(await applyScreens.email(page).count()).toBe(0);
        expect(await applyScreens.proofInput(page).count()).toBe(0);

        // 2. THE ACTUAL PROOF. Bypass the page entirely and INSERT with the anon key —
        //    which is what a forwarded link, a replayed request or a curl would do. If
        //    this succeeds, the refusal above was decoration.
        const termId = await currentTermId(admin);
        const bypassEmail = uniqueApplicantEmail("closed-bypass");

        const { data, error } = await anonClient()
          .from("applications")
          .insert({
            term_id: termId,
            applicant_email: bypassEmail,
            applicant_given_name: "Bypass",
            applicant_family_name: "Attempt",
            payload: {},
          })
          .select("id");

        expect(error).not.toBeNull();
        expect(data).toBeNull();

        // ⚠ VERIFY THE RED ONCE (S3-T23): comment out the `application_windows` EXISTS
        //   predicate in `applications_insert_anon` (0008), re-run, and watch THIS
        //   assertion fail. A gate that has never refused is a gate nobody knows works.

        // And nothing was written — the refusal is total, not partial.
        expect(await applicationsFor(admin, bypassEmail)).toHaveLength(0);
      } finally {
        await openWindow(admin);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (c) A duplicate email is not an oracle
  // ───────────────────────────────────────────────────────────────────────────

  test("a second application from the same email returns an identical success screen and leaves one pending row", async ({
    page,
  }) => {
    await withWindowLock(async () => {
      const admin = adminClient();
      await openWindow(admin);

      const applicantEmail = uniqueApplicantEmail("duplicate");

      const submitOnce = async (): Promise<string> => {
        const cor = await makeCorPhoto();
        await page.goto("/apply");
        await expect(applyScreens.email(page).first()).toBeVisible();
        await fillApplicationForm(page, { email: applicantEmail });
        await attachProof(page, cor);
        return submitAndExpectSuccess(page);
      };

      const first = await submitOnce();
      const second = await submitOnce();

      // BYTE-IDENTICAL. `finalize_application()` swallows the unique violation and
      // returns success, and `finalizeApplication` has no "already applied" branch —
      // adding one would rebuild the email-enumeration oracle the partial unique index
      // was reshaped to remove (S3-T4, S3-T6).
      expect(second).toBe(first);

      const rows = await applicationsFor(admin, applicantEmail);
      expect(pendingOnly(rows)).toHaveLength(1);

      // The second attempt's row is left behind as a DRAFT for the nightly
      // `purge_abandoned_drafts()` sweep (0020) — not deleted, because nothing in this
      // system deletes.
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => r.status === "pending" || r.status === "draft")).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (d) Two refusals, two different mechanisms, two different end states
  // ───────────────────────────────────────────────────────────────────────────

  test("a 12MB file is refused client-side and creates no application row at all", async ({
    page,
  }) => {
    await withWindowLock(async () => {
      const admin = adminClient();
      await openWindow(admin);

      const applicantEmail = uniqueApplicantEmail("oversize");
      const oversize = await makeOversizeCor();
      expect(oversize.byteLength).toBeGreaterThan(10 * 1024 * 1024);

      await page.goto("/apply");
      await expect(applyScreens.email(page).first()).toBeVisible();
      await fillApplicationForm(page, { email: applicantEmail });
      await attachProof(page, oversize);

      // The form refuses before `startApplication` is ever called, so the applicant can
      // pick another file without re-entering anything (S3-T19).
      await expect(page.getByText(/10\s?MB|too large|larger than/i).first()).toBeVisible({
        timeout: 30_000,
      });

      // NO ROW. Not a draft, not a pending — nothing was created, no submit token was
      // minted, no upload session was requested and no provider quota was spent.
      await waitOutHoneypotFloor(page);
      expect(await applicationsFor(admin, applicantEmail)).toHaveLength(0);
    });
  });

  test("a text file named .pdf passes every client gate and is refused by the server-side magic-byte sniff", async ({
    page,
  }) => {
    await withWindowLock(async () => {
      const admin = adminClient();
      await openWindow(admin);

      const applicantEmail = uniqueApplicantEmail("wrong-type");
      const disguised = await makeDisguisedTextAsPdf();

      await page.goto("/apply");
      await expect(applyScreens.email(page).first()).toBeVisible();
      await fillApplicationForm(page, { email: applicantEmail });

      // The browser types a file by its EXTENSION, so it declares `application/pdf` for
      // a text file — every client-side check passes and the bytes really do upload.
      await attachProofAsBuffer(
        page,
        disguised.fileName,
        "application/pdf",
        Buffer.from(
          "This is not a PDF. Only the magic-byte sniff in lib/documents/sniff-mime.ts refuses it.\n".repeat(
            32,
          ),
          "utf8",
        ),
      );

      await waitOutHoneypotFloor(page);
      await applyScreens.submit(page).first().click();

      // `verifyUpload()` re-reads the stored bytes, finds they do not begin `%PDF-`,
      // DELETES the object and throws; `finalizeApplication` maps that to `validation`.
      await expect(applyScreens.error(page)).toBeVisible({ timeout: 60_000 });
      await expect(applyScreens.success(page)).toHaveCount(0);

      // END STATE — the half that distinguishes this from the oversize case. The draft
      // row DOES exist (the client got that far) and it is STILL a draft: the flip to
      // `pending` never happened, so nothing reached CRRD's review queue.
      const rows = await applicationsFor(admin, applicantEmail);
      expect(pendingOnly(rows)).toHaveLength(0);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("draft");
    });
  });
});
