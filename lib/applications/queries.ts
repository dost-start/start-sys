// ─────────────────────────────────────────────────────────────────────────────
// Reads for the application feature.
//
// ⚠ SCOPE: this module holds the ONE read the PUBLIC portal needs. The reviewer reads —
// `listApplications`, `getApplicationDetail`, `countPendingApplications`, `getProofRef` —
// belong to S4-T14 and land in this same file then. They are deliberately absent now
// rather than stubbed: a stub reads as coverage that does not exist, and `applications`
// currently has no reviewer-facing column GRANT anyway (0008's header hands that to
// S4-T4's 0027_applications_review_grants.sql).
//
// Every read here goes through the caller's own client. On `/apply` that caller holds no
// session, so the statement runs as the `anon` database role and the anon policies are
// what decide the answer.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";

export type PublicWindowState = {
  /** Whether the membership-application form may be submitted right now. */
  open: boolean;
  /** `opens_at` of the open window, or `null`. See the note below about closed windows. */
  opensAt: string | null;
  /** `closes_at` of the open window, or `null`. */
  closesAt: string | null;
};

const CLOSED: PublicWindowState = { open: false, opensAt: null, closesAt: null };

/**
 * Is the public application period open, and until when? (PRD US-B4, item 5.)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * A DELIBERATE LIMITATION, STATED SO IT IS NOT DEBUGGED AS A BUG
 * ═══════════════════════════════════════════════════════════════════════════════
 * `application_windows_read_anon` (0014) is `using (now() between opens_at and
 * closes_at)`. An anonymous visitor can therefore see a window ONLY WHILE IT IS OPEN.
 * When the period is closed this function returns `{ open: false, null, null }` and
 * genuinely cannot say when applications next open — the row exists but anon cannot
 * read it.
 *
 * That is the correct trade and it must not be "fixed" by widening the anon policy:
 * that same policy is EXISTS-checked from inside the anon INSERT policy on
 * `applications`, so widening it would make a bookmarked `/apply` link submittable
 * outside the period. If the closed-state screen must announce a future opening date,
 * the answer is a separate, deliberately-published value — not a wider read.
 *
 * The open/closed decision is a DATABASE FACT either way. This function drives what the
 * page renders; the policy is what refuses the write (ARCHITECTURE.md §5 — the hidden
 * link is never the enforcement).
 */
export async function getPublicWindowState(): Promise<PublicWindowState> {
  const supabase = await createServerSupabase();

  const { data: termId, error: termError } = await supabase.rpc("current_term_id");
  if (termError || !termId) return CLOSED;

  const { data, error } = await supabase
    .from("application_windows")
    .select("opens_at, closes_at")
    .eq("term_id", termId)
    .eq("form_kind", "membership_application")
    .maybeSingle();

  // An RLS-filtered empty result is an ordinary outcome here, not an error: it is
  // exactly what "the period is closed" looks like to an anonymous caller.
  if (error || !data) return CLOSED;

  return { open: true, opensAt: data.opens_at, closesAt: data.closes_at };
}
