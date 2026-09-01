-- ═══════════════════════════════════════════════════════════════════════════════════
-- 002_audit_substrate.sql
--
-- Every assertion here is one careless migration away from being untrue, and none of
-- them fails visibly in the application — an audit log that silently stops being
-- append-only, or silently starts storing the PII it exists to record access to, looks
-- exactly like a working audit log.
--
--   1–4   RLS enabled AND forced on audit_log and sensitive_column_registry
--   5–6   zero UPDATE and zero DELETE policies on audit_log
--   7–12  has_table_privilege false for {authenticated, anon, service_role} × {UPDATE, DELETE}
--         — append-only at the GRANT level, the strong form: a policy added later
--           cannot re-open what has been revoked
--   13–16 audit_row() and current_term_id() are SECURITY DEFINER and pin search_path
--         — a definer function without `SET search_path = ''` is a privilege-escalation
--           surface (CONVENTIONS.md §3.4, no exceptions)
--   17–18 mask_sensitive() actually masks: a registered key is redacted, an unregistered
--         key passes through. This is the assertion that keeps the audit log from
--         becoming a PII backdoor (RA 10173; CBL Art. VIII §6).
--
-- PRD §3 v1.0 item 16; PRD US-I1; DATA_MODEL.md §8.3.
-- ═══════════════════════════════════════════════════════════════════════════════════

begin;

select plan(18);

-- ── 1–4: RLS flags ─────────────────────────────────────────────────────────────────
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'audit_log'),
  'audit_log has ROW LEVEL SECURITY enabled'
);

select ok(
  (select relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'audit_log'),
  'audit_log has FORCE ROW LEVEL SECURITY (the owner is not exempt)'
);

select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'sensitive_column_registry'),
  'sensitive_column_registry has ROW LEVEL SECURITY enabled'
);

select ok(
  (select relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'sensitive_column_registry'),
  'sensitive_column_registry has FORCE ROW LEVEL SECURITY'
);

-- ── 5–6: no write policies on the log ──────────────────────────────────────────────
select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'audit_log' and cmd = 'UPDATE'),
  0::bigint,
  'no UPDATE policy exists on audit_log — not even the CEO can rewrite history from the app'
);

select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'audit_log' and cmd = 'DELETE'),
  0::bigint,
  'no DELETE policy exists on audit_log'
);

-- ── 7–12: append-only at the GRANT level ───────────────────────────────────────────
select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'UPDATE'),
  'authenticated has no UPDATE grant on audit_log'
);
select ok(
  not has_table_privilege('anon', 'public.audit_log', 'UPDATE'),
  'anon has no UPDATE grant on audit_log'
);
select ok(
  not has_table_privilege('service_role', 'public.audit_log', 'UPDATE'),
  'service_role has no UPDATE grant on audit_log'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_log', 'DELETE'),
  'authenticated has no DELETE grant on audit_log'
);
select ok(
  not has_table_privilege('anon', 'public.audit_log', 'DELETE'),
  'anon has no DELETE grant on audit_log'
);
select ok(
  not has_table_privilege('service_role', 'public.audit_log', 'DELETE'),
  'service_role has no DELETE grant on audit_log'
);

-- ── 13–16: definer functions pin their search_path ─────────────────────────────────
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'audit_row'),
  'audit_row() is SECURITY DEFINER'
);

select ok(
  (select exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'audit_row'),
  'audit_row() pins search_path'
);

select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'current_term_id'),
  'current_term_id() is SECURITY DEFINER'
);

select ok(
  (select exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'current_term_id'),
  'current_term_id() pins search_path'
);

-- ── 17–18: mask_sensitive() functionally masks what the registry names ─────────────
-- Registered in-transaction and rolled back, so this proves the REGISTRY drives the
-- masking rather than a hardcoded column list.
insert into public.sensitive_column_registry (table_name, column_name, rationale)
values ('meta_selftest', 'secret_col', 'pgTAP substrate check — rolled back');

select is(
  public.mask_sensitive(
    'meta_selftest',
    '{"secret_col": "0917-000-0000", "plain_col": "visible"}'::jsonb
  ) ->> 'secret_col',
  '«redacted»',
  'mask_sensitive() redacts a column listed in sensitive_column_registry'
);

select is(
  public.mask_sensitive(
    'meta_selftest',
    '{"secret_col": "0917-000-0000", "plain_col": "visible"}'::jsonb
  ) ->> 'plain_col',
  'visible',
  'mask_sensitive() passes an unregistered column through unchanged'
);

select * from finish();

rollback;
