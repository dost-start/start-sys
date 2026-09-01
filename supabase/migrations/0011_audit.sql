-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0011_audit.sql
--
-- WHAT:      The audit substrate, written before any audited table exists:
--              audit_log         append-only, enforced at the GRANT level
--              mask_sensitive()  redacts registered columns BEFORE they are written
--              audit_row()       the generic AFTER trigger function
--              set_updated_at()  the shared updated_at trigger function
--
-- WHY NOW:   PRD History NFR / US-I1 — "log significant administrative actions ...
--            including the user responsible". Trigger-based, never application-based, so
--            NO CODE PATH CAN SKIP IT; that is what makes "including the user
--            responsible" true rather than aspirational. Written on Day 1, before the
--            tables it will observe, so the audited set is opt-out by omission rather
--            than something bolted on afterwards (ARCHITECTURE.md §8, BUILD_PLAN S1-T14).
--
-- CITATION:  PRD §3 v1.0 item 16; PRD §5 US-I1; PRD §6 NFR register row 9 (Data Privacy);
--            DATA_MODEL.md §6/0011 and §8.3; CBL Art. VIII §6 (RA 10173 is a
--            constitutional obligation, not merely a statutory one).
--
-- NO TRIGGERS ARE ATTACHED HERE. Attaching the nine trg_<table>_audit triggers is
--            0012_functions.sql (BUILD_PLAN S2-T9), because CREATE TRIGGER resolves its
--            function at creation time and the tables do not exist yet.
--            audit_row()'s forward reference to public.auth_role() (which lands in 0012)
--            is safe: plpgsql bodies are not resolved until execution, and nothing
--            executes this function until a trigger is attached.
--
-- POLICIES:  The audit_log SELECT policy — exec_admin and tech_admin ONLY (US-I1: "the
--            log is readable only by Executive and Technical Admins") — is deferred to
--            0014_rls.sql per ADR 0002. There is deliberately NO UPDATE, DELETE or
--            INSERT policy, ever: the trigger inserts as a SECURITY DEFINER owned by a
--            BYPASSRLS role, and a forgeable audit row is worse than no audit row.
--
-- ROLLBACK:  Forward-only. Dropping audit_log destroys the record of record.
-- ═══════════════════════════════════════════════════════════════════════════════════

create table public.audit_log (
  id            bigserial primary key,
  actor_user_id uuid,                       -- null => system job (purge, rollover sweep)
  actor_role    text not null,
  table_name    text not null,
  row_id        uuid,
  operation     text not null,              -- INSERT | UPDATE | DELETE | VIEW_DOCUMENT | VIEW_RECORD | ROLLOVER | PURGE
  old_data      jsonb,                      -- sensitive keys masked AT WRITE TIME
  new_data      jsonb,
  note          text,
  created_at    timestamptz not null default now()
);

create index audit_log_row   on public.audit_log (table_name, row_id, created_at desc);
create index audit_log_actor on public.audit_log (actor_user_id, created_at desc);

-- Append-only is enforced at the GRANT level, which is the strong form: a policy added
-- by a careless migration in 2029 cannot re-open what has been revoked here.
-- NOT EVEN THE CEO CAN REWRITE HISTORY FROM THE APP.
revoke update, delete on public.audit_log from authenticated, anon, service_role;

alter table public.audit_log enable row level security;
alter table public.audit_log force  row level security;

-- ── mask_sensitive() ───────────────────────────────────────────────────────────────
-- The audit log must never become a PII backdoor. Every value whose column is listed in
-- sensitive_column_registry is replaced with a marker BEFORE the row is written, so the
-- log answers "who changed this scholar's contact number, and when" without STORING the
-- number. That is also what makes append-only compatible with the five-year purge: the
-- log holds no PII, so the purge never needs to reach into it, so nobody ever needs a
-- reason to grant UPDATE on it. RA 10173 / CBL Art. VIII §6. DATA_MODEL.md §8.3.
--
-- `language sql` bodies are validated at CREATE time, which is why
-- sensitive_column_registry had to land in 0003 rather than here.
create or replace function public.mask_sensitive(p_table text, p_row jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_object_agg(
              k,
              case
                when exists (
                  select 1 from public.sensitive_column_registry s
                  where s.table_name = p_table and s.column_name = k
                )
                then to_jsonb('«redacted»'::text)
                else v
              end
            )
     from jsonb_each(p_row) as e(k, v)),
    '{}'::jsonb
  );
$$;

comment on function public.mask_sensitive(text, jsonb) is
  'Redacts every column registered in sensitive_column_registry. RA 10173 / CBL Art. VIII §6. '
  'One registry, two consumers (audit masking and the 5-year purge), so they cannot disagree.';

-- ── audit_row() ────────────────────────────────────────────────────────────────────
-- Generic AFTER trigger. Returns NULL because an AFTER trigger's return value is ignored.
--
-- NOTE ON row_id: DATA_MODEL.md §6/0011 sketches this as `coalesce(new.id, old.id)`.
-- Two of the audited tables — committee_memberships and department_assignments — have
-- COMPOSITE primary keys and no `id` column at all, and referencing a missing field of a
-- record raises at runtime. Reading the id out of the jsonb instead is identical wherever
-- an `id` exists and yields NULL (a nullable column) where it does not, so the same
-- function serves all nine audited tables without a per-table variant. The raw record is
-- used for the lookup, never the masked copy, so registering `id` as sensitive could not
-- silently null out every row reference.
create or replace function public.audit_row() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_raw jsonb;
  v_new_raw jsonb;
  v_row_id  uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_raw := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_raw := to_jsonb(new);
  end if;

  v_row_id := nullif(coalesce(v_new_raw, v_old_raw) ->> 'id', '')::uuid;

  insert into public.audit_log (
    actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data
  )
  values (
    (select auth.uid()),
    coalesce(public.auth_role()::text, 'system'),   -- forward reference; resolved at execution (0012)
    tg_table_name,
    v_row_id,
    tg_op,
    case when v_old_raw is not null then public.mask_sensitive(tg_table_name, v_old_raw) end,
    case when v_new_raw is not null then public.mask_sensitive(tg_table_name, v_new_raw) end
  );

  return null;
end;
$$;

comment on function public.audit_row() is
  'AFTER INSERT OR UPDATE trigger for the audited tables (DATA_MODEL.md §8.3). Trigger-based, '
  'never application-based, so no code path can skip it. PRD US-I1. Attached in 0012.';

-- ── set_updated_at() ───────────────────────────────────────────────────────────────
-- CONVENTIONS.md §3.3: updated_at is maintained by trigger and NEVER set in application
-- code. Every mutable table added later reuses this one function.
create or replace function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared BEFORE UPDATE trigger. CONVENTIONS.md §3.3 — updated_at is never set by the client.';
