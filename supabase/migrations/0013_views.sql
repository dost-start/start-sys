-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0013_views.sql
--
-- WHAT:      v_member_directory — the read surface for the Officer and Regional
--            Representative tiers. Thirteen columns, and not one of them is sensitive.
--
-- WHY:       **RLS IS ROW-LEVEL AND CANNOT PROTECT A COLUMN.** A policy that lets an
--            officer read a `memberships` row does nothing whatsoever to stop a
--            hand-written `select birthdate from people` in the same session. Column
--            protection is a SECOND, SEPARATE mechanism, and it is drawn twice on purpose
--            (ARCHITECTURE.md §5, "Column protection"):
--              1. this view, which is the shape every officer/RR screen consumes, and
--              2. the column-level GRANT on public.people in 0015_grants.sql, which is
--                 what actually refuses the hand-written query.
--            The view is the ergonomics; the GRANT is the enforcement. Neither is
--            sufficient alone, and neither may be widened to make a screen work.
--
-- CITATION:  DATA_MODEL.md §6/0013; ARCHITECTURE.md §5; PRD §3 v1.0 items 12, 14, 15;
--            PRD US-D2 ("the officer view excludes sensitive personal data"), US-F1,
--            US-I2, US-I3, US-J1; PRD §6 Success Metric 8 ("0 sensitive fields returned
--            to Officer or RR tiers"); CBL Art. VIII §6 (RA 10173 as a constitutional
--            obligation) and §7.1.4 ("private member data" designated confidential).
--
-- v_email_merge_fields IS DELIBERATELY ABSENT. DATA_MODEL.md §6/0013 defines it beside
--            this view, but campaigns are PRD v1.1 items 20-26 and nothing in v1.0 sends
--            mail. Creating the merge whitelist now would ship an unused, untested read
--            surface over PII-adjacent columns during the exact week nobody is looking at
--            it. It lands with 0010_email.sql in the outreach slice, where its pgTAP
--            column-set assertion lands too (BUILD_PLAN S2-T10, Scope honesty).
--
-- ROLLBACK:  Forward-only. Dropping this view breaks every officer and RR screen; the
--            corrective action is a new migration that recreates it, never an edit here.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── v_member_directory ─────────────────────────────────────────────────────────────
-- WHAT IS NOT HERE, AND THIS LIST IS THE POINT:
--   birthdate, contact_number, personal_email, address_line, city_municipality,
--   province, postal_code, school, school_id_no, middle_name  — the RA 10173 sensitive
--   block on public.people (0004), reachable only through get_person_sensitive() (0012),
--   which is role-guarded, gated on a current-term confidentiality acknowledgement
--   (CBL Art. VIII §7.1) and audited on every call.
--   proof_drive_file_id / proof_web_view_link — a Certificate of Registration carries a
--   student number, an address and a signature. No Drive pointer appears in any view.
--
-- **Adding a column here is how Success Metric 8 becomes false with every test still
-- green.** 018_v_member_directory.sql pins the exact 13 names with columns_are(), so a
-- fourteenth column fails CI rather than reaching a screen. If an officer screen "needs"
-- a sensitive field, the answer is that the officer does not get it (PRD OQ-6, default
-- no); if a committee head genuinely needs contact details, that is a SCOPED ADDITIONAL
-- view over one committee, never a widening of this one (PRD v2 item 34).
--
-- security_barrier = true
--   Stops a caller from smuggling a cheap, leaky function into a WHERE clause and having
--   the planner evaluate it BEFORE the view's own qualifiers — the classic way to read
--   rows through a restricting view one error message at a time.
--
-- security_invoker = true
--   THE LOAD-BEARING CLAUSE. The view runs with the CALLER's privileges, so both the RLS
--   policies on memberships/people AND the column-level GRANTs still apply THROUGH it.
--   Without it the view would execute as its owner (the migration role, which holds
--   BYPASSRLS) and every officer would read every region — a total scope failure that
--   produces no error and looks correct to whoever is testing as an admin.
--   **This is why there is no SECURITY DEFINER "directory RPC" anywhere in this schema:
--   scoping is inherited from the policies, never restated in a second permission model
--   that can drift from the first.** Same reasoning as ADR 0008 for the dashboard
--   aggregates.
--
-- The two LEFT JOINs are LEFT on purpose: a member with no committee and no department is
-- still a member and must appear in the directory. The cost is that a member sitting on
-- two committees yields two rows — real, and the caller's problem to aggregate.
-- search_member_directory() (0030) GROUPs and array_aggs for exactly this reason;
-- anything paginating over this view directly must dedupe or it will miscount.
create view public.v_member_directory
with (security_barrier = true, security_invoker = true) as
select
  m.id            as membership_id,
  p.id            as person_id,
  p.member_id,
  p.given_name,
  p.family_name,
  p.join_year,
  m.term_id,
  m.status,
  m.year_level,
  r.name          as region_name,
  r.island_group,
  c.name          as committee_name,
  d.name          as department_name
from public.memberships m
join public.people  p on p.id = m.person_id
join public.regions r on r.id = m.region_id
left join public.committee_memberships  cm on cm.membership_id = m.id
left join public.committees             c  on c.id  = cm.committee_id
left join public.department_assignments da on da.membership_id = m.id
left join public.departments            d  on d.id  = da.department_id;

comment on view public.v_member_directory is
  'The Officer and Regional Representative read surface: exactly 13 non-sensitive columns. '
  'security_invoker = true, so RLS and the column GRANTs apply through it and regional '
  'scoping is INHERITED rather than restated. Never add a sensitive column here — '
  'PRD US-D2, US-J1, Success Metric 8; CBL Art. VIII §7.1.4.';

-- ── grants ─────────────────────────────────────────────────────────────────────────
-- Explicit rather than inherited. Supabase's default privileges grant ALL on new objects
-- in `public` to anon and authenticated, so an un-revoked view is an anonymously readable
-- member directory — PRD US-A1: no organizational record reaches an unauthenticated
-- caller, ever. Revoking anon here rather than relying on 0015 keeps the object and its
-- grant in one file, and re-revoking in 0015 is harmless.
--
-- `grant select to authenticated` is not a widening: security_invoker means the caller
-- still needs their own privileges on people/memberships/regions and still faces the RLS
-- policies, so an officer gets the officer's rows and a regional rep gets one region.
revoke all     on public.v_member_directory from anon;
grant  select  on public.v_member_directory to   authenticated;
