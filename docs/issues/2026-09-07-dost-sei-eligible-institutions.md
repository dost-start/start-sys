# DOST-SEI eligible institutions — sources behind migration 0048 (research of 2026-09-07)

**Status.** Applied to `universities` by `supabase/migrations/0048_universities_dost_sei_placements.sql` (2026-09-08): five renames, two region corrections, 158 inserts — the table goes from 122 rows to 280. The compiled list holds 290 eligible institutions; the difference is the rows deliberately left out, each named in the migration header: LUCs, five campus duplicates of schools already seeded, six UP units with no priority program, a school that closed in 2020, two chartered but not-yet-operating state colleges, and one former name of a school inserted under its current one. Eight schools whose conversion law CHED has not yet acted on are inserted under the names they operate under.

**LUCs resolved 2026-09-08.** The CCDO answered yes to both open questions: include the Local Universities and Colleges, and keep the 25 teacher-education-only private schools. `supabase/migrations/0050_universities_local_colleges.sql` therefore adds 165 LUCs (Pamantasan ng Lungsod ng Maynila was already seeded), taking the table from 280 to 445 rows. The reasoning is the dropdown's rather than the scholarship's: a school missing from the list blocks an application outright, while a school that turns out not to qualify is one check the CRRD reviewer already performs on the program. The CSVs named below are the working files of the research session (not committed); this document is the durable record of what was found and where.

**Result:** 290 institutions meet the DOST-SEI study-placement rule on the evidence found: 15 University of the Philippines units, 128 state universities and colleges, and 147 private HEIs with a CHED COE/COD or FAAP Level III/IV accreditation in a priority program (29 of them only for BSEd Science/Math). A further 166 local universities and colleges sit in a separate tier because DOST-SEI's live Helpdesk FAQ names LUCs as eligible while the 2026 brochure does not.

**Working files** (research session scratchpad, 2026-09-07; regenerate with the merge scripts if ever needed):

- `dost-sei-eligible-institutions.csv` — one row per institution: name, region_code (the seed's 18 codes), city, kind, tier (`eligible`, or `policy-question` for LUCs), basis (why it qualifies, with program names where the source gave them), in_0037_seed, corroborated_by (DOST-SEI-hosted artifacts and DOST regional lists that also name it), accredited_priority_programs_rescan (2026 PACUCOA / PAASCU / CHED evidence per program), sources, notes, source_urls.
- `seed-delta-additions.csv` — the 182 eligible rows not in the 0037 seed.
- `seed-delta-review.csv` — the 13 existing seed rows that need a rename.
- `unmatched-classified.csv` — the 23 source rows deliberately not promoted, with the reason.

## Counts by region

| Region | UP | SUC | Private | Eligible total | LUC tier (separate) |
|---|---|---|---|---|---|
| NCR | 2 | 7 | 45 | 54 | 19 |
| CAR | 1 | 6 | 3 | 10 | 0 |
| Region I | 0 | 5 | 9 | 14 | 6 |
| Region II | 0 | 5 | 6 | 11 | 0 |
| Region III | 3 | 12 | 12 | 27 | 21 |
| Region IV-A | 2 | 5 | 21 | 28 | 22 |
| MIMAROPA | 0 | 6 | 0 | 6 | 5 |
| Region V | 0 | 10 | 7 | 17 | 29 |
| Region VI | 2 | 8 | 3 | 13 | 8 |
| NIR | 0 | 5 | 8 | 13 | 5 |
| Region VII | 1 | 3 | 9 | 13 | 17 |
| Region VIII | 2 | 10 | 1 | 13 | 4 |
| Region IX | 0 | 10 | 2 | 12 | 5 |
| Region X | 0 | 12 | 6 | 18 | 12 |
| Region XI | 1 | 6 | 10 | 17 | 8 |
| Region XII | 1 | 6 | 3 | 10 | 3 |
| Region XIII | 0 | 5 | 1 | 6 | 2 |
| BARMM | 0 | 7 | 1 | 8 | 0 |
| **Total** | 15 | 128 | 147 | 290 | 166 |

## What changes against the 0037 starter seed

The seed has 122 rows. 108 match an eligible institution exactly. 13 need a rename because the institution was converted or renamed after the seed was written, or the seed used a short name:

| Seed row | Region | Matches | Action |
|---|---|---|---|
| Mapúa University | NCR | Mapua University (Intramuros, Manila; Makati campus for IT/CS) | rename to the matched row |
| Far Eastern University | NCR | Far Eastern University (Manila) | rename to the matched row |
| University of the East | NCR | University of the East - Caloocan | rename to the matched row |
| Technological Institute of the Philippines | NCR | Technological Institute of the Philippines - Manila | rename to the matched row |
| National University | NCR | National University (Manila) | rename to the matched row |
| Don Honorio Ventura State University | R03 | Pampanga State University | rename to the matched row |
| Occidental Mindoro State College | MIMAROPA | Occidental Mindoro State University | rename to the matched row |
| Camarines Sur Polytechnic Colleges | R05 | Polytechnic State University of Bicol | rename to the matched row |
| University of the Philippines Tacloban College | R08 | University of the Philippines Tacloban | rename to the matched row |
| Surigao del Sur State University | R13 | North Eastern Mindanao State University | rename to the matched row |
| Agusan del Sur State College of Agriculture and Technology | R13 | Agusan del Sur State University | rename to the matched row |
| Basilan State College | BARMM | Basilan State University | rename to the matched row |
| Sulu State College | BARMM | Sulu State University | rename to the matched row |

Seed rows that are LUCs rather than SUCs, eligible only if the CCDO accepts the FAQ wording: Pamantasan ng Lungsod ng Maynila.

182 eligible institutions are missing from the seed: 70 public and 112 private, of which 26 are teacher-ed-only. See `seed-delta-additions.csv`.

## Rows deliberately not promoted

- **LUC / community college (policy question; see lucs.csv)** (5): Baliuag Polytechnic College, Maasin City College, Mabalacat College, Pamantasan ng Montalban, Sorsogon Community College
- **excluded: Career-Guide listing without COE/COD/SUC/FAAP designation** (11): Air Link International Aviation College, Cebu Doctors' University, Cebu Doctor’s Hospital – Mandaue City, Cebu, De La Salle Medical and Health Sciences Insti, De La Salle-College of Saint Benilde, La Salle University – Ozamiz, Saint Gabriel College, Saint Paul University, Southwestern University, Universidad de Zamboanga, University of La Salette
- **excluded: maritime programs, not priority S&T** (3): John B. Lacson Colleges Foundation, John B. Lacson Foundation Maritime University, Maritime Academy of Asia and the Pacific
- **public: named SUC-tagged but no canonical match (campus or renamed?)** (1): Rizal Memorial Colleges
- **review** (3): Manila Tytana Colleges, Inc., Saint Joseph Institute of Technology, University of La Salette - Santiago

The five names left in the LUC bucket are renames or mergers the LUC pass resolved separately: Maasin City College is now a Southern Leyte State University campus (RA 11079), Sorsogon Community College was turned over to Sorsogon State University, Baliuag Polytechnic College is now Dalubhasaang Politekniko ng Lungsod ng Baliwag, Gov. Alfonso D. Tan College is now Tangub City Global College, and Mabalacat College is listed under its current name. The LUC tier itself: 166 rows from CHED's HEIDA directory cross-checked against the UniFAST free-tuition list (121 confirmed there) and CHED's June 2025 count of 154 LUCs; 12 rows are newly created LGU colleges without a CHED code yet, flagged in `notes`.

## The rule, verbatim

**2026 DOST-SEI S&T Undergraduate Scholarship Brochure, "STUDY PLACEMENT"** (science-scholarships.ph/pdf/2026_UG_Scholarship_Brochure.pdf):
- University of the Philippines
- State Universities and Colleges
- Private Institutions that are recognized by CHED as Centers of Excellence or Centers of Development or have FAAP Level III accreditation for the priority S&T programs of study.

**JLSS / RA 10612** (science-scholarships.ph JLSS section; DOST Region V brochure): "For RA 10612: All of the above and schools that offer CHED compliant courses that are included in the list of priority S&T programs of study EXCEPT EDUCATION COURSES."

**DOST-SEI Helpdesk FAQ, 2027 cycle** (helpdesk.sei.dost.gov.ph/faqs): "…an eligible institution, such as: State Universities and Colleges (SUCs); **Local Universities and Colleges (LUCs)**; and Private Higher Education Institutions (HEIs) that offer the priority program and are: Recognized by CHED as a Center of Excellence (COE) or Center of Development (COD) for the priority S&T program; or Accredited at least Level III by the Federation of Accrediting Agencies of the Philippines (FAAP) for the priority S&T program."

**DOST-SEI eFOI reply #SEI-742778963899, 20 Jun 2022:** "this list varies every year, hence, we could not provide the consolidated list." DOST-SEI attached CHED's COE/COD list and PACUCOA's FAAP list instead.

## What that means for the data

1. **There is no official master list of eligible institutions.** DOST-SEI publishes the rule and defers to CHED (COE/COD) and FAAP accreditors (PAASCU, PACUCOA, ACSCU-ACI). Any list is a compilation; ours is one.
2. **Eligibility is institution × program, not institution.** A private HEI is eligible only for the programs it is COE/COD/Level-III in. UP and SUCs are eligible for every priority program they offer. The `universities` table cannot carry eligibility as a boolean; the CSV's `basis` column names the programs where the source did.
3. **RA 10612 widens placement to any HEI whose program is CHED-compliant** (IRR Rule II §1(b): a *program* meeting CHED PSGs; evidenced by a COPC for SUCs/LUCs or Government Recognition for private HEIs). No list exists and none can, since it is per program per campus. Education courses are excluded from RA 10612.
4. **LUCs**: named as eligible in the live Helpdesk FAQ, absent from the 2026 brochure. Kept in a separate tier for the CCDO to decide.
5. **Nine institution-locked programs** in the 2026 brochure footnotes: UP System only (BS Agricultural Biotechnology); ADMU only (Applied Math/Mathematical Finance, Applied Physics w/ ACS or MSE, Chemistry w/ ACS or MSE, Management Information Systems); DLSU-Manila only (IME-IT, Manufacturing Eng-Mgt-Biomedical, Manufacturing Eng-Mgt-Mechatronics & Robotics, BS Human Biology 3-yr); USC only (BSE Biology-Chemistry, Physics-Chemistry, Physics-Mathematics); UPM only (BS Basic Medical Sciences); UERMMMCI only (BS Prosthetics and Orthotics); CPU only (BS Packaging Engineering); UST only (BS Data Science and Analytics).

## Sources used (newest first)

| Source | Date | What it gave |
|---|---|---|
| DOST-SEI 2026 UG Scholarship Brochure | 2026 cycle | Placement rule verbatim; 133 priority programs; footnote-locked institutions |
| PACUCOA "Certified Levels as of July 4, 2026" (pacucoa.com) | Jul 2026 | Level III/IV private programs, 309 institutions parsed programmatically |
| PAASCU member database (paascu.org.ph, 213 school pages) | 2025–2026 | Level III/IV private programs with validity dates |
| CHED "Distribution of HEIs AY 2024-25" (legacy.ched.gov.ph) | Jun 2025 | 113 SUC main campuses per region (count reconciliation) |
| DBM NEP FY2026 SUC roster (dbm.gov.ph) | 2025 | One line per chartered SUC, region-coded |
| CHED HEIDA directory (heida.ched.gov.ph) | live | LUC rows tagged "Local Government College/University" |
| CMO No. 10 s. 2025 (COE policy) + CMO No. 03 s. 2019 (extension of 2016 COE/COD) | 2019, 2025 | Status of the COE/COD designations (see caveat) |
| DOST-6 "Priority S&T Programs and Schools in Region VI" | Jun 2024 | Regional eligible list, 19 institutions by campus |
| DOST-10 eligible schools/programs list | Jun 2024 | Regional eligible list, 23 institutions |
| CHED "List of Centers of Excellence and Development" (ieducationphl.ched.gov.ph) | Feb 2022 (data as of May 2018) | COE/COD per program, 134 HEIs |
| DOST-SEI coecod.pdf, suc.pdf, certlevelfaap.pdf (sei.dost.gov.ph/images/stsd, via Wayback; coecod.pdf is the file SEI attached to the 2022 eFOI) | 2018 | SEI's own COE/COD list (123 HEIs), SUC+LUC list (76+52), PACUCOA 2018 |
| SEI STEM Career Guide program pages (sei.dost.gov.ph/stemcg, 88 pages) | tags as of 2018 | Per-program institution lists tagged [COE]/[COD]/[SUC]/[FAAP] |
| CHED CMO 9 s.2019 "SUC Level of 106 SUCs"; RA texts (lawphil) for every 2021–2026 conversion | 2019–2026 | SUC charters and renames |
| UP System constituent-university page + BOR 1409th meeting (27 May 2026) | 2026 | UP Tacloban elevated to 9th CU |

## Caveats that matter

- **CHED COE/COD designations are 2015–2016 vintage.** CMO 03 s.2019 extended them "until the new guidelines are formulated"; CMO 10 s.2025 is those guidelines, covers COEs only, has no transitory clause, and opened a new application round (deadline 31 Oct 2025). No new list was published as of Sept 2026. DOST regional offices and the universities still cite the 2016 designations, but they are legally in limbo.
- **FAAP coverage:** PACUCOA complete (July 2026 list); PAASCU complete for members but several validity dates on PAASCU pages are already past (UST engineering, USC sciences, ADZU, USLS, SLU, DLSU ME, UE-Caloocan) and may simply be un-updated; **ACSCU-ACI publishes no list** — only CPU, Filamer, TUA, Wesleyan-Philippines captured.
- **Three newer FOI attachments could not be fetched** — they sit behind a Cloudflare Turnstile check, which I did not complete. Worth downloading by hand; the first two are the most likely to be newer than anything used here:
  - https://www.foi.gov.ph/documents/273800/e-FOI_Oracion.pdf — DOST-SEI's Aug 2023 response on accredited schools by program
  - https://www.foi.gov.ph/documents/265879/ATTACHMENT_MORANO.pdf — CHED's 2023 COE/COD/FAAP-Level-III list
  - https://www.foi.gov.ph/documents/259748/Annex_A_-_Program_Covered_by_the_DOST-SEI_Undergraduate_Scholarships.pdf — 2023 priority-programs annex
- **Region calls:** Negros Occidental/Oriental/Siquijor institutions are filed under NIR (the seed's 18-region set) even where 2018-era sources say VI/VII. Sulu State University and MSU-Sulu are R09 (EO 91 s.2025 moved Sulu to Zamboanga Peninsula). Basilan State University is R09 (Isabela City is outside BARMM). Cotabato State University is BARMM.
- **Two chartered SUCs absent from CHED's June 2025 count and the FY2026 budget roster:** Misamis Occidental State College (RA 11282) and Iligan City Polytechnic State College (RA 11856) — flagged in notes; operational status unverified.
- **BS Nursing and BS Criminology are not priority programs** (Helpdesk FAQ) — the UP Manila School of Health Sciences campuses (Palo, Baler, Koronadal, Tarlac) are listed for completeness only.

## What was done, and what is still open

1. ~~CCDO decides two policy points.~~ **Answered 2026-09-08: yes to both** — LUCs are included (migration 0050) and the teacher-education-only schools stay. Twelve LUCs carry no CHED institution code yet and are flagged in 0050's header for CRRD to deactivate if preferred.
2. Download the three FOI attachments by hand (links above) and diff them against `dost-sei-eligible-institutions.csv`; CHED's 2023 list is likely newer than the 2018 COE/COD data used here.
3. Done in 0048: the five renames that are confirmed in use, the two region corrections, and 158 inserts. One naming rule throughout — the name the school operates under today. Eight schools with an unconferred conversion law therefore keep their present names (Camarines Sur Polytechnic Colleges, Basilan State College, Sulu State College, Ilocos Sur Polytechnic State College, Aurora State College of Technology, Bicol State College of Applied Sciences and Technology, J.H. Cerilles State College, Camarines Norte State College); Basilan and Sulu also moved to Region IX.
4. `programs`: the 2026 brochure lists 133 priority programs; the SRS's 13 are a subset. The nine institution-locked programs in the brochure footnotes cannot be expressed as institution rows.
