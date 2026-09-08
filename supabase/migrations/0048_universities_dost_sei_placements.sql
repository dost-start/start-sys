-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0048_universities_dost_sei_placements.sql  —  replace the 0037 starter list with the
--                                              DOST-SEI study-placement list
--                                              (Ethan, 2026-09-08; SRS membership form
--                                               "university" field; PRD US-B1, OQ-17 sibling)
--
-- WHAT:
--   1. Rename five seed rows whose institution was renamed or converted after 0037 was
--      written, each cited to the law or the board resolution that did it.
--   2. Correct the region of two seed rows that CHED, DBM and Executive Order 91 s.2025
--      file under Region IX, not BARMM.
--   3. Insert 158 institutions (53 public, 105 private) that meet the DOST-SEI
--      placement rule and were missing from the starter list. 0037 seeded 122 rows, so
--      `select count(*) from public.universities` goes 122 -> 280.
--   4. Re-state the table comment so the next maintainer knows what the list is now.
--   No row is deactivated: every 0037 row still resolves to an eligible institution, or to
--   Pamantasan ng Lungsod ng Maynila, an LUC (see the LUC note below).
--
-- WHY:
--   0037 seeded "the state universities and the larger private institutions of every
--   region" and flagged itself "NOT AN AUTHORITY". The authority is the DOST-SEI
--   study-placement rule (2026 S&T Undergraduate Scholarship Brochure, "STUDY PLACEMENT"):
--     • University of the Philippines
--     • State Universities and Colleges
--     • Private Institutions that are recognized by CHED as Centers of Excellence or
--       Centers of Development or have FAAP Level III accreditation for the priority
--       S&T programs of study.
--   DOST-SEI keeps no master list of institutions (its eFOI reply #SEI-742778963899 of
--   20 Jun 2022: "this list varies every year, hence, we could not provide the consolidated
--   list") and defers to CHED's COE/COD designations and the FAAP accreditors. The rows
--   below were therefore compiled on 2026-09-07 from: the UP System's constituent-university
--   list (incl. UP Tacloban, 9th CU, BOR 1409th meeting 27 May 2026); CHED's Distribution of
--   HEIs AY 2024-25 (26 Jun 2025) and the DBM FY2026 SUC roster cross-checked with every
--   2021–2026 conversion RA; CHED's List of Centers of Excellence and Development (Feb 2022,
--   data as of May 2018, extended by CMO 03 s.2019 pending CMO 10 s.2025 results); PACUCOA
--   Certified Levels as of 4 Jul 2026; the PAASCU member database; and the DOST-6 (24 Jun
--   2024) and DOST-10 (14 Jun 2024) regional eligible-school lists. Full write-up with
--   sources and per-institution basis: docs/issues/2026-09-07-dost-sei-eligible-institutions.md.
--
--   Eligibility is institution × program, not a boolean on the institution: a private HEI
--   qualifies only for the programs it is COE/COD or Level III in. This table cannot say
--   which, so the dropdown lists the institution and the CRRD reviewer checks the program.
----
-- NAMING RULE (applied to every row, both directions): an institution is listed under the
--   name it OPERATES under today — the name printed on the registration form a scholar
--   uploads — not under a statutory name a charter has granted but CHED has not yet
--   conferred. So the five renames above are the ones already in use, while eight schools
--   whose conversion law exists but whose conferment is unverified keep their present
--   names: Camarines Sur Polytechnic Colleges, Basilan State College and Sulu State College
--   (already seeded in 0037), and Ilocos Sur Polytechnic State College (RA 11755 -> University
--   of Ilocos Philippines), Aurora State College of Technology (RA 12298 -> Aurora State
--   University of Science and Technology), Bicol State College of Applied Sciences and
--   Technology (RA 11585 -> Southeast Asian University of Technology), J.H. Cerilles State
--   College (RA 12295 -> Zamboanga del Sur State University) and Camarines Norte State
--   College (RA 11399 -> University of Camarines Norte) among the rows inserted below. Each
--   is a one-line rename here when CHED confers, or a row edit by CRRD.
--
-- DELIBERATELY NOT INSERTED (present in the compiled list, left out here):
--     · Far Eastern University (Manila): variant of seed row Far Eastern University
--     · Mapua University (Intramuros, Manila; Makati campus for IT/CS): variant of seed row Mapúa University
--     · National University (Manila): variant of seed row National University
--     · Technological Institute of the Philippines - Manila: variant of seed row Technological Institute of the Philippines (Manila is the main campus)
--     · University of the East - Manila: variant of seed row University of the East (Manila is the main campus)
--     · UP Manila School of Health Sciences Baler Campus: offers only the midwifery-nursing ladder; no priority program
--     · UP Manila School of Health Sciences Tarlac Campus: offers only the midwifery-nursing ladder; no priority program
--     · University of the Philippines Open University: undergraduate offerings (BES, BA Multimedia Studies) are not priority programs
--     · Polytechnic State University of Bicol: RA 11283 (2019) conferment unverified; the seed row Camarines Sur Polytechnic Colleges keeps its name
--     · UP Visayas Iloilo City Campus: College of Management only (accountancy, business); no priority program
--     · UP Manila School of Health Sciences (Palo main campus): offers only the midwifery-nursing ladder; no priority program
--     · Basilan State University: RA 11554 (2021) conferment unverified; the seed row Basilan State College keeps its name (region corrected below)
--     · Sulu State University: RA 12296 (2025) conferment pending; the seed row Sulu State College keeps its name (region corrected below)
--     · UP Manila School of Health Sciences Koronadal Campus: offers only the midwifery-nursing ladder; no priority program
--     · Colegio de Dagupan: former name of Universidad de Dagupan, which is inserted (its
--       2018 CHED COD in Information Technology was earned under the old name)
--     · College of the Holy Spirit of Manila: ceased operations at the end of SY 2019-2020;
--       the only evidence was a PAASCU entry whose validity had already lapsed
--     · UP Diliman Extension Program in Pampanga: BA Applied Psychology, BA Business
--       Economics and BS Business Management only — no priority program, same test that
--       excludes UP Visayas Iloilo City and UPOU above
--     · Sarangani State College (RA 12300) and Dinagat Islands State College (RA 12299):
--       chartered when the laws lapsed on 15 Sep 2025, neither yet operational — Dinagat's
--       charter does not even fix a main-campus municipality yet
--   Local Universities and Colleges (166 compiled): DOST-SEI's live Helpdesk FAQ names LUCs
--   as eligible, the 2026 brochure does not. Left for the CCDO to decide; nothing here adds
--   or removes an LUC. Pamantasan ng Lungsod ng Maynila (0037) stays as is.
--
-- TEACHER-EDUCATION-ONLY ROWS (25): these private HEIs qualify solely through a CHED
--   COE/COD or FAAP Level III+ in Teacher Education, i.e. for the BSEd Science/Math
--   specializations on the priority list, nothing else. Marked "BSEd Science/Math only":
--     · Assumption College
--     · Bicol College
--     · De La Salle Araneta University
--     · Foundation University
--     · Holy Cross College of Calinan
--     · La Consolacion University Philippines
--     · Mabini Colleges
--     · Miriam College
--     · Naga College Foundation
--     · Northeastern College
--     · Olivarez College
--     · Panpacific University
--     · Ramon Magsaysay Memorial Colleges
--     · Republic Central Colleges
--     · Sacred Heart College of Lucena City
--     · St. Joseph's College of Quezon City
--     · St. Michael's College of Iligan
--     · St. Scholastica's College
--     · The National Teachers College
--     · The University of Manila
--     · Tomas del Rosario College
--     · Universidad de Santa Isabel
--     · University of Asia and the Pacific
--     · University of Bohol
--     · University of Saint Anthony
--
-- KNOWN GAPS: CHED's 2023 COE/COD/FAAP list (foi.gov.ph documents 265879 and 273800) sits
--   behind a Cloudflare check and was not read; Misamis Occidental State College (RA 11282)
--   and Iligan City Polytechnic State College (RA 11856) are chartered but absent from CHED's
--   June-2025 count and the FY2026 budget roster, operational status unverified; the two
--   MSU units below (Lanao National College of Arts and Trades, Maigo) are integrated
--   CHED-supervised institutions of the MSU System; Rinconada State College (RA 12294) and
--   Zamboanga del Sur Polytechnic State College (RA 12282) are converted from schools that
--   do operate but are not yet in CHED's SUC count; and North Luzon Philippines State
--   College, which RA 11755 folds into University of Ilocos Philippines on conferment, is
--   not inserted because whether it still enrols under its own name could not be confirmed.
--
-- RLS: unchanged — 0037's policies stand (SELECT anon + authenticated; INSERT/UPDATE
--   crrd_admin and tech_admin; no DELETE). No new table, no new column, no type change,
--   so database.types.ts is unaffected.
--
-- IDEMPOTENT: renames are guarded so a re-run (or a row a CRRD admin already renamed by
--   hand) does not violate universities_name_key; inserts are `on conflict (name) do nothing`.
--
-- ROLLBACK: forward-only. Reference data; a wrong row is `is_active = false`, never deleted.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── 1. renames ─────────────────────────────────────────────────────────────────────
-- RA 12148 (2025) renamed Don Honorio Ventura State University.
update public.universities set name = 'Pampanga State University'
 where name = 'Don Honorio Ventura State University'
   and not exists (select 1 from public.universities where name = 'Pampanga State University');

-- RA 11587 (2021); CHED conferred university status 17 Jun 2026.
update public.universities set name = 'Occidental Mindoro State University'
 where name = 'Occidental Mindoro State College'
   and not exists (select 1 from public.universities where name = 'Occidental Mindoro State University');

-- RA 11584 (2021) renamed Surigao del Sur State University.
update public.universities set name = 'North Eastern Mindanao State University', city_municipality = 'Tandag City'
 where name = 'Surigao del Sur State University'
   and not exists (select 1 from public.universities where name = 'North Eastern Mindanao State University');

-- RA 11586 (2021); CHED conferred university status 15 Mar 2026.
update public.universities set name = 'Agusan del Sur State University'
 where name = 'Agusan del Sur State College of Agriculture and Technology'
   and not exists (select 1 from public.universities where name = 'Agusan del Sur State University');

-- UP Board of Regents, 1409th meeting, 27 May 2026: UP Tacloban is the ninth constituent
-- university (autonomous college of UP Visayas from 27 Apr 2023).
update public.universities set name = 'University of the Philippines Tacloban', city_municipality = 'Tacloban City'
 where name = 'University of the Philippines Tacloban College'
   and not exists (select 1 from public.universities where name = 'University of the Philippines Tacloban');

-- ── 2. region corrections ──────────────────────────────────────────────────────────
-- Basilan State College's main campus is in Isabela City, which is outside BARMM; CHED and
-- DBM both file the institution under Region IX. (Its Lamitan, Maluso and Tipo-Tipo campuses
-- are in BARMM; the row carries the main campus.)
update public.universities
   set region_id = (select id from public.regions where code = 'R09'), city_municipality = 'Isabela City'
 where name = 'Basilan State College';

-- Executive Order 91 s.2025 (30 Jul 2025) transferred the province of Sulu from BARMM to
-- Region IX after the Supreme Court excluded it from the Bangsamoro region.
update public.universities
   set region_id = (select id from public.regions where code = 'R09')
 where name = 'Sulu State College';

-- ── 3. insert the missing eligible institutions ───────────────────────────────────
-- Region resolved by CODE, never by uuid (0016 generates region ids). Public rows are UP
-- units and SUCs; private rows carry a CHED COE/COD or FAAP Level III+ in a priority program.
insert into public.universities (name, region_id, city_municipality, kind)
select v.name, r.id, v.city, v.kind
from (values
  -- NCR
  ('AMA University',                                                                  'NCR',      'Quezon City',               'private'),
  ('Arellano University',                                                             'NCR',      'Manila',                    'private'),
  ('Assumption College',                                                              'NCR',      'Makati City',               'private'),  -- BSEd Science/Math only
  ('Centro Escolar University',                                                       'NCR',      'Manila',                    'private'),
  ('Centro Escolar University – Makati',                                              'NCR',      'Makati City',               'private'),
  ('Colegio de San Juan de Letran',                                                   'NCR',      'Manila',                    'private'),
  ('De La Salle Araneta University',                                                  'NCR',      'Malabon City',              'private'),  -- BSEd Science/Math only
  ('Emilio Aguinaldo College',                                                        'NCR',      'Manila',                    'private'),
  ('FEU Institute of Technology',                                                     'NCR',      'Manila',                    'private'),
  ('Far Eastern University – Dr. Nicanor Reyes Medical Foundation',                   'NCR',      'Quezon City',               'private'),
  ('Jose Rizal University',                                                           'NCR',      'Mandaluyong City',          'private'),
  ('Lyceum of the Philippines University – Manila',                                   'NCR',      'Manila',                    'private'),
  ('Manila Central University',                                                       'NCR',      'Caloocan City',             'private'),
  ('Miriam College',                                                                  'NCR',      'Quezon City',               'private'),  -- BSEd Science/Math only
  ('New Era University',                                                              'NCR',      'Quezon City',               'private'),
  ('Olivarez College',                                                                'NCR',      'Parañaque City',            'private'),  -- BSEd Science/Math only
  ('Our Lady of Fatima University',                                                   'NCR',      'Valenzuela City',           'private'),
  ('PATTS College of Aeronautics',                                                    'NCR',      'Parañaque City',            'private'),
  ('San Beda University',                                                             'NCR',      'Manila',                    'private'),
  ('San Sebastian College – Recoletos',                                               'NCR',      'Manila',                    'private'),
  ('Southville International School and Colleges',                                    'NCR',      'Las Piñas City',            'private'),
  ('St. Joseph''s College of Quezon City',                                            'NCR',      'Quezon City',               'private'),  -- BSEd Science/Math only
  ('St. Paul University Manila',                                                      'NCR',      'Manila',                    'private'),
  ('St. Paul University Quezon City',                                                 'NCR',      'Quezon City',               'private'),
  ('St. Scholastica''s College',                                                      'NCR',      'Manila',                    'private'),  -- BSEd Science/Math only
  ('Technological Institute of the Philippines – Quezon City',                        'NCR',      'Quezon City',               'private'),
  ('The National Teachers College',                                                   'NCR',      'Manila',                    'private'),  -- BSEd Science/Math only
  ('The Philippine Women''s University',                                              'NCR',      'Manila',                    'private'),
  ('The University of Manila',                                                        'NCR',      'Manila',                    'private'),  -- BSEd Science/Math only
  ('Trinity University of Asia',                                                      'NCR',      'Quezon City',               'private'),
  ('University of Asia and the Pacific',                                              'NCR',      'Pasig City',                'private'),  -- BSEd Science/Math only
  ('University of Perpetual Help System DALTA – Las Piñas',                           'NCR',      'Las Piñas City',            'private'),
  ('University of the East Ramon Magsaysay Memorial Medical Center',                  'NCR',      'Quezon City',               'private'),
  ('University of the East – Caloocan',                                               'NCR',      'Caloocan City',             'private'),
  ('Eulogio "Amang" Rodriguez Institute of Science and Technology',                   'NCR',      'Manila',                    'public'),
  ('Marikina Polytechnic College',                                                    'NCR',      'Marikina City',             'public'),
  ('National Aviation Academy of the Philippines',                                    'NCR',      'Pasay City',                'public'),
  -- CAR
  ('University of Baguio',                                                            'CAR',      'Baguio City',               'private'),
  ('Apayao State College',                                                            'CAR',      'Conner',                    'public'),
  ('Ifugao State University',                                                         'CAR',      'Lamut',                     'public'),
  ('Kalinga State University',                                                        'CAR',      'Tabuk City',                'public'),
  ('Mountain Province State University',                                              'CAR',      'Bontoc',                    'public'),
  ('University of Abra',                                                              'CAR',      'Lagangilang',               'public'),
  -- Region I
  ('Lorma Colleges',                                                                  'R01',      'City of San Fernando',      'private'),
  ('Lyceum-Northwestern University',                                                  'R01',      'Dagupan City',              'private'),
  ('Northwestern University',                                                         'R01',      'Laoag City',                'private'),
  ('Panpacific University',                                                           'R01',      'Urdaneta City',             'private'),  -- BSEd Science/Math only
  ('Universidad de Dagupan',                                                          'R01',      'Dagupan City',              'private'),
  ('University of Luzon',                                                             'R01',      'Dagupan City',              'private'),
  ('Virgen Milagrosa University Foundation',                                          'R01',      'San Carlos City',           'private'),
  ('Ilocos Sur Polytechnic State College',                                          'R01',      'Sta. Maria',               'public'),
  -- Region II
  ('Lyceum of Aparri',                                                                'R02',      'Aparri',                    'private'),
  ('Northeastern College',                                                            'R02',      'Santiago City',             'private'),  -- BSEd Science/Math only
  ('Saint Mary''s University',                                                        'R02',      'Bayombong',                 'private'),
  ('St. Paul University Philippines',                                                 'R02',      'Tuguegarao City',           'private'),
  ('University of Cagayan Valley',                                                    'R02',      'Tuguegarao City',           'private'),
  ('Batanes State College',                                                           'R02',      'Basco',                     'public'),
  ('Quirino State University',                                                        'R02',      'Diffun',                    'public'),
  -- Region III
  ('Angeles University Foundation',                                                   'R03',      'Angeles City',              'private'),
  ('Baliuag University',                                                              'R03',      'Baliwag City',              'private'),
  ('Centro Escolar University – Malolos',                                             'R03',      'Malolos City',              'private'),
  ('Colegio de San Gabriel Arcangel',                                                 'R03',      'San Jose del Monte City',   'private'),
  ('First City Providential College',                                                 'R03',      'City of San Jose del Monte', 'private'),
  ('La Consolacion University Philippines',                                           'R03',      'Malolos City',              'private'),  -- BSEd Science/Math only
  ('Our Lady of Fatima University – Pampanga',                                        'R03',      'City of San Fernando',      'private'),
  ('Republic Central Colleges',                                                       'R03',      'Angeles City',              'private'),  -- BSEd Science/Math only
  ('Systems Plus College Foundation',                                                 'R03',      'Angeles City',              'private'),
  ('Tomas del Rosario College',                                                       'R03',      'Balanga City',              'private'),  -- BSEd Science/Math only
  ('Wesleyan University-Philippines',                                                 'R03',      'Cabanatuan City',           'private'),
  ('Aurora State College of Technology',                                            'R03',      'Baler',                    'public'),
  ('Bulacan State Agricultural University',                                           'R03',      'San Ildefonso',             'public'),
  ('Philippine Merchant Marine Academy',                                              'R03',      'San Narciso',               'public'),
  ('Tarlac Agricultural University',                                                  'R03',      'Camiling',                  'public'),
  -- Region IV-A
  ('Adventist University of the Philippines',                                         'R04A',     'Silang',                    'private'),
  ('Colegio de San Juan de Letran – Calamba',                                         'R04A',     'Calamba City',              'private'),
  ('Emilio Aguinaldo College – Cavite',                                               'R04A',     'Dasmariñas City',           'private'),
  ('First Asia Institute of Technology and Humanities',                               'R04A',     'Tanauan City',              'private'),
  ('Lemery Colleges',                                                                 'R04A',     'Lemery',                    'private'),
  ('Lipa City Colleges',                                                              'R04A',     'Lipa City',                 'private'),
  ('Lyceum of the Philippines University – Cavite',                                   'R04A',     'General Trias',             'private'),
  ('Lyceum of the Philippines University – Laguna',                                   'R04A',     'Calamba City',              'private'),
  ('Manuel S. Enverga University Foundation',                                         'R04A',     'Lucena City',               'private'),
  ('Our Lady of Fatima University – Antipolo',                                        'R04A',     'Antipolo City',             'private'),
  ('Sacred Heart College of Lucena City',                                             'R04A',     'Lucena City',               'private'),  -- BSEd Science/Math only
  ('Saint Michael''s College of Laguna',                                              'R04A',     'Biñan City',                'private'),
  ('San Pablo Colleges',                                                              'R04A',     'San Pablo City',            'private'),
  ('St. Dominic College of Asia',                                                     'R04A',     'Bacoor City',               'private'),
  ('Tomas Claudio Colleges',                                                          'R04A',     'Morong',                    'private'),
  ('University of Perpetual Help System DALTA – Calamba',                             'R04A',     'Calamba City',              'private'),
  ('University of Perpetual Help System DALTA – Molino',                              'R04A',     'Bacoor City',               'private'),
  ('University of Perpetual Help System Laguna – Biñan',                              'R04A',     'Biñan City',                'private'),
  -- MIMAROPA
  -- Region V
  ('Bicol College',                                                                   'R05',      'Daraga',                    'private'),  -- BSEd Science/Math only
  ('Mabini Colleges',                                                                 'R05',      'Daet',                      'private'),  -- BSEd Science/Math only
  ('Naga College Foundation',                                                         'R05',      'Naga City',                 'private'),  -- BSEd Science/Math only
  ('Universidad de Santa Isabel',                                                     'R05',      'Naga City',                 'private'),  -- BSEd Science/Math only
  ('University of Saint Anthony',                                                     'R05',      'Iriga City',                'private'),  -- BSEd Science/Math only
  ('Dr. Emilio B. Espinosa Sr. Memorial State College of Agriculture and Technology', 'R05',      'Mandaon',                   'public'),
  ('Partido State University',                                                        'R05',      'Goa',                       'public'),
  ('Rinconada State College',                                                         'R05',      'Baao',                      'public'),
  ('Bicol State College of Applied Sciences and Technology',                        'R05',      'Naga City',                'public'),
  ('Camarines Norte State College',                                                 'R05',      'Daet',                     'public'),
  -- Region VI
  ('Filamer Christian University',                                                    'R06',      'Roxas City',                'private'),
  ('Guimaras State University',                                                       'R06',      'Buenavista',                'public'),
  ('Iloilo State University of Fisheries Science and Technology',                     'R06',      'Barotac Nuevo',             'public'),
  ('Northern Iloilo State University',                                                'R06',      'Estancia',                  'public'),
  -- Negros Island Region
  ('Colegio San Agustin – Bacolod',                                                   'NIR',      'Bacolod City',              'private'),
  ('Foundation University',                                                           'NIR',      'Dumaguete City',            'private'),  -- BSEd Science/Math only
  ('La Consolacion College – Bacolod',                                                'NIR',      'Bacolod City',              'private'),
  ('STI West Negros University',                                                      'NIR',      'Bacolod City',              'private'),
  ('St. Paul University Dumaguete',                                                   'NIR',      'Dumaguete City',            'private'),
  ('Siquijor State College',                                                          'NIR',      'Larena',                    'public'),
  ('State University of Northern Negros',                                             'NIR',      'Sagay City',                'public'),
  -- Region VII
  ('University of Bohol',                                                             'R07',      'Tagbilaran City',           'private'),  -- BSEd Science/Math only
  ('University of Cebu – Lapu-Lapu and Mandaue',                                      'R07',      'Mandaue City',              'private'),
  ('University of Southern Philippines Foundation',                                   'R07',      'Cebu City',                 'private'),
  ('University of the Visayas',                                                       'R07',      'Cebu City',                 'private'),
  -- Region VIII
  ('Asian Development Foundation College',                                            'R08',      'Tacloban City',             'private'),
  ('Biliran Province State University',                                               'R08',      'Naval',                     'public'),
  ('Eastern Samar State University',                                                  'R08',      'Borongan City',             'public'),
  ('Northwest Samar State University',                                                'R08',      'Calbayog City',             'public'),
  ('Palompon Institute of Technology',                                                'R08',      'Palompon',                  'public'),
  ('Southern Leyte State University',                                                 'R08',      'Sogod',                     'public'),
  -- Region IX
  ('Dipolog Medical Center College Foundation',                                       'R09',      'Dipolog City',              'private'),
  ('Mindanao State University – Buug Campus',                                         'R09',      'Buug',                      'public'),
  ('Mindanao State University – Sulu',                                                'R09',      'Jolo',                      'public'),
  ('Zamboanga Peninsula Polytechnic State University',                                'R09',      'Zamboanga City',            'public'),
  ('Zamboanga del Sur Polytechnic State College',                                     'R09',      'Pagadian City',             'public'),
  ('J.H. Cerilles State College',                                                   'R09',      'San Miguel',               'public'),
  -- Region X
  ('Capitol University',                                                              'R10',      'Cagayan de Oro City',       'private'),
  ('Lourdes College',                                                                 'R10',      'Cagayan de Oro City',       'private'),
  ('Misamis University',                                                              'R10',      'Ozamiz City',               'private'),
  ('St. Michael''s College of Iligan',                                                'R10',      'Iligan City',               'private'),  -- BSEd Science/Math only
  ('Camiguin Polytechnic State College',                                              'R10',      'Mambajao',                  'public'),
  ('Iligan City Polytechnic State College',                                           'R10',      'Iligan City',               'public'),
  ('Mindanao State University – Maigo',                                               'R10',      'Maigo',                     'public'),
  ('Mindanao State University – Naawan',                                              'R10',      'Naawan',                    'public'),
  ('Mindanao State University – Sultan Naga Dimaporo',                                'R10',      'Sultan Naga Dimaporo',      'public'),
  ('Misamis Occidental State College',                                                'R10',      'Oroquieta City',            'public'),
  ('Northern Bukidnon State College',                                                 'R10',      'Manolo Fortich',            'public'),
  ('University of Northwestern Mindanao',                                             'R10',      'Tangub City',               'public'),
  -- Region XI
  ('Cor Jesu College',                                                                'R11',      'Digos City',                'private'),
  ('Davao Doctors College',                                                           'R11',      'Davao City',                'private'),
  ('Holy Cross College of Calinan',                                                   'R11',      'Davao City',                'private'),  -- BSEd Science/Math only
  ('Holy Cross of Davao College',                                                     'R11',      'Davao City',                'private'),
  ('San Pedro College',                                                               'R11',      'Davao City',                'private'),
  ('University of Mindanao – Digos College',                                          'R11',      'Digos City',                'private'),
  ('University of Mindanao – Tagum College',                                          'R11',      'Tagum City',                'private'),
  ('Davao de Oro State College',                                                      'R11',      'Compostela',                'public'),
  ('Davao del Norte State College',                                                   'R11',      'Panabo City',               'public'),
  ('Davao del Sur State College',                                                     'R11',      'Digos City',                'public'),
  ('Southern Philippines Agri-Business and Marine and Aquatic School of Technology',  'R11',      'Malita',                    'public'),
  -- Region XII
  ('Ramon Magsaysay Memorial Colleges',                                               'R12',      'General Santos City',       'private'),  -- BSEd Science/Math only
  ('Cotabato Foundation College of Science and Technology',                           'R12',      'Arakan',                    'public'),
  ('South Cotabato State College',                                                    'R12',      'Surallah',                  'public'),
  -- Region XIII (Caraga)
  -- BARMM
  ('Adiong Memorial State College',                                                   'BARMM',    'Ditsaan-Ramain',            'public'),
  ('Mindanao State University – Lanao National College of Arts and Trades',           'BARMM',    'Marawi City',               'public'),
  ('Mindanao State University – Maguindanao',                                         'BARMM',    'Datu Odin Sinsuat',         'public'),
  ('Mindanao State University – Tawi-Tawi College of Technology and Oceanography',    'BARMM',    'Bongao',                    'public')
) as v(name, region_code, city, kind)
join public.regions r on r.code = v.region_code
on conflict (name) do nothing;

-- ── 4. table comment ───────────────────────────────────────────────────────────────
comment on table public.universities is
  'Institutions an applicant may declare, each in one region (meeting 2026-09-05: the RR '
  'view filters by university). Since 0048 (2026-09-08) the rows are the DOST-SEI '
  'study-placement list — UP, SUCs, and private HEIs with a CHED COE/COD or FAAP Level '
  'III+ in a priority program — compiled 2026-09-07 (docs/issues/'
  '2026-09-07-dost-sei-eligible-institutions.md). LUCs deliberately not included pending '
  'the CCDO''s decision. CRRD edits; never deleted (is_active = false).';
