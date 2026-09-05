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
};
