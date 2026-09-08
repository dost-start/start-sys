-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0051_email_recipients_audited_read.sql
--
-- WHAT:      `email_recipients.to_email` and `.merge` — both registered SENSITIVE in
--            `sensitive_column_registry` since 0016/0043's own comment says so — become
--            reachable only through a new audited, acknowledgement-gated definer
--            function, `get_campaign_recipients()`. The blanket `grant select on
--            email_recipients to authenticated` (0043) is narrowed to the non-sensitive
--            columns; the sensitive two are no longer selectable directly at all.
--
-- WHY:       Found 2026-09-08, QA review of `main`. `email_recipients_read` (0043) let
--            any `crrd_admin`/`exec_admin` session read a batch of members' frozen
--            personal emails and names with a bare role check — no CBL Art. VIII §7.1
--            confidentiality-acknowledgement gate and no `audit_log` entry, unlike
--            EVERY other path to the same `personal_email` data in this codebase
--            (`get_member_record()`, `get_application_detail()`,
--            `list_region_member_contacts()`, `get_renewal_detail()` all enforce both).
--            `lib/campaigns/queries.ts`'s `listRecipients()` — the delivery-report UI,
--            PRD item 25 — was the one caller reading `to_email`/`merge` directly; it is
--            updated in the same PR to call the new RPC instead.
--
--            One audit row PER CALL, not per recipient row — matching `get_member_record`'s
--            shape: the question RA 10173 asks is "who opened this campaign's contact
--            list, and when", not "who saw which individual row of it".
--
-- ROLLBACK:  Forward-only; a later migration may `create or replace` this body again.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── 1 — narrow the column grant ─────────────────────────────────────────────────────
-- Mirrors 0015's treatment of `people`: revoke everything, grant back only what is not
-- registered sensitive. `to_email` and `merge` are deliberately absent from the list.
revoke select on public.email_recipients from authenticated;
grant  select (id, campaign_id, person_id, status, claimed_at, provider_message_id, error,
               sent_at, created_at)
  on public.email_recipients to authenticated;

-- ── 2 — the audited, acknowledgement-gated read ─────────────────────────────────────
create or replace function public.get_campaign_recipients(p_campaign_id uuid)
returns setof public.email_recipients
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
begin
  -- Same role set `email_campaigns_read`/`email_recipients_read` already use (0043) —
  -- this function does not widen who may see a campaign's recipients, only how the
  -- sensitive two columns are reached once they can.
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin') then
    raise exception 'not authorized to read campaign recipients'
      using errcode = '42501';
  end if;

  -- CBL Art. VIII §7.1, the same precondition every other sensitive-column path
  -- enforces. Raises with its own distinct message naming the missing acknowledgement.
  perform public.assert_confidentiality_ack();

  insert into public.audit_log (
    actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note
  )
  values (
    (select auth.uid()),
    v_role::text,
    'email_recipients',
    p_campaign_id,
    'VIEW_RECIPIENTS',
    null,
    null,
    'campaign recipient contacts opened via get_campaign_recipients()'
  );

  return query
    select * from public.email_recipients where campaign_id = p_campaign_id;
end;
$$;

comment on function public.get_campaign_recipients(uuid) is
  'Audited, acknowledgement-gated read of a campaign''s recipient rows, INCLUDING the '
  'sensitive to_email/merge columns 0051 withdrew from the plain table GRANT. One '
  'VIEW_RECIPIENTS audit row per call. crrd_admin/exec_admin only, matching '
  'email_recipients_read (0043).';

revoke execute on function public.get_campaign_recipients(uuid) from public;
revoke execute on function public.get_campaign_recipients(uuid) from anon;
grant  execute on function public.get_campaign_recipients(uuid) to   authenticated;
