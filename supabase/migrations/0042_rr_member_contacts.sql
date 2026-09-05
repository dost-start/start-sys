-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0042_rr_member_contacts.sql  —  the Regional Representative contact view (ADR 0011)
--
-- WHAT: list_region_member_contacts(p_university_id) — a SECURITY DEFINER read that
--   returns, for the caller's OWN region(s) and the CURRENT term only, each scholar's name,
--   member ID, status, university, personal email, contact number and Facebook link.
--   Regional Representatives only. Gated on the CBL Art. VIII §7.1 confidentiality
--   acknowledgement exactly like get_member_record(); ONE audit row per call
--   (operation VIEW_CONTACTS); optional university filter.
--
-- WHY: team decision, 2026-09-05 — "for rr … add email, school, fb account, and contact
--   number … for faster communication for regional representatives". This is a DELIBERATE
--   widening of PRD US-J1 / US-F1 / OQ-6, recorded as such in ADR 0011. Everything the
--   docs said about RRs seeing no contact data stays true of the TABLE surface: the 0015
--   column GRANT and v_member_directory are untouched, so a hand-written SELECT from a
--   rep session still gets six columns and a 42501 on the rest. The widening exists in
--   this one function, where it can be audited, gated and revoked.
--
-- WHY THE ACKNOWLEDGEMENT GATE APPLIES TO A REP. CBL Art. VIII §7.1 binds "all elected
--   and appointed officers" to the Confidentiality Agreement; an RR is an appointed
--   officer (Art. III §4.6). So a rep with no current-term acknowledgement — or with no
--   people row to hang one on — is refused with an ERROR, not an empty list (PRD US-J5).
--   That is the correct day-one state; the runbook says who records the acknowledgement.
--
-- WHAT IS DELIBERATELY NOT RETURNED: birthdate, address, school ID, the NOA — nothing the
--   meeting did not name. Committee and department are omitted on purpose ("remove
--   committee and department" — they are org structure, not contact information).
--
-- ROLLBACK: forward-only. Revoking the widening is `drop function`; nothing else changes.
-- ═══════════════════════════════════════════════════════════════════════════════════

create or replace function public.list_region_member_contacts(p_university_id uuid default null)
returns table (
  membership_id    uuid,
  person_id        uuid,
  member_id        text,
  given_name       text,
  family_name      text,
  status           public.membership_status,
  region_id        uuid,
  region_name      text,
  university_id    uuid,
  university_name  text,
  personal_email   text,
  contact_number   text,
  facebook_account text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  v_term uuid := public.current_term_id();
begin
  -- Regional Representatives ONLY. Administrators read contact data through the audited
  -- member-record RPCs; officers never do (PRD US-D2, OQ-6 default kept).
  if v_role is null or v_role <> 'regional_rep' then
    raise exception 'not authorized to read regional contact details'
      using errcode = '42501';
  end if;

  -- CBL Art. VIII §7.1 — no sensitive read without a current-term acknowledgement.
  perform public.assert_confidentiality_ack();

  if v_term is null then
    return;
  end if;

  -- RA 10173 / CBL Art. VIII §6: "who looked at this scholar's contact details, and when"
  -- must be answerable. One row per call, before any data is built; no value stored.
  insert into public.audit_log (
    actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note
  )
  values (
    (select auth.uid()),
    v_role::text,
    'memberships',
    null,
    'VIEW_CONTACTS',
    null,
    null,
    'regional contact list read via list_region_member_contacts()'
      || case when p_university_id is null then '' else ' (filtered by university)' end
  );

  -- Scope: the caller's region(s) — primary plus rr_region_grants — and the active term.
  -- The function adds this scoping itself because it bypasses RLS by construction; the
  -- predicate is the same one memberships_read uses for a rep.
  return query
  select m.id,
         p.id,
         p.member_id,
         p.given_name,
         p.family_name,
         m.status,
         m.region_id,
         r.name,
         p.university_id,
         u.name,
         p.personal_email::text,
         p.contact_number,
         p.facebook_account
  from public.memberships m
  join public.people   p on p.id = m.person_id
  join public.regions  r on r.id = m.region_id
  left join public.universities u on u.id = p.university_id
  where m.term_id   = v_term
    and m.region_id = any(public.auth_region_ids())
    and (p_university_id is null or p.university_id = p_university_id)
  order by p.family_name, p.given_name;
end;
$$;

comment on function public.list_region_member_contacts(uuid) is
  'ADR 0011 — the ONE place a Regional Representative reads contact details: name, '
  'member ID, status, university, personal email, contact number and Facebook link, for '
  'their own region(s) and the current term only. regional_rep only; gated on the CBL '
  'Art. VIII §7.1 acknowledgement; one VIEW_CONTACTS audit row per call; optional '
  'university filter. Column GRANTs and v_member_directory are unchanged — a direct '
  'SELECT from a rep still raises 42501 on every sensitive column.';

revoke execute on function public.list_region_member_contacts(uuid) from public;
revoke execute on function public.list_region_member_contacts(uuid) from anon;
grant  execute on function public.list_region_member_contacts(uuid) to   authenticated;
