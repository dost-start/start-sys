// ─────────────────────────────────────────────────────────────────────────────
// Hand-written shapes shared by the server reads (`queries.ts`, server-only) and the
// client composer. Kept apart from `queries.ts` so a `'use client'` file never imports a
// server-only module for a type (CONVENTIONS §1.3). Nothing here carries an address.
// ─────────────────────────────────────────────────────────────────────────────

export type AudiencePreview = {
  count: number;
  /** Up to five "Family, Given · Region" lines. Names only — never an address. */
  sample: string[];
};

export type AudienceOptions = {
  regions: Array<{ id: string; name: string; island_group: string }>;
  affiliations: Array<{ id: string; name: string }>;
  positions: Array<{ code: string; title: string }>;
  joinYears: number[];
  /** Current-term departments and committees (term-scoped rows, DATA_MODEL §2). */
  departments: Array<{ id: string; name: string }>;
  committees: Array<{ id: string; name: string }>;
  /** Active universities, by name. */
  universities: Array<{ id: string; name: string }>;
};

/**
 * One row of the composer's people picker — what `list_audience_candidates()` returns.
 * Name, member ID, where they sit. NEVER an email address: the address leaves the
 * database only as a frozen recipient row, at send time.
 */
export type AudienceCandidate = {
  person_id: string;
  given_name: string;
  family_name: string;
  member_id: string | null;
  region_name: string;
  department_name: string | null;
  committee_name: string | null;
  position_title: string | null;
  status: string;
};

export type AudienceCandidatePage = {
  rows: AudienceCandidate[];
  /** Everyone the filter axes match (ignores the selection keys), across all pages. */
  total: number;
  page: number;
};
