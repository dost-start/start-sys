-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0050_universities_local_colleges.sql  —  add the Local Universities and Colleges
--                                          (Ethan, 2026-09-08; answers docs/SYSTEM_CHANGES.md
--                                           question 7, raised by 0048)
--
-- WHAT:
--   Insert 165 Local Universities and Colleges — higher education institutions created
--   and funded by a city, municipality or province and supervised by CHED. 0048 left the
--   table at 280 rows; `select count(*) from public.universities` goes 280 -> 445.
--   Pamantasan ng Lungsod ng Maynila is NOT in the list below: 0037 already seeded it, and
--   `on conflict (name) do nothing` would drop it anyway.
--
-- WHY:
--   0048 deliberately held LUCs back because DOST-SEI's two statements disagree. The 2026
--   S&T Undergraduate Scholarship Brochure lists only "University of the Philippines /
--   State Universities and Colleges / Private Institutions [with] CHED [COE or COD] or
--   FAAP Level III accreditation". The DOST-SEI Helpdesk FAQ for the 2027 cycle, which is
--   the live text, is wider:
--     "qualifiers must enroll in a DOST-SEI approved priority program at an eligible
--      institution, such as: State Universities and Colleges (SUCs); Local Universities
--      and Colleges (LUCs); and Private Higher Education Institutions ..."
--   The CCDO's call (Ethan, 2026-09-08, question 7): follow the FAQ and list them. The
--   reasoning is the dropdown's, not the scholarship's — a school missing from the list
--   blocks an application outright, while a school that turns out to be ineligible is one
--   check the CRRD reviewer already performs on the program. Eligibility stays
--   institution x program either way; this table has never claimed to decide it.
--
-- SOURCE:
--   CHED's HEI directory (heida.ched.gov.ph), every regional page, taking the rows CHED
--   itself types "Local Government College/University" — cross-checked against the UniFAST
--   RA 10931 free-higher-education participating list (120 of the 165 appear there, which is
--   evidence of CHED-recognized degree programs; the other 45 carry a CHED institution code
--   but no UniFAST entry, so their programs are listed on CHED's word alone) and against CHED's
--   Distribution of HEIs AY 2024-25 (26 Jun 2025), which counts 154 LUCs nationally.
--   Region II, CAR and BARMM have none, and CHED's count agrees. Compiled 2026-09-07;
--   full write-up in docs/issues/2026-09-07-dost-sei-eligible-institutions.md.
--
-- NOT INCLUDED, because CHED no longer lists them as LUCs:
--     · Maasin City College — now a campus of Southern Leyte State University (RA 11079)
--     · Sorsogon Community College — turned over to Sorsogon State University
--     · Consolacion Community College — now a campus of Cebu Technological University
--     · Quirino Polytechnic College — merged into Quirino State University (RA 10230)
--     · Northern Bukidnon Community College — chartered as a state college (RA 11284) and
--       already inserted by 0048 under that name
--     · Colegio de Iligan (defunct), Marikina Polytechnic College and New Lucena
--       Polytechnic College (CHED types them as a state college and a government school,
--       not as LUCs; Marikina Polytechnic College is already in the table via 0048)
--
-- CHED RECOGNITION PENDING (12 rows, marked inline below): CHED's directory carries
--   these with no institution code yet ("NEW" or "Requested"), i.e. an LGU has created the
--   college but CHED recognition of its programs is not on record. They are inserted so a
--   scholar attending one can still find it, and flagged here so CRRD can set
--   `is_active = false` on any of them from the admin side without a migration:
--     · Calaca City Global College
--     · Colegio de General Luna
--     · Colegio de Kapatagan
--     · Colegio de Masinloc
--     · Colegio de Nabunturan
--     · Colegio de Naujan
--     · Colegio de San Leonardo
--     · Dingalan Community College
--     · Kolehiyo ng Guiguinto
--     · Padre Garcia Polytechnic College
--     · San Francisco Municipal College
--     · Santiago "Santy" R. Austria College
--
-- NAMING: the rule 0048 set stands — each school is listed under the name it operates
--   under today. Six LUCs were renamed by their LGU and appear under the current name
--   (e.g. Baliuag Polytechnic College is Dalubhasaang Politekniko ng Lungsod ng Baliwag;
--   Gov. Alfonso D. Tan College is Tangub City Global College).
--
-- RLS: unchanged — 0037's policies stand (SELECT anon + authenticated; INSERT/UPDATE
--   crrd_admin and tech_admin; no DELETE). No table, column, type or policy is touched, so
--   database.types.ts is unaffected and the pgTAP suite needs no new assertion (070 derives
--   its expected university count from the live table).
--
-- IDEMPOTENT: `on conflict (name) do nothing`, so a re-run inserts nothing.
--
-- ROLLBACK: forward-only. Reference data; a wrong row is `is_active = false`, never deleted.
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Region resolved by CODE, never by uuid (0016 generates region ids). Every row is `public`:
-- an LUC is owned and funded by a local government unit.
insert into public.universities (name, region_id, city_municipality, kind)
select v.name, r.id, v.city, v.kind
from (values
  -- NCR
  ('City University of Pasay',                                       'NCR',      'Pasay City',              'public'),
  ('City of Malabon University',                                     'NCR',      'Malabon City',            'public'),
  ('Colegio de Muntinlupa',                                          'NCR',      'Muntinlupa City',         'public'),
  ('Dr. Filemon C. Aguilar Memorial College of Las Piñas',           'NCR',      'Las Piñas City',          'public'),
  ('Mandaluyong College of Science and Technology',                  'NCR',      'Mandaluyong City',        'public'),
  ('Navotas Polytechnic College',                                    'NCR',      'Navotas City',            'public'),
  ('Pamantasan ng Lungsod ng Marikina',                              'NCR',      'Marikina City',           'public'),
  ('Pamantasan ng Lungsod ng Muntinlupa',                            'NCR',      'Muntinlupa City',         'public'),
  ('Pamantasan ng Lungsod ng Pasig',                                 'NCR',      'Pasig City',              'public'),
  ('Pamantasan ng Lungsod ng Valenzuela',                            'NCR',      'Valenzuela City',         'public'),
  ('Parañaque City College',                                         'NCR',      'Parañaque City',          'public'),
  ('Pateros Technological College',                                  'NCR',      'Pateros',                 'public'),
  ('Quezon City University',                                         'NCR',      'Quezon City',             'public'),
  ('Taguig City University',                                         'NCR',      'Taguig City',             'public'),
  ('Universidad de Manila',                                          'NCR',      'Manila',                  'public'),
  ('University of Caloocan City',                                    'NCR',      'Caloocan City',           'public'),
  ('University of Makati',                                           'NCR',      'Makati City',             'public'),
  ('Valenzuela City Technological College',                          'NCR',      'Valenzuela City',         'public'),
  -- Region I
  ('Bayambang Polytechnic College',                                  'R01',      'Bayambang',               'public'),
  ('Binalatongan Community College',                                 'R01',      'San Carlos City',         'public'),
  ('Ilocos Sur Community College',                                   'R01',      'Bantay',                  'public'),
  ('Pangasinan Polytechnic College',                                 'R01',      'Lingayen',                'public'),
  ('University of Eastern Pangasinan',                               'R01',      'Binalonan',               'public'),
  ('Urdaneta City University',                                       'R01',      'Urdaneta City',           'public'),
  -- Region III
  ('Bulacan Polytechnic College',                                    'R03',      'Malolos City',            'public'),
  ('City College of Angeles',                                        'R03',      'Angeles City',            'public'),
  ('City College of San Fernando, Pampanga',                         'R03',      'City of San Fernando',    'public'),
  ('City College of San Jose del Monte',                             'R03',      'San Jose del Monte City', 'public'),
  ('Colegio de Masinloc',                                            'R03',      'Masinloc',                'public'),  -- CHED recognition pending
  ('Colegio de San Leonardo',                                        'R03',      'San Leonardo',            'public'),  -- CHED recognition pending
  ('Dalubhasaang Politekniko ng Lungsod ng Baliwag',                 'R03',      'Baliwag City',            'public'),
  ('Dingalan Community College',                                     'R03',      'Dingalan',                'public'),  -- CHED recognition pending
  ('Eduardo L. Joson Memorial College',                              'R03',      'Palayan City',            'public'),
  ('Gapan City College',                                             'R03',      'Gapan City',              'public'),
  ('Gordon College',                                                 'R03',      'Olongapo City',           'public'),
  ('Guagua Community College',                                       'R03',      'Guagua',                  'public'),
  ('Kolehiyo ng Guiguinto',                                          'R03',      'Guiguinto',               'public'),  -- CHED recognition pending
  ('Kolehiyo ng Subic',                                              'R03',      'Subic',                   'public'),
  ('Limay Polytechnic College',                                      'R03',      'Limay',                   'public'),
  ('Mabalacat City College',                                         'R03',      'Mabalacat City',          'public'),
  ('Norzagaray College',                                             'R03',      'Norzagaray',              'public'),
  ('Pambayang Dalubhasaan ng Marilao',                               'R03',      'Marilao',                 'public'),
  ('Polytechnic College of Botolan',                                 'R03',      'Botolan',                 'public'),
  ('Polytechnic College of the City of Meycauayan',                  'R03',      'Meycauayan City',         'public'),
  ('Santiago "Santy" R. Austria College',                            'R03',      'Jaen',                    'public'),  -- CHED recognition pending
  -- Region IV-A
  ('Antipolo Institute of Technology (AITECH)',                      'R04A',     'Antipolo City',           'public'),
  ('Balian Community College',                                       'R04A',     'Pangil',                  'public'),
  ('Calaca City Global College',                                     'R04A',     'Calaca City',             'public'),  -- CHED recognition pending
  ('City College of Calamba',                                        'R04A',     'Calamba City',            'public'),
  ('City College of Tagaytay',                                       'R04A',     'Tagaytay City',           'public'),
  ('Colegio de General Luna',                                        'R04A',     'General Luna',            'public'),  -- CHED recognition pending
  ('Colegio de La Ciudad de Tayabas',                                'R04A',     'Tayabas City',            'public'),
  ('Colegio de Montalban',                                           'R04A',     'Rodriguez',               'public'),
  ('Colegio ng Lungsod ng Batangas',                                 'R04A',     'Batangas City',           'public'),
  ('Dalubhasaan ng Lungsod ng Lucena',                               'R04A',     'Lucena City',             'public'),
  ('Dalubhasaan ng Lunsod ng San Pablo',                             'R04A',     'San Pablo City',          'public'),
  ('Kolehiyo ng Lungsod ng Dasmariñas',                              'R04A',     'Dasmariñas City',         'public'),
  ('Kolehiyo ng Lungsod ng Lipa',                                    'R04A',     'Lipa City',               'public'),
  ('Laguna University',                                              'R04A',     'Santa Cruz',              'public'),
  ('One Cainta College',                                             'R04A',     'Cainta',                  'public'),
  ('Padre Garcia Polytechnic College',                               'R04A',     'Padre Garcia',            'public'),  -- CHED recognition pending
  ('Pamantasan ng Cabuyao',                                          'R04A',     'Cabuyao City',            'public'),
  ('Pambayang Kolehiyo ng Mauban',                                   'R04A',     'Mauban',                  'public'),
  ('San Francisco Municipal College',                                'R04A',     'San Francisco',           'public'),  -- CHED recognition pending
  ('San Mateo Municipal College',                                    'R04A',     'San Mateo',               'public'),
  ('Tanauan City College',                                           'R04A',     'Tanauan City',            'public'),
  ('Trece Martires City College',                                    'R04A',     'Trece Martires City',     'public'),
  -- MIMAROPA
  ('Baco Community College',                                         'MIMAROPA', 'Baco',                    'public'),
  ('City College of Calapan',                                        'MIMAROPA', 'Calapan City',            'public'),
  ('Colegio de Naujan',                                              'MIMAROPA', 'Naujan',                  'public'),  -- CHED recognition pending
  ('Colegio de Puerto Galera',                                       'MIMAROPA', 'Puerto Galera',           'public'),
  ('Pola Community College',                                         'MIMAROPA', 'Pola',                    'public'),
  -- Region V
  ('Aroroy Municipal College',                                       'R05',      'Aroroy',                  'public'),
  ('Baao Community College',                                         'R05',      'Baao',                    'public'),
  ('Bacacay Community College',                                      'R05',      'Bacacay',                 'public'),
  ('Balud Municipal College',                                        'R05',      'Balud',                   'public'),
  ('Calabanga Community College',                                    'R05',      'Calabanga',               'public'),
  ('Caramoan Community College',                                     'R05',      'Caramoan',                'public'),
  ('Castilla Colleges',                                              'R05',      'Castilla',                'public'),
  ('Cataingan Municipal College',                                    'R05',      'Cataingan',               'public'),
  ('Cawayan Community College',                                      'R05',      'Cawayan',                 'public'),
  ('City College of Naga',                                           'R05',      'Naga City',               'public'),
  ('Community College of Manito',                                    'R05',      'Manito',                  'public'),
  ('Daraga Community College',                                       'R05',      'Daraga',                  'public'),
  ('Donsol Community College',                                       'R05',      'Donsol',                  'public'),
  ('Goa Community College',                                          'R05',      'Goa',                     'public'),
  ('Governor Mariano E. Villafuerte Community College-Garchitorena', 'R05',      'Garchitorena',            'public'),
  ('Governor Mariano E. Villafuerte Community College-Libmanan',     'R05',      'Libmanan',                'public'),
  ('Governor Mariano E. Villafuerte Community College-Siruma',       'R05',      'Siruma',                  'public'),
  ('Governor Mariano E. Villafuerte Community College-Tinambac',     'R05',      'Tinambac',                'public'),
  ('Guinobatan Community College',                                   'R05',      'Guinobatan',              'public'),
  ('Libon Community College',                                        'R05',      'Libon',                   'public'),
  ('Ligao Community College',                                        'R05',      'Ligao City',              'public'),
  ('Oas Community College',                                          'R05',      'Oas',                     'public'),
  ('Pilar Community College',                                        'R05',      'Pilar',                   'public'),
  ('Polangui Community College',                                     'R05',      'Polangui',                'public'),
  ('Rapu-Rapu Community College',                                    'R05',      'Rapu-Rapu',               'public'),
  ('San Jose Community College',                                     'R05',      'Malilipot',               'public'),
  ('San Pascual Polytechnic College',                                'R05',      'San Pascual',             'public'),
  ('Sto. Domingo Community College',                                 'R05',      'Santo Domingo',           'public'),
  ('Tiwi Community College',                                         'R05',      'Tiwi',                    'public'),
  -- Region VI
  ('Altavas College',                                                'R06',      'Altavas',                 'public'),
  ('Balete Community College',                                       'R06',      'Balete',                  'public'),
  ('Batan Integrated College of Technology',                         'R06',      'Batan',                   'public'),
  ('Iloilo City Community College',                                  'R06',      'Iloilo City',             'public'),
  ('Libacao College of Science and Technology',                      'R06',      'Libacao',                 'public'),
  ('Malay College',                                                  'R06',      'Malay',                   'public'),
  ('Passi City College',                                             'R06',      'Passi City',              'public'),
  ('Vicente A. Javier Memorial Community College',                   'R06',      'Culasi',                  'public'),
  -- Negros Island Region
  ('Bacolod City College',                                           'NIR',      'Bacolod City',            'public'),
  ('Bago City College',                                              'NIR',      'Bago City',               'public'),
  ('City College of Bayawan',                                        'NIR',      'Bayawan City',            'public'),
  ('Colegio de La Castellana',                                       'NIR',      'La Castellana',           'public'),
  ('La Carlota City College',                                        'NIR',      'La Carlota City',         'public'),
  -- Region VII
  ('Buenavista Community College',                                   'R07',      'Buenavista',              'public'),
  ('Carcar City College',                                            'R07',      'Carcar City',             'public'),
  ('Carmen Municipal College',                                       'R07',      'Carmen',                  'public'),
  ('Colegio de Getafe',                                              'R07',      'Getafe',                  'public'),
  ('Colegio de Loboc',                                               'R07',      'Loboc',                   'public'),
  ('Cordova Public College',                                         'R07',      'Cordova',                 'public'),
  ('Danao Technological College',                                    'R07',      'Danao (Bohol)',           'public'),
  ('Inabanga College of Arts and Sciences',                          'R07',      'Inabanga',                'public'),
  ('Lapu-Lapu City College',                                         'R07',      'Lapu-Lapu City',          'public'),
  ('Madridejos Community College',                                   'R07',      'Madridejos',              'public'),
  ('Mandaue City College',                                           'R07',      'Mandaue City',            'public'),
  ('Sibonga Community College',                                      'R07',      'Sibonga',                 'public'),
  ('Tagbilaran City College',                                        'R07',      'Tagbilaran City',         'public'),
  ('Talibon Polytechnic College',                                    'R07',      'Talibon',                 'public'),
  ('Talisay City College',                                           'R07',      'Talisay City',            'public'),
  ('Trinidad Municipal College',                                     'R07',      'Trinidad',                'public'),
  ('Ubay Community College',                                         'R07',      'Ubay',                    'public'),
  -- Region VIII
  ('Abuyog Community College',                                       'R08',      'Abuyog',                  'public'),
  ('Burauen Community College',                                      'R08',      'Burauen',                 'public'),
  ('City College of Ormoc',                                          'R08',      'Ormoc City',              'public'),
  ('Colegio de las Navas',                                           'R08',      'Las Navas',               'public'),
  -- Region IX
  ('Colegio de La Ciudad de Zamboanga',                              'R09',      'Zamboanga City',          'public'),
  ('Pagadian City International College',                            'R09',      'Pagadian City',           'public'),
  ('Zamboanga del Sur Provincial Government College',                'R09',      'Aurora',                  'public'),
  ('Zamboanga del Sur Provincial Government College - Dimataling',   'R09',      'Dimataling',              'public'),
  ('Zamboanga del Sur Provincial Government College - Pagadian',     'R09',      'Pagadian City',           'public'),
  -- Region X
  ('City College of El Salvador',                                    'R10',      'El Salvador City',        'public'),
  ('Colegio de Kapatagan',                                           'R10',      'Kapatagan',               'public'),  -- CHED recognition pending
  ('Don Carlos Polytechnic College',                                 'R10',      'Don Carlos',              'public'),
  ('Gingoog City United College',                                    'R10',      'Gingoog City',            'public'),
  ('Initao College',                                                 'R10',      'Initao',                  'public'),
  ('Magsaysay College',                                              'R10',      'Magsaysay',               'public'),
  ('Opol Community College',                                         'R10',      'Opol',                    'public'),
  ('Pangantucan Bukidnon Community College',                         'R10',      'Pangantucan',             'public'),
  ('Salay Community College',                                        'R10',      'Salay',                   'public'),
  ('Tagoloan Community College',                                     'R10',      'Tagoloan',                'public'),
  ('Tangub City Global College',                                     'R10',      'Tangub City',             'public'),
  ('Tubod College',                                                  'R10',      'Tubod',                   'public'),
  -- Region XI
  ('Colegio de Nabunturan',                                          'R11',      'Nabunturan',              'public'),  -- CHED recognition pending
  ('Governor Generoso College of Arts, Sciences and Technology',     'R11',      'Governor Generoso',       'public'),
  ('Kapalong College of Agriculture, Sciences and Technology',       'R11',      'Kapalong',                'public'),
  ('Kolehiyo ng Pantukan',                                           'R11',      'Pantukan',                'public'),
  ('Maco de Oro College',                                            'R11',      'Maco',                    'public'),
  ('Monkayo College of Arts, Sciences and Technology',               'R11',      'Monkayo',                 'public'),
  ('Samal Island City College',                                      'R11',      'Island Garden City of Samal', 'public'),
  ('Sto. Tomas College of Agriculture, Sciences and Technology',     'R11',      'Santo Tomas',             'public'),
  -- Region XII
  ('Glan Institute of Technology',                                   'R12',      'Glan',                    'public'),
  ('Makilala Institute of Science and Technology',                   'R12',      'Makilala',                'public'),
  ('Malapatan College of Science and Technology',                    'R12',      'Malapatan',               'public'),
  -- Region XIII (Caraga)
  ('City College of Bayugan',                                        'R13',      'Bayugan City',            'public'),
  ('Hinatuan Southern College',                                      'R13',      'Hinatuan',                'public')
) as v(name, region_code, city, kind)
join public.regions r on r.code = v.region_code
on conflict (name) do nothing;

comment on table public.universities is
  'Institutions an applicant may declare, each in one region (meeting 2026-09-05: the RR '
  'view filters by university). Since 0048 (2026-09-08) the rows are the DOST-SEI '
  'study-placement list — UP, SUCs, and private HEIs with a CHED COE/COD or FAAP Level '
  'III+ in a priority program — and since 0050 the Local Universities and Colleges CHED '
  'lists, per the DOST-SEI helpdesk FAQ (docs/issues/'
  '2026-09-07-dost-sei-eligible-institutions.md). CRRD edits; never deleted (is_active = false).';
