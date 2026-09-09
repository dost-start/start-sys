#!/usr/bin/env python3
"""
Turn the PSA's PSGC publication into the `psgc_locations` seed migration.

RUN THIS ONLY WHEN THE PSA PUBLISHES A NEW QUARTER, and commit BOTH the workbook's
identifying details (printed below, copied into the migration header) and the generated
SQL. The generator is committed so the next maintainer can see exactly how 43,769 rows
of national geography got into the repository, and reproduce it rather than trust it.

    python3 scripts/generate-psgc-migration.py "~/Downloads/PSGC Q4 2025 Updates.xlsx" \
        supabase/migrations/0057_psgc_locations.sql

WHY A SCRIPT AND NOT A FETCH: psa.gov.ph refuses automated requests (403, checked
2026-09-09 with a browser user-agent). The workbook is downloaded by hand, once, and its
publication date is pinned in the migration header — so "which PSGC is this?" has an
answer years later.

⚠ THE 10-DIGIT CODE IS `RR PPP MM BBB`: region(2) province(3) city-or-municipality(2)
barangay(3). Verified against this file, not assumed — see `derive_parent`.
"""

import sys
import unicodedata
from pathlib import Path

import openpyxl

# PSA "Geographic Level" -> our psgc_level enum.
#
# `SubMun` is Manila's fourteen districts (Tondo, Binondo, Sampaloc, …). They are a REAL
# level between city and barangay and are kept as one: Binondo's barangays are named
# "Barangay 287"…"Barangay 296", so collapsing the district away would leave a Manila
# resident choosing between numbers with nothing to disambiguate them. Ethan's own example
# was "Binondo in Manila".
LEVELS = {
    "Reg": "region",
    "Prov": "province",
    "City": "city",
    "Mun": "municipality",
    "SubMun": "sub_municipality",
    "Bgy": "barangay",
}

# Two rows carry no Geographic Level in the PSA file and both are province-EQUIVALENTS —
# containers that sit in the province slot and hold cities/municipalities:
#   0990100000  "City of Isabela (Not a Province)" — in Basilan geographically, administered
#               under Region IX; the PSA's own label says it is not a province.
#   1999900000  "Special Geographic Area" — the 63 barangays of Cotabato that voted into
#               BARMM in the 2019 plebiscite and are not yet inside a province.
# Classified here rather than skipped, because their descendants are real addresses.
UNLEVELLED_AS_PROVINCE = {"0990100000", "1999900000"}

# Rows per INSERT statement. Small enough that one statement stays readable in a diff and
# well inside any parser limit; large enough that the file is ~90 statements, not 43,769.
BATCH = 500

# PSA region code -> our `regions.code` (DATA_MODEL §6/0016, 18 rows incl. RA 12000's NIR).
# ⚠ 16 is Caraga, which we seed as `R13` (Region XIII) — the PSA's numbering and the
# region's Roman numeral disagree, and this is the one row where a careless mapping would
# put every Caraga address in the wrong region.
REGION_CODE_MAP = {
    "01": "R01", "02": "R02", "03": "R03", "04": "R04A", "05": "R05",
    "06": "R06", "07": "R07", "08": "R08", "09": "R09", "10": "R10",
    "11": "R11", "12": "R12", "13": "NCR", "14": "CAR", "16": "R13",
    "17": "MIMAROPA", "18": "NIR", "19": "BARMM",
}


def clean(name: str) -> str:
    """Trim, collapse inner whitespace, and normalise to NFC.

    The PSA file mixes trailing spaces ("Bangued ") and composed/decomposed accents in the
    same column, so `Peña` can arrive two ways that compare unequal. NFC once, here, means
    the trigram index and the backfill's exact-match comparison both see one spelling.
    """
    return unicodedata.normalize("NFC", " ".join(str(name).split()))


def read_rows(xlsx: Path):
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)

    meta = {}
    for row in wb["Metadata"].iter_rows(max_row=12, values_only=True):
        if row and row[0] and row[1]:
            meta[str(row[0]).strip().rstrip(":")] = clean(row[1])

    sheet = wb["PSGC"]
    rows = sheet.iter_rows(values_only=True)
    next(rows)  # header

    out = []
    for r in rows:
        if r[0] is None and r[1] is None:
            continue
        code = str(r[0]).strip().zfill(10)
        name = clean(r[1] or "")
        raw_level = r[3]
        if raw_level in LEVELS:
            level = LEVELS[raw_level]
        elif code in UNLEVELLED_AS_PROVINCE:
            level = "province"
        else:
            raise SystemExit(f"unclassified row: {code} {name!r} level={raw_level!r}")
        if not name:
            raise SystemExit(f"row with no name: {code}")
        out.append((code, name, level))
    return meta, out


def derive_parent(code: str, known: set[str]) -> str | None:
    """The nearest ancestor that actually exists in this publication.

    Truncating in order — city/municipality slot, then province slot, then region — rather
    than switching on the level, because the exceptions are not exceptional enough to
    enumerate and every one of them falls out of this rule correctly:

      · NCR has no provinces, so its highly urbanised cities sit in the PROVINCE slot
        (City of Caloocan is 13-801-00-000) and their parent resolves straight to the
        region. That is Ethan's "NCR skips the province level", and it is the PSA's
        structure rather than something we impose.
      · Pateros is the one NCR municipality; same shape, same resolution.
      · Manila's sub-municipalities sit in the city slot under the city (Binondo is
        13-806-02-000, parent 13-806-00-000 = City of Manila).
      · A barangay under an NCR city truncates to that city because the city occupies the
        province slot; a barangay under an ordinary municipality truncates to the
        municipality. Same expression, both correct.
    """
    if code.endswith("00000000"):
        return None  # a region
    for candidate in (code[:7] + "000", code[:5] + "00000", code[:2] + "00000000"):
        if candidate != code and candidate in known:
            return candidate
    return None


def sql_literal(value: str | None) -> str:
    """A single-quoted SQL literal, or NULL.

    `standard_conforming_strings` is on, so a backslash is an ordinary character and only
    the quote needs doubling. PSA place names genuinely contain apostrophes
    (`Bo. Obrero`, `Sto. Niño`, `Balite 1st`), so this is exercised, not theoretical.
    """
    if value is None:
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    xlsx, out_path = Path(sys.argv[1]).expanduser(), Path(sys.argv[2])

    meta, rows = read_rows(xlsx)
    known = {code for code, _, _ in rows}

    counts: dict[str, int] = {}
    orphans: list[str] = []
    prepared = []
    for code, name, level in rows:
        parent = derive_parent(code, known)
        if parent is None and level != "region":
            orphans.append(f"{code} {name} ({level})")
        counts[level] = counts.get(level, 0) + 1
        prepared.append((code, name, level, parent))

    if orphans:
        raise SystemExit("rows with no resolvable parent:\n  " + "\n  ".join(orphans))

    region_codes = sorted({c[:2] for c, _, level, _ in prepared if level == "region"})
    unmapped = [rc for rc in region_codes if rc not in REGION_CODE_MAP]
    if unmapped:
        raise SystemExit(f"PSA regions with no entry in REGION_CODE_MAP: {unmapped}")

    # Deterministic order: by code. A regenerated file must diff cleanly against the last
    # one, or a maintainer cannot see what a new quarter actually changed.
    prepared.sort(key=lambda r: r[0])

    header = f"""-- ═══════════════════════════════════════════════════════════════════════════════════
-- {out_path.name}
--
-- ⚠ GENERATED FILE — DO NOT HAND-EDIT.
--   Produced by scripts/generate-psgc-migration.py from the PSA workbook named below.
--   A new quarter is a NEW migration generated the same way, never an edit to this one.
--
-- WHAT:      `psgc_locations` — the Philippine Standard Geographic Code as rows, so the
--            two public forms can ask for an address with four dropdowns instead of three
--            free-text boxes. {len(prepared):,} rows.
--
-- WHY:       Ethan, 2026-09-09: "let's make it drop down with drop down filter instead of
--            typing it … the only thing that they will type is their address and postal
--            code." Typed city and province names are unsearchable, unfilterable, and
--            wrong in a dozen spellings each ("Q.C.", "Quezon City", "quezon city").
--
-- SOURCE:    {meta.get('Title', 'Philippine Standard Geographic Code (PSGC)')}
--            {meta.get('Originator', 'Philippine Statistics Authority (PSA)')}
--            Publication date: {meta.get('Publication date', 'unknown')}
--            File: {xlsx.name}
--            Downloaded by hand on 2026-09-09 — psa.gov.ph answers 403 to a scripted
--            request, so this cannot be fetched by CI and the provenance is the pin.
--
-- ATTRIBUTION: the PSA's use constraint is acknowledgement, which the privacy notice and
--            this header carry. There is no licence fee and no redistribution limit.
--
-- SHAPE:     One self-referencing table, not four. The cascade is then "give me the
--            children of what was just picked", which is one query and one policy — and
--            it handles the two places the hierarchy is NOT four levels deep without a
--            single special case in the application:
--              · NCR has no provinces, so its cities hang directly off the region.
--              · City of Manila has fourteen SUB-MUNICIPALITIES (Tondo, Binondo,
--                Sampaloc …) between the city and the barangay. Ethan's own example was
--                "Binondo in Manila", and Binondo's barangays are called "Barangay 287"
--                through "Barangay 296" — collapsing that level away would leave a Manila
--                resident choosing between bare numbers.
--
-- COUNTS:    {' · '.join(f'{k} {v:,}' for k, v in sorted(counts.items()))}
--
-- ROLLBACK:  Forward-only. Reference data; nothing references it with ON DELETE.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- The levels the PSA publishes. An enum rather than a table: this is fixed by national
-- statistics law, not by anything CRRD adds (DATA_MODEL.md §13 rule 8).
create type public.psgc_level as enum
  ('region', 'province', 'city', 'municipality', 'sub_municipality', 'barangay');

comment on type public.psgc_level is
  'PSA Geographic Level. `sub_municipality` is Manila''s fourteen districts, which sit '
  'between city and barangay and are a real address component there.';

create table public.psgc_locations (
  -- The PSA's own 10-digit code, `RR PPP MM BBB`. The natural key, deliberately: it is
  -- what the PSA publishes, what every other Philippine system keys on, and what makes a
  -- regenerated quarter diff cleanly against this one. A surrogate uuid would change on
  -- every regeneration and take every stored address with it.
  code        text primary key
              constraint psgc_code_is_ten_digits check (code ~ '^[0-9]{{10}}$'),
  name        text not null check (length(btrim(name)) > 0),
  level       public.psgc_level not null,
  -- Null only for a region. Self-referencing, so the cascade is one recursive shape
  -- rather than four joins.
  parent_code text references public.psgc_locations(code),
  -- Retire, never delete: a barangay that is dissolved must still resolve for the members
  -- whose stored address names it. Nothing in this schema hard-deletes (CLAUDE.md).
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint psgc_region_has_no_parent
    check ((level = 'region') = (parent_code is null))
);

comment on table public.psgc_locations is
  'The Philippine Standard Geographic Code as rows (PSA, see the migration header for the '
  'publication pinned). Reference data: anon-readable, written only by a migration.';

-- The cascade's only query shape: "the active children of X, in name order".
create index psgc_locations_parent on public.psgc_locations (parent_code, name)
  where is_active;
create index psgc_locations_level  on public.psgc_locations (level);
-- An EXPRESSION index rather than a stored `region_psgc` column: the region prefix is the
-- first two characters of the code and duplicating it into a column would be a second copy
-- of a fact the primary key already carries.
create index psgc_locations_region on public.psgc_locations (left(code, 2));
-- Search-as-you-type over ~42,000 barangays needs the same trigram treatment as member
-- names (0004), or the picker table-scans on every keystroke.
create index psgc_locations_name_trgm on public.psgc_locations
  using gin (name gin_trgm_ops);

alter table public.psgc_locations enable row level security;
alter table public.psgc_locations force row level security;

-- Read by everyone including anon: `/apply` and `/renew` are ANONYMOUS forms and cannot
-- render an address picker they may not read. This is national public reference data — the
-- same reasoning that makes `regions`, `universities` and `programs` anon-readable
-- (0015_grants.sql §4, 0037). It discloses nothing about any person.
create policy psgc_locations_read on public.psgc_locations
  for select to anon, authenticated
  using (true);

-- NO INSERT, UPDATE OR DELETE POLICY, for any role, ever. A new PSA quarter is a new
-- migration; nobody edits national geography from the application.

revoke all on public.psgc_locations from anon, authenticated;
grant select on public.psgc_locations to anon, authenticated;

-- ── The data ────────────────────────────────────────────────────────────────────────
-- ⚠ MULTI-ROW INSERTS, NOT `COPY ... FROM stdin`, AND THIS IS NOT A STYLE CHOICE.
-- `COPY ... FROM stdin` needs the psql FRONTEND PROTOCOL to stream the rows after the
-- statement. The Supabase CLI applies migrations over an ordinary Postgres connection, so
-- it sends the whole file as SQL and the server answers
-- `unexpected message type 0x50 during COPY from stdin (08P01)`. Discovered in CI on
-- 2026-09-09; `supabase db reset` locally uses psql and would have hidden it.
--
-- Batched {BATCH:,} rows to a statement: one parse per batch instead of {len(prepared):,},
-- and a file that still diffs line-by-line between quarters.
--
-- Parents are ordered before children by construction (the codes sort that way), so the
-- self-referencing FK is satisfied row by row without deferring it.
"""

    lines = [header]
    for start in range(0, len(prepared), BATCH):
        chunk = prepared[start : start + BATCH]
        lines.append(
            "insert into public.psgc_locations (code, name, level, parent_code) values"
        )
        rows = [
            f"  ({sql_literal(code)}, {sql_literal(name)}, {sql_literal(level)}, {sql_literal(parent)})"
            for code, name, level, parent in chunk
        ]
        lines.append(",\n".join(rows) + ";")
        lines.append("")

    footer = """
-- ── 2. Our eighteen regions gain their PSA code ─────────────────────────────────────
-- `regions` is OUR table (0003) with our own codes; `psgc_locations` is the PSA's. This
-- column is the join between them, and it is the only place the two vocabularies meet.
--
-- ⚠ THE ONE THAT WOULD SILENTLY BE WRONG: PSA `16` is Region XIII (Caraga), which we seed
-- as `R13`. The PSA's numbering and the region's own Roman numeral disagree, so a mapping
-- written from the numbers alone puts every Caraga address in Region XVI, which does not
-- exist. Asserted in pgTAP rather than trusted.
alter table public.regions
  add column psgc_code text
    constraint regions_psgc_code_is_two_digits check (psgc_code ~ '^[0-9]{2}$');

comment on column public.regions.psgc_code is
  'The PSA''s two-digit region code, joining `regions` to the first two characters of '
  'psgc_locations.code. '
  'Note PSA 16 = Region XIII (Caraga) = our `R13`.';

update public.regions set psgc_code = v.psgc
from (values
"""
    pairs = sorted(REGION_CODE_MAP.items())
    footer += ",\n".join(f"  ('{ours}', '{psa}')" for psa, ours in
                         sorted(((p, o) for p, o in pairs), key=lambda x: x[1]))
    footer += """
) as v(code, psgc)
where public.regions.code = v.code;

-- Every region must now carry one, and they must be distinct — a null or a duplicate here
-- is an address cascade that silently drops or doubles a region.
alter table public.regions alter column psgc_code set not null;
create unique index regions_psgc_code_unique on public.regions (psgc_code);
"""
    lines.append(footer)

    out_path.write_text("\n".join(lines))

    print(f"wrote {out_path}  ({out_path.stat().st_size/1_048_576:.2f} MB)")
    print(f"  publication: {meta.get('Publication date')}")
    print(f"  rows: {len(prepared):,}")
    for k, v in sorted(counts.items()):
        print(f"    {k:18} {v:,}")


if __name__ == "__main__":
    main()
