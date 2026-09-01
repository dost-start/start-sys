// ─────────────────────────────────────────────────────────────────────────────
// Shared shapes for the member-records surface.
//
// ⚠ EVERY ROW TYPE HERE IS DERIVED FROM `database.types.ts`. CONVENTIONS.md §5:
// "Always from the generated root `database.types.ts`. Never hand-write a row shape."
// A hand-written `{ memberId: string }` needs a mapping layer nobody maintains, and the
// first thing that mapping layer does is quietly drop a column.
//
// ⚠ KEYS STAY `snake_case`. There is no snake -> camel translation anywhere in this
// codebase and adding one is a rejected design (CONVENTIONS.md §5). supabase-js returns
// rows verbatim; the generated types are snake_case; the form field names, the zod issue
// paths and the database columns are the same strings all the way down.
//
// ⚠ NOTHING SENSITIVE IS IN A LIST TYPE. `MemberDirectoryRow` is exactly what
// `search_member_directory()` returns, and that function selects only the six `people`
// columns 0015 grants to `authenticated`. A `birthdate` on this type would be a lie —
// the column GRANT would refuse it — and a lie that looks like a bug in a page component
// rather than a permissions decision (ARCHITECTURE.md §9 item 4).
// ─────────────────────────────────────────────────────────────────────────────

import type { Database, Enums, Tables } from "@/database.types";

// ── The grid ─────────────────────────────────────────────────────────────────

/**
 * One row of the member directory, DEDUPED.
 *
 * Taken straight from the generated RPC return type, so adding a column to
 * `search_member_directory()` and regenerating types surfaces here rather than in a cast.
 * A scholar on two committees is ONE row with two `committee_names` — the RPC's GROUP BY
 * is what makes pagination honest (page 1 of 25 really is 25 people).
 */
export type MemberDirectoryRow =
  Database["public"]["Functions"]["search_member_directory"]["Returns"][number];

/** One page of the grid, with an honest exact total rather than an estimate. */
export type MemberDirectoryPage = {
  rows: MemberDirectoryRow[];
  /** PostgREST's `count: 'exact'` for the filtered set. Drives the page count. */
  total: number;
  page: number;
  perPage: number;
};

// ── The detail page ──────────────────────────────────────────────────────────

/**
 * A full member record as `get_member_record()` returns it: `to_jsonb(people)`, sensitive
 * columns included.
 *
 * ⚠ HOLDING ONE OF THESE MEANS AN AUDIT ROW WAS WRITTEN. The RPC inserts a `VIEW_RECORD`
 * entry before it returns (RA 10173 / CBL Art. VIII §6: "who read this scholar's address,
 * and when" must be answerable). Do not fetch one to test whether a person exists, and do
 * not fetch one twice per render.
 *
 * ⚠ READ IT IN A SERVER COMPONENT AND PASS DOWN ONLY WHAT THE SCREEN RENDERS. PII must
 * never be fetched in a client component (CLAUDE.md "Privacy", CONVENTIONS.md §1.3).
 */
export type MemberRecord = Tables<"people">;

/** One term of a person's history — the view that shows the member ID never changing. */
export type MemberTermHistoryRow = {
  membership_id: string;
  term_id: string;
  term_label: string;
  term_starts_on: string;
  term_ends_on: string;
  term_status: Enums<"term_status">;
  status: Enums<"membership_status">;
  region_id: string;
  region_name: string;
  island_group: Enums<"island_group">;
  year_level: number | null;
  expected_grad_year: number | null;
  ended_reason: string | null;
};

/**
 * One audit entry about this person.
 *
 * `old_data` and `new_data` arrive ALREADY MASKED — `mask_sensitive()` replaced every
 * column registered in `sensitive_column_registry` with a redaction marker BEFORE the row
 * was written (DATA_MODEL.md §8.3). There is no un-masking path and none may be added:
 * that masking is precisely what lets the log be append-only and still survive the
 * five-year purge, because it holds no PII for the purge to reach.
 */
export type MemberAuditEntry = Pick<
  Tables<"audit_log">,
  | "id"
  | "created_at"
  | "actor_user_id"
  | "actor_role"
  | "table_name"
  | "row_id"
  | "operation"
  | "old_data"
  | "new_data"
  | "note"
>;

// ── Facet options ────────────────────────────────────────────────────────────

export type FacetOption = {
  id: string;
  label: string;
};

/**
 * What the filter bar renders. Resolved in the Server Component and passed DOWN as props
 * — never fetched from a client component, so the filter bar carries no Supabase client
 * and no session of its own.
 *
 * `terms` is empty for a caller who may not choose a term. That emptiness is UX only:
 * `search_member_directory()` ignores a client-supplied term for non-admin tiers and RLS
 * refuses the rows regardless (PRD US-H3).
 */
export type MemberFacetOptions = {
  regions: FacetOption[];
  committees: FacetOption[];
  departments: FacetOption[];
  terms: FacetOption[];
};

// ── Read outcomes ────────────────────────────────────────────────────────────

/**
 * Why a member record could not be read.
 *
 * `missing_acknowledgement` exists because it is the ONE denial with an action attached
 * to it. CBL Art. VIII §7.1 requires the agreement "upon assuming their roles", so on the
 * morning a term opens nobody has one and every sensitive read fails — correctly. That is
 * a documented day-one failure mode (PRD US-J5; ARCHITECTURE.md §9 item 5), not a bug, and
 * the screen must say the sentence that unblocks it: an Executive Admin records the
 * acknowledgement. Every OTHER denial renders as not-found, never "forbidden" — saying
 * forbidden would confirm that a named scholar has a record (CONVENTIONS.md §4.3).
 */
export type MemberRecordDenial = "missing_acknowledgement" | "not_found";
