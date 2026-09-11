-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0064_second_factor_backstop.sql
--
-- WHAT:      The database now requires aal2 (a satisfied second factor) for every path
--            that returns a scholar's PII or changes a record. Three mechanisms:
--              1. `assert_confidentiality_ack()` (0012) gains an aal2 check, so every RPC
--                 that already calls it — get_person_sensitive, get_member_record,
--                 get_application_detail, get_renewal_detail, list_region_member_contacts,
--                 get_campaign_recipients, log_document_view, log_renewal_document_view,
--                 update_member_record — refuses an aal1 caller.
--              2. Nine SECURITY DEFINER functions that do NOT call that helper are moved
--                 into a non-exposed `private` schema and fronted by a thin `public`
--                 wrapper of the identical signature that enforces aal2 (and, for the two
--                 that return member emails, a confidentiality acknowledgement and an audit
--                 row). resolve_recipients, claim_campaign_batch, send_campaign,
--                 finish_recipient, approve_application, reject_application,
--                 approve_renewal, reject_renewal, approve_all_pending.
--              3. A RESTRICTIVE `has_aal2()` write policy on every table with a privileged
--                 INSERT/UPDATE policy, so a direct PostgREST PATCH/POST from an aal1
--                 session is refused even though the definers are bypassed by it.
--            confidentiality_acknowledgements_insert additionally pins recorded_by to the
--            caller.
--
-- WHY:       QA 2026-09-11 (AUTH-01..05, AUTH-16, RLS-01, CAMPAIGNS-01, VERIFY-AUTH-V01,
--            VERIFY-CAMPAIGNS-V01). MFA was enforced ONLY in middleware — the UX layer —
--            while `has_aal2()` guarded just five write policies. A PostgREST call never
--            passes through middleware, so a session holding only a password (the demo
--            passwords are committed to a public repo) could read or alter real member PII
--            at aal1. PRD US-A3 makes 2FA mandatory above Member tier; ARCHITECTURE.md §5
--            claims the database backstop "holds even if the API is called directly" — this
--            migration is what makes that claim true rather than aspirational.
--
-- WHY THE WRAPPER PATTERN, NOT A REWRITE: adding a guard to a plpgsql function means
--            reproducing its whole body, and there is no local Postgres here (no Docker) to
--            catch a transcription error in, e.g., the member-ID minting inside
--            approve_application. `alter function ... set schema private` + `rename to
--            _impl` moves the vetted body UNTOUCHED out of the API surface, and a small
--            public wrapper of the same name/signature/return type adds the guard. Because
--            PostgREST and `supabase gen types` see only the `public` schema, the wrapper
--            signatures are identical to the originals, so database.types.ts does NOT
--            change. The private impls keep their `set search_path = ''` and their fully
--            qualified `public.` references, so they resolve exactly as before.
--
-- WHY RESTRICTIVE POLICIES, NOT AN EDIT PER POLICY: appending `and has_aal2()` to ~20
--            existing write policies would mean retyping every predicate by hand with no
--            way to run pgTAP locally. A RESTRICTIVE policy ANDs with the permissive ones
--            without touching them. It is scoped to `for insert`/`for update` only —
--            NEVER `for all` — because a restrictive clause on SELECT would gate reads on
--            aal2 too, which 031_aal2_rls.sql documents as deliberately wrong (the
--            enrolment screen must still resolve who is calling). Reads stay gated by ROLE;
--            writes and PII-returning RPCs by role AND aal2.
--
-- NOT GATED, ON PURPOSE: search_member_directory (SECURITY INVOKER, non-sensitive columns
--            only — the officer directory) and the terms/user_roles/application_windows
--            reads the enrolment screen needs. The MFA enrol/verify, password reset and job
--            endpoints call none of the functions touched here.
--
-- DIVERGENCE FROM THE APPROVED PLAN, STATED: the plan also said "forbid self-attestation"
--            on confidentiality_acknowledgements_insert. Dropped deliberately — an
--            acknowledgement IS a self-declaration that the paper agreement was signed, and
--            with aal2 required (restrictive policy) and recorded_by pinned to the caller,
--            a lone exec_admin filing their own row is legitimate, not the abuse
--            VERIFY-AUTH-V01 described (that was aal1 + a forged recorded_by). Forbidding it
--            would strand a single sitting exec_admin at term start.
--
-- ROLLBACK:  forward-only. To reverse, a later migration would move the impls back to
--            public and drop the wrappers/policies; do not edit this file.
--
-- PRD:       US-A3, US-A4, US-J1, US-J5, US-D5/D6.  ADR: extends ADR 0003's aal2 posture.
-- ═══════════════════════════════════════════════════════════════════════════════════

create schema if not exists private;
-- Not in config.toml's exposed `schemas`, so nothing here is reachable through PostgREST.
-- No USAGE granted to anon/authenticated: only the wrapper functions (owned by the
-- migration role) can reach what lands in it.
revoke all on schema private from public;

-- ── 1. The read chokepoint ──────────────────────────────────────────────────────────
-- Adds the aal2 refusal AHEAD of the acknowledgement check so an aal1 caller gets the
-- second-factor message, and a caller past aal2 still gets the distinct, actionable
-- acknowledgement message when that is what is missing. Every sensitive-column RPC calls
-- this, so one edit gates them all (AUTH-01/02/04, RLS-01). The role guards inside those
-- RPCs already exclude `member`, so no member exception is needed here.
create or replace function public.assert_confidentiality_ack() returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_aal2() then
    raise exception
      'this action requires a second authentication factor (aal2); sign in and complete your two-factor challenge (PRD US-A3)'
      using errcode = '42501';
  end if;
  if not public.has_confidentiality_ack() then
    raise exception
      'confidentiality acknowledgement for the current term is not on file for this account (CBL Art. VIII §7.1); an Executive Admin must record it before sensitive member data can be read'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.assert_confidentiality_ack() is
  'Raises 42501 unless the caller has satisfied their second factor (aal2, PRD US-A3) AND '
  'holds a current-term confidentiality acknowledgement (CBL Art. VIII §7.1). Distinct, '
  'actionable messages for each. Called by every RPC that returns a sensitive column.';

-- ── 2. Move the nine unguarded definers to `private`, front them with aal2 wrappers ──
-- Move + rename first (bodies untouched), then create the wrappers, then re-grant. plpgsql
-- late-binds names, so the temporary absence of public.approve_application while it is
-- being moved does not invalidate approve_all_pending's body — and approve_all_pending's
-- own `public.approve_application(...)` call resolves to the wrapper once created.

alter function public.approve_application(uuid)            set schema private;
alter function private.approve_application(uuid)           rename to approve_application_impl;
alter function public.reject_application(uuid, text)       set schema private;
alter function private.reject_application(uuid, text)      rename to reject_application_impl;
alter function public.approve_renewal(uuid)                set schema private;
alter function private.approve_renewal(uuid)               rename to approve_renewal_impl;
alter function public.reject_renewal(uuid, text)           set schema private;
alter function private.reject_renewal(uuid, text)          rename to reject_renewal_impl;
alter function public.approve_all_pending()                set schema private;
alter function private.approve_all_pending()               rename to approve_all_pending_impl;
alter function public.send_campaign(uuid)                  set schema private;
alter function private.send_campaign(uuid)                 rename to send_campaign_impl;
alter function public.finish_recipient(uuid, boolean, text, text)  set schema private;
alter function private.finish_recipient(uuid, boolean, text, text) rename to finish_recipient_impl;
alter function public.claim_campaign_batch(uuid, int)      set schema private;
alter function private.claim_campaign_batch(uuid, int)     rename to claim_campaign_batch_impl;
alter function public.resolve_recipients(jsonb)            set schema private;
alter function private.resolve_recipients(jsonb)           rename to resolve_recipients_impl;

-- Nobody but the wrappers (which run as the owner) may reach the impls.
revoke all on function private.approve_application_impl(uuid)              from public, anon, authenticated;
revoke all on function private.reject_application_impl(uuid, text)         from public, anon, authenticated;
revoke all on function private.approve_renewal_impl(uuid)                  from public, anon, authenticated;
revoke all on function private.reject_renewal_impl(uuid, text)             from public, anon, authenticated;
revoke all on function private.approve_all_pending_impl()                  from public, anon, authenticated;
revoke all on function private.send_campaign_impl(uuid)                    from public, anon, authenticated;
revoke all on function private.finish_recipient_impl(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function private.claim_campaign_batch_impl(uuid, int)        from public, anon, authenticated;
revoke all on function private.resolve_recipients_impl(jsonb)              from public, anon, authenticated;

-- A single guard clause, repeated in each wrapper. Kept inline (not a helper) so no new
-- public function is added and database.types.ts stays unchanged.
--   aal2:  raise 42501 unless has_aal2().

create or replace function public.approve_application(p_app_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_aal2() then
    raise exception 'this action requires a second authentication factor (aal2)' using errcode = '42501';
  end if;
  return private.approve_application_impl(p_app_id);
end;
$$;

create or replace function public.reject_application(p_app_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_aal2() then
    raise exception 'this action requires a second authentication factor (aal2)' using errcode = '42501';
  end if;
  perform private.reject_application_impl(p_app_id, p_reason);
end;
$$;

create or replace function public.approve_renewal(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_aal2() then
    raise exception 'this action requires a second authentication factor (aal2)' using errcode = '42501';
  end if;
  return private.approve_renewal_impl(p_id);
end;
$$;

create or replace function public.reject_renewal(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_aal2() then
    raise exception 'this action requires a second authentication factor (aal2)' using errcode = '42501';
  end if;
  perform private.reject_renewal_impl(p_id, p_note);
end;
$$;

create or replace function public.approve_all_pending() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_aal2() then
    raise exception 'this action requires a second authentication factor (aal2)' using errcode = '42501';
  end if;
  return private.approve_all_pending_impl();
end;
$$;

create or replace function public.send_campaign(p_campaign_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_aal2() then
    raise exception 'this action requires a second authentication factor (aal2)' using errcode = '42501';
  end if;
  return private.send_campaign_impl(p_campaign_id);
end;
$$;

create or replace function public.finish_recipient(
  p_recipient_id uuid, p_ok boolean, p_provider_id text default null, p_error text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_aal2() then
    raise exception 'this action requires a second authentication factor (aal2)' using errcode = '42501';
  end if;
  perform private.finish_recipient_impl(p_recipient_id, p_ok, p_provider_id, p_error);
end;
$$;

-- claim_campaign_batch and resolve_recipients return frozen member EMAILS, so their
-- wrappers add the confidentiality gate (which now also enforces aal2) and one audit row
-- per call — the read was previously unguarded and untraced (AUTH-03, CAMPAIGNS-01,
-- VERIFY-CAMPAIGNS-V01).
create or replace function public.claim_campaign_batch(p_campaign_id uuid, p_limit int default 50)
returns table (recipient_id uuid, to_email text, merge jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_confidentiality_ack();
  insert into public.audit_log (actor_user_id, actor_role, table_name, row_id, operation, note)
  values ((select auth.uid()), coalesce(public.auth_role()::text, 'system'), 'email_recipients',
          p_campaign_id, 'VIEW_RECIPIENTS', 'frozen recipient batch claimed for delivery');
  return query select * from private.claim_campaign_batch_impl(p_campaign_id, p_limit);
end;
$$;

-- resolve_recipients is called inside send_campaign_impl's `insert into email_recipients
-- ... select ... from public.resolve_recipients(...)`. So its wrapper stays READ-ONLY: a
-- bare `perform assert_confidentiality_ack()` only RAISEs (aal2 + acknowledgement), it
-- never writes, so there is no data-modifying statement inside a function used in a FROM
-- clause. The send is audited by send_campaign_impl's own CAMPAIGN_QUEUED row; the
-- previously-unaudited stand-alone read is claim_campaign_batch, handled above.
create or replace function public.resolve_recipients(p_filter jsonb default '{}'::jsonb)
returns table (person_id uuid, email text, merge jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_confidentiality_ack();
  return query select * from private.resolve_recipients_impl(p_filter);
end;
$$;

-- Wrapper grants mirror the originals exactly: revoke the PUBLIC default and anon, grant
-- authenticated. send_campaign_impl calls resolve_recipients as the owner, so the owner
-- reaches it regardless of these grants.
revoke execute on function public.approve_application(uuid)                from public, anon; grant execute on function public.approve_application(uuid)                to authenticated;
revoke execute on function public.reject_application(uuid, text)           from public, anon; grant execute on function public.reject_application(uuid, text)           to authenticated;
revoke execute on function public.approve_renewal(uuid)                    from public, anon; grant execute on function public.approve_renewal(uuid)                    to authenticated;
revoke execute on function public.reject_renewal(uuid, text)               from public, anon; grant execute on function public.reject_renewal(uuid, text)               to authenticated;
revoke execute on function public.approve_all_pending()                    from public, anon; grant execute on function public.approve_all_pending()                    to authenticated;
revoke execute on function public.send_campaign(uuid)                      from public, anon; grant execute on function public.send_campaign(uuid)                      to authenticated;
revoke execute on function public.finish_recipient(uuid, boolean, text, text) from public, anon; grant execute on function public.finish_recipient(uuid, boolean, text, text) to authenticated;
revoke execute on function public.claim_campaign_batch(uuid, int)          from public, anon; grant execute on function public.claim_campaign_batch(uuid, int)          to authenticated;
revoke execute on function public.resolve_recipients(jsonb)                from public, anon; grant execute on function public.resolve_recipients(jsonb)                to authenticated;

-- ── 3. confidentiality_acknowledgements_insert: pin recorded_by to the caller ─────────
-- The aal2 requirement is supplied by the restrictive policy below. Here the honesty fix:
-- the filer named in recorded_by must be the account doing the insert (VERIFY-AUTH-V01,
-- RLS-06).
drop policy confidentiality_acknowledgements_insert on public.confidentiality_acknowledgements;
create policy confidentiality_acknowledgements_insert on public.confidentiality_acknowledgements
  for insert to authenticated
  with check (
    public.auth_role() = 'exec_admin'
    and recorded_by = (select auth.uid())
  );

-- ── 4. RESTRICTIVE aal2 write policies ────────────────────────────────────────────────
-- One per (table, command) on every table that already has a permissive privileged
-- INSERT/UPDATE policy. Tables whose writes already carry has_aal2() inline (terms,
-- application_windows, user_roles, rr_region_grants, privacy_notice_versions) are omitted.
-- Tables written only through SECURITY DEFINER functions (renewal_submissions,
-- email_recipients, people-insert) need none — the definer wrappers above carry the check.
-- for insert/update ONLY, never for all: a restrictive SELECT clause would break aal1 reads.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('people',                          false, true ),
      ('memberships',                     true,  true ),
      ('member_affiliations',             true,  true ),
      ('departments',                     true,  true ),
      ('committees',                      true,  true ),
      ('department_assignments',          true,  true ),
      ('committee_memberships',           true,  true ),
      ('officer_assignments',             true,  true ),
      ('confidentiality_acknowledgements',true,  false),
      ('applications',                    false, true ),
      ('email_campaigns',                 true,  true ),
      ('affiliations',                    true,  true ),
      ('programs',                        true,  true ),
      ('universities',                    true,  true ),
      ('regions',                         true,  true ),
      ('officer_positions',               true,  true )
    ) as t(tbl text, has_ins boolean, has_upd boolean)
  loop
    if r.has_ins then
      execute format(
        'create policy %I on public.%I as restrictive for insert to authenticated with check (public.has_aal2())',
        r.tbl || '_ins_aal2', r.tbl);
    end if;
    if r.has_upd then
      execute format(
        'create policy %I on public.%I as restrictive for update to authenticated using (public.has_aal2()) with check (public.has_aal2())',
        r.tbl || '_upd_aal2', r.tbl);
    end if;
  end loop;
end;
$$;
