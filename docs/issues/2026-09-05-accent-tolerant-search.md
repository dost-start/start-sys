# 2026-09-05 — Member search is case-tolerant but NOT accent-tolerant (US-I2 partially unmet)

**Status:** Open — accepted gap, scheduled for v1.1
**Severity:** Low (a correctness gap in one acceptance criterion; no data or access impact)
**Owner:** S5 database lane → next available slice
**Raised by:** BUILD_PLAN S5-T4, whose 45-minute timebox expired against a file this lane must not edit

---

## Symptom

`PRD US-I2` states: *"Partial-name search returns matches; search is **case- and
accent-tolerant**."*

Half of that ships. Searching `dela cruz` finds **Juan Dela Cruz**; searching `Peña` finds
**José Peña**. Searching `Pena` does **not** find **José Peña**, and searching `Peña` does not
find a record stored as `Pena`.

Reproduce against a database with `supabase/seeds/dev_members.sql` applied (person index 5
carries the diacritic surname):

```sql
select count(*) from public.search_member_directory(p_q => 'Peña');  -- 1
select count(*) from public.search_member_directory(p_q => 'Pena');  -- 0  ← the gap
```

## Impact

An officer looking up a scholar whose surname carries a diacritic — Peña, Muñoz, Ibañez,
Nuñez, all common in a Philippine membership roll — has to type the diacritic, from a
keyboard layout that may not offer it, and has to spell it the same way the applicant did.
A CRRD officer who cannot find a member by name falls back to browsing, which is the
spreadsheet behaviour this system exists to replace (PRD §1).

This is a **usability gap in one acceptance criterion**, not a security or data-integrity
one. Nothing is exposed, nothing is lost, and every other axis of `PRD §3 v1.0 item 12` —
partial name, partial member ID, case-insensitivity, and all five filter dimensions — is
implemented and asserted in `supabase/tests/063_member_search_scope.sql`.

## Cause

Two different mechanisms, and only one of them is free.

**Case tolerance is free.** `pg_trgm` lowercases when it extracts trigrams, so
`people_name_trgm` (0004) and `idx_people_member_id_trgm` (0029) both serve an `ILIKE`
without any wrapper. `search_member_directory()` (0030) writes its predicate as a bare
`ILIKE` on `(given_name || ' ' || family_name)` — matching `people_name_trgm`'s indexed
expression character for character — and on `member_id`. Assertion 7 in `063` proves it.

**Accent folding is not.** It needs three things this lane could not ship:

1. **The `unaccent` extension**, which is not enabled. It would belong in
   `0001_extensions.sql`, and `HARD RULES` forbid this lane from editing migrations 0001–0027.
   A separate migration enabling it is possible, but see (3).
2. **An `IMMUTABLE` wrapper.** `unaccent(text)` is only `STABLE` — it reads a dictionary
   configuration — and Postgres refuses to build an index on a non-immutable expression. The
   standard workaround is a one-argument `IMMUTABLE` wrapper around
   `unaccent('unaccent'::regdictionary, $1)`, which is safe in practice but is a deliberate
   lie to the planner and must be re-examined if the dictionary is ever changed.
3. **A second functional GIN index** on the folded expression, plus a rewritten predicate
   folding both sides. That predicate no longer matches `people_name_trgm`, so the existing
   index stops being used for name search and the new one replaces it — a change worth
   measuring rather than assuming, and the measurement (S7-T19) does not exist yet.

`BUILD_PLAN` S5-T4 scoped the whole item as droppable behind a 45-minute timebox precisely
because of this shape: it is three coupled changes across an extension, an index and a query
plan, for one clause of one acceptance criterion.

## Fix (deferred)

One migration, in a slice that also owns the benchmark so the index swap is measured:

```sql
create extension if not exists unaccent;

create or replace function public.immutable_unaccent(text) returns text
language sql immutable strict parallel safe
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;
-- ⚠ the schema qualification above depends on where `unaccent` actually installs; on a
--    platform that pre-installs extensions it is `extensions`, on a plain Postgres it
--    follows search_path. Resolve it at authoring time, not from this document.

create index idx_people_name_unaccent_trgm on public.people
  using gin (public.immutable_unaccent(given_name || ' ' || family_name) gin_trgm_ops);
```

…then rewrite `search_member_directory()`'s name predicate to fold both sides, and extend
`063_member_search_scope.sql` with the two assertions that close this issue:

```sql
select is((select count(*)::int from public.search_member_directory(p_q => 'Pena')), 1,
  'accent-FOLDED search finds José Peña — PRD US-I2''s accent criterion');
select is((select count(*)::int from public.search_member_directory(p_q => 'Peña')), 1,
  'and the diacritic spelling still works — folding must not replace the exact match');
```

`supabase/seeds/dev_members.sql` and `supabase/tests/helpers/fixtures.psql` both already carry
a diacritic surname (`Peña`) specifically so this is testable the day the index lands.

## Prevention

The gap is **recorded rather than claimed**. Two places state it plainly so nobody reads
US-I2 as fully met:

- the header of `supabase/migrations/0029_member_search_indexes.sql`, under "NOT HERE, AND IT
  IS A DECISION RATHER THAN AN OMISSION";
- the header of `supabase/tests/063_member_search_scope.sql`, whose assertion 6 searches
  `'Peña'` **with the diacritic intact** rather than searching `'Pena'` and quietly asserting
  the wrong thing.

The failure mode this avoids is the common one: a test written as `search('Pena') = 0`, which
passes, reads as coverage, and encodes the bug as the expected behaviour.
