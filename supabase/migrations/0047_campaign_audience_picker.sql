-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0047_campaign_audience_picker.sql  —  the campaign composer's people picker
--                                       (Ethan, 2026-09-06; PRD US-G2 "filter recipients";
--                                        SRS Email Sending / Form Sending)
--
-- WHAT:
--   resolve_recipients(jsonb)        RE-CREATED (same name, same signature, same return
--                                    table as 0043). Adds four filter axes — department,
--                                    committee, university, year level — and a SELECTION
--                                    layer on top of the filter axes: a header checkbox
--                                    ("everyone matching") plus per-person tick/untick.
--                                       recipients =
--                                         (select_all ? axis-matched : ∅)
--                                          ∪ person_ids − excluded_person_ids
--                                    A hand-picked person_id is included even when the
--                                    axes (including `statuses`, which defaults to
--                                    ['active']) would not have matched them — the whole
--                                    point of a hand-pick is overriding the filter — but
--                                    they must still be a REAL, CONTACTABLE, CURRENT-TERM
--                                    person: a membership in current_term_id() (any
--                                    status), personal_email on file, not redacted. An
--                                    absent key (every campaign stored before this
--                                    migration) means select_all=true and every new list
--                                    empty, i.e. "resolve exactly as 0043 did" — a
--                                    pre-0047 audience_filter is not reprocessed or
--                                    migrated, it simply keeps meaning what it always
--                                    meant.
--
--   list_audience_candidates(jsonb, text, int, int)   NEW. The picker's own read: apply
--                                    ONLY the filter axes (never select_all /
--                                    person_ids / excluded_person_ids — those are
--                                    selection STATE the client overlays on whatever page
--                                    of candidates it is looking at, not a further
--                                    narrowing of who can be looked at) plus an optional
--                                    name/member-ID substring, and hand back one page of
--                                    people to tick boxes next to. Same role guard, same
--                                    eligibility (current term, email on file, not
--                                    redacted) as the resolver, so a name that cannot
--                                    ever be resolved into a recipient never appears in
--                                    the picker to begin with. Returns name, member ID,
--                                    region, department, committee, position — NEVER an
--                                    email address (Ethan: "the picker shows ... NEVER an
--                                    email address"). total_count is a window column so
--                                    the composer can page without a second round trip.
--
-- WHY THE TWO FUNCTIONS DUPLICATE THEIR FILTER-PARSING RATHER THAN SHARING A HELPER: they
--   answer different questions over an overlapping but not identical predicate (the
--   resolver adds the selection layer; the picker adds full-text search and never reads
--   selection state at all), and a shared helper would need to parameterise both
--   differences via boolean flags threaded through every call site — harder to audit than
--   two definers that each read straight down. 0043 already made this same call for
--   resolve_recipients vs. send_campaign vs. claim_campaign_batch: nothing in this schema
--   shares filter-compilation logic across definers. A future change to one axis is a
--   change in two places by design, caught by 076_campaign_audience_picker.sql asserting
--   both.
--
-- WHO: crrd_admin and exec_admin only, same guard as every other campaign function in
--   0043. The picker is read-only surface for the same tier that already reads
--   email_recipients (the delivery report) and writes email_campaigns.
--
-- SECURITY DEFINER, `set search_path = ''`, fully-qualified names throughout — the same
--   shape as every function in 0043 and for the same reason: the 0015 column GRANT
--   withholds people.personal_email from every session, and an INVOKER function could
--   never read an address (list_audience_candidates doesn't return one, but it still runs
--   as definer so its role guard, not RLS, is the single place authorization is decided —
--   consistent with resolve_recipients rather than half of one shape and half of another).
--
-- NEITHER FUNCTION TOUCHES email_recipients OR email_campaigns. Both are pure reads over
--   people / memberships / regions / departments / committees / committee_memberships /
--   department_assignments / officer_assignments / officer_positions / member_affiliations
--   / universities — reference and org-chart tables already readable by every authenticated
--   tier (0014), so the DEFINER marking here is about the sensitive personal_email column
--   and the audience-composition guard, not about reaching tables the caller's own session
--   could not otherwise see the rows of.
--
-- CITATION: 0043 (the function this re-creates); DATA_MODEL.md §6/0007 (departments,
--   committees, department_assignments, committee_memberships, officer_assignments,
--   officer_positions), §6/0037 (universities); PRD US-G2 "filter recipients by year of
--   membership, role, region, island group, and affiliation" (department/committee/
--   university/year-level are the 2026-09-06 widening of that same story); ADR 0010
--   (Gmail ≈500/day — the reason the composer warns rather than refuses past 400).
--
-- ROLLBACK: forward-only. resolve_recipients keeps its name and signature, so any campaign
--   whose audience_filter predates this migration keeps resolving exactly as before —
--   there is nothing to roll back on existing data. list_audience_candidates is new and
--   additive.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── resolve_recipients, re-created ─────────────────────────────────────────────────
create or replace function public.resolve_recipients(p_filter jsonb default '{}'::jsonb)
returns table (person_id uuid, email text, merge jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role       public.org_role := public.auth_role();
  v_term       uuid := public.current_term_id();
  v_years      int[];
  v_regions    uuid[];
  v_islands    text[];
  v_statuses   text[];
  v_affils     uuid[];
  v_roles      text[];
  v_depts      uuid[];
  v_cmtes      uuid[];
  v_unis       uuid[];
  v_levels     int[];
  v_select_all boolean;
  v_picks      uuid[];
  v_excludes   uuid[];
begin
  -- The role guard runs BEFORE any filter is even parsed, selection layer included: a
  -- hand-picked person_id must never become a way for a refused role to learn anything.
  if v_role is null or v_role not in ('crrd_admin', 'exec_admin') then
    raise exception 'not authorized to resolve a recipient list' using errcode = '42501';
  end if;
  if v_term is null then
    return;
  end if;

  select array_agg((x)::int)  into v_years    from jsonb_array_elements_text(coalesce(p_filter->'join_years',          '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_regions  from jsonb_array_elements_text(coalesce(p_filter->'region_ids',          '[]'::jsonb)) as t(x);
  select array_agg(x)         into v_islands  from jsonb_array_elements_text(coalesce(p_filter->'island_groups',       '[]'::jsonb)) as t(x);
  select array_agg(x)         into v_statuses from jsonb_array_elements_text(coalesce(p_filter->'statuses',            '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_affils   from jsonb_array_elements_text(coalesce(p_filter->'affiliation_ids',     '[]'::jsonb)) as t(x);
  select array_agg(x)         into v_roles    from jsonb_array_elements_text(coalesce(p_filter->'role_codes',         '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_depts    from jsonb_array_elements_text(coalesce(p_filter->'department_ids',     '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_cmtes    from jsonb_array_elements_text(coalesce(p_filter->'committee_ids',      '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_unis     from jsonb_array_elements_text(coalesce(p_filter->'university_ids',     '[]'::jsonb)) as t(x);
  select array_agg((x)::int)  into v_levels   from jsonb_array_elements_text(coalesce(p_filter->'year_levels',        '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_picks    from jsonb_array_elements_text(coalesce(p_filter->'person_ids',          '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_excludes from jsonb_array_elements_text(coalesce(p_filter->'excluded_person_ids', '[]'::jsonb)) as t(x);

  if v_statuses is null or cardinality(v_statuses) = 0 then
    v_statuses := array['active'];
  end if;

  -- The composer's zod schema caps both lists at 1,000 (lib/campaigns/schema.ts); this is
  -- the same ceiling held here too, because the function is executable by any crrd_admin /
  -- exec_admin session directly through PostgREST, not only through the Server Action.
  if coalesce(cardinality(v_picks), 0) > 1000 or coalesce(cardinality(v_excludes), 0) > 1000 then
    raise exception 'person_ids and excluded_person_ids are capped at 1000 entries each'
      using errcode = '22023';
  end if;

  -- An ABSENT `select_all` key (every campaign stored before this migration) means true —
  -- ->> yields SQL NULL for a missing key, and NULL::boolean survives the cast, so coalesce
  -- is what actually supplies the default. A key present as JSON `false` casts to false and
  -- is NOT touched by coalesce, which only replaces a genuine SQL NULL.
  v_select_all := coalesce((p_filter->>'select_all')::boolean, true);

  return query
  with matched as (
    -- Everyone the FILTER AXES match, current term, contactable. Computed only when
    -- select_all is true — when it is false this CTE is a constant-false scan, i.e. empty,
    -- which is exactly "select_all=false takes nobody from the axes".
    select p.id as person_id
    from public.memberships m
    join public.people  p on p.id = m.person_id
    join public.regions r on r.id = m.region_id
    where v_select_all
      and m.term_id = v_term
      and p.personal_email is not null
      and p.redacted_at is null
      and m.status::text = any(v_statuses)
      and (v_years   is null or cardinality(v_years)   = 0 or p.join_year = any(v_years))
      and (v_regions is null or cardinality(v_regions) = 0 or m.region_id = any(v_regions))
      and (v_islands is null or cardinality(v_islands) = 0 or r.island_group::text = any(v_islands))
      and (v_levels  is null or cardinality(v_levels)  = 0 or m.year_level = any(v_levels))
      and (v_affils  is null or cardinality(v_affils)  = 0 or exists (
             select 1 from public.member_affiliations ma
              where ma.membership_id = m.id and ma.affiliation_id = any(v_affils)))
      and (v_roles   is null or cardinality(v_roles)   = 0 or exists (
             select 1 from public.officer_assignments oa
              where oa.person_id = p.id and oa.term_id = v_term
                and oa.status = 'active' and oa.role = any(v_roles)))
      and (v_depts   is null or cardinality(v_depts)   = 0 or exists (
             select 1 from public.department_assignments da
              where da.membership_id = m.id and da.department_id = any(v_depts)))
      and (v_cmtes   is null or cardinality(v_cmtes)   = 0 or exists (
             select 1 from public.committee_memberships cm
              where cm.membership_id = m.id and cm.committee_id = any(v_cmtes)))
      and (v_unis    is null or cardinality(v_unis)    = 0 or p.university_id = any(v_unis))
  ),
  picked as (
    -- A hand-pick OVERRIDES the axes (including `statuses`) but not the base eligibility
    -- to be a recipient at all: current-term membership, an email on file, not redacted.
    select p.id as person_id
    from public.memberships m
    join public.people p on p.id = m.person_id
    where v_picks is not null and cardinality(v_picks) > 0
      and p.id = any(v_picks)
      and m.term_id = v_term
      and p.personal_email is not null
      and p.redacted_at is null
  ),
  unioned as (
    select person_id from matched
    union
    select person_id from picked
  ),
  final_ids as (
    select u.person_id
    from unioned u
    where v_excludes is null or cardinality(v_excludes) = 0
       or not (u.person_id = any(v_excludes))
  )
  select f.person_id,
         p.personal_email::text,
         jsonb_build_object(
           'given_name',      vf.given_name,
           'family_name',     vf.family_name,
           'member_id',       vf.member_id,
           'join_year',       vf.join_year,
           'region_name',     vf.region_name,
           'island_group',    vf.island_group,
           'term_label',      vf.term_label,
           'year_level',      vf.year_level,
           'committee_name',  vf.committee_name,
           'department_name', vf.department_name
         )
  from final_ids f
  join public.people p on p.id = f.person_id
  join public.v_email_merge_fields vf on vf.person_id = f.person_id and vf.term_id = v_term;
end;
$$;

comment on function public.resolve_recipients(jsonb) is
  'The audience filter, compiled once (0043). Re-created 2026-09-06 (Ethan) to add '
  'department/committee/university/year-level axes and a selection layer: recipients = '
  '(select_all ? axis-matched : ∅) ∪ person_ids − excluded_person_ids. A hand-pick '
  'overrides every axis (statuses included) but must still be a real current-term person '
  'with an email on file. An absent select_all/person_ids/excluded_person_ids key (every '
  'pre-0047 campaign) resolves exactly as before. crrd_admin / exec_admin only.';


-- ── list_audience_candidates — the picker's own read ───────────────────────────────
create or replace function public.list_audience_candidates(
  p_filter jsonb default '{}'::jsonb,
  p_q      text  default null,
  p_limit  int   default 50,
  p_offset int   default 0
)
returns table (
  person_id       uuid,
  given_name      text,
  family_name     text,
  member_id       text,
  region_name     text,
  department_name text,
  committee_name  text,
  position_title  text,
  status          text,
  total_count     bigint
)
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
  v_depts    uuid[];
  v_cmtes    uuid[];
  v_unis     uuid[];
  v_levels   int[];
  v_q        text;
  v_limit    int;
  v_offset   int;
begin
  if v_role is null or v_role not in ('crrd_admin', 'exec_admin') then
    raise exception 'not authorized to list audience candidates' using errcode = '42501';
  end if;
  if v_term is null then
    return;
  end if;

  -- Clamp rather than reject: a client-side paging bug should degrade to a smaller or
  -- larger page, never a 500. Offset floors at 0; Postgres itself raises on a negative
  -- OFFSET, and a floor is friendlier than an error for a bug that is purely cosmetic.
  v_limit  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_q      := nullif(btrim(coalesce(p_q, '')), '');

  select array_agg((x)::int)  into v_years    from jsonb_array_elements_text(coalesce(p_filter->'join_years',      '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_regions  from jsonb_array_elements_text(coalesce(p_filter->'region_ids',      '[]'::jsonb)) as t(x);
  select array_agg(x)         into v_islands  from jsonb_array_elements_text(coalesce(p_filter->'island_groups',   '[]'::jsonb)) as t(x);
  select array_agg(x)         into v_statuses from jsonb_array_elements_text(coalesce(p_filter->'statuses',        '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_affils   from jsonb_array_elements_text(coalesce(p_filter->'affiliation_ids', '[]'::jsonb)) as t(x);
  select array_agg(x)         into v_roles    from jsonb_array_elements_text(coalesce(p_filter->'role_codes',      '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_depts    from jsonb_array_elements_text(coalesce(p_filter->'department_ids',  '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_cmtes    from jsonb_array_elements_text(coalesce(p_filter->'committee_ids',   '[]'::jsonb)) as t(x);
  select array_agg((x)::uuid) into v_unis     from jsonb_array_elements_text(coalesce(p_filter->'university_ids',  '[]'::jsonb)) as t(x);
  select array_agg((x)::int)  into v_levels   from jsonb_array_elements_text(coalesce(p_filter->'year_levels',     '[]'::jsonb)) as t(x);

  if v_statuses is null or cardinality(v_statuses) = 0 then
    v_statuses := array['active'];
  end if;

  -- ⚠ DELIBERATELY NEVER READS select_all / person_ids / excluded_person_ids. Those are
  -- selection STATE the client overlays on top of whatever page of candidates this
  -- returns; they narrow who counts as a RECIPIENT (resolve_recipients), never who is
  -- visible to search and tick in the picker.
  return query
  with matched as (
    select
      p.id       as person_id,
      p.given_name,
      p.family_name,
      p.member_id,
      r.name     as region_name,
      m.status::text as status,
      m.id       as membership_id
    from public.memberships m
    join public.people  p on p.id = m.person_id
    join public.regions r on r.id = m.region_id
    where m.term_id = v_term
      and p.personal_email is not null
      and p.redacted_at is null
      and m.status::text = any(v_statuses)
      and (v_years   is null or cardinality(v_years)   = 0 or p.join_year = any(v_years))
      and (v_regions is null or cardinality(v_regions) = 0 or m.region_id = any(v_regions))
      and (v_islands is null or cardinality(v_islands) = 0 or r.island_group::text = any(v_islands))
      and (v_levels  is null or cardinality(v_levels)  = 0 or m.year_level = any(v_levels))
      and (v_affils  is null or cardinality(v_affils)  = 0 or exists (
             select 1 from public.member_affiliations ma
              where ma.membership_id = m.id and ma.affiliation_id = any(v_affils)))
      and (v_roles   is null or cardinality(v_roles)   = 0 or exists (
             select 1 from public.officer_assignments oa
              where oa.person_id = p.id and oa.term_id = v_term
                and oa.status = 'active' and oa.role = any(v_roles)))
      and (v_depts   is null or cardinality(v_depts)   = 0 or exists (
             select 1 from public.department_assignments da
              where da.membership_id = m.id and da.department_id = any(v_depts)))
      and (v_cmtes   is null or cardinality(v_cmtes)   = 0 or exists (
             select 1 from public.committee_memberships cm
              where cm.membership_id = m.id and cm.committee_id = any(v_cmtes)))
      and (v_unis    is null or cardinality(v_unis)    = 0 or p.university_id = any(v_unis))
      -- p_q: case-insensitive substring on given_name, family_name, "given family", or
      -- member_id. All four are plain `text` (never `citext`), so a bare ILIKE resolves
      -- fine under this function's `search_path = ''` — no citext-operator trap here.
      and (v_q is null
           or p.given_name ilike '%' || v_q || '%'
           or p.family_name ilike '%' || v_q || '%'
           or (p.given_name || ' ' || p.family_name) ilike '%' || v_q || '%'
           or p.member_id ilike '%' || v_q || '%')
  ),
  enriched as (
    select
      mt.person_id,
      mt.given_name,
      mt.family_name,
      mt.member_id,
      mt.region_name,
      mt.status,
      -- One row per person: the first committee/department by name, mirroring
      -- v_email_merge_fields's own tie-break (0043) so a member on two committees is
      -- never counted, or shown, twice.
      (select d.name
         from public.department_assignments da
         join public.departments d on d.id = da.department_id
        where da.membership_id = mt.membership_id
        order by d.name limit 1) as department_name,
      (select c.name
         from public.committee_memberships cm
         join public.committees c on c.id = cm.committee_id
        where cm.membership_id = mt.membership_id
        order by c.name limit 1) as committee_name,
      -- The title of ONE active officer_assignments row this term, first by
      -- officer_positions.sort_order (CBL listing order) if the person holds more than
      -- one seat — a Chief who also sits on a committee shows the Chief title.
      (select op.title
         from public.officer_assignments oa
         join public.officer_positions op on op.code = oa.role
        where oa.person_id = mt.person_id
          and oa.term_id = v_term
          and oa.status = 'active'
        order by op.sort_order limit 1) as position_title,
      count(*) over ()::bigint as total_count
    from matched mt
  )
  select
    e.person_id, e.given_name, e.family_name, e.member_id, e.region_name,
    e.department_name, e.committee_name, e.position_title, e.status, e.total_count
  from enriched e
  order by e.family_name, e.given_name, e.person_id
  limit v_limit offset v_offset;
end;
$$;

comment on function public.list_audience_candidates(jsonb, text, int, int) is
  'The campaign composer''s people picker (Ethan, 2026-09-06). Applies ONLY the filter '
  'axes resolve_recipients() reads — never select_all/person_ids/excluded_person_ids, '
  'which are client-side selection state, not a further narrowing of who can be searched. '
  'p_q matches given_name, family_name, "given family", or member_id, case-insensitively. '
  'Returns name, member ID, region, department, committee, position — NEVER an email '
  'address. total_count is a window column over the full filtered set, independent of '
  'p_limit/p_offset. crrd_admin / exec_admin only, same guard as resolve_recipients.';

revoke execute on function public.list_audience_candidates(jsonb, text, int, int) from public, anon;
grant  execute on function public.list_audience_candidates(jsonb, text, int, int) to authenticated;
