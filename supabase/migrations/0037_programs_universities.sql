-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0037_programs_universities.sql  —  two reference tables the SRS forms select from
--
-- WHAT:
--   programs      the closed list of accredited programs an applicant chooses from.
--                 Thirteen rows, verbatim from the CRRD SRS ("Questions Roles and
--                 Features", 2026-09-05), which restates CBL Art. I §4. This CLOSES PRD
--                 OQ-17: the form offers a closed list, not free text. Art. VII §2.4 makes
--                 the list amendment-paced, so a new program is a CRRD row edit citing the
--                 amendment, never a code change.
--   universities  the institutions an applicant chooses from, each tied to a region so the
--                 Regional Representative view can filter by university (meeting 2026-09-05:
--                 "point person per university … filter students per university").
--                 ⚠ SEEDED AS A STARTER LIST, NOT AN AUTHORITY. The org wants the DOST-SEI
--                 list of eligible institutions (fallback: the CHED list of HEIs by region);
--                 neither was obtainable as data on 2026-09-06, so this seed carries the
--                 state universities and the larger private institutions of every region,
--                 by region code. CRRD edits rows; nothing hangs on the exact set.
--
-- Both are "rows, not code" (ARCHITECTURE.md §8 Extensibility): the form is hardcoded, the
-- CHOICES come from these tables (meeting 2026-09-05: "form is hardcoded but choices are
-- flexible based on the data").
--
-- RLS: ENABLE + FORCE (S1-T15 meta-test). SELECT to anon and authenticated — the public
-- application form has to render the dropdowns before anyone is signed in. INSERT/UPDATE to
-- crrd_admin (the SRS's "manage members, committees and departments" operational tier) and
-- tech_admin. No DELETE policy, no DELETE grant: a program that stops being accredited or a
-- university that closes is `is_active = false`, so history keeps its foreign keys.
--
-- ROLLBACK: forward-only. Both tables are additive; 0038 references them.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── programs ───────────────────────────────────────────────────────────────────────
create table public.programs (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null unique,
  is_active  boolean not null default true,
  sort_order int  not null,
  created_at timestamptz not null default now()
);

comment on table public.programs is
  'Accredited programs an applicant may declare — CRRD SRS 2026-09-05 (thirteen, verbatim), '
  'restating CBL Art. I §4. Closed list (PRD OQ-17 resolved). Amendment-paced per Art. VII '
  '§2.4: a new program is a row citing the amendment. Never deleted; is_active = false.';

-- ── universities ───────────────────────────────────────────────────────────────────
create table public.universities (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  region_id         uuid not null references public.regions(id),
  city_municipality text,
  kind              text not null check (kind in ('public', 'private')),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create index universities_region on public.universities (region_id, name);

comment on table public.universities is
  'Institutions an applicant may declare, each in one region (meeting 2026-09-05: the RR '
  'view filters by university). STARTER LIST seeded 2026-09-06 — state universities and '
  'major private institutions per region, pending the DOST-SEI eligible-institution list. '
  'CRRD edits; never deleted (is_active = false).';

-- ── RLS ────────────────────────────────────────────────────────────────────────────
alter table public.programs     enable row level security;
alter table public.programs     force  row level security;
alter table public.universities enable row level security;
alter table public.universities force  row level security;

-- Supabase's default privileges grant ALL on a new public table. Take everything back and
-- hand out only what the policies below can ever use — in particular NO DELETE, which is
-- what keeps 0015's "zero DELETE grants anywhere in public" true for these two tables.
revoke all on public.programs     from anon, authenticated;
revoke all on public.universities from anon, authenticated;
grant select         on public.programs     to anon, authenticated;
grant select         on public.universities to anon, authenticated;
grant insert, update on public.programs     to authenticated;
grant insert, update on public.universities to authenticated;

-- why: the public form (anon) renders both dropdowns; every signed-in tier may read them.
create policy programs_read on public.programs
  for select to anon, authenticated
  using (true);

create policy universities_read on public.universities
  for select to anon, authenticated
  using (true);

-- why: reference data is CRRD's to maintain (SRS: "manage members, committees and
-- departments") and the CTO's to correct. Two policies, INSERT and UPDATE, never `for all`
-- — a `for all` policy would carry DELETE with it.
create policy programs_insert on public.programs
  for insert to authenticated
  with check (public.auth_role() in ('crrd_admin', 'tech_admin'));

create policy programs_update on public.programs
  for update to authenticated
  using      (public.auth_role() in ('crrd_admin', 'tech_admin'))
  with check (public.auth_role() in ('crrd_admin', 'tech_admin'));

create policy universities_insert on public.universities
  for insert to authenticated
  with check (public.auth_role() in ('crrd_admin', 'tech_admin'));

create policy universities_update on public.universities
  for update to authenticated
  using      (public.auth_role() in ('crrd_admin', 'tech_admin'))
  with check (public.auth_role() in ('crrd_admin', 'tech_admin'));

-- ── seed: the thirteen programs (SRS, verbatim; CBL Art. I §4) ─────────────────────
insert into public.programs (code, name, sort_order) values
  ('APPLIED_MATH',  'Applied Mathematics',                                                                              10),
  ('TLE_ICT',       'Technology and Livelihood Education with Specialization in Information and Communication Technology', 20),
  ('CPE',           'Computer Engineering',                                                                             30),
  ('CS',            'Computer Science',                                                                                 40),
  ('ECE',           'Electronics and Communication Engineering',                                                        50),
  ('IME_IT',        'Industrial Management Engineering – Information Technology',                                       60),
  ('ICT',           'Information and Communications Technology',                                                        70),
  ('IS',            'Information Systems',                                                                              80),
  ('IT',            'Information Technology',                                                                           90),
  ('ITS',           'Information Technology Systems',                                                                  100),
  ('MIS',           'Management Information Systems',                                                                  110),
  ('STAT',          'Statistics',                                                                                      120),
  ('MECHATRONICS',  'Mechatronics Engineering',                                                                        130)
on conflict (code) do nothing;

-- ── seed: starter universities by region ───────────────────────────────────────────
-- Region resolved by CODE, never by uuid (0016 generates region ids). A row whose region
-- code is unknown is silently skipped by the join, which is the safe failure.
insert into public.universities (name, region_id, city_municipality, kind)
select v.name, r.id, v.city, v.kind
from (values
  -- NCR
  ('University of the Philippines Diliman',                       'NCR',      'Quezon City',            'public'),
  ('University of the Philippines Manila',                        'NCR',      'Manila',                 'public'),
  ('Polytechnic University of the Philippines',                   'NCR',      'Manila',                 'public'),
  ('Technological University of the Philippines',                 'NCR',      'Manila',                 'public'),
  ('Philippine Normal University',                                'NCR',      'Manila',                 'public'),
  ('Pamantasan ng Lungsod ng Maynila',                            'NCR',      'Manila',                 'public'),
  ('Rizal Technological University',                              'NCR',      'Mandaluyong',            'public'),
  ('Ateneo de Manila University',                                 'NCR',      'Quezon City',            'private'),
  ('De La Salle University',                                      'NCR',      'Manila',                 'private'),
  ('University of Santo Tomas',                                   'NCR',      'Manila',                 'private'),
  ('Mapúa University',                                            'NCR',      'Manila',                 'private'),
  ('Adamson University',                                          'NCR',      'Manila',                 'private'),
  ('Far Eastern University',                                      'NCR',      'Manila',                 'private'),
  ('University of the East',                                      'NCR',      'Manila',                 'private'),
  ('Technological Institute of the Philippines',                  'NCR',      'Quezon City',            'private'),
  ('National University',                                         'NCR',      'Manila',                 'private'),
  ('Asia Pacific College',                                        'NCR',      'Makati',                 'private'),
  -- CAR
  ('University of the Philippines Baguio',                        'CAR',      'Baguio City',            'public'),
  ('Benguet State University',                                    'CAR',      'La Trinidad',            'public'),
  ('Saint Louis University',                                      'CAR',      'Baguio City',            'private'),
  ('University of the Cordilleras',                               'CAR',      'Baguio City',            'private'),
  -- Region I
  ('Mariano Marcos State University',                             'R01',      'Batac',                  'public'),
  ('Don Mariano Marcos Memorial State University',                'R01',      'Bacnotan',               'public'),
  ('University of Northern Philippines',                          'R01',      'Vigan',                  'public'),
  ('Pangasinan State University',                                 'R01',      'Lingayen',               'public'),
  ('Saint Louis College',                                         'R01',      'San Fernando',           'private'),
  -- Region II
  ('Cagayan State University',                                    'R02',      'Tuguegarao',             'public'),
  ('Isabela State University',                                    'R02',      'Echague',                'public'),
  ('Nueva Vizcaya State University',                              'R02',      'Bayombong',              'public'),
  ('University of Saint Louis Tuguegarao',                        'R02',      'Tuguegarao',             'private'),
  -- Region III
  ('Bulacan State University',                                    'R03',      'Malolos',                'public'),
  ('Central Luzon State University',                              'R03',      'Science City of Muñoz',  'public'),
  ('Tarlac State University',                                     'R03',      'Tarlac City',            'public'),
  ('Pampanga State Agricultural University',                      'R03',      'Magalang',               'public'),
  ('Don Honorio Ventura State University',                        'R03',      'Bacolor',                'public'),
  ('Nueva Ecija University of Science and Technology',            'R03',      'Cabanatuan',             'public'),
  ('Bataan Peninsula State University',                           'R03',      'Balanga',                'public'),
  ('President Ramon Magsaysay State University',                  'R03',      'Iba',                    'public'),
  ('Holy Angel University',                                       'R03',      'Angeles City',           'private'),
  -- Region IV-A
  ('University of the Philippines Los Baños',                     'R04A',     'Los Baños',              'public'),
  ('Batangas State University',                                   'R04A',     'Batangas City',          'public'),
  ('Cavite State University',                                     'R04A',     'Indang',                 'public'),
  ('Laguna State Polytechnic University',                         'R04A',     'Santa Cruz',             'public'),
  ('University of Rizal System',                                  'R04A',     'Tanay',                  'public'),
  ('Southern Luzon State University',                             'R04A',     'Lucban',                 'public'),
  ('De La Salle University – Dasmariñas',                         'R04A',     'Dasmariñas',             'private'),
  ('Lyceum of the Philippines University – Batangas',             'R04A',     'Batangas City',          'private'),
  ('University of Batangas',                                      'R04A',     'Batangas City',          'private'),
  -- MIMAROPA (Region IV-B)
  ('Mindoro State University',                                    'MIMAROPA', 'Calapan',                'public'),
  ('Occidental Mindoro State College',                            'MIMAROPA', 'San Jose',               'public'),
  ('Marinduque State University',                                 'MIMAROPA', 'Boac',                   'public'),
  ('Romblon State University',                                    'MIMAROPA', 'Odiongan',               'public'),
  ('Palawan State University',                                    'MIMAROPA', 'Puerto Princesa',        'public'),
  ('Western Philippines University',                              'MIMAROPA', 'Aborlan',                'public'),
  -- Region V
  ('Bicol University',                                            'R05',      'Legazpi City',           'public'),
  ('Central Bicol State University of Agriculture',               'R05',      'Pili',                   'public'),
  ('Camarines Sur Polytechnic Colleges',                          'R05',      'Nabua',                  'public'),
  ('Sorsogon State University',                                   'R05',      'Sorsogon City',          'public'),
  ('Catanduanes State University',                                'R05',      'Virac',                  'public'),
  ('Ateneo de Naga University',                                   'R05',      'Naga City',              'private'),
  ('University of Nueva Caceres',                                 'R05',      'Naga City',              'private'),
  -- Region VI
  ('University of the Philippines Visayas',                       'R06',      'Miagao',                 'public'),
  ('West Visayas State University',                               'R06',      'Iloilo City',            'public'),
  ('Iloilo Science and Technology University',                    'R06',      'Iloilo City',            'public'),
  ('Aklan State University',                                      'R06',      'Banga',                  'public'),
  ('Capiz State University',                                      'R06',      'Roxas City',             'public'),
  ('University of Antique',                                       'R06',      'Sibalom',                'public'),
  ('Central Philippine University',                               'R06',      'Iloilo City',            'private'),
  ('University of San Agustin',                                   'R06',      'Iloilo City',            'private'),
  -- Negros Island Region
  ('Central Philippines State University',                        'NIR',      'Kabankalan',             'public'),
  ('Carlos Hilado Memorial State University',                     'NIR',      'Talisay City',           'public'),
  ('Negros Oriental State University',                            'NIR',      'Dumaguete',              'public'),
  ('University of St. La Salle',                                  'NIR',      'Bacolod',                'private'),
  ('University of Negros Occidental – Recoletos',                 'NIR',      'Bacolod',                'private'),
  ('Silliman University',                                         'NIR',      'Dumaguete',              'private'),
  -- Region VII
  ('University of the Philippines Cebu',                          'R07',      'Cebu City',              'public'),
  ('Cebu Technological University',                               'R07',      'Cebu City',              'public'),
  ('Cebu Normal University',                                      'R07',      'Cebu City',              'public'),
  ('Bohol Island State University',                               'R07',      'Tagbilaran',             'public'),
  ('University of San Carlos',                                    'R07',      'Cebu City',              'private'),
  ('Cebu Institute of Technology – University',                   'R07',      'Cebu City',              'private'),
  ('University of Cebu',                                          'R07',      'Cebu City',              'private'),
  ('University of San Jose – Recoletos',                          'R07',      'Cebu City',              'private'),
  ('Holy Name University',                                        'R07',      'Tagbilaran',             'private'),
  -- Region VIII
  ('Visayas State University',                                    'R08',      'Baybay',                 'public'),
  ('University of the Philippines Tacloban College',              'R08',      'Tacloban',               'public'),
  ('Leyte Normal University',                                     'R08',      'Tacloban',               'public'),
  ('Eastern Visayas State University',                            'R08',      'Tacloban',               'public'),
  ('Samar State University',                                      'R08',      'Catbalogan',             'public'),
  ('University of Eastern Philippines',                           'R08',      'Catarman',               'public'),
  -- Region IX
  ('Western Mindanao State University',                           'R09',      'Zamboanga City',         'public'),
  ('Zamboanga State College of Marine Sciences and Technology',   'R09',      'Zamboanga City',         'public'),
  ('Jose Rizal Memorial State University',                        'R09',      'Dapitan',                'public'),
  ('Ateneo de Zamboanga University',                              'R09',      'Zamboanga City',         'private'),
  -- Region X
  ('Mindanao State University – Iligan Institute of Technology',  'R10',      'Iligan',                 'public'),
  ('University of Science and Technology of Southern Philippines','R10',      'Cagayan de Oro',         'public'),
  ('Central Mindanao University',                                 'R10',      'Maramag',                'public'),
  ('Bukidnon State University',                                   'R10',      'Malaybalay',             'public'),
  ('Xavier University – Ateneo de Cagayan',                       'R10',      'Cagayan de Oro',         'private'),
  ('Liceo de Cagayan University',                                 'R10',      'Cagayan de Oro',         'private'),
  -- Region XI
  ('University of the Philippines Mindanao',                      'R11',      'Davao City',             'public'),
  ('University of Southeastern Philippines',                      'R11',      'Davao City',             'public'),
  ('Davao Oriental State University',                             'R11',      'Mati',                   'public'),
  ('Ateneo de Davao University',                                  'R11',      'Davao City',             'private'),
  ('University of Mindanao',                                      'R11',      'Davao City',             'private'),
  ('University of the Immaculate Conception',                     'R11',      'Davao City',             'private'),
  -- Region XII
  ('Mindanao State University – General Santos',                  'R12',      'General Santos',         'public'),
  ('University of Southern Mindanao',                             'R12',      'Kabacan',                'public'),
  ('Sultan Kudarat State University',                             'R12',      'Tacurong',               'public'),
  ('Notre Dame of Marbel University',                             'R12',      'Koronadal',              'private'),
  ('Notre Dame of Dadiangas University',                          'R12',      'General Santos',         'private'),
  -- Region XIII (Caraga)
  ('Caraga State University',                                     'R13',      'Butuan',                 'public'),
  ('Surigao del Norte State University',                          'R13',      'Surigao City',           'public'),
  ('Surigao del Sur State University',                            'R13',      'Tandag',                 'public'),
  ('Agusan del Sur State College of Agriculture and Technology',  'R13',      'Bunawan',                'public'),
  ('Father Saturnino Urios University',                           'R13',      'Butuan',                 'private'),
  -- BARMM
  ('Mindanao State University – Main Campus',                     'BARMM',    'Marawi',                 'public'),
  ('Cotabato State University',                                   'BARMM',    'Cotabato City',          'public'),
  ('Basilan State College',                                       'BARMM',    'Isabela City',           'public'),
  ('Sulu State College',                                          'BARMM',    'Jolo',                   'public'),
  ('Tawi-Tawi Regional Agricultural College',                     'BARMM',    'Bongao',                 'public'),
  ('Notre Dame University',                                       'BARMM',    'Cotabato City',          'private')
) as v(name, region_code, city, kind)
join public.regions r on r.code = v.region_code
on conflict (name) do nothing;
