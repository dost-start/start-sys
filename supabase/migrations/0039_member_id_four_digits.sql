-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0039_member_id_four_digits.sql  —  new member IDs pad the sequence to four digits
--
-- WHAT: allocate_member_id() now mints `2026-0001`, not `2026-001`. Team meeting
--   2026-09-05: "START membership ID = Generated YEAR_ACTIVATED-####"; Ethan, 2026-09-06:
--   "let's do 4 digits, not three", and YEAR_ACTIVATED = the year the person joined the org
--   (= join_year, unchanged). Only the padding changes: the counter, the lock, the
--   idempotent early-return and the EXECUTE lockdown are exactly as 0022 wrote them.
--
--   member_id_format (0004, `^\d{4}-\d{3,}$`) is deliberately NOT tightened to `\d{4,}`.
--   Three-digit IDs already issued are valid, immutable (trg_people_freeze_member_id) and
--   never renumbered — PRD US-C4 forbids it even for a format change. `{3,}` admits both
--   widths, so nothing existing is touched and the 10,000th member of a year rolls to
--   `2026-10000` rather than colliding, exactly as the 1,000th did before.
--
-- ROLLBACK: forward-only. A new migration may restore three-digit padding; IDs already
--   minted at four digits stay as they are.
-- ═══════════════════════════════════════════════════════════════════════════════════

create or replace function public.allocate_member_id(p_person_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int;
  v_seq  int;
  v_id   text;
begin
  select p.member_id, p.join_year
    into v_id, v_year
    from public.people p
   where p.id = p_person_id
     for update;

  if not found then
    raise exception 'allocate_member_id: no person %', p_person_id
      using errcode = 'P0002';   -- no_data_found
  end if;

  -- Idempotent: an existing id is returned unchanged. This is what makes renewal keep
  -- the original member ID (PRD US-C4, US-H5) and a retried approval safe (US-C3).
  if v_id is not null then
    return v_id;
  end if;

  -- ONE statement, ONE row-level lock on ONE counter row. Never max(seq)+1, never a
  -- SEQUENCE (DATA_MODEL.md §4).
  insert into public.member_id_counters (join_year, last_seq)
  values (v_year, 1)
  on conflict (join_year)
  do update set last_seq = public.member_id_counters.last_seq + 1
  returning last_seq into v_seq;

  -- lpad TRUNCATES when the value is wider than the pad (start-sys-e2e-quirks), so the
  -- pad is only applied below 10,000; beyond that the raw sequence is used.
  v_id := v_year::text || '-' ||
          case when v_seq < 10000 then lpad(v_seq::text, 4, '0') else v_seq::text end;

  update public.people
     set member_id = v_id
   where id = p_person_id;

  return v_id;
end;
$$;

comment on function public.allocate_member_id(uuid) is
  'Allocates people.member_id as joinYear-sequence, four-digit padded (2026-0001) since '
  '0039 per the 2026-09-05 meeting. Race-safe via a single-statement counter-table upsert; '
  'idempotent — returns any existing id unchanged, which is what makes renewal keep the '
  'original id (PRD US-C3, US-C4, US-H5). Reachable ONLY from approve_application(); '
  'EXECUTE is revoked from every session role. DATA_MODEL.md §4.';

-- create or replace keeps the existing ACL, but say it again so a reader of THIS file can
-- see the lockdown without opening 0022.
revoke execute on function public.allocate_member_id(uuid) from public;
revoke execute on function public.allocate_member_id(uuid) from anon;
revoke execute on function public.allocate_member_id(uuid) from authenticated;
