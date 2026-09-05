// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/campaign-send.spec.ts — the FIFTH of the six locked Playwright flows
// (ARCHITECTURE.md §1 "Testing & quality"; CONVENTIONS.md §8.1).
//
// PRD v1.1 items 20–26 · US-G1, US-G2, US-G3, US-G4 · US-I1. SRS "Email Sending".
//
// ⚠ THE FILE NAME IS PART OF THE CONTRACT. `campaign-send` is one of the six named
// flows; the merge-token and the officer-refusal cases are additional `test()` blocks IN
// HERE, never a seventh spec file.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE PROVES, AND WHY EACH NEEDS A BROWSER
// ═══════════════════════════════════════════════════════════════════════════════
//
// (a) A real CRRD Admin, signed in through the real login and TOTP screens, composes a
//     message, sees the live recipient count, saves the draft, FREEZES the list and
//     SENDS — and the database, not the toast, says every recipient row is `sent`, the
//     campaign is closed with matching counts, and one CAMPAIGN_QUEUED audit row names
//     that officer (US-I1). The count the composer showed equals the number of rows
//     frozen: the preview and the send call the same function (US-G2).
//
// (b) Freezing a second time — through a DIRECT RPC as the signed-in sender, because
//     the disabled button is UX and the real guard is `UNIQUE (campaign_id, person_id)`
//     — adds zero rows and returns the same count (US-G4: "clicking Send twice does not
//     send twice").
//
// (c) An unknown merge token is refused BEFORE anything is stored: the preview names
//     it and the save control is disabled (US-G3: "fails the send … rather than
//     shipping literal placeholder text").
//
// (d) An officer is bounced off `/campaigns`, and — the half a UI test cannot fake —
//     the resolver refuses them with 42501 when called directly. Sending is the CRRD's
//     and the CEO/COO's (SRS), enforced by the definer's own guard, not by the nav.
//
// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONAL RULES
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. NO DELETES, EVER. Every run seeds its own recipient with a unique email and
//    composes its own campaign; rows accumulate in a scratch database.
//
// 2. THE TRANSPORT IS `fake` (MAIL_TRANSPORT=fake in CI): the drain runs end to end,
//    every send "succeeds", and nothing leaves the box. The assertion is therefore about
//    the queue's state machine, which is the part that is ours; SMTP is nodemailer's.
//
// 3. NO EXACT AUDIENCE SIZE IS ASSUMED. Other specs seed people too, so the count is
//    read from the screen and then required to equal the frozen rows in the database —
//    which is the property that matters.
//
// The whole file skips without SUPABASE_SERVICE_ROLE_KEY (see e2e/global-setup.ts).
// ═══════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { signIn } from "./fixtures/auth";
import { adminClient, currentTermId, fixtureUserId, signedInClient } from "./fixtures/review-seed";

const HAS_SERVICE_KEY = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

test.skip(
  !HAS_SERVICE_KEY,
  "SUPABASE_SERVICE_ROLE_KEY is not set — the campaign flow cannot be seeded or asserted.",
);

test.describe.configure({ timeout: 120_000 });

const CAMPAIGN_URL = /\/campaigns\/([0-9a-f-]{36})$/;
const COUNT_TEXT = /This will reach (\d+) (?:person|people)\./;

// ═══════════════════════════════════════════════════════════════════════════════
// THE PAGE OBJECT — every selector for the campaign screens lives HERE
// ═══════════════════════════════════════════════════════════════════════════════

const campaignScreens = {
  template: (page: Page) => page.getByLabel("Template"),
  subject: (page: Page) => page.getByLabel("Subject"),
  body: (page: Page) => page.getByLabel("Message"),
  audienceCount: (page: Page) => page.getByTestId("audience-count"),
  mergeTokenError: (page: Page) => page.getByTestId("merge-token-error"),
  saveDraft: (page: Page) => page.getByRole("button", { name: "Save draft" }),
  freeze: (page: Page) => page.getByTestId("freeze-recipients"),
  send: (page: Page) => page.getByTestId("send-campaign"),
  sendMessage: (page: Page) => page.getByTestId("send-message"),
  sentRows: (page: Page) => page.getByTestId("recipient-sent"),
  statusBadge: (page: Page, status: string) => page.getByTestId(`campaign-status-${status}`),
  // The 2026-09-06 audience picker: search by name/member ID, one checkbox per row,
  // aria-label "Select <family>, <given>" (never an email — see components/campaigns/
  // audience-picker.tsx).
  audienceSearch: (page: Page) => page.getByLabel("Search by name or member ID"),
  candidateCheckbox: (page: Page, familyName: string, givenName: string) =>
    page.getByRole("checkbox", { name: `Select ${familyName}, ${givenName}` }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Seeding — one guaranteed recipient, so the audience is never empty
// ─────────────────────────────────────────────────────────────────────────────

export type SeededRecipient = {
  personId: string;
  email: string;
  /** Always "Campaign" — kept on the return so a caller never has to hardcode it. */
  givenName: string;
  /** `Recipient<4 hex>`, unique per call — what the audience picker's search matches on. */
  familyName: string;
};

/** A person with an email and an active current-term membership in NCR. Unique per call. */
async function seedRecipient(admin: SupabaseClient): Promise<SeededRecipient> {
  const personId = randomUUID();
  const email = `campaign-${personId.slice(0, 8)}@fixture.start-sys.test`;
  const givenName = "Campaign";
  const familyName = `Recipient${personId.slice(0, 4)}`;

  const { data: region, error: regionError } = await admin
    .from("regions")
    .select("id")
    .eq("code", "NCR")
    .single();
  if (regionError || !region) throw new Error(`region NCR: ${regionError?.message ?? "missing"}`);

  const termId = await currentTermId(admin);

  // A member ID the grid can count (other specs collect rows by member ID). Join year 2019
  // and a 9xxx suffix: no real approval ever allocates in 2019 (join year = the current
  // term's start year), so this literal can never collide with the allocator's sequence —
  // the same rule e2e/fixtures/dashboard-seed.ts follows.
  const memberId = `2019-9${personId.replace(/\D/g, "").slice(0, 3).padStart(3, "0")}`;
  const { error: personError } = await admin.from("people").insert({
    id: personId,
    member_id: memberId,
    join_year: 2019,
    given_name: givenName,
    family_name: familyName,
    personal_email: email,
  });
  if (personError) throw new Error(`seeding person: ${personError.message}`);

  const { error: membershipError } = await admin.from("memberships").insert({
    person_id: personId,
    term_id: termId,
    status: "active",
    region_id: region.id,
    year_level: 2,
    expected_grad_year: 2029,
  });
  if (membershipError) throw new Error(`seeding membership: ${membershipError.message}`);

  return { personId, email, givenName, familyName };
}

async function campaignRow(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .from("email_campaigns")
    .select("status, recipient_count, sent_count, failed_count, created_by")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`reading campaign ${id}: ${error?.message ?? "missing"}`);
  return data as {
    status: string;
    recipient_count: number;
    sent_count: number;
    failed_count: number;
    created_by: string;
  };
}

async function recipientRows(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .from("email_recipients")
    .select("person_id, status, provider_message_id, error")
    .eq("campaign_id", id);
  if (error) throw new Error(`reading recipients: ${error.message}`);
  return (data ?? []) as Array<{
    person_id: string;
    status: string;
    provider_message_id: string | null;
    error: string | null;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// (a) + (b) — compose → freeze → send, asserted against the database
// ═══════════════════════════════════════════════════════════════════════════════

test("US-G1/G2/G4: the CRRD composes, freezes and sends; every recipient row is sent, the campaign closes, and the send is audited (US-I1)", async ({
  page,
}) => {
  const admin = adminClient();
  const recipient = await seedRecipient(admin);
  // A second, disposable recipient — matched by the default filter (active, NCR) exactly
  // like `recipient` — that the audience picker below finds by name and drops. Keeping it
  // separate from `recipient` means every assertion downstream (the frozen count, the
  // sent rows, the final "recipients-table contains recipient.email" check) still
  // describes `recipient`, which is never excluded.
  const excludedRecipient = await seedRecipient(admin);
  const subject = `E2E campaign ${recipient.personId.slice(0, 8)}`;

  await signIn(page, "crrd_admin");

  let shownCount = 0;
  await test.step("compose with a live count and save the draft", async () => {
    await page.goto("/campaigns/new");
    await expect(campaignScreens.template(page)).toBeVisible();
    await campaignScreens.subject(page).fill(subject);
    await campaignScreens.body(page).fill("Hi {{given_name}},\n\nSee you at {{term_label}}.");
    await expect(campaignScreens.audienceCount(page)).toHaveText(COUNT_TEXT);
    const text = await campaignScreens.audienceCount(page).textContent();
    shownCount = Number(COUNT_TEXT.exec(text ?? "")?.[1] ?? "0");
    expect(shownCount).toBeGreaterThanOrEqual(1);
  });

  await test.step("the audience picker finds a seeded recipient by family name, and unticking them narrows the count by exactly one", async () => {
    await campaignScreens.audienceSearch(page).fill(excludedRecipient.familyName);
    const candidate = campaignScreens.candidateCheckbox(
      page,
      excludedRecipient.familyName,
      excludedRecipient.givenName,
    );
    await expect(candidate).toBeVisible();
    // select_all is the default, so a matching candidate starts ticked.
    await expect(candidate).toBeChecked();
    await candidate.uncheck();

    const reduced = shownCount - 1;
    await expect(campaignScreens.audienceCount(page)).toHaveText(
      new RegExp(`This will reach ${reduced} (?:person|people)\\.`),
    );
    shownCount = reduced;
  });

  await campaignScreens.saveDraft(page).click();
  await page.waitForURL(CAMPAIGN_URL);
  const campaignId = CAMPAIGN_URL.exec(page.url())?.[1];
  if (!campaignId) throw new Error(`no campaign id in ${page.url()}`);

  await test.step("the draft is stored, attributed, and nothing is queued yet", async () => {
    const row = await campaignRow(admin, campaignId);
    expect(row.status).toBe("draft");
    expect(row.created_by).toBe(fixtureUserId("crrd_admin"));
    expect(await recipientRows(admin, campaignId)).toHaveLength(0);
    await expect(campaignScreens.statusBadge(page, "draft")).toBeVisible();
  });

  await test.step("freezing writes exactly the rows the composer counted", async () => {
    await campaignScreens.freeze(page).click();
    await expect(campaignScreens.sendMessage(page)).toContainText(/queued/);
    const rows = await recipientRows(admin, campaignId);
    expect(rows).toHaveLength(shownCount);
    expect(rows.some((r) => r.person_id === recipient.personId)).toBe(true);
    // Unticked in the picker above — the frozen list must not resurrect them.
    expect(rows.some((r) => r.person_id === excludedRecipient.personId)).toBe(false);
    expect(rows.every((r) => r.status === "queued")).toBe(true);
    const row = await campaignRow(admin, campaignId);
    expect(row.status).toBe("queued");
    expect(row.recipient_count).toBe(shownCount);
  });

  await test.step("freezing AGAIN, by direct RPC as the sender, adds nothing (US-G4)", async () => {
    const sender = await signedInClient("crrd_admin");
    const { data, error } = await sender.rpc("send_campaign", { p_campaign_id: campaignId });
    expect(error).toBeNull();
    expect(data).toBe(shownCount);
    expect(await recipientRows(admin, campaignId)).toHaveLength(shownCount);
  });

  await test.step("one CAMPAIGN_QUEUED audit row names the officer, carries no values", async () => {
    const { data, error } = await admin
      .from("audit_log")
      .select("actor_user_id, actor_role, old_data, new_data")
      .eq("table_name", "email_campaigns")
      .eq("row_id", campaignId)
      .eq("operation", "CAMPAIGN_QUEUED");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.actor_user_id).toBe(fixtureUserId("crrd_admin"));
    expect(data?.[0]?.actor_role).toBe("crrd_admin");
    expect(data?.[0]?.old_data).toBeNull();
    expect(data?.[0]?.new_data).toBeNull();
  });

  await test.step("sending drains the queue through the transport and closes the campaign", async () => {
    await expect(campaignScreens.send(page)).toBeVisible();
    await campaignScreens.send(page).click();
    await expect(campaignScreens.sendMessage(page)).toContainText(/^Done/, { timeout: 60_000 });

    const rows = await recipientRows(admin, campaignId);
    expect(rows).toHaveLength(shownCount);
    expect(rows.every((r) => r.status === "sent")).toBe(true);
    expect(rows.every((r) => (r.provider_message_id ?? "").startsWith("fake-"))).toBe(true);
    expect(rows.every((r) => r.error === null)).toBe(true);

    const row = await campaignRow(admin, campaignId);
    expect(row.status).toBe("sent");
    expect(row.sent_count).toBe(shownCount);
    expect(row.failed_count).toBe(0);
  });

  await test.step("the delivery report shows one sent row per recipient (item 25)", async () => {
    await page.reload();
    await expect(campaignScreens.statusBadge(page, "sent")).toBeVisible();
    await expect(campaignScreens.sentRows(page)).toHaveCount(shownCount);
    await expect(page.getByTestId("recipients-table")).toContainText(recipient.email);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// (c) — an unknown merge token never reaches a mailbox
// ═══════════════════════════════════════════════════════════════════════════════

test("US-G3: an unknown merge token is named in the preview and blocks saving", async ({
  page,
}) => {
  await signIn(page, "crrd_admin");
  await page.goto("/campaigns/new");
  await expect(campaignScreens.template(page)).toBeVisible();
  await campaignScreens.subject(page).fill("Token check");
  await campaignScreens.body(page).fill("Hi {{frist_name}},");
  await expect(campaignScreens.mergeTokenError(page)).toContainText("frist_name");
  await expect(campaignScreens.saveDraft(page)).toBeDisabled();

  // Fixing the token clears the error and re-enables the save — proving the check is
  // live, not a one-time render.
  await campaignScreens.body(page).fill("Hi {{given_name}},");
  await expect(campaignScreens.mergeTokenError(page)).toHaveCount(0);
  await expect(campaignScreens.saveDraft(page)).toBeEnabled();
});

// ═══════════════════════════════════════════════════════════════════════════════
// (d) — sending is not an officer's, at the nav AND at the data layer
// ═══════════════════════════════════════════════════════════════════════════════

test("SRS: a non-sending tier is bounced off /campaigns and resolve_recipients() refuses an officer with 42501", async ({
  page,
}) => {
  // tech_admin: enrolled (so the real login completes) and not a sender. The officer
  // fixture is deliberately unenrolled (US-A3) and parks on the MFA enrolment screen, so
  // it cannot drive the browser half; it still proves the data-layer half below.
  await signIn(page, "tech_admin");
  await page.goto("/campaigns");
  await expect(page).not.toHaveURL(/\/campaigns/);
  await expect(page.getByTestId("campaigns-table")).toHaveCount(0);

  const officer = await signedInClient("officer");
  const { data, error } = await officer.rpc("resolve_recipients", { p_filter: {} });
  expect(data).toBeNull();
  expect(error?.code).toBe("42501");
});
