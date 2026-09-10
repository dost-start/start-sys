-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0061_revoke_anon_table_grants.sql
-- WHAT:      Revokes the leftover default SELECT privilege `anon` still holds on
--            `memberships`, `user_roles` and `confidentiality_acknowledgements`.
-- WHY:       Supabase grants ALL on every new table in `public` to `anon` and
--            `authenticated` by default. `0015_grants.sql` revoked that for `people` and
--            `member_id_counters`, and revoked DELETE everywhere — but these three were
--            created in `0004`, `0006` and `0007` and never had their SELECT taken back.
--
--            NOTHING LEAKS TODAY and nothing ever did: probed with the anon key on
--            2026-09-10, all three return `200 []`. RLS holds, because no policy names
--            `anon`. This is the braces to that belt.
--
--            The distinction is worth stating plainly, because "RLS already covers it" is
--            the argument for not bothering. A missing GRANT fails CLOSED at the privilege
--            layer with `42501` before a policy is ever consulted. A present GRANT with no
--            matching policy fails closed only as long as the policy set stays correct —
--            so a future policy widened one clause too far becomes reachable BY AN
--            ANONYMOUS CALLER on `user_roles` (who holds which role) or on
--            `confidentiality_acknowledgements` (who may read PII). With the GRANT gone,
--            the same mistake is a 401 to a stranger and a bug for a logged-in user.
--
-- NOT INCLUDED, DELIBERATELY:
--            · `applications` — `anon` KEEPS both INSERT and SELECT. `0027` asserts this
--              at migration time and `0008`'s header explains it: the public form needs
--              INSERT, and SELECT returning zero rows (rather than 42501) is what makes a
--              duplicate submission indistinguishable from a first one. Revoking it would
--              turn the anti-enumeration design into an email oracle.
--            · `audit_log` — SELECT stays for the same "no policy, zero rows" reason;
--              `0011` already revoked UPDATE and DELETE from anon, authenticated AND
--              service_role, which is the guarantee that matters there.
--
-- CITATION:  QA 2026-09-10 ISSUE-011; DATA_MODEL.md §9; CLAUDE.md "deny by default".
-- ROLLBACK:  Forward-only. To undo, grant SELECT back explicitly — but read the paragraph
--            above first, because nothing in the app needs it.
-- ═══════════════════════════════════════════════════════════════════════════════════

revoke select on public.memberships from anon;
revoke select on public.user_roles from anon;
revoke select on public.confidentiality_acknowledgements from anon;

-- Belt for the braces: `anon` should hold no INSERT/UPDATE on these either. Revoking is a
-- no-op where it was never granted, and cheap insurance where a default slipped through.
revoke insert, update on public.memberships from anon;
revoke insert, update on public.user_roles from anon;
revoke insert, update on public.confidentiality_acknowledgements from anon;
