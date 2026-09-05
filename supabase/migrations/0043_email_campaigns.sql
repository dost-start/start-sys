-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0043_email_campaigns.sql  —  the campaign spine (PRD §3 v1.1 items 20–26; SRS "Email
-- Sending" and "Form Sending")
--
-- WHAT:
--   email_campaigns         one row per compose + send: template, subject, the body as the
--                           CRRD wrote it (markdown) and as it is sent (rendered, escaped
--                           HTML), the audience filter FROZEN at send, status, counts.
--   email_recipients        THE QUEUE IS THE ROWS (ARCHITECTURE.md §4.2). One per resolved
--                           person, address and merge payload frozen at enqueue,
--                           UNIQUE (campaign_id, person_id) so a double-clicked Send is a
--                           no-op. `claimed_at` is the drain's lease: a chunk is claimed,
--                           sent, then finished; a lease older than ten minutes is
--                           re-claimable, which is what makes a send that died mid-chunk
--                           resumable without a queue product.
--   v_email_merge_fields    the ONLY columns that can ever be mail-merged (DATA_MODEL.md
--                           §6/0013). A birthdate cannot leak into a bulk send because it
--                           is not in this view.
--   resolve_recipients()    the audience filter compiled once, used by the composer's live
--                           count AND by send_campaign() — the preview can never disagree
--                           with the send. SECURITY DEFINER, guarded to crrd_admin and
--                           exec_admin: DATA_MODEL.md wrote it as INVOKER so RLS would
--                           scope a rep, but the 0015 column GRANT withholds
--                           people.personal_email from every session, so an INVOKER
--                           function could never read an address. Regional-rep sending
--                           (PRD US-F3, rr_send_grants) is NOT in this migration.
--   send_campaign()         freezes the audience into recipient rows in one transaction.
--   claim_campaign_batch()  leases up to N queued rows to the calling drain.
--   finish_recipient()      records sent / failed per row and closes the campaign when
--                           nothing is left queued.
--
-- WHO: crrd_admin and exec_admin read and write campaigns ("CRRD can use the platform to
--   directly send emails" — SRS; the CEO/COO oversee records). Recipient rows are written
--   only by the three definers; no human role holds INSERT or UPDATE on them, so the
--   queue's state machine cannot be edited by hand. No DELETE anywhere.
--
-- WHAT IS NOT HERE: email_events / suppressions (the interim transport has no bounce
--   webhooks — ADR 0010), notifications (in-system delivery), rr_send_grants. Each is an
--   additive migration.
--
-- ROLLBACK: forward-only.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── tables ─────────────────────────────────────────────────────────────────────────
create table public.email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  term_id         uuid not null references public.terms(id),
  form_kind       public.form_kind not null default 'freeform',
  template_key    text not null,
  subject         text not null check (length(btrim(subject)) between 1 and 200),
  body_markdown   text not null check (length(body_markdown) between 1 and 20000),
  body_html       text not null,
  audience_filter jsonb not null default '{}'::jsonb,
  status          public.campaign_status not null default 'draft',
  recipient_count int not null default 0,
  sent_count      int not null default 0,
  failed_count    int not null default 0,
  created_by      uuid not null references auth.users(id),
  queued_at       timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index email_campaigns_term    on public.email_campaigns (term_id, created_at desc);
create index email_campaigns_open    on public.email_campaigns (status)
  where status in ('queued', 'sending');

comment on table public.email_campaigns is
  'One row per compose + send (PRD items 20-26). body_markdown is what the CRRD wrote; '
  'body_html is what is sent — rendered from the markdown with every value HTML-escaped, '
  'never raw HTML from the browser. audience_filter is frozen at send and is the exact '
  'input resolve_recipients() used, so the delivery report can be reproduced.';

create table public.email_recipients (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.email_campaigns(id),
  person_id           uuid not null references public.people(id),
  -- SENSITIVE (RA 10173): a frozen copy of contact data. Registered in 0016 ahead of time.
  to_email            citext not null,
  merge               jsonb not null,
  status              public.recipient_status not null default 'queued',
  claimed_at          timestamptz,
  provider_message_id text,
  error               text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (campaign_id, person_id)                 -- a double-clicked Send is a no-op
);

create index email_recipients_drain on public.email_recipients (campaign_id, claimed_at)
  where status = 'queued';

comment on table public.email_recipients is
  'THE QUEUE IS THE ROWS. One per resolved person; address and merge payload frozen at '
  'enqueue (both registered sensitive); UNIQUE (campaign_id, person_id). Written only by '
  'send_campaign(), claim_campaign_batch() and finish_recipient(). No Redis, no BullMQ, '
  'no QStash — nothing for the 2029 maintainer to find credentials for.';

-- ── RLS ────────────────────────────────────────────────────────────────────────────
alter table public.email_campaigns  enable row level security;
alter table public.email_campaigns  force  row level security;
alter table public.email_recipients enable row level security;
alter table public.email_recipients force  row level security;

revoke all on public.email_campaigns  from anon, authenticated;
revoke all on public.email_recipients from anon, authenticated;
grant select, insert, update on public.email_campaigns to authenticated;
grant select                 on public.email_recipients to authenticated;

-- why: SRS "CRRD can use the platform to directly send emails"; the CEO/COO oversee records.
create policy email_campaigns_read on public.email_campaigns
  for select to authenticated
  using (public.auth_role() in ('crrd_admin', 'exec_admin'));

create policy email_campaigns_insert on public.email_campaigns
  for insert to authenticated
  with check (public.auth_role() in ('crrd_admin', 'exec_admin')
              and created_by = (select auth.uid()));

-- A draft may be edited; status moves only through the definers below, which bypass this.
create policy email_campaigns_update on public.email_campaigns
  for update to authenticated
  using      (public.auth_role() in ('crrd_admin', 'exec_admin') and status = 'draft')
  with check (public.auth_role() in ('crrd_admin', 'exec_admin') and status = 'draft');

-- why: the delivery report (PRD item 25) — per-recipient sent/failed for the same tier
-- that sent. No INSERT or UPDATE policy: the queue's state machine is definer-only.
create policy email_recipients_read on public.email_recipients
  for select to authenticated
  using (public.auth_role() in ('crrd_admin', 'exec_admin'));

-- ── the merge-field whitelist ──────────────────────────────────────────────────────
-- Non-sensitive columns only. Adding a column here IS the review that decides whether
-- it may appear in a bulk send. security_invoker, so it reads as the caller; it is used
-- by the definers below, which read as owner.
create view public.v_email_merge_fields
  with (security_barrier, security_invoker = true) as
select p.id           as person_id,
       m.term_id,
       m.region_id,
       m.status,
       p.given_name,
       p.family_name,
       p.member_id,
       p.join_year,
       r.name         as region_name,
       r.island_group::text as island_group,
       t.label        as term_label,
       m.year_level,
       (select c.name
          from public.committee_memberships cm
          join public.committees c on c.id = cm.committee_id
         where cm.membership_id = m.id
         order by c.name limit 1) as committee_name,
       (select d.name
          from public.department_assignments da
          join public.departments d on d.id = da.department_id
         where da.membership_id = m.id
         order by d.name limit 1) as department_name
from public.memberships m
join public.people  p on p.id = m.person_id
join public.regions r on r.id = m.region_id
join public.terms   t on t.id = m.term_id;

comment on view public.v_email_merge_fields is
  'The ONLY columns that can ever be mail-merged (PRD US-G3). One row per membership; a '
  'member on two committees merges the first by name. No contact number, no birthdate, '
  'no address — they are not here, so they cannot leak into a bulk send.';

grant select on public.v_email_merge_fields to authenticated;

-- ── resolve_recipients ─────────────────────────────────────────────────────────────
-- Filter keys (all optional, all ANDed; every array is "any of"):
--   join_years int[]        PRD "year of membership"
--   region_ids uuid[]       PRD "region"
--   island_groups text[]    PRD "island group"
--   statuses text[]         default ['active'] — membership_status labels
--   affiliation_ids uuid[]  PRD "affiliation" (member_affiliations on the membership)
--   role_codes text[]       PRD "role" — officer_positions codes held this term
-- Always: memberships in the CURRENT term, people with an email on file, one row per person.
create or replace function public.resolve_recipients(p_filter jsonb default '{}'::jsonb)
returns table (person_id uuid, email text, merge jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role     public.org_role := public.auth_role();
  v_term     uuid := public.current_term_id();
  v_years    int[];
  v_regions  uuid[];
  v_islands  text[];
  v_statuses text[];
  v_affils   uuid[];
  v_roles    text[];
begin
  if v_role is null or v_role not in ('crrd_admin', 'exec_admin') then
    raise exception 'not authorized to resolve a recipient list' using errcode = '42501';
  end if;
  if v_term is null then
    return;
  end if;

  select array_agg((x)::int)  into v_years    from jsonb_array_elements_text(coalesce(p_filter->'join_years',      '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_regions  from jsonb_array_elements_text(coalesce(p_filter->'region_ids',      '[]'::jsonb)) as t(x);
  select array_agg(x)         into v_islands  from jsonb_array_elements_text(coalesce(p_filter->'island_groups',   '[]'::jsonb)) as t(x);
  select array_agg(x)         into v_statuses from jsonb_array_elements_text(coalesce(p_filter->'statuses',        '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_affils   from jsonb_array_elements_text(coalesce(p_filter->'affiliation_ids', '[]'::jsonb)) as t(x);
  select array_agg(x)         into v_roles    from jsonb_array_elements_text(coalesce(p_filter->'role_codes',      '[]'::jsonb)) as t(x);

  if v_statuses is null or cardinality(v_statuses) = 0 then
    v_statuses := array['active'];
  end if;

  return query
  select distinct on (p.id)
         p.id,
         p.personal_email::text,
         jsonb_build_object(
           'given_name',      f.given_name,
           'family_name',     f.family_name,
           'member_id',       f.member_id,
           'join_year',       f.join_year,
           'region_name',     f.region_name,
           'island_group',    f.island_group,
           'term_label',      f.term_label,
           'year_level',      f.year_level,
           'committee_name',  f.committee_name,
           'department_name', f.department_name
         )
  from public.memberships m
  join public.people p on p.id = m.person_id
  join public.regions r on r.id = m.region_id
  join public.v_email_merge_fields f on f.person_id = p.id and f.term_id = m.term_id
  where m.term_id = v_term
    and p.personal_email is not null
    and p.redacted_at is null
    and m.status::text = any(v_statuses)
    and (v_years   is null or cardinality(v_years)   = 0 or p.join_year = any(v_years))
    and (v_regions is null or cardinality(v_regions) = 0 or m.region_id = any(v_regions))
    and (v_islands is null or cardinality(v_islands) = 0 or r.island_group::text = any(v_islands))
    and (v_affils  is null or cardinality(v_affils)  = 0 or exists (
           select 1 from public.member_affiliations ma
            where ma.membership_id = m.id and ma.affiliation_id = any(v_affils)))
    and (v_roles   is null or cardinality(v_roles)   = 0 or exists (
           select 1 from public.officer_assignments oa
            where oa.person_id = p.id and oa.term_id = v_term
              and oa.status = 'active' and oa.role = any(v_roles)))
  order by p.id;
end;
$$;

comment on function public.resolve_recipients(jsonb) is
  'The audience filter, compiled once. The composer''s live count and send_campaign() '
  'call the SAME function, so the preview can never disagree with the send (PRD US-G2). '
  'crrd_admin / exec_admin only; current term; one row per person with an email on file. '
  'SECURITY DEFINER because the 0015 column GRANT withholds personal_email from every '
  'session (documented deviation from DATA_MODEL.md §4.2''s INVOKER sketch).';

-- ── send_campaign ──────────────────────────────────────────────────────────────────
create or replace function public.send_campaign(p_campaign_id uuid) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  c      public.email_campaigns;
  v_n    int;
begin
  if v_role is null or v_role not in ('crrd_admin', 'exec_admin') then
    raise exception 'not authorized to send a campaign' using errcode = '42501';
  end if;

  select * into c from public.email_campaigns where id = p_campaign_id for update;
  if c.id is null then
    raise exception 'campaign % not found', p_campaign_id using errcode = 'P0002';
  end if;
  if c.status not in ('draft', 'queued') then
    return c.recipient_count;   -- already sending or done: idempotent
  end if;

  -- Freeze the audience. ON CONFLICT DO NOTHING is what makes a double-clicked Send, or
  -- a retried request, add zero rows (PRD US-G4).
  insert into public.email_recipients (campaign_id, person_id, to_email, merge)
  select p_campaign_id, r.person_id, r.email, r.merge
  from public.resolve_recipients(c.audience_filter) r
  on conflict (campaign_id, person_id) do nothing;

  select count(*)::int into v_n from public.email_recipients where campaign_id = p_campaign_id;

  update public.email_campaigns
     set status = 'queued', recipient_count = v_n, queued_at = coalesce(queued_at, now())
   where id = p_campaign_id;

  -- PRD US-I1 names campaign sends among the significant actions; email_campaigns carries
  -- no row trigger, so the attribution is written here, value-free.
  insert into public.audit_log (actor_user_id, actor_role, table_name, row_id, operation, note)
  values ((select auth.uid()), v_role::text, 'email_campaigns', p_campaign_id, 'CAMPAIGN_QUEUED',
          format('%s recipient(s) queued', v_n));

  return v_n;
end;
$$;

comment on function public.send_campaign(uuid) is
  'Freezes the campaign''s audience into email_recipients rows in one transaction and '
  'marks it queued. Idempotent: UNIQUE (campaign_id, person_id) plus the status check make '
  'a retry add nothing. Writes one CAMPAIGN_QUEUED audit row. PRD US-G4.';

-- ── claim_campaign_batch ───────────────────────────────────────────────────────────
-- Leases up to p_limit queued rows to the caller. A lease expires after ten minutes, so
-- a drain that died mid-chunk leaves rows another drain will pick up (PRD US-G4: "a send
-- interrupted mid-way resumes and does not re-send to recipients already sent").
create or replace function public.claim_campaign_batch(p_campaign_id uuid, p_limit int default 50)
returns table (recipient_id uuid, to_email text, merge jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
begin
  if v_role is null or v_role not in ('crrd_admin', 'exec_admin') then
    raise exception 'not authorized to drain a campaign' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'claim_campaign_batch: p_limit must be between 1 and 100' using errcode = '22023';
  end if;

  update public.email_campaigns set status = 'sending'
   where id = p_campaign_id and status = 'queued';

  return query
  with picked as (
    select r.id
    from public.email_recipients r
    where r.campaign_id = p_campaign_id
      and r.status = 'queued'
      and (r.claimed_at is null or r.claimed_at < now() - interval '10 minutes')
    order by r.created_at
    limit p_limit
    for update skip locked
  ),
  leased as (
    update public.email_recipients r
       set claimed_at = now()
      from picked
     where r.id = picked.id
    returning r.id, r.to_email::text as to_email, r.merge
  )
  select l.id, l.to_email, l.merge from leased l;
end;
$$;

comment on function public.claim_campaign_batch(uuid, int) is
  'Leases up to p_limit queued recipient rows (claimed_at = now(); stale leases after ten '
  'minutes are re-claimable) and flips the campaign to sending. The rows are the queue; '
  'this is the dequeue. crrd_admin / exec_admin only.';

-- ── finish_recipient ───────────────────────────────────────────────────────────────
create or replace function public.finish_recipient(
  p_recipient_id uuid,
  p_ok           boolean,
  p_provider_id  text default null,
  p_error        text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role     public.org_role := public.auth_role();
  v_campaign uuid;
  v_left     int;
  v_sent     int;
  v_failed   int;
begin
  if v_role is null or v_role not in ('crrd_admin', 'exec_admin') then
    raise exception 'not authorized to drain a campaign' using errcode = '42501';
  end if;

  update public.email_recipients
     set status              = case when p_ok then 'sent'::public.recipient_status else 'failed'::public.recipient_status end,
         provider_message_id = case when p_ok then p_provider_id else provider_message_id end,
         error               = case when p_ok then null else left(coalesce(p_error, 'send failed'), 500) end,
         sent_at             = case when p_ok then now() else sent_at end,
         claimed_at          = null
   where id = p_recipient_id
     and status = 'queued'
  returning campaign_id into v_campaign;

  if v_campaign is null then
    return;   -- already finished (a retried drain); nothing to redo
  end if;

  select count(*) filter (where status = 'queued'),
         count(*) filter (where status = 'sent'),
         count(*) filter (where status = 'failed')
    into v_left, v_sent, v_failed
    from public.email_recipients where campaign_id = v_campaign;

  update public.email_campaigns
     set sent_count   = v_sent,
         failed_count = v_failed,
         status       = case when v_left > 0 then status
                             when v_sent = 0 and v_failed > 0 then 'failed'::public.campaign_status
                             else 'sent'::public.campaign_status end,
         sent_at      = case when v_left > 0 then sent_at else coalesce(sent_at, now()) end
   where id = v_campaign;
end;
$$;

comment on function public.finish_recipient(uuid, boolean, text, text) is
  'Records one recipient''s outcome (sent with the provider id, or failed with a short '
  'error — never the recipient''s address) and closes the campaign when no row is left '
  'queued. Idempotent on a row that is already finished. crrd_admin / exec_admin only.';

-- ── grants on the four functions ───────────────────────────────────────────────────
revoke execute on function public.resolve_recipients(jsonb)                       from public, anon;
revoke execute on function public.send_campaign(uuid)                             from public, anon;
revoke execute on function public.claim_campaign_batch(uuid, int)                 from public, anon;
revoke execute on function public.finish_recipient(uuid, boolean, text, text)     from public, anon;
grant  execute on function public.resolve_recipients(jsonb)                       to authenticated;
grant  execute on function public.send_campaign(uuid)                             to authenticated;
grant  execute on function public.claim_campaign_batch(uuid, int)                 to authenticated;
grant  execute on function public.finish_recipient(uuid, boolean, text, text)     to authenticated;
