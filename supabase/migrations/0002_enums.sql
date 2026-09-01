-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0002_enums.sql
--
-- WHAT:      All ten enum types, in one file.
--
-- WHY ONE FILE: `ALTER TYPE ... ADD VALUE` must be its own migration, and the new value
--            cannot be used until a migration *after* that one (CONVENTIONS.md §3.4).
--            Splitting the enums across files buys nothing and costs a round trip every
--            time two of them need to change together.
--
-- CITATION:  DATA_MODEL.md §3 (transcribed, including the inline CBL citations, which are
--            part of the definition and not decoration). START-DOST Constitution and
--            By-Laws 2026: Art. VI (Separation from Office) and Art. VII (Membership)
--            are two different régimes and get two different enums on two different
--            tables — DATA_MODEL.md §3.1 and §3.4, CLAUDE.md banned patterns.
--
-- ROLLBACK:  Forward-only. A dropped enum takes every column that uses it. Amending the
--            Constitution (CBL Art. XII) lands as a new migration citing the amendment.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- The seven access tiers. PRD §2; ARCHITECTURE.md §5.
-- 'crrd_admin' is the CCDO (Chief Community Development Officer, head of the
-- Community & Regional Relations Department) only. The DCCDO-C, DCCDO-D and DCTO-PD hold
-- 'moderator': the day-to-day operating tier (review applications, update member
-- records, send campaigns) with no structural or access-control powers.
-- Administrators, per the project heads (2026-09-01): CEO, COO (exec_admin),
-- CTO (tech_admin), CCDO (crrd_admin). Nobody else — enforced by the admin_is_c_suite
-- CHECK in 0003_reference.sql, not by this comment.
create type public.org_role as enum (
  'exec_admin',
  'tech_admin',
  'crrd_admin',
  'moderator',
  'officer',
  'regional_rep',
  'member'
);

-- Philippine geography. Three values, fixed; an enum rather than a table because nobody
-- will ever add a fourth island group through a UI (DATA_MODEL.md §1.1).
create type public.island_group as enum ('Luzon', 'Visayas', 'Mindanao');

create type public.term_status as enum ('draft', 'active', 'archived');

-- ── MEMBERSHIP: belonging to the organization. CBL Art. VII. ────────────────────────
create type public.membership_status as enum (
  'renewal_pending',
  'active',
  'graduated',
  'resigned',
  'left',
  'terminated'
);
-- 'terminated' is CBL Art. VII §3 -- removal from the organization by a majority vote
-- (50%+1) of the Executive Board. It is NOT the same event as 'left' (renewal declined
-- or lapsed) and NOT the same as an impeachment, which ends an OFFICE, not a membership.
-- There is deliberately no 'expired' or 'lapsed': CBL Art. VII §1 makes membership valid
-- "until the end of term as defined in Article V, Section 1", so membership expiring at
-- term end is the term-scoped row running out, not a status change (DATA_MODEL.md §3.1).

-- ── OFFICE: holding a position. CBL Art. VI is titled "Separation from Office" and ──
-- applies to Executive Board, Deputy Board and Committee members -- never to plain
-- membership. An impeached CTO is still a member (Art. VI §3.3 disqualifies them from
-- holding a POSITION, not from the organization).
create type public.officer_assignment_status as enum (
  'active',
  'on_leave',
  'suspended',
  'resigned',
  'dismissed',
  'impeached',
  'ended'
);
-- on_leave    Art. VI §1  -- approved LOA, max 30 days per term, approved by the CEO.
--             The 30-day cap is deliberately NOT enforced: leave is counted "Monday to
--             Saturday, excluding national holidays", and Philippine national holidays
--             are set by annual presidential proclamation (PRD US-E5, DATA_MODEL §3.4).
-- suspended   Art. VI §3.2.3 -- the accused "shall immediately be put on indefinite LOA,
--             without going through the processes defined in Article VI, Section 1",
--             until the case is resolved. A separate value precisely because the CBL
--             says it is not a §1 leave: it is indefinite and must not consume the cap.
-- resigned    Art. VI §2  -- voluntary, approved by the CEO (or Exec Board if the CEO).
-- dismissed   Art. VI §1.7 -- automatic dismissal after an unanswered AWOL notice.
-- impeached   Art. VI §3.2.7 -- majority vote of the Executive Board; ruling is "final
--             and irrevocable" (§3.2.8), so this value has no outbound edge at all.
-- ended       Art. V §1.3.3 death, Art. VI §4 permanent incapacity or analogous cause.
--             NOT ordinary term expiry -- that is terms.status = 'archived'.
-- There is NO 'vacant' value, and none may be added: CBL Art. VI §4 vacancy is the
-- ABSENCE of a sitting assignment for a (term, position), which is a query, not a state.
-- A row claiming someone holds a position nobody holds is a lie the schema must not be
-- able to tell (DATA_MODEL.md §3.4).

create type public.application_status as enum ('draft', 'pending', 'approved', 'rejected');

create type public.form_kind as enum (
  'membership_application',
  'committee_application',
  'membership_renewal',
  'freeform'
);

create type public.campaign_status as enum ('draft', 'queued', 'sending', 'sent', 'failed');

create type public.recipient_status as enum ('queued', 'sent', 'failed', 'suppressed');

create type public.email_event_type as enum (
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained'
);
