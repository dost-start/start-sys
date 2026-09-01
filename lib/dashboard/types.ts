// ─────────────────────────────────────────────────────────────────────────────
// Shapes for the three dashboard aggregate views (0032) and the buckets built from
// them (BUILD_PLAN S6-T5, S6-T6).
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ WHY THESE ROW TYPES ARE HAND-WRITTEN, WHICH CONVENTIONS.md §5 OTHERWISE FORBIDS
// ═══════════════════════════════════════════════════════════════════════════════
// `database.types.ts` at the time of writing does NOT contain
// `v_membership_status_counts`, `v_membership_region_counts` or
// `v_membership_committee_counts`: 0032 landed after the last `pnpm db:types` run, and
// this slice may not regenerate that file (it is a merge-alone artifact — BUILD_PLAN
// "Parallelism"). The CI `types-drift` job is what closes the gap, and it closes it in
// the migration owner's commit, not here.
//
// So the three `*CountRow` types below are a TEMPORARY MIRROR of the view definitions in
// 0032, and `lib/dashboard/queries.ts` casts through them once, in one documented place.
// TODO(migration owner, 2026-09-06): once `pnpm db:types` has been run against 0032,
// replace each of these with `Database["public"]["Views"]["v_…"]["Row"]` and delete the
// cast helper in queries.ts. Nothing else in this folder changes — the field names below
// are deliberately identical to the view's output columns.
//
// Everything that CAN come from the generated module already does: the enums
// (`membership_status`, `island_group`) are `Enums<...>`, so a constitutional amendment
// that adds a status is a compile error at the label map (status-buckets.ts) rather than
// a silently missing tile.
//
// ⚠ NO COLUMN OF `people` APPEARS ANYWHERE IN THIS FILE, AND NONE MAY BE ADDED. The
// aggregates expose counts, region names and committee names — nothing about a person.
// That is what keeps the column-level GRANT (0015) and the CBL Art. VIII §7.1
// acknowledgement gate (0012) out of the dashboard path entirely, so a dashboard can
// never become the way somebody widens them (PRD US-J1, Success Metric 8). 066 asserts
// this against `sensitive_column_registry` on every CI run.
//
// CITATION: BUILD_PLAN S6-T5, S6-T6; ADR 0007; DATA_MODEL.md §6/0032;
//           PRD §3 v1.0 items 13-15; PRD US-D2, US-D4, US-F1, US-J1.
// ─────────────────────────────────────────────────────────────────────────────

import type { Enums } from "@/database.types";

export type MembershipStatus = Enums<"membership_status">;
export type IslandGroup = Enums<"island_group">;

// ── Raw view rows ────────────────────────────────────────────────────────────

/** One row of `v_membership_status_counts`. No join, so this is memberships itself. */
export type StatusCountRow = {
  term_id: string;
  status: MembershipStatus;
  member_count: number;
};

/**
 * One row of `v_membership_region_counts`.
 *
 * `region_id` is carried alongside the name because the tile links through to
 * `/members?region_id=<uuid>` — `v_member_directory` exposes `region_name` only and
 * therefore cannot serve a facet link (0032's header; ADR 0006).
 */
export type RegionCountRow = {
  term_id: string;
  region_id: string;
  region_code: string;
  region_name: string;
  island_group: IslandGroup;
  sort_order: number;
  member_count: number;
};

/**
 * One row of `v_membership_committee_counts`.
 *
 * ⚠ `committee_id === null` IS THE UNASSIGNED BUCKET, not a missing join. A membership
 * with no `committee_memberships` row lands here, and without it a term where most
 * members sit on no committee would show a panel accounting for a handful of people and
 * silently omitting everyone else.
 */
export type CommitteeCountRow = {
  term_id: string;
  committee_id: string | null;
  committee_code: string | null;
  committee_name: string | null;
  member_count: number;
};

// ── Zero-filled buckets (status-buckets.ts) ──────────────────────────────────

/** One status tile. Present for EVERY enum member, at 0 when nobody holds it. */
export type StatusBucket = {
  status: MembershipStatus;
  /** Human label from the union-keyed map — never derived by string-munging the enum. */
  label: string;
  count: number;
};

/** One region bar. Present for every seeded region, at 0 when it has no members. */
export type RegionBucket = {
  region_id: string;
  region_code: string;
  region_name: string;
  island_group: IslandGroup;
  sort_order: number;
  count: number;
};

/** One committee bar. `committee_id === null` is the unassigned bucket. */
export type CommitteeBucket = {
  committee_id: string | null;
  committee_name: string;
  count: number;
};

/**
 * The reference rows `zeroFillRegions` fills against — read from the `regions` TABLE,
 * never hard-coded. RA 12000 (2024) made it 18 by carving out the Negros Island Region,
 * and a hard-coded list is how the 19th goes missing (DATA_MODEL.md §6/0016).
 */
export type RegionRef = {
  id: string;
  code: string;
  name: string;
  island_group: IslandGroup;
  sort_order: number;
};

/** The rep's own region(s), for the Regional Representative dashboard header (US-F1). */
export type CallerRegion = RegionRef;
