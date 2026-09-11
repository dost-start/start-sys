-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0062_grad_year_through_term_end.sql
--
-- WHAT:      check_submission_standards() (0045) is re-created with ONE change: the
--            'expected_grad_year' standard now refuses a graduation year EARLIER than the
--            year the active term ends, where 0045 refused any year not LATER than it.
--            `v_grad_year <= end_year` becomes `v_grad_year < end_year`. Every other line
--            of the function is identical to 0045.
--
-- WHY:       Co-officer QA, 2026-09-11: "Students graduating in 2027 cannot apply." The
--            2026–2027 term runs 1 June 2026 to 31 May 2027 (CBL Art. V §1). The standard
--            compares YEARS, so a scholar graduating in mid-2027 — enrolled for the whole
--            term they are applying into — was refused as though already graduated. The
--            project head (Ethan Baltazar) approved the change the same day; ADR 0013 §1.2
--            is amended to match.
--
--            Still refused: a year BEFORE the term's end year (2026 for the 2026–2027 term).
--            The gate is unchanged in where it runs: at submission on /apply and /renew,
--            again inside finalize_application() / finalize_renewal(), and per row in the
--            reviewer's standards check and the "Approve all" batch.
--
-- NOT CHANGED: who is OFFERED the next term's renewal form (PRD US-G7's campaign
--            targeting) is a different question from whether someone may join the current
--            term, and nothing here touches it. ADR 0013 "Costs" already records that the
--            two are separate predicates.
--
-- CITATIONS: ADR 0013 §1.2 (amended 2026-09-11); PRD US-B1, US-G7; CBL Art. V §1.
--
-- ROLLBACK:  forward-only. A later migration re-creates the function with `<=` to restore
--            0045's rule.
-- ═══════════════════════════════════════════════════════════════════════════════════

create or replace function public.check_submission_standards(
  p_email   text,
  p_payload jsonb
) returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term       public.terms;
  v_failures   text[] := '{}'::text[];
  v_grad_year  int;
  v_program    uuid;
  v_university uuid;
  v_award      text;
begin
  select * into v_term from public.terms where status = 'active' limit 1;

  -- Nothing below is evaluable without a term to evaluate it against (see 0045's header).
  if v_term.id is null then
    return array['term'];
  end if;

  -- expected_grad_year: present, a 4-digit year, and NOT EARLIER than the active term's end
  -- year (0062 — was "later than" in 0045). A scholar graduating in the year the term ends
  -- is still enrolled for that term.
  --
  -- ⚠ `x !~ pattern` on a NULL x yields NULL, and plpgsql's IF treats a NULL condition as
  -- FALSE (it takes the ELSE branch), not as "missing". A bare `if val !~ pattern` would
  -- therefore let a MISSING key fall through to the else branch, where `NULL::int` and
  -- every comparison against it is again NULL — silently passing. Every branch below
  -- checks `IS NULL` explicitly, first, so "absent" and "malformed" are both caught.
  if (p_payload ->> 'expected_grad_year') is null
     or (p_payload ->> 'expected_grad_year') !~ '^\d{4}$' then
    v_failures := array_append(v_failures, 'expected_grad_year');
  else
    v_grad_year := (p_payload ->> 'expected_grad_year')::int;
    if v_grad_year < extract(year from v_term.ends_on)::int then
      v_failures := array_append(v_failures, 'expected_grad_year');
    end if;
  end if;

  -- program_id: a uuid naming an ACTIVE public.programs row (0037; PRD OQ-17 closed list).
  if (p_payload ->> 'program_id') is null
     or (p_payload ->> 'program_id') !~ '^[0-9a-f-]{36}$' then
    v_failures := array_append(v_failures, 'program_id');
  else
    v_program := (p_payload ->> 'program_id')::uuid;
    if not exists (
      select 1 from public.programs where id = v_program and is_active
    ) then
      v_failures := array_append(v_failures, 'program_id');
    end if;
  end if;

  -- university_id: a uuid naming an ACTIVE public.universities row (0037).
  if (p_payload ->> 'university_id') is null
     or (p_payload ->> 'university_id') !~ '^[0-9a-f-]{36}$' then
    v_failures := array_append(v_failures, 'university_id');
  else
    v_university := (p_payload ->> 'university_id')::uuid;
    if not exists (
      select 1 from public.universities where id = v_university and is_active
    ) then
      v_failures := array_append(v_failures, 'university_id');
    end if;
  end if;

  -- scholarship_award: one of the five DOST-SEI programs (0038). Compared as plain text —
  -- never cast to public.scholarship_award — so a stray value fails the CHECK rather than
  -- raising an invalid-enum-input error out of a function anon is allowed to call.
  v_award := p_payload ->> 'scholarship_award';
  if v_award is null
     or v_award not in ('ra_7687', 'merit', 'jlss_ra_7687', 'jlss_merit', 'jlss_ra_10612')
  then
    v_failures := array_append(v_failures, 'scholarship_award');
  end if;

  -- award_year: a 4-digit year (mirrors 0041's own award_year guard). `is null or` first,
  -- for the same three-valued-logic reason as above — a bare `!~` on a missing key is
  -- NULL, which an IF with no ELSE silently treats as "nothing to append".
  if (p_payload ->> 'award_year') is null
     or (p_payload ->> 'award_year') !~ '^\d{4}$' then
    v_failures := array_append(v_failures, 'award_year');
  end if;

  -- applicant_email: not the email of a person whose LATEST membership (by term
  -- starts_on) is 'terminated' (CBL Art. VII §3). citext operators are invisible under an
  -- empty search_path (0041's note), hence lower(::text) on both sides.
  if p_email is not null and exists (
    select 1
      from public.people p
     where lower(p.personal_email::text) = lower(btrim(p_email))
       and (
         select m.status
           from public.memberships m
           join public.terms t on t.id = m.term_id
          where m.person_id = p.id
          order by t.starts_on desc
          limit 1
       ) = 'terminated'
  ) then
    v_failures := array_append(v_failures, 'applicant_email');
  end if;

  return v_failures;
end;
$$;

comment on function public.check_submission_standards(text, jsonb) is
  'ADR 0013 §1 (amended 2026-09-11, 0062): the checkable submission-time standards, as '
  'failing field keys (empty = passes). No role guard — called by anon at submission and by '
  'the reviewer queue informationally; returns only field-key strings, never PII. term / '
  'expected_grad_year (not earlier than the active term''s end year) / program_id / '
  'university_id / scholarship_award / award_year / applicant_email. PRD US-B1, US-G7; '
  'CBL Art. VII §3, Art. I §4.';

-- `create or replace` keeps the existing grants; restated so this file reads on its own.
revoke execute on function public.check_submission_standards(text, jsonb) from public;
grant  execute on function public.check_submission_standards(text, jsonb) to   anon, authenticated;
