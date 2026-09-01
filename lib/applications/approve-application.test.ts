// ═════════════════════════════════════════════════════════════════════════════
// S4's LOOP-EXIT TEST — and the ONLY place real concurrency is proved.
// ═════════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE.md §5 and CONVENTIONS.md §8.2 both describe a pgTAP concurrency test.
// It cannot exist: `supabase test db` wraps each file in a transaction that is rolled
// back, so a second connection cannot see the fixtures, and 50-way parallelism is not
// achievable there. `supabase/tests/048_member_id_concurrency.sql` therefore asserts
// what one session genuinely can — 50 sequential allocations, the 999 -> 1000 rollover,
// the immutability trigger, and STRUCTURALLY that the allocator's body contains
// `on conflict` and does not contain `max(`.
//
// THIS FILE IS THE REST OF IT: fifty genuinely concurrent PostgREST connections, which
// is the shape the race actually takes during application week when two DCCDOs work
// the queue at the same time. Do not weaken 048 to look like this test, and do not
// delete this test because 048 is green (BUILD_PLAN S4-T10, S4-T23).
//
// ⚠ THE ACCEPTANCE BAR IS THREE CONSECUTIVE PASSES FROM A FRESH `pnpm db:reset`.
// A race that passes once has not been disproved. The offset-relative assertions below
// are written so that repeated runs against the SAME database are also valid — which is
// what lets you run it three times in a row without resetting between attempts.
//
// WHAT WOULD MAKE IT FAIL, AND WHAT THAT WOULD MEAN
//   · duplicate ids  ....... the allocator went back to `max(seq) + 1` and lost updates
//   · a GAP in the run ..... someone reached for a Postgres SEQUENCE, which is
//                            non-transactional: a failed approval burns a number
//                            permanently, and a hole in a member-ID series is a support
//                            ticket forever (DATA_MODEL.md §4)
//   · people delta ≠ 50 .... approval stopped being one transaction, or person reuse
//                            matched addresses it should not have
//   · a rejected promise ... the row lock is gone and concurrent approvals deadlock or
//                            raise instead of serializing
//
// PRD US-C3: "two admins approving at the same moment produce two different IDs — never
// a duplicate, never a gap caused by a lost update"; "a retried or double-submitted
// approval returns the existing ID rather than issuing a second one".
// ═════════════════════════════════════════════════════════════════════════════

import { beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  countMembershipsForPerson,
  countRows,
  DB_TEST_ENV_READY,
  ensureReviewWorld,
  personIdForApplication,
  readCounter,
  runNonce,
  seedPendingApplications,
  sequenceOf,
  signInAsReviewer,
  type ReviewWorld,
  type TypedClient,
} from "@/lib/applications/test-support";

/** Fifty is the number BUILD_PLAN S4-T12 names, and it is not arbitrary: it is well
 *  past the point where a lost-update allocator produces a collision on every run. */
const PARALLEL_APPROVALS = 50;

/** Ten concurrent approvals of ONE row — the double-clicked-Approve case. */
const PARALLEL_RETRIES = 10;

/** Fifty concurrent round trips plus GoTrue setup. Generous; the race itself is fast. */
const RACE_TIMEOUT_MS = 180_000;

describe.skipIf(!DB_TEST_ENV_READY)("approve_application() under real concurrency", () => {
  let admin: TypedClient;
  let reviewer: TypedClient;
  let world: ReviewWorld;

  beforeAll(async () => {
    admin = adminClient();
    world = await ensureReviewWorld(admin);
    // The subject under test signs in like a human: anon key, real password, real JWT.
    // Approving through the service-role client would prove nothing about the path a
    // reviewer takes, because it would not evaluate the function's role guard at all.
    reviewer = await signInAsReviewer();
  }, RACE_TIMEOUT_MS);

  it(
    "mints 50 distinct, gapless member IDs for 50 simultaneous approvals",
    async () => {
      const nonce = runNonce();

      // Read the counter FIRST. Every assertion below is relative to this offset, never
      // to 1 — review-fixtures.psql seeds a counter row and previous runs leave one, and
      // a test that assumed a virgin counter would fail on its second run in a way that
      // looks exactly like the lost update it is meant to detect.
      const seqBefore = await readCounter(admin, world.joinYear);
      const peopleBefore = await countRows(admin, "people");
      const membershipsBefore = await countRows(admin, "memberships");

      const seeded = await seedPendingApplications(admin, world, PARALLEL_APPROVALS, nonce);

      // ── THE RACE ────────────────────────────────────────────────────────────
      // `Promise.all` over 50 supabase-js calls opens 50 concurrent HTTP requests to
      // PostgREST, each landing in its own Postgres backend. They contend on the
      // `member_id_counters` row exactly as two reviewers clicking Approve would.
      const settled = await Promise.allSettled(
        seeded.ids.map((id) => reviewer.rpc("approve_application", { p_app_id: id })),
      );

      const rejected = settled.filter((r) => r.status === "rejected");
      expect(
        rejected,
        "every approval promise must settle — a rejection means the row lock or the connection failed",
      ).toHaveLength(0);

      const results = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));

      // A PostgREST error arrives in `error`, not as a rejected promise. Surface the
      // SQLSTATE, never the message — a raw error can carry an applicant's address.
      const failedCodes = results
        .filter((r) => r.error !== null)
        .map((r) => r.error?.code ?? "unknown");
      expect(failedCodes, "no approval may return a database error").toEqual([]);

      const ids = results.map((r) => r.data).filter((v): v is string => typeof v === "string");
      expect(ids).toHaveLength(PARALLEL_APPROVALS);

      // ── 1. Distinct. A duplicate here is a lost update. ─────────────────────
      expect(new Set(ids).size, "50 approvals must produce 50 DISTINCT member IDs").toBe(
        PARALLEL_APPROVALS,
      );

      // ── 2. Contiguous, relative to the counter's starting value. A gap means a
      //       SEQUENCE crept in somewhere. ────────────────────────────────────
      const sequences = ids.map((id) => sequenceOf(id, world.joinYear)).sort((a, b) => a - b);
      const expected = Array.from({ length: PARALLEL_APPROVALS }, (_, i) => seqBefore + i + 1);
      expect(sequences, "sequences must be contiguous from the pre-race counter value").toEqual(
        expected,
      );

      // ── 3. Format. `{3,}`, not `{3}` — the 1000th member of a year is 2026-1000,
      //       not a collision (ARCHITECTURE.md §6). ────────────────────────────
      for (const id of ids) expect(id).toMatch(/^\d{4}-\d{3,}$/);

      // ── 4. One person and one membership per approval, and no more. This is the
      //       "one transaction" claim: you can never get an ID without a membership
      //       or a membership without an ID (PRD US-C3). ───────────────────────
      expect((await countRows(admin, "people")) - peopleBefore).toBe(PARALLEL_APPROVALS);
      expect((await countRows(admin, "memberships")) - membershipsBefore).toBe(PARALLEL_APPROVALS);

      // ── 5. The counter advanced by exactly 50 — no burnt numbers. ───────────
      expect(await readCounter(admin, world.joinYear)).toBe(seqBefore + PARALLEL_APPROVALS);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    "returns the same member ID and creates exactly one membership for 10 concurrent approvals of the SAME application",
    async () => {
      const nonce = runNonce();
      const seeded = await seedPendingApplications(admin, world, 1, nonce);
      const applicationId = seeded.ids[0];
      expect(applicationId).toBeDefined();
      if (applicationId === undefined) throw new Error("unreachable");

      const seqBefore = await readCounter(admin, world.joinYear);

      const settled = await Promise.allSettled(
        Array.from({ length: PARALLEL_RETRIES }, () =>
          reviewer.rpc("approve_application", { p_app_id: applicationId }),
        ),
      );

      expect(settled.filter((r) => r.status === "rejected")).toHaveLength(0);
      const results = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      expect(
        results.filter((r) => r.error !== null).map((r) => r.error?.code ?? "unknown"),
      ).toEqual([]);

      const ids = results.map((r) => r.data).filter((v): v is string => typeof v === "string");
      expect(ids).toHaveLength(PARALLEL_RETRIES);

      // The idempotent early-return: nine of these took the `status = 'approved'`
      // branch and returned the id the first one minted. This — not the disabled
      // button in the dialog — is the real double-click guard (BUILD_PLAN S4-T21).
      expect(new Set(ids).size, "a retried approval must return the EXISTING id").toBe(1);

      // Exactly ONE number was consumed by ten calls.
      expect(await readCounter(admin, world.joinYear)).toBe(seqBefore + 1);

      const personId = await personIdForApplication(admin, applicationId);
      expect(personId, "an approved application always names its person").not.toBeNull();
      if (personId === null) throw new Error("unreachable");

      // `unique (person_id, term_id)` is PRD US-H1 spelled as a constraint, and
      // `on conflict do nothing` in the RPC is what makes the retry hit it silently.
      expect(await countMembershipsForPerson(admin, personId)).toBe(1);
    },
    RACE_TIMEOUT_MS,
  );
});
