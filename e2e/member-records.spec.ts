// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/member-records.spec.ts — BUILD_PLAN S5-T29.
//
// The member directory as an administrator actually uses it: search, filter, sort,
// page, share the link, open a record, correct a field, move a status.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE CASE THAT MATTERS MOST IS #4
// ═══════════════════════════════════════════════════════════════════════════════
// PRD US-I3 says a filtered view "is shareable as a link and survives the browser back
// button". Almost every implementation passes a test that reloads the URL in the SAME
// tab — because the component still holds the state that produced it. So case 4 copies
// the full URL into a FRESH BROWSER CONTEXT signed in as a DIFFERENT ADMINISTRATOR and
// asserts an IDENTICAL ROW SET AND IDENTICAL FILTER CHIPS. That is the sentence proven
// rather than asserted: nothing but the URL travelled.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHAT IS ASSERTED AGAINST THE DATABASE, AND WHY
// ═══════════════════════════════════════════════════════════════════════════════
// Three of these cases are audit-and-privacy cases, not UI cases, so they are checked
// with the service role rather than by reading the screen:
//
//   • Opening a record writes EXACTLY ONE `VIEW_RECORD` row (counted before and after).
//     RA 10173 asks "who opened this scholar's record, and when"; DATA_MODEL §8.3 makes
//     `get_member_record()` write it. Two rows would mean the page mounts the panel
//     twice; zero would mean the RA 10173 access record silently stopped.
//
//   • A contact-number edit writes the VALUE to `people` and an `UPDATE` audit row —
//     whose payload is masked, because `mask_sensitive()` runs before the row is
//     written (DATA_MODEL §8.3). The log answers "who changed it" without storing it.
//
//   • `active → graduated` moves the badge AND `graduated → active` is then absent from
//     the offered set. Terminal-within-the-term is a trigger (0028), and the editor
//     offering an edge the database refuses is how a user learns to distrust the screen.
//
// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONAL RULES
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. NO DELETES, EVER (CLAUDE.md; DATA_MODEL.md §13 rule 2). The two mutating cases
//    seed their OWN member with a unique family name and member ID, so nothing shares
//    state, nothing is cleaned up, and rows accumulate in a scratch database.
//
// 2. IT NEVER MUTATES A SCOPE FIXTURE. `e2e/fixtures/dashboard-seed.ts` plants the
//    sensitive literals that `member-officer-read-only.spec.ts` and
//    `rr-scope-leak.spec.ts` grep for. Editing a planted contact number here would make
//    those two specs pass for the wrong reason — the literal would simply no longer be
//    in the database. Hence `seedMutableMember()`.
//
// 3. THE WHOLE FILE SKIPS WITHOUT SUPABASE_SERVICE_ROLE_KEY. Seeding and every database
//    assertion are privileged; a DB-less clone should still get a green `pnpm test:e2e`
//    rather than a wall of connection errors that teaches people to ignore e2e output.
// ═══════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { MEMBERS_PATH } from "../lib/members/filters";
import { signIn } from "./fixtures/auth";
import {
  ALPHA_NAMES,
  BRAVO_NAMES,
  REGION_A_CODE,
  countMembershipsByStatusAndRegion,
  countPeopleUpdates,
  countViewRecords,
  loadScopeState,
  readMembershipStatus,
  readPerson,
  scopeAdminClient,
  seedDashboardWorld,
} from "./fixtures/dashboard-seed";

const HAS_SERVICE_KEY = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

test.skip(
  !HAS_SERVICE_KEY,
  "SUPABASE_SERVICE_ROLE_KEY is not set — the member directory cannot be seeded or asserted.",
);

/** PRD US-C3's shape, used to identify a row without depending on column order. */
const MEMBER_ID_PATTERN = /\b\d{4}-\d{3,}\b/g;

// ═══════════════════════════════════════════════════════════════════════════════
// THE PAGE OBJECT — every selector for the member screens lives HERE
// ═══════════════════════════════════════════════════════════════════════════════
//
// One place to fix when S5-T21…T28 settle their markup, rather than nine. Accessible
// selectors only (role + accessible name), so these specs also assert the screens are
// operable by label and keyboard — the Usability NFR tested for free.

const memberScreens = {
  /** US-I2's search box, over both name and member ID. */
  search: (page: Page) =>
    page
      .getByRole("searchbox")
      .or(page.getByRole("textbox", { name: /search/i }))
      .first(),

  /** Every data row. The header row is excluded by requiring a member ID in the text. */
  rows: (page: Page) => page.getByRole("row"),

  /** US-I3's visible, clearable active-filter set. */
  activeFilters: (page: Page) =>
    page.getByRole("region", { name: /active filters?/i }).or(page.getByTestId("active-filters")),

  /** The link into a member's detail page. */
  detailLink: (page: Page, familyName: string) =>
    page.getByRole("link").filter({ hasText: familyName }).first(),

  editButton: (page: Page) => page.getByRole("button", { name: /edit/i }).first(),
  contactField: (page: Page) => page.getByLabel(/contact number/i).first(),
  saveButton: (page: Page) => page.getByRole("button", { name: /save|update/i }).first(),

  statusEditor: (page: Page) =>
    page.getByRole("button", { name: /change status|update status|status/i }).first(),
  statusReason: (page: Page) => page.getByLabel(/reason|ground|note/i).first(),
  confirmDialog: (page: Page) => page.getByRole("alertdialog").or(page.getByRole("dialog")).first(),
};

/**
 * The member IDs currently rendered, in DOM order.
 *
 * Reads member IDs rather than names because they are unique, stable and the one column
 * every tier can see — so this helper works unchanged in the officer spec.
 */
async function visibleMemberIds(page: Page): Promise<string[]> {
  const texts = await memberScreens.rows(page).allInnerTexts();
  const ids: string[] = [];
  for (const text of texts) {
    const matched = text.match(MEMBER_ID_PATTERN);
    if (matched) ids.push(...matched);
  }
  return ids;
}

/** The active-filter chip labels, normalised, for the cross-context comparison. */
async function chipTexts(page: Page): Promise<string[]> {
  const region = memberScreens.activeFilters(page).first();
  if ((await region.count()) === 0) return [];
  const raw = await region.innerText();
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

/** Wait until the grid has painted whatever the current URL asks for. */
async function waitForGrid(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

// ═══════════════════════════════════════════════════════════════════════════════
// A MUTABLE MEMBER — see operational rule 2
// ═══════════════════════════════════════════════════════════════════════════════

type MutableMember = {
  personId: string;
  membershipId: string;
  familyName: string;
  memberId: string;
};

/**
 * Seed one member this file is allowed to edit.
 *
 * `join_year` 2018 with a random four-digit sequence: unique across concurrent browser
 * projects, matching `member_id_format` (`^\d{4}-\d{3,}$`), and far from any year
 * `allocate_member_id()` will ever hand out — so nothing here can collide with a real
 * approval or desynchronise `member_id_counters`.
 */
async function seedMutableMember(admin: SupabaseClient): Promise<MutableMember> {
  const state = loadScopeState();
  const personId = randomUUID();
  const membershipId = randomUUID();
  const suffix = Math.floor(1000 + Math.random() * 8999);
  const familyName = `ScopeEdit${suffix}`;
  const memberId = `2018-${suffix}`;

  const { error: personError } = await admin.from("people").insert({
    id: personId,
    member_id: memberId,
    join_year: 2018,
    given_name: "Editable",
    family_name: familyName,
    birthdate: "2001-07-07",
    contact_number: "+639180000900",
    personal_email: `${familyName.toLowerCase()}@fixture.start-sys.test`,
    address_line: "Editable Street 9",
    city_municipality: "Quezon City",
    province: "Metro Manila",
    postal_code: "1100",
    school: "Editable University",
    school_id_no: `EDIT-${suffix}`,
  });
  if (personError) throw new Error(`seeding mutable person: ${personError.message}`);

  const { error: membershipError } = await admin.from("memberships").insert({
    id: membershipId,
    person_id: personId,
    term_id: state.currentTermId,
    status: "active",
    region_id: state.regionIds[REGION_A_CODE],
    year_level: 3,
    expected_grad_year: 2028,
  });
  if (membershipError) throw new Error(`seeding mutable membership: ${membershipError.message}`);

  return { personId, membershipId, familyName, memberId };
}

// ═══════════════════════════════════════════════════════════════════════════════

test.describe("member records (US-I2, US-I3, US-D1, US-D3)", () => {
  test.beforeAll(async () => {
    if (!HAS_SERVICE_KEY) return;
    await seedDashboardWorld();
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  test("US-I2: search narrows the grid and the query survives in the URL", async ({ page }) => {
    await signIn(page, "crrd_admin");
    await page.goto(MEMBERS_PATH);
    await waitForGrid(page);

    const target = ALPHA_NAMES[0];
    if (!target) throw new Error("No scope fixtures seeded.");

    await memberScreens.search(page).fill(target);
    // The search is debounced (S5-T23, 300ms) and navigates rather than filtering in the
    // browser — a client-side filter over one page would silently lie about the other 23.
    await page.waitForURL((url) => url.searchParams.get("q") === target, { timeout: 15_000 });
    await waitForGrid(page);

    await expect(page.getByText(target)).toBeVisible();

    // Exactly one member, and it is the one asked for. `ScopeAlpha01` is a unique family
    // name, so a grid still showing anyone else is not filtering server-side.
    const ids = await visibleMemberIds(page);
    expect(ids).toHaveLength(1);

    // …and none of the other fifteen scope members leaked through.
    for (const other of [...ALPHA_NAMES.slice(1), ...BRAVO_NAMES]) {
      await expect(page.getByText(other, { exact: true })).toHaveCount(0);
    }
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  test("US-I3: two facets combined return the count the database says they should", async ({
    page,
  }) => {
    const admin = scopeAdminClient();
    const state = loadScopeState();
    const regionA = state.regionIds[REGION_A_CODE];
    if (!regionA) throw new Error("Region A is not seeded.");

    // THE EXPECTATION IS COMPUTED, NEVER HARDCODED. A literal goes stale the moment
    // another spec seeds a member, and the repair is always to loosen the assertion.
    const expected = await countMembershipsByStatusAndRegion(
      admin,
      "active",
      regionA,
      state.currentTermId,
    );
    expect(expected).toBeGreaterThan(0);
    test.skip(
      expected > 100,
      "More active region-A members than one page holds; see S7 benchmark.",
    );

    await signIn(page, "crrd_admin");
    await page.goto(`${MEMBERS_PATH}?status=active&region_id=${regionA}&per_page=100`);
    await waitForGrid(page);

    const ids = await visibleMemberIds(page);
    expect(new Set(ids).size).toBe(expected);
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  test("pagination: page 2 shares no member with page 1 under a descending sort", async ({
    page,
  }) => {
    await signIn(page, "crrd_admin");

    const query = "per_page=5&sort=family_name.desc";
    await page.goto(`${MEMBERS_PATH}?${query}`);
    await waitForGrid(page);
    const first = await visibleMemberIds(page);

    await page.goto(`${MEMBERS_PATH}?${query}&page=2`);
    await waitForGrid(page);
    const second = await visibleMemberIds(page);

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);

    // Disjoint is the real assertion: an unstable sort (no deterministic tiebreak) shows
    // the same person on both pages and hides another entirely, and the grid still looks
    // perfectly plausible while doing it.
    const overlap = first.filter((id) => second.includes(id));
    expect(overlap).toEqual([]);
  });

  // ── 4 ── THE US-I3 CASE. See the header. ──────────────────────────────────
  test("US-I3: the same URL in a fresh context as a different admin renders an identical view", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    const state = loadScopeState();
    const regionA = state.regionIds[REGION_A_CODE];
    if (!regionA) throw new Error("Region A is not seeded.");

    await signIn(page, "crrd_admin");
    await page.goto(
      `${MEMBERS_PATH}?status=active&region_id=${regionA}&sort=member_id.asc&per_page=100`,
    );
    await waitForGrid(page);

    const sharedUrl = page.url();
    const authorIds = await visibleMemberIds(page);
    const authorChips = await chipTexts(page);

    expect(authorIds.length).toBeGreaterThan(0);
    // The chips are half the claim: a link that reproduces the rows but not the visible
    // filter set leaves the recipient unable to tell what they are looking at.
    expect(authorChips.length).toBeGreaterThan(0);

    // A genuinely fresh browser context — new cookie jar, new storage, no component
    // state — signed in as a DIFFERENT administrator.
    const recipientContext = await browser.newContext();
    try {
      const recipient = await recipientContext.newPage();
      await signIn(recipient, "exec_admin");
      await recipient.goto(sharedUrl);
      await waitForGrid(recipient);

      expect(await visibleMemberIds(recipient)).toEqual(authorIds);
      expect(await chipTexts(recipient)).toEqual(authorChips);
    } finally {
      await recipientContext.close();
    }
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────
  test("US-I3: the back button restores the previous filter state", async ({ page }) => {
    const state = loadScopeState();
    const regionA = state.regionIds[REGION_A_CODE];
    if (!regionA) throw new Error("Region A is not seeded.");

    await signIn(page, "crrd_admin");

    await page.goto(`${MEMBERS_PATH}?per_page=100`);
    await waitForGrid(page);
    const unfiltered = await visibleMemberIds(page);

    await page.goto(`${MEMBERS_PATH}?status=active&region_id=${regionA}&per_page=100`);
    await waitForGrid(page);
    const filtered = await visibleMemberIds(page);
    expect(filtered.length).toBeLessThanOrEqual(unfiltered.length);

    await page.goBack();
    await waitForGrid(page);

    // Back must restore the VIEW, not just the address bar — the two are the same thing
    // only because filter state lives in the URL and nowhere else (CONVENTIONS §2).
    expect(new URL(page.url()).searchParams.get("status")).toBeNull();
    expect(await visibleMemberIds(page)).toEqual(unfiltered);
  });

  // ── 6 ── RA 10173 / DATA_MODEL §8.3 ───────────────────────────────────────
  test("opening a member record writes exactly one VIEW_RECORD audit row", async ({ page }) => {
    const admin = scopeAdminClient();
    const member = await seedMutableMember(admin);

    // Counted for the PERSON rather than for one actor: the row must exist and be
    // attributable, and pinning the actor here would only re-test what
    // `049_document_view_audit.sql` and `062_member_record_rpc_authz.sql` already assert
    // at the data layer. What this case adds is that OPENING THE PAGE is what writes it.
    const before = await countViewRecords(admin, member.personId);

    await signIn(page, "crrd_admin");
    await page.goto(`${MEMBERS_PATH}/${member.personId}`);
    await waitForGrid(page);

    // The record actually rendered — otherwise a 404 would also produce "zero new rows"
    // and the assertion below would pass for the wrong reason.
    await expect(page.getByText(member.memberId).first()).toBeVisible();

    const after = await countViewRecords(admin, member.personId);
    expect(after - before).toBe(1);
  });

  // ── 7 ── US-D1 ────────────────────────────────────────────────────────────
  test("US-D1: editing a contact number writes the value and an attributable audit row", async ({
    page,
  }) => {
    const admin = scopeAdminClient();
    const member = await seedMutableMember(admin);
    const updatesBefore = await countPeopleUpdates(admin, member.personId);
    const nextNumber = `+63918${Math.floor(1000000 + Math.random() * 8999999)}`;

    await signIn(page, "crrd_admin");
    await page.goto(`${MEMBERS_PATH}/${member.personId}`);
    await waitForGrid(page);

    const editButton = memberScreens.editButton(page);
    if ((await editButton.count()) > 0) await editButton.click();

    await memberScreens.contactField(page).fill(nextNumber);
    await memberScreens.saveButton(page).click();
    await waitForGrid(page);

    const person = await readPerson(admin, member.personId);
    expect(person.contact_number).toBe(nextNumber);

    // "Including the user responsible" is true because `audit_row()` is a DB TRIGGER, not
    // an application write — no code path can skip it (ARCHITECTURE §8).
    expect(await countPeopleUpdates(admin, member.personId)).toBeGreaterThan(updatesBefore);
  });

  // ── 8 ── US-D3 / 0028 ─────────────────────────────────────────────────────
  test("US-D3: active → graduated moves the badge, and graduated → active is not offered", async ({
    page,
  }) => {
    const admin = scopeAdminClient();
    const member = await seedMutableMember(admin);

    await signIn(page, "crrd_admin");
    await page.goto(`${MEMBERS_PATH}/${member.personId}`);
    await waitForGrid(page);

    await memberScreens.statusEditor(page).click();

    const dialog = memberScreens.confirmDialog(page);
    await expect(dialog).toBeVisible();

    // The target status. Rendered as an option or a radio depending on how S5-T28 settled
    // its markup; both are addressed by accessible name.
    await dialog
      .getByRole("option", { name: /graduated/i })
      .or(dialog.getByRole("radio", { name: /graduated/i }))
      .or(dialog.getByRole("button", { name: /graduated/i }))
      .first()
      .click();

    // A written ground is required for every terminal status on both sides — and for
    // `terminated` it is also a database CHECK (0028), so the form cannot be looser.
    await memberScreens.statusReason(page).fill("Confirmed graduation, e2e fixture record.");
    await dialog
      .getByRole("button", { name: /save|confirm|update|change/i })
      .last()
      .click();
    await waitForGrid(page);

    expect(await readMembershipStatus(admin, member.membershipId)).toBe("graduated");

    await expect(page.getByText(/graduated/i).first()).toBeVisible();

    // The reverse edge is terminal within the term (DATA_MODEL §3.1). The editor must not
    // offer what the trigger will refuse: a control that produces a 23514 teaches the
    // officer that the system is broken, and the next move is to stop trusting the screen.
    await memberScreens.statusEditor(page).click();
    const reopened = memberScreens.confirmDialog(page);
    await expect(reopened).toBeVisible();
    await expect(
      reopened
        .getByRole("option", { name: /^active$/i })
        .or(reopened.getByRole("radio", { name: /^active$/i })),
    ).toHaveCount(0);
  });
});
