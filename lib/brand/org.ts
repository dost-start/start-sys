// Organization identity strings used by the brand components (landing, hero, footer)
// and the public pages. One place, so the tagline and the contact address cannot drift
// between the footer, the privacy notice and the closed-window screens.
//
// The tagline is the org wordmark's own wording ("…Advancement and Research for
// Technology"), per the logo file the org supplied on 2026-09-08.
//
// ⚠ THE CONTACT ADDRESS IS NOT HERE ANY MORE. It used to be a hardcoded mailbox on a
// domain START-DOST does not own (PRD OQ-10). It now lives in
// `lib/brand/org-contact.ts`, derived at request time from the mail environment, because
// the address a scholar is told to write to must be an address the org actually reads.
// This module stays free of `server-only` so a client component can still import the
// wordmark strings; that split is why the two files exist.

export const ORG_SHORT_NAME = "START-DOST";
export const ORG_SYSTEM_NAME = "START-SYS";
export const ORG_TAGLINE = "Scholars Transforming Advancement and Research for Technology";
export const ORG_SYSTEM_DESCRIPTION =
  "Centralized Membership Information Management System for START-DOST.";
export const ORG_COPYRIGHT_YEAR = 2026;
