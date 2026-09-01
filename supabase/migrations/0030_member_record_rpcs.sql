-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0030_member_record_rpcs.sql
--
-- WHAT:      The three functions the member-records surface is built on:
--              search_member_directory()  SECURITY INVOKER — the deduped, filtered read
--                                         behind /members. Scoping is INHERITED from RLS.
--              get_member_record()        SECURITY DEFINER — the audited, acknowledgement-
--                                         gated door to one scholar's PII.
--              update_member_record()     SECURITY DEFINER — the audited, acknowledgement-
--                                         gated, optimistically-concurrent write path.
--
-- WHY:       PRD §3 v1.0 items 10 and 12; PRD US-D1, US-D2, US-I2, US-I3, US-J1, US-J5.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- THE ASYMMETRY THAT EXPLAINS THIS WHOLE FILE
-- ═══════════════════════════════════════════════════════════════════════════════════
-- One of these functions is SECURITY INVOKER and two are SECURITY DEFINER, and the split
-- is not a style choice — it follows from WHAT each one has to get past.
--
--   search_member_directory() reads only NON-SENSITIVE columns: the same six of `people`
--   that 0015_grants.sql grants to `authenticated`, plus memberships/regions/committees/
--   departments, which every authenticated tier may read. It needs no elevation, so it
--   takes none — and because it takes none, an officer gets the officer's rows and a
--   regional rep gets one region WITHOUT this function containing a single line about
--   regions. **A SECURITY DEFINER "directory RPC" that hand-checked auth_role() would be a
--   SECOND authorization model, and a second model drifts from the first.** Same reasoning
--   as v_member_directory's own security_invoker (0013) and ADR 0008's dashboard views.
--
--   get_member_record() and update_member_record() must reach the sensitive ten, which
--   0015 revokes from `authenticated` outright — there is no table UPDATE on `people` for
--   ANY role and no SELECT on any sensitive column. Elevation is unavoidable, so it is
--   confined to two functions that each open with the same two guards and each leave a
--   record. **The banned alternative is widening the 0015 GRANT to make a screen work**
--   (CLAUDE.md banned patterns; 0014's people_update comment says the same thing from the
--   policy side).
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- CITATION:  BUILD_PLAN S5-T5, S5-T6, S5-T7, S5-T32; ADR 0006; DATA_MODEL.md §6/0013,
--            §8.1, §8.3, §8.4; ARCHITECTURE.md §5, §9; PRD §3 v1.0 items 10, 12;
--            PRD US-D1, US-D2, US-D4, US-F1, US-I2, US-I3, US-J1, US-J5; PRD OQ-5, OQ-6;
--            CBL Art. VIII §6 (RA 10173), §7.1 (confidentiality agreements).
--
-- ROLLBACK:  Forward-only, `create or replace` throughout. Dropping get_member_record() or
--            update_member_record() makes the member detail page and the edit form
--            inoperable — which is the correct failure direction, since the alternative
--            path does not exist. Dropping search_member_directory() makes /members empty.
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — search_member_directory()   (BUILD_PLAN S5-T5)
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- Returns exactly v_member_directory's non-sensitive shape, DEDUPED: the view's two LEFT
-- JOINs mean a scholar on two committees yields two rows, and anything paginating over that
-- silently miscounts — page 1 of 25 shows 24 people. GROUP BY + array_agg collapses the
-- fan-out into `committee_names text[]` / `department_names text[]`.
--
-- ⚠ WHY THIS READS THE BASE TABLES AND NOT v_member_directory. The view exposes
-- region_name but not region_id, committee_name but not committee_id — it is a RENDER
-- shape, and you cannot write `where region_id = any($1)` against it. Filtering by name
-- would break the moment two regions were renamed, and the URL contract
-- (lib/members/filters.ts) carries ids. So this function joins the same tables in the same
-- way and RETURNS the same thirteen concepts. Two consequences worth stating:
--   · the RLS surface is identical — memberships_read, people_read, and the column GRANT
--     on `people` all apply here exactly as they apply through the view, because this is
--     SECURITY INVOKER and touches the same relations;
--   · every `people` column selected below is one of the six 0015 grants to
--     `authenticated`. Adding p.birthdate here would raise 42501 for every caller rather
--     than leak — the correct failure direction, and the reason to never try.
--
-- ⚠ SORTING AND PAGINATION ARE DELIBERATELY NOT PARAMETERS. PostgREST applies `?order=` and
-- Range headers to a SETOF-returning function, so `.rpc(...).order('family_name').range(0,24)`
-- works without this function containing one line of dynamic SQL. An `p_sort text` argument
-- would be a string concatenated into an ORDER BY, which is an injection surface added for
-- no capability.
--
-- ⚠ TERM RESOLUTION IS SERVER-SIDE AND ROLE-GATED. PRD US-H3: officers and regional reps do
-- not gain access to prior terms they could not see at the time. A client-supplied term is
-- honoured only for the four admin tiers; everyone else is forced to current_term_id()
-- regardless of what they pass. This is belt to RLS's braces — memberships_read carries no
-- term predicate at all, so without this an officer could page through history by editing a
-- URL. tech_admin is in the honoured list for completeness even though memberships_read
-- does not name tech_admin and it therefore sees zero rows either way (PRD OQ-5).
create or replace function public.search_member_directory(
  p_term_id        uuid                     default null,
  p_q              text                     default null,
  p_statuses       public.membership_status[] default null,
  p_region_ids     uuid[]                   default null,
  p_committee_ids  uuid[]                   default null,
  p_department_ids uuid[]                   default null
)
returns table (
  membership_id    uuid,
  person_id        uuid,
  member_id        text,
  given_name       text,
  family_name      text,
  join_year        int,
  term_id          uuid,
  status           public.membership_status,
  year_level       int,
  region_name      text,
  island_group     public.island_group,
  committee_names  text[],
  department_names text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_role text := public.auth_role()::text;
  v_term uuid;
  v_q    text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if p_term_id is not null
     and v_role in ('exec_admin', 'crrd_admin', 'moderator', 'tech_admin') then
    v_term := p_term_id;
  else
    v_term := public.current_term_id();
  end if;

  return query
  select
    m.id,
    p.id,
    p.member_id,
    p.given_name,
    p.family_name,
    p.join_year,
    m.term_id,
    m.status,
    m.year_level,
    r.name,
    r.island_group,
    -- filter (where ... is not null) rather than array_remove: a member with no committee
    -- gets '{}' and not '{NULL}', so array_length() is NULL and the UI renders nothing
    -- instead of an empty chip. `distinct` because the department LEFT JOIN multiplies the
    -- committee rows and vice versa.
    coalesce(array_agg(distinct c.name) filter (where c.name is not null), '{}'::text[]),
    coalesce(array_agg(distinct d.name) filter (where d.name is not null), '{}'::text[])
  from public.memberships m
  join public.people  p on p.id = m.person_id
  join public.regions r on r.id = m.region_id
  left join public.committee_memberships  cm on cm.membership_id = m.id
  left join public.committees             c  on c.id  = cm.committee_id
  left join public.department_assignments da on da.membership_id = m.id
  left join public.departments            d  on d.id  = da.department_id
  where m.term_id = v_term
    -- PRD US-I2, both axes. Bare ILIKE on both sides so the two pg_trgm GIN indexes stay
    -- usable: people_name_trgm (0004) is on `(given_name || ' ' || family_name)` and the
    -- expression below matches it CHARACTER FOR CHARACTER; idx_people_member_id_trgm (0029)
    -- is on the bare column. pg_trgm lowercases when extracting trigrams, so ILIKE is
    -- case-tolerant for free. Accent tolerance is NOT met — see
    -- docs/issues/2026-09-05-accent-tolerant-search.md.
    and (
      v_q is null
      or (p.given_name || ' ' || p.family_name) ilike '%' || v_q || '%'
      or p.member_id ilike '%' || v_q || '%'
    )
    -- A NULL filter array means "no filter", NOT "match nothing". Every facet is optional
    -- and independent, which is PRD US-I3's "filters combine".
    and (p_statuses   is null or m.status    = any (p_statuses))
    and (p_region_ids is null or m.region_id = any (p_region_ids))
    -- The committee and department facets are EXISTS rather than a predicate on the joined
    -- alias. Filtering `c.id = any(...)` in the WHERE clause would drop the member's OTHER
    -- committees from the aggregate, so a member on two committees filtered to one would
    -- render as if they sat on one — a filter that silently rewrites the data it returns.
    and (
      p_committee_ids is null
      or exists (
        select 1 from public.committee_memberships x
        where x.membership_id = m.id and x.committee_id = any (p_committee_ids)
      )
    )
    and (
      p_department_ids is null
      or exists (
        select 1 from public.department_assignments y
        where y.membership_id = m.id and y.department_id = any (p_department_ids)
      )
    )
  group by
    m.id, p.id, p.member_id, p.given_name, p.family_name, p.join_year,
    m.term_id, m.status, m.year_level, r.name, r.island_group;
end;
$$;

comment on function public.search_member_directory(
  uuid, text, public.membership_status[], uuid[], uuid[], uuid[]
) is
  'The deduped read behind /members (PRD §3 v1.0 item 12, US-I2, US-I3). SECURITY INVOKER, '
  'and that is LOAD-BEARING: every scoping decision — an officer sees all rows, a regional '
  'rep sees one region, a member sees their own — is INHERITED from memberships_read and '
  'people_read rather than restated here, so there is no second permission model to drift. '
  'Term is resolved server-side and honoured from the client only for admin tiers (PRD '
  'US-H3). GROUP BY collapses the committee/department fan-out; without it pagination '
  'miscounts. Sorting and paging are PostgREST''s ?order= and Range, never arguments.';

-- SECURITY INVOKER functions are not granted to PUBLIC the way definers are, but Supabase's
-- default privileges do grant EXECUTE on new functions in `public` to anon and
-- authenticated. anon must not reach the member directory at all (PRD US-A1) — and would
-- get zero rows from RLS anyway, which is the wrong shape of refusal for a public caller.
revoke execute on function public.search_member_directory(
  uuid, text, public.membership_status[], uuid[], uuid[], uuid[]
) from public;
revoke execute on function public.search_member_directory(
  uuid, text, public.membership_status[], uuid[], uuid[], uuid[]
) from anon;
grant execute on function public.search_member_directory(
  uuid, text, public.membership_status[], uuid[], uuid[], uuid[]
) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — get_member_record()   (BUILD_PLAN S5-T6)
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- The member-detail page's door to a scholar's PII, and there is deliberately only one.
-- Structurally identical to get_person_sensitive() (0012) — same guards in the same order,
-- same NULL-for-absent behaviour — and distinct from it only in the audit operation it
-- writes: `VIEW_RECORD` for "an administrator opened this scholar's record" versus
-- `VIEW_SENSITIVE` for "the application-review surface read the sensitive block". Keeping
-- them apart is what lets `/audit` answer the two questions separately (PRD US-I1).
--
-- ORDER OF OPERATIONS IS THE SECURITY PROPERTY:
--   1. role guard        exec_admin / crrd_admin / moderator, else 42501
--   2. acknowledgement   CBL Art. VIII §7.1, else a DISTINCT, ACTIONABLE 42501
--   3. audit write       BEFORE the value is built
--   4. return
--
-- ⚠ tech_admin IS EXCLUDED, and it is the exclusion most likely to be "fixed" by someone
-- who reasons that the CTO administers the system. PRD OQ-5's default answer is NO, least
-- privilege: "configure the system and control access" is not "read everyone's address".
-- If that is ever reversed it must be a DISTINCT AUDITED ROLE, never an extra literal in
-- the list below. officer is excluded by PRD US-D2/OQ-6 — and note the Special Advisor
-- sits in that tier (CBL Art. III §2.9, Art. X §2.4-2.5) and must not read the records of
-- people whose appeals they adjudicate.
--
-- ⚠ A DENIED READ WRITES NOTHING. Both guards raise before the insert, so the audit log
-- records reads that happened and never attempts that did not. An audit log that recorded
-- refusals would grow a row every time a misconfigured client retried, and "who read this
-- scholar's address" would stop being answerable by reading it.
--
-- ⚠ old_data AND new_data ARE NULL ON PURPOSE. This is a read; there is no diff. More
-- importantly, putting the row here would make the audit log the PII store that
-- mask_sensitive() exists to prevent, and the five-year purge would then have to reach into
-- an append-only table it can never write to (DATA_MODEL.md §8.3).
--
-- VOLATILE (stated by the absence of STABLE) because it WRITES. A STABLE marking would let
-- the planner elide or reorder calls and the audit row could go missing.
create or replace function public.get_member_record(p_person_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  v_row  public.people;
begin
  -- 1.
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin', 'moderator') then
    raise exception 'not authorized to read a member record'
      using errcode = '42501';
  end if;

  -- 2. Raises with its own distinct message naming the missing acknowledgement, so the
  -- detail page can render the one sentence that unblocks a newly appointed CCDO rather
  -- than a dead-end "forbidden" (BUILD_PLAN S5-T26; ARCHITECTURE.md §9 item 5).
  perform public.assert_confidentiality_ack();

  select * into v_row from public.people p where p.id = p_person_id;

  -- CONVENTIONS.md §4.3: an absent row is `not_found`, never `unauthorized`. Saying
  -- "forbidden" would confirm that a named scholar has a record.
  if v_row.id is null then
    return null;
  end if;

  -- 3. RA 10173 / CBL Art. VIII §6.
  insert into public.audit_log (
    actor_user_id, actor_role, table_name, row_id, operation, old_data, new_data, note
  )
  values (
    (select auth.uid()),
    v_role::text,
    'people',
    p_person_id,
    'VIEW_RECORD',
    null,
    null,
    'member record opened via get_member_record()'
  );

  return to_jsonb(v_row);
end;
$$;

comment on function public.get_member_record(uuid) is
  'The member-detail page''s only path to a scholar''s record, sensitive columns included. '
  'Guards on role (exec_admin/crrd_admin/moderator — tech_admin excluded per PRD OQ-5), then '
  'on a current-term confidentiality acknowledgement (CBL Art. VIII §7.1 / PRD US-J5), then '
  'writes ONE VIEW_RECORD audit row with old_data and new_data NULL before returning. A '
  'denied read writes nothing. PRD US-D1, US-I1, US-J1.';

revoke execute on function public.get_member_record(uuid) from public;
revoke execute on function public.get_member_record(uuid) from anon;
grant  execute on function public.get_member_record(uuid) to   authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — update_member_record()   (BUILD_PLAN S5-T7)
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ WHY THIS FUNCTION HAS TO EXIST. 0015_grants.sql runs `revoke all on public.people from
-- authenticated` and grants back a six-column SELECT. **No role holds table UPDATE on
-- `people`.** people_update (0014) names exec_admin/crrd_admin/moderator, but a policy
-- cannot grant a privilege that was revoked — it is the second lock on a door whose first
-- lock is a missing GRANT. So an ordinary `supabase.from('people').update(...)` raises
-- 42501 for every caller, and the ONLY correct response is to come through here. Widening
-- the 0015 grant to "make the edit form work" is the exact banned move.
--
-- FOUR PROPERTIES, each of which is a separate requirement:
--
--   ROLE + ACKNOWLEDGEMENT — the same two guards as the read, in the same order, because a
--   write implies a read: the edit form is populated from get_member_record().
--
--   OPTIMISTIC CONCURRENCY — PRD US-D1: "concurrent edits do not silently overwrite one
--   another." `select ... for update` then compare the caller's expected updated_at. A
--   stale form loses with 40001 (serialization_failure), which lib/members/actions.ts maps
--   to `conflict` and the form renders as "the record changed, reload" — it does NOT
--   silently merge, because a merge of two half-informed edits is a third edit nobody made.
--
--   AN EXPLICIT PATCH WHITELIST — `member_id`, `join_year`, `id` and `redacted_at` are
--   refused by name, and so is every key not on the list. member_id in particular is the
--   PRD's hardest rule (US-C4: 2024-001 never becomes 2025-001); it is already defended by
--   enforce_member_id_immutable() (0022) and a CHECK, and this is the third layer, sited
--   where a caller would actually try. **`status` IS DELIBERATELY NOT SETTABLE HERE.**
--   Membership status is a term-scoped fact on `memberships`, it moves through a plain
--   table UPDATE so that both memberships_update (0014) and
--   enforce_membership_transition() (0028) are in the path, and routing it through a
--   SECURITY DEFINER function would take RLS out of that path entirely.
--
--   NO HAND-WRITTEN AUDIT ROW — trg_people_audit (0012) fires inside this function and
--   masks every key registered in sensitive_column_registry before writing. Adding an
--   insert here would double-count and, worse, would be the one audit write in the system
--   that a code path could skip (CLAUDE.md invariant: the trigger is a DB trigger precisely
--   so nothing can).
--
-- `updated_at` is NOT set here. trg_people_set_updated_at (0012) owns it —
-- CONVENTIONS.md §3.3: updated_at is maintained by trigger and never by the writer.
--
-- Casts are performed by the UPDATE itself: `(p_patch->>'birthdate')::date` on a malformed
-- date raises 22007 and the whole statement rolls back. That is the correct behaviour and
-- the reason the patch is not pre-coerced — a defensive `try_cast` would turn a typo into
-- a silently NULLed birthdate, which is data loss disguised as a successful save.
create or replace function public.update_member_record(
  p_person_id           uuid,
  p_patch               jsonb,
  p_expected_updated_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.org_role := public.auth_role();
  v_row  public.people;
  v_bad  text[];
begin
  -- 1. role
  if v_role is null or v_role not in ('exec_admin', 'crrd_admin', 'moderator') then
    raise exception 'not authorized to update a member record'
      using errcode = '42501';
  end if;

  -- 2. CBL Art. VIII §7.1
  perform public.assert_confidentiality_ack();

  -- 3. whitelist, BEFORE any row is locked, so a rejected patch costs nothing and leaves
  -- no lock behind. The list is spelled out rather than derived from the table's columns:
  -- a column added to `people` in 2029 must be argued onto this list, not inherited onto
  -- it. errcode 22023 (invalid_parameter_value) rather than 42501 — this is a malformed
  -- request from an authorized caller, not a permission failure, and conflating the two
  -- would render "you may not edit this member" for a typo'd field name.
  if p_patch is null or p_patch = '{}'::jsonb then
    raise exception 'update_member_record: the patch is empty; nothing to change'
      using errcode = '22023';
  end if;

  select array_agg(k order by k) into v_bad
  from jsonb_object_keys(p_patch) as k
  where k not in (
    'given_name', 'middle_name', 'family_name', 'suffix',
    'birthdate', 'contact_number', 'personal_email',
    'address_line', 'city_municipality', 'province', 'postal_code',
    'school', 'school_id_no'
  );

  if v_bad is not null then
    raise exception
      'update_member_record: % is not a patchable column. member_id, join_year, id and redacted_at are never patchable (PRD US-C4), and membership status moves through memberships so that its RLS policy and transition trigger stay in the path',
      array_to_string(v_bad, ', ')
      using errcode = '22023';
  end if;

  -- 4. lock, then compare. FOR UPDATE holds the row for the rest of the transaction, so
  -- the check-then-write below cannot interleave with another writer between the two
  -- statements — which is the race the expected-timestamp comparison would otherwise only
  -- narrow rather than close.
  select * into v_row from public.people p where p.id = p_person_id for update;

  if v_row.id is null then
    raise exception 'member record % not found', p_person_id
      using errcode = 'no_data_found';
  end if;

  -- PRD US-D1. `is distinct from` so a NULL expectation is a mismatch rather than a
  -- comparison that yields NULL and falls through to the write.
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception
      'this member record was changed by someone else since it was loaded; reload and reapply the edit'
      using errcode = 'serialization_failure';
  end if;

  -- 5. the write. `p_patch ? 'key'` distinguishes "absent" from "present and null", so a
  -- patch may deliberately CLEAR a field (send null) without every other field being
  -- clobbered by a coalesce.
  update public.people p set
    given_name        = case when p_patch ? 'given_name'        then  p_patch->>'given_name'                else p.given_name        end,
    middle_name       = case when p_patch ? 'middle_name'       then  p_patch->>'middle_name'               else p.middle_name       end,
    family_name       = case when p_patch ? 'family_name'       then  p_patch->>'family_name'               else p.family_name       end,
    suffix            = case when p_patch ? 'suffix'            then  p_patch->>'suffix'                    else p.suffix            end,
    birthdate         = case when p_patch ? 'birthdate'         then (p_patch->>'birthdate')::date          else p.birthdate         end,
    contact_number    = case when p_patch ? 'contact_number'    then  p_patch->>'contact_number'            else p.contact_number    end,
    -- NO explicit ::citext cast. `create extension citext` in 0004 carries no SCHEMA
    -- clause, so on a platform that pre-installs it the type lives in `extensions` and an
    -- unqualified `::citext` would fail to resolve under this function's `search_path = ''`.
    -- text -> citext is an assignment cast, so the bare text assigns correctly and the
    -- column keeps its case-insensitive comparison semantics.
    personal_email    = case when p_patch ? 'personal_email'    then  p_patch->>'personal_email'            else p.personal_email::text end,
    address_line      = case when p_patch ? 'address_line'      then  p_patch->>'address_line'              else p.address_line      end,
    city_municipality = case when p_patch ? 'city_municipality' then  p_patch->>'city_municipality'         else p.city_municipality end,
    province          = case when p_patch ? 'province'          then  p_patch->>'province'                  else p.province          end,
    postal_code       = case when p_patch ? 'postal_code'       then  p_patch->>'postal_code'               else p.postal_code       end,
    school            = case when p_patch ? 'school'            then  p_patch->>'school'                    else p.school            end,
    school_id_no      = case when p_patch ? 'school_id_no'      then  p_patch->>'school_id_no'              else p.school_id_no      end
  where p.id = p_person_id;
end;
$$;

comment on function public.update_member_record(uuid, jsonb, timestamptz) is
  'The ONLY write path to a member record: `authenticated` holds no table UPDATE on people '
  'at all (0015 revokes it), so this is not a convenience. Guards on role and on a '
  'current-term confidentiality acknowledgement, refuses any key outside an explicit '
  'whitelist (member_id, join_year, id, redacted_at and status are never patchable), and '
  'raises 40001 when the caller''s expected updated_at is stale so a concurrent edit loses '
  'instead of clobbering (PRD US-D1). Audit rows come from trg_people_audit, never from '
  'here. PRD US-C4, US-D1, US-J5; DATA_MODEL.md §8.4.';

revoke execute on function public.update_member_record(uuid, jsonb, timestamptz) from public;
revoke execute on function public.update_member_record(uuid, jsonb, timestamptz) from anon;
grant  execute on function public.update_member_record(uuid, jsonb, timestamptz) to   authenticated;
