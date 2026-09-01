// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/approve-and-id.spec.ts — the THIRD of the six locked Playwright flows
// (BUILD_PLAN S4-T22; ARCHITECTURE.md §1 "Testing & quality").
//
// PRD MVP items 8 and 9 · US-C1, US-C2, US-C3, US-C4 · US-J2 · US-I1.
//
// ⚠ THE FILE NAME IS PART OF THE CONTRACT. `approve-and-id` is one of the six named
// flows; the proof-view and reject cases are additional `test()` blocks IN HERE, never
// a seventh spec file. A test suite whose file list no longer matches the locked six is
// a suite nobody can check against the plan.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE FOUR THINGS THIS FILE PROVES, AND WHY EACH NEEDS A BROWSER
// ═══════════════════════════════════════════════════════════════════════════════
//
// (a) A pending application can be found, opened and APPROVED by a real reviewer
//     signed in through the real login and TOTP screens, and the minted member ID
//     appears on screen matching `^\d{4}-\d{3,}$`. The database assertion is the proof,
//     not the toast: one `people` row, one `memberships` row, one ID. The `{3,}` in the
//     pattern is deliberate — `2024-999` must roll to `2024-1000` rather than collide
//     (DATA_MODEL.md §4).
//
// (b) The proof document streams through `/api/applications/[id]/proof` AND leaves a
//     `VIEW_DOCUMENT` audit row naming that reviewer. Both halves are asserted, because
//     the route's whole design is "authorize by an ordinary RLS-checked SELECT, then
//     fail closed on the audit write, THEN stream" (ARCHITECTURE.md §4.1 step 7). A
//     200 without an audit row is a compliance failure under RA 10173 and CBL Art.
//     VIII §6, and it is invisible in any test that only checks the bytes.
//
// (c) Rejection records a written ground and creates NOTHING. Zero `people`, zero
//     `memberships` — US-C2's "rejection leaves no membership record", asserted against
//     the database rather than against the absence of a success message.
//
// (d) A SECOND approval of the same application returns the SAME member ID and leaves
//     exactly one membership. This is US-C3's idempotency, and it is checked through a
//     DIRECT RPC CALL as the signed-in reviewer rather than a second button press —
//     the disabled in-flight button is UX, and the real guard is
//     `approve_application()`'s early return, which only a call that bypasses the UI
//     can demonstrate.
//
// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONAL RULES
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. NO DELETES, EVER (CLAUDE.md; DATA_MODEL.md §13 rule 2). Every test seeds its own
//    application with a unique applicant email, so nothing shares state and nothing
//    needs cleaning up. Rows accumulate in a scratch database.
//
// 2. IT NEVER TOUCHES THE APPLICATION WINDOW. `application_windows` is UNIQUE
//    (term_id, form_kind) — one global row that `apply-with-upload.spec.ts` opens and
//    closes behind a cross-process lockfile while all three browser projects run
//    concurrently. Reviewing needs no open window (the window gates the anonymous
//    INSERT, and these rows are seeded with the service role), so this file stays out
//    of that shared state entirely rather than racing it.
//
// 3. THE CONFIDENTIALITY ACKNOWLEDGEMENT IS SEEDED FIRST. Without a current-term row
//    for the reviewer's person, every detail read raises 42501 and the whole spec fails
//    in a way that looks like a broken login (CBL Art. VIII §7.1, US-J5). See
//    `e2e/fixtures/review-seed.ts`.
//
// The whole file skips without SUPABASE_SERVICE_ROLE_KEY: seeding and every database
// assertion are privileged, and a DB-less clone should still get a green
// `pnpm test:e2e` rather than a wall of connection errors (e2e/global-setup.ts).
// ═══════════════════════════════════════════════════════════════════════════════════

import { expect, test, type Page } from "@playwright/test";

import { FIXTURES, signIn } from "./fixtures/auth";
import {
  adminClient,
  countDocumentViews,
  countMembershipsForPerson,
  countPeopleByEmail,
  documentDriver,
  ensureConfidentialityAck,
  fixtureUserId,
  memberIdFor,
  readApplication,
  seedPendingApplication,
  signedInClient,
} from "./fixtures/review-seed";

const HAS_SERVICE_KEY = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

test.skip(
  !HAS_SERVICE_KEY,
  "SUPABASE_SERVICE_ROLE_KEY is not set — the review flow cannot be seeded or asserted.",
);

// Login + TOTP + the approve round trip on a loaded CI box does not fit Playwright's
// default 30s — and the in-test diagnostic waits need room to fire before the test
// budget kills the page out from under them.
test.describe.configure({ timeout: 120_000 });

/** PRD US-C3: `joinYear-sequence`. `{3,}` so 2024-999 rolls to 2024-1000, never collides. */
const MEMBER_ID_PATTERN = /\b\d{4}-\d{3,}\b/;

/** The queue lives at `/applications` — route groups are URL-invisible. */
const QUEUE_PATH = "/applications";

// ═══════════════════════════════════════════════════════════════════════════════
// THE PAGE OBJECT — every selector for the review screens lives HERE
// ═══════════════════════════════════════════════════════════════════════════════
//
// One place to fix when S4-T18…T21 settle their markup, rather than four. Accessible
// selectors only (role + name), so these specs also assert the screens are operable by
// label and keyboard — the Usability NFR tested for free.

const reviewScreens = {
  /** The queue row for one application, found by the seeded per-run surname. */
  queueRow: (page: Page, familyName: string) =>
    page.getByRole("row").filter({ hasText: familyName }).first(),

  /** Anything that opens the detail view for that application. */
  openDetail: (page: Page, familyName: string) =>
    page.getByRole("link").filter({ hasText: familyName }).first(),

  approveButton: (page: Page) => page.getByRole("button", { name: /^approve/i }).first(),
  rejectButton: (page: Page) => page.getByRole("button", { name: /^reject/i }).first(),

  /** The reason textarea in the reject dialog. */
  rejectReason: (page: Page) => page.getByLabel(/reason|ground|why/i).first(),

  /** The confirm control inside whichever dialog is open. */
  confirm: (page: Page) =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: /approve|reject|confirm/i })
      .last(),

  /** US-C3: the minted ID, shown as a success state rather than a bare toast. */
  memberId: (page: Page) => page.getByText(MEMBER_ID_PATTERN).first(),
};

/**
 * Open the detail page for a seeded application.
 *
 * Navigates by URL rather than by clicking through the queue: the queue's paging and
 * default sort belong to S4-T18 and are asserted there, and a review spec that fails
 * because a row fell to page 2 is a review spec nobody trusts. The queue itself is
 * still visited first, so a broken list still fails this flow.
 */
async function openApplication(page: Page, applicationId: string, familyName: string) {
  await page.goto(QUEUE_PATH);
  await expect(page).toHaveURL(new RegExp(`${QUEUE_PATH}$`));

  await page.goto(`${QUEUE_PATH}/${applicationId}`);
  // The detail view shows every submitted field (US-C1); the surname is the cheapest
  // proof we are looking at the right row and not at an empty or 404 shell.
  await expect(page.getByText(familyName).first()).toBeVisible();
}

/** Click a control and confirm inside the dialog it opens, when there is one. */
async function clickAndConfirm(
  page: Page,
  trigger: ReturnType<typeof reviewScreens.approveButton>,
) {
  await trigger.click();

  // The confirm dialog mounts with an animation — an immediate isVisible() races it
  // and silently skips the confirm click. Wait for it; only a real absence after the
  // wait means the control acts directly.
  const dialog = page.getByRole("dialog");
  const appeared = await dialog
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await reviewScreens.confirm(page).click();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// (a) Approve → a member ID appears, and the control is gone
// ═══════════════════════════════════════════════════════════════════════════════

test("a CRRD admin approves a pending application and sees the minted member ID (US-C2, US-C3)", async ({
  page,
}) => {
  const admin = adminClient();
  await ensureConfidentialityAck(admin, "crrd_admin");
  const application = await seedPendingApplication(admin, { label: "approve" });

  await signIn(page, "crrd_admin");
  await openApplication(page, application.id, application.familyName);

  await clickAndConfirm(page, reviewScreens.approveButton(page));

  // ── On screen: the ID itself. PRD US-C3 names "e.g. 2024-001" as the acceptance
  //    criterion, and that string is the org's proof the feature works. Generous
  //    timeout: the approve action + revalidate round trip runs on a loaded CI box.
  try {
    await expect(reviewScreens.memberId(page)).toBeVisible({ timeout: 30_000 });
  } catch (cause) {
    const alerts = await page.getByRole("alert").allInnerTexts();
    const body = (await page.locator("body").innerText()).slice(0, 1500);
    throw new Error(`member ID never appeared. alerts=${JSON.stringify(alerts)} body:\n${body}`, {
      cause,
    });
  }

  // ── And the decision controls are gone: `approved` is terminal, and
  //    `enforce_application_status_transition()` (0024) refuses a re-decision at the
  //    data layer, so leaving a live Approve button would offer an act the database
  //    would reject (US-C2, "cannot be silently re-decided").
  await expect(reviewScreens.approveButton(page)).toHaveCount(0);
  await expect(reviewScreens.rejectButton(page)).toHaveCount(0);

  // ── In the database: one transaction produced all of it (ARCHITECTURE.md §6).
  const row = await readApplication(admin, application.id);
  expect(row.status).toBe("approved");
  expect(row.person_id).not.toBeNull();
  expect(row.reviewed_by).toBe(fixtureUserId("crrd_admin"));

  const memberId = await memberIdFor(admin, application.id);
  expect(memberId).toMatch(/^\d{4}-\d{3,}$/);

  // You can never get an ID without a membership, or a membership without an ID.
  expect(await countMembershipsForPerson(admin, row.person_id as string)).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// (b) The proof proxy: 200 + application/pdf AND an audit row
// ═══════════════════════════════════════════════════════════════════════════════

test("viewing the proof of enrollment streams the document and records who looked (US-C1, US-J2, US-I1)", async ({
  page,
}) => {
  test.skip(
    documentDriver() !== "fake",
    `DOCUMENT_STORE=${documentDriver()} — the byte-streaming case seeds into the fake ` +
      `store, which is the only driver a test process may write to without real ` +
      `credentials or leaving objects in a shared bucket (ADR 0005).`,
  );

  const admin = adminClient();
  await ensureConfidentialityAck(admin, "crrd_admin");
  const application = await seedPendingApplication(admin, { label: "proof" });
  const reviewerId = fixtureUserId("crrd_admin");

  const before = await countDocumentViews(admin, application.id, reviewerId);

  await signIn(page, "crrd_admin");

  // `page.request` shares the browser context's cookie jar, so this carries the real
  // session — the route authorizes by an ordinary RLS-checked SELECT under that JWT.
  const response = await page.request.get(`/api/applications/${application.id}/proof`);

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"] ?? "").toContain("application/pdf");
  // US-J2: a provider URL must never reach a browser. The bytes come through the proxy.
  expect(response.headers()["cache-control"] ?? "").toContain("no-store");

  const body = await response.body();
  expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");

  // ── The half a bytes-only test would miss. Exactly one new row, naming this reviewer.
  //    RA 10173 asks "who looked at this scholar's ID, and when" — CBL Art. VIII §6
  //    makes that a constitutional obligation, not only a statutory one.
  expect(await countDocumentViews(admin, application.id, reviewerId)).toBe(before + 1);

  // A second view is a second row, not a no-op: the question is "when", not "ever".
  await page.request.get(`/api/applications/${application.id}/proof`);
  expect(await countDocumentViews(admin, application.id, reviewerId)).toBe(before + 2);
});

// ═══════════════════════════════════════════════════════════════════════════════
// (c) Reject with a reason → nothing is created
// ═══════════════════════════════════════════════════════════════════════════════

test("rejecting records the written ground and creates no person and no membership (US-C2)", async ({
  page,
}) => {
  const admin = adminClient();
  await ensureConfidentialityAck(admin, "crrd_admin");
  const application = await seedPendingApplication(admin, { label: "reject" });

  // At least ten characters after trimming: `REJECT_REASON_MIN_LENGTH` in the shared
  // schema and the `rejected_has_reason` CHECK in 0024 agree on that floor, and the
  // CHECK is the enforcement — the form cannot be the only thing holding it.
  const reason = "Proof of enrollment is illegible; asked for a clearer re-upload.";

  await signIn(page, "crrd_admin");
  await openApplication(page, application.id, application.familyName);

  await reviewScreens.rejectButton(page).click();
  await reviewScreens.rejectReason(page).fill(reason);
  await reviewScreens.confirm(page).click();

  await expect(page.getByText(reason).first()).toBeVisible();

  const row = await readApplication(admin, application.id);
  expect(row.status).toBe("rejected");
  expect(row.review_note).toBe(reason);
  expect(row.reviewed_by).toBe(fixtureUserId("crrd_admin"));

  // US-C2: "rejection records a reason and leaves NO membership record."
  expect(row.person_id).toBeNull();
  expect(await countPeopleByEmail(admin, application.email)).toBe(0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// (d) Approving twice is idempotent — same ID, still one membership
// ═══════════════════════════════════════════════════════════════════════════════

test("a second approval returns the same member ID and does not create a second membership (US-C3)", async ({
  page,
}) => {
  const admin = adminClient();
  await ensureConfidentialityAck(admin, "crrd_admin");
  const application = await seedPendingApplication(admin, { label: "idempotent" });

  await signIn(page, "crrd_admin");
  await openApplication(page, application.id, application.familyName);
  await clickAndConfirm(page, reviewScreens.approveButton(page));
  await expect(reviewScreens.memberId(page)).toBeVisible();

  const firstId = await memberIdFor(admin, application.id);
  expect(firstId).toMatch(/^\d{4}-\d{3,}$/);

  // ── The second attempt goes DIRECTLY to the RPC as the same signed-in reviewer,
  //    bypassing the UI entirely. The disabled in-flight button is UX; the real guard
  //    is `approve_application()`'s early return, and only a call that skips the button
  //    can show it working (ARCHITECTURE.md §6 mechanism 3).
  const reviewer = await signedInClient("crrd_admin");
  const { data: repeated, error } = await reviewer.rpc("approve_application", {
    p_app_id: application.id,
  });

  expect(error).toBeNull();
  expect(repeated).toBe(firstId);

  const row = await readApplication(admin, application.id);
  expect(row.status).toBe("approved");
  expect(await countMembershipsForPerson(admin, row.person_id as string)).toBe(1);
  // And the ID is unchanged — `people.member_id` is immutable by trigger (US-C4).
  expect(await memberIdFor(admin, application.id)).toBe(firstId);
});

// A guard against the fixture drifting out from under the spec: `crrd_admin` must be
// bound to a person, or `ensureConfidentialityAck` has nothing to acknowledge with and
// every test above fails with a message about the wrong thing.
test("the crrd_admin fixture is bound to a person (seed precondition)", async () => {
  expect(FIXTURES.crrd_admin.personId).not.toBeNull();
});
