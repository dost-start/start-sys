-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0008_applications.sql
--
-- WHAT:      The public intake surface and its v1.2 sibling:
--              applications          external membership applications — applicant PII, the
--                                    proof-of-enrollment pointers, the review outcome, and
--                                    the submit-token capability that replaces an anon
--                                    UPDATE policy
--              renewal_submissions   renewal-form bodies from EXISTING people (v1.2)
--            Plus the policies for both, the sensitive-column registrations, the
--            archived-term freeze triggers and the audit trigger.
--
-- WHY:       PRD §3 v1.0 items 5-8 and PRD US-B1/US-B2/US-B3/US-B4. This is the ONLY
--            unauthenticated write path in the whole system, so every predicate below is
--            load-bearing and the absences are as load-bearing as the presences.
--
-- POLICIES ARE IN THIS FILE, NOT IN 0014_rls.sql. ADR 0002 defers policies to 0014 because
--            every policy body calls auth_role(), which lands in 0012 — but 0014 has ALREADY
--            APPLIED by the time this migration is written. A policy for a table created
--            here cannot go into an applied file (CONVENTIONS.md §3.4: never edit an applied
--            migration). ADR 0002's constraint is satisfied anyway: auth_role() exists, so
--            the bodies resolve. From 0008 onward the CONVENTIONS.md §3.4 rule holds in its
--            plain form — a new table ships with its policies in the same file.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- THREE DIVERGENCES FROM DATA_MODEL.md §6/0008, EACH DELIBERATE (BUILD_PLAN S3-T4)
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- 1. `unique (term_id, applicant_email)` becomes a PARTIAL UNIQUE INDEX
--    `where status <> 'draft'`. Two independent reasons, and the second is a security
--    property rather than a usability one:
--      · As a table constraint it fires at INSERT time, i.e. at the moment the applicant
--        types their email — which makes the public form an EMAIL-ENUMERATION ORACLE. A
--        stranger could probe which addresses have already applied by watching which
--        submissions error.
--      · An applicant whose browser dies between the draft INSERT and the upload is then
--        permanently locked out until purge_abandoned_drafts() (0020) runs, because their
--        abandoned draft holds the pair.
--    Deferring uniqueness to the draft -> pending flip is what lets finalize_application()
--    (0019) swallow the collision and return a response byte-identical to a first-time
--    submission. The constraint still does its real job: at most one LIVE application per
--    email per term.
--
-- 2. `submit_token_hash text` + `submit_token_expires_at timestamptz` are ADDED.
--    The intake flow is three steps — server mints a draft, browser PUTs the bytes straight
--    to the document store (Vercel caps request bodies at 4.5MB and a phone photo of a
--    Certificate of Registration exceeds it), server finalizes. Step three has to update a
--    row on behalf of an anonymous caller. The obvious implementation is an anon UPDATE
--    policy, and it is wrong: any anon UPDATE policy is a predicate an attacker can probe
--    against every row in the table. Instead the caller presents a bearer capability for
--    EXACTLY ONE ROW, checked inside a SECURITY DEFINER function, so
--    **NO ANON UPDATE POLICY EXISTS ANYWHERE IN THIS SCHEMA.** Only the sha256 hex digest
--    is stored; the token itself never touches the database.
--
-- 3. `applications_read` names exec_admin, crrd_admin and moderator and NOBODY ELSE —
--    tech_admin included. An application row is sensitive end to end (raw birthdate,
--    address, contact number, school ID, plus a pointer to a Certificate of Registration),
--    and PRD OQ-5's default answer is that "configure the system and control access" is not
--    "read everyone's address".
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ⚠ ONE COLLISION FOUND AND RESOLVED IN THE SAFE DIRECTION — FLAGGED, NOT SILENT
-- ═══════════════════════════════════════════════════════════════════════════════════
--   BUILD_PLAN S3-T4 specifies renewal_submissions with "no policies at all yet — v1.2 uses
--   it". That is not shippable: 026_policy_invariants.sql assertion (c) requires every table
--   in public to carry a SELECT-capable policy EXCEPT a hard-coded whitelist of three
--   deliberately-unreachable tables (member_id_counters, mfa_recovery_codes,
--   rate_limit_buckets). renewal_submissions is not on that list, so shipping it policyless
--   turns a CI-blocking suite in another lane red.
--
--   Resolved by shipping the READ half only — the same three reviewer roles plus the person
--   themselves, which is what PRD US-G7 and US-H4 will need in v1.2 and is defensible on its
--   own today. There is still NO INSERT and NO UPDATE policy, so the table remains unwritable
--   by every human role and v1.2 must add the member INSERT policy deliberately. That is the
--   correct failure direction. Raised for the S7/026 owner in the PR rather than resolved by
--   editing their whitelist.
--
-- CITATION:  DATA_MODEL.md §6/0008, §8.1, §9; ARCHITECTURE.md §4.1, §5;
--            PRD §3 v1.0 items 5, 6, 7, 8; PRD US-B1, US-B2, US-B3, US-B4, US-C1, US-C2,
--            US-G7, US-J1, US-J2; CBL Art. VIII §6 (RA 10173 as a constitutional obligation).
--
-- ROLLBACK:  Forward-only. `applications` is the FK source for the person a successful
--            application becomes (0023, approve_application()). There is no DELETE path
--            anywhere in this schema by design — an abandoned draft is REDACTED, never
--            removed (0020).
-- ═══════════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 1 — applications
-- ═══════════════════════════════════════════════════════════════════════════════════
create table public.applications (
  id                    uuid primary key default gen_random_uuid(),
  term_id               uuid not null references public.terms(id),
  status                public.application_status not null default 'draft',

  -- ── SENSITIVE (RA 10173, CBL Art. VIII §6) ──────────────────────────────────────
  -- The raw submission, captured before any `people` row exists. `payload` is the densest
  -- PII object in the schema: birthdate, address, contact number, school ID number. All
  -- four columns are registered in sensitive_column_registry at the foot of this file, which
  -- is what makes mask_sensitive() redact them out of every audit row (0011) and what makes
  -- them purgeable (0020 for abandoned drafts, redact_expired_pii() for the five-year mark).
  --
  -- citext, so an applicant who types Juan@Example.com on Monday and juan@example.com on
  -- Tuesday collides on the partial unique index below rather than acquiring two
  -- applications and, eventually, two member IDs.
  applicant_email       citext not null,
  applicant_given_name  text not null,
  applicant_family_name text not null,
  payload               jsonb not null default '{}'::jsonb,

  -- ── proof of enrollment (PRD Addendum, US-B2) ───────────────────────────────────
  -- POINTERS ONLY. The bytes live in the document store and never in this database
  -- (PRD §4: general file storage is a non-goal; the only files the system handles are
  -- proof-of-enrollment documents).
  --
  -- proof_drive_file_id is provider-opaque BY CONTRACT: it holds a Google Drive file id OR
  -- a Supabase Storage object path, and nothing outside lib/documents/ interprets it. That
  -- is the whole reason the S3 fallback is an environment-variable flip rather than a
  -- migration (ADR 0005).
  --
  -- proof_web_view_link is stored but MUST NEVER REACH A BROWSER (PRD US-J2). Documents are
  -- served by GET /api/applications/[id]/proof, which authorizes with an ordinary
  -- RLS-checked SELECT and writes an audit row per view. S4-T4's column GRANT withholds this
  -- column from `authenticated` for exactly that reason.
  --
  -- proof_size_bytes and proof_mime_type are written from a SERVER-SIDE re-fetch of the
  -- provider's own metadata, never from the client's claim, and proof_verified_at is the
  -- timestamp of that re-verification (ARCHITECTURE.md §4.1 step 5).
  proof_drive_file_id   text,
  proof_web_view_link   text,
  proof_mime_type       text,
  proof_size_bytes      bigint,
  proof_verified_at     timestamptz,

  -- ── the submit-token capability (divergence 2) ──────────────────────────────────
  -- The sha256 hex digest of a 32-byte token minted server-side at draft creation and
  -- returned to the browser exactly once. finalize_application() (0019) is the only reader.
  -- The PLAINTEXT TOKEN IS NEVER STORED AND MUST NEVER BE LOGGED.
  submit_token_hash        text,
  submit_token_expires_at  timestamptz,

  -- ── review outcome (PRD US-C1, US-C2) ───────────────────────────────────────────
  -- person_id is written ONLY by approve_application() (0023), in the same transaction that
  -- mints the member ID and inserts the membership. No human role holds an INSERT privilege
  -- on public.people (0015), so you can never get an ID without a membership or vice versa.
  person_id             uuid references public.people(id),
  reviewed_by           uuid references auth.users(id),
  reviewed_at           timestamptz,
  review_note           text,

  -- Stamped by purge_abandoned_drafts() (0020) and by redact_expired_pii() (0012). A
  -- redacted row is a SKELETON, never a deleted row: id, term_id, status and created_at
  -- survive, which is what proves the sweep ran (PRD US-J3).
  redacted_at           timestamptz,

  -- Stamped by the draft -> pending flip. "Submitted" is prose for that flip; `pending` is
  -- the enum value, matching the PRD's own vocabulary (DATA_MODEL.md §3.2).
  submitted_at          timestamptz,
  created_at            timestamptz not null default now(),

  -- PRD US-C2: "approval creates the member's membership record". An approved application
  -- with no person is a member ID that went nowhere.
  constraint approved_has_person
    check (status <> 'approved' or person_id is not null),

  -- PRD US-B2: proof of enrollment is part of the application, not an afterthought. A row
  -- may only leave `draft` once a document reference exists.
  constraint pending_has_proof
    check (status = 'draft' or proof_drive_file_id is not null)
);

comment on table public.applications is
  'External membership applications (PRD §3 v1.0 items 5-8). The only table an '
  'unauthenticated caller may write to, and only while an application window is open. '
  'Sensitive end to end: applicant_email, payload, the two proof pointers and '
  'submit_token_hash are all registered in sensitive_column_registry.';

comment on column public.applications.submit_token_hash is
  'sha256 hex digest of the one-time submit token. Exists so that finalize_application() '
  'can authorize an anonymous update of exactly one row and NO ANON UPDATE POLICY has to '
  'exist. The plaintext token is never stored and never logged.';

comment on column public.applications.proof_drive_file_id is
  'Provider-opaque document reference: a Google Drive file id OR a Supabase Storage object '
  'path. Nothing outside lib/documents/ interprets it — that is what makes the document-store '
  'fallback an env-var flip rather than a migration (ADR 0005).';

-- ── the partial unique index (divergence 1) ────────────────────────────────────────
-- At most one LIVE (pending / approved / rejected) application per email per term. Drafts
-- are excluded on purpose: see divergence 1 in the header. finalize_application() catches
-- the unique_violation this raises and returns success anyway, leaving the duplicate row as
-- a draft for the sweep — so a second submission from the same address is indistinguishable
-- from a first one at the response level.
create unique index applications_one_live_per_email_per_term
  on public.applications (term_id, applicant_email)
  where status <> 'draft';

-- The review queue (PRD US-C1: filter by status and term, sort by submission time) and the
-- dashboard's pending-application count (PRD US-D4).
create index applications_term_status on public.applications (term_id, status);

-- purge_abandoned_drafts() (0020) scans exactly this predicate every night.
create index applications_abandoned_drafts on public.applications (created_at)
  where status = 'draft' and redacted_at is null;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 2 — renewal_submissions
-- ═══════════════════════════════════════════════════════════════════════════════════
-- Separate from `applications` because the ACTOR and the POLICY are different: an
-- application is written by a stranger with no account, a renewal by an existing person who
-- has one. PRD US-H4's carve-out — "no access to any part of the website unless it's for
-- membership renewal" — is two policies rather than an if-statement someone can forget to
-- write, and the second of those two policies lands in v1.2.
create table public.renewal_submissions (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people(id),
  -- The NEW term being renewed INTO, never the term being renewed from.
  term_id      uuid not null references public.terms(id),
  -- SENSITIVE: same shape and same sensitivity as an application body. Registered below.
  payload      jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  -- One renewal per person per term. The same shape as memberships' own uniqueness, and for
  -- the same reason (PRD US-H1).
  unique (person_id, term_id)
);

comment on table public.renewal_submissions is
  'Membership renewal form bodies (PRD US-G7, v1.2). READ policy ships now so 026''s '
  '"every table has a SELECT-capable policy" invariant holds; there is deliberately NO '
  'INSERT and NO UPDATE policy, so the table is unwritable by every human role until v1.2 '
  'adds the member INSERT policy on purpose.';


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 3 — triggers
-- ═══════════════════════════════════════════════════════════════════════════════════

-- Archived means read-only for EVERY role including exec_admin (DATA_MODEL.md §7.3). Both
-- tables carry term_id, so the 0005 form of the guard applies directly.
create trigger trg_applications_freeze_archived
  before insert or update on public.applications
  for each row execute function public.reject_write_to_archived_term();

create trigger trg_renewal_submissions_freeze_archived
  before insert or update on public.renewal_submissions
  for each row execute function public.reject_write_to_archived_term();

-- PRD US-C1 ("each document view is recorded"), US-C2 ("both outcomes write an audit entry
-- naming the deciding officer") and the History NFR. 0012's header explicitly defers this
-- trigger to "0008, S3" because the table did not exist yet; this is that attachment.
--
-- SECURITY INVARIANT 6: this is a DATABASE trigger precisely so no code path can skip it.
-- Do NOT add an application-side audit write anywhere. mask_sensitive() reads
-- sensitive_column_registry at write time, so the four sensitive columns registered at the
-- foot of this file are redacted BEFORE the audit row is stored — the log answers "who
-- decided this application, and when" without becoming a second copy of the PII.
create trigger trg_applications_audit
  after insert or update on public.applications
  for each row execute function public.audit_row();

-- renewal_submissions is deliberately NOT audited here. DATA_MODEL.md §8.3's list does not
-- name it, nothing writes it in v1.0, and attaching the trigger now would assert a decision
-- the v1.2 owner should make alongside the INSERT policy. Flagged rather than assumed.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 4 — RLS: ENABLE + FORCE
-- ═══════════════════════════════════════════════════════════════════════════════════
-- FORCE matters and ENABLE alone is not enough: a table owner bypasses non-forced RLS and
-- the Supabase migration role IS the owner. 001_meta_force_rls.sql enumerates pg_class and
-- fails CI if either flag is missing on any table in public.
alter table public.applications         enable row level security;
alter table public.applications         force  row level security;
alter table public.renewal_submissions  enable row level security;
alter table public.renewal_submissions  force  row level security;


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 5 — policies
-- ═══════════════════════════════════════════════════════════════════════════════════

-- ── applications_insert_anon ───────────────────────────────────────────────────────
-- THE ONLY UNAUTHENTICATED WRITE POLICY IN THE SYSTEM. Every conjunct below is doing work.
--
--   window EXISTS   PRD US-B4 / DATA_MODEL.md §9. "The application period is closed" is a
--                   DATABASE FACT, not a hidden link — a forwarded or bookmarked /apply URL
--                   is inert outside the period. Note that this sub-select is evaluated AS
--                   ANON and is therefore itself subject to application_windows_read_anon
--                   (0014), which already narrows anon to a window open right now. The
--                   predicate is deliberately spelled out here as well, so this policy is
--                   correct on its own reading and does not depend on another file's anon
--                   policy remaining narrow. ⚠ If that grant or policy is ever removed,
--                   every anonymous submission fails with an opaque RLS error that reads
--                   exactly like a form bug — 041_applications_anon_insert_rls.sql asserts
--                   the success path so the breakage lands in CI instead of in the field.
--
--   term_id =       The client does not choose its term. Without this an anonymous caller
--   current_term_id could insert into a draft or archived term (the freeze trigger catches
--                   the archived case; nothing else catches the draft case).
--
--   status='draft'  **WITHOUT THIS PIN AN ANONYMOUS CALLER INSERTS status='approved'
--                   DIRECTLY.** approved_has_person would then require a person_id, which
--                   the next conjunct forbids — but relying on a CHECK to close an
--                   authorization hole is an accident waiting to be refactored. The state
--                   machine starts at draft, for everyone, always.
--
--   the NULL block  Nobody may self-review, self-approve, or arrive with proof metadata
--                   already stamped. proof_* and submitted_at are written by
--                   finalize_application() AFTER a server-side re-fetch of the provider's
--                   own metadata; person_id / reviewed_* are written by
--                   approve_application() and reject_application() (0023, 0024).
--
-- submit_token_hash and submit_token_expires_at are DELIBERATELY unconstrained here. A row
-- inserted with a null or unknown hash is simply unfinalizable — the digest comparison in
-- 0019 yields NULL, which is not true, which raises — so it can only ever become an
-- abandoned draft that the sweep redacts. Constraining them would buy nothing.
create policy applications_insert_anon on public.applications
  for insert to anon
  with check (
    exists (
      select 1
      from public.application_windows w
      where w.term_id   = applications.term_id
        and w.form_kind = 'membership_application'
        and now() between w.opens_at and w.closes_at
    )
    and applications.term_id = public.current_term_id()
    and applications.status  = 'draft'
    and applications.person_id           is null
    and applications.reviewed_by         is null
    and applications.reviewed_at         is null
    and applications.review_note         is null
    and applications.proof_drive_file_id is null
    and applications.proof_web_view_link is null
    and applications.submitted_at        is null
  );

-- ── applications_read ──────────────────────────────────────────────────────────────
-- PRD US-C1: CRRD and Executive Admins review applications; moderators do the day-to-day
-- work, and you cannot review an application without reading it (ARCHITECTURE.md §5).
--
-- ⚠ **THERE IS NO ANON SELECT POLICY AND NO ANON UPDATE POLICY ON THIS TABLE, AND THOSE TWO
-- ABSENCES ARE THE ANTI-ENUMERATION MECHANISM.** anon holds Supabase's default SELECT
-- privilege, so what returns zero rows is the missing policy, not a missing grant — which is
-- deny-by-default working as designed. The obvious feature request that would undo it is
-- "let the applicant check their status later": do not add a policy for it. An
-- accountless status-lookup surface is a way to ask the database whether a given person
-- applied, and the answer is PII. PRD §4 defers applicant self-service outright — the
-- applicant contacts CRRD and CRRD edits the application.
--
-- tech_admin is absent from this list, deliberately (PRD OQ-5). officer, regional_rep and
-- member are absent because an application is not an organizational record they have any
-- claim on.
create policy applications_read on public.applications
  for select to authenticated
  using (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));

-- ── applications_update ────────────────────────────────────────────────────────────
-- PRD §4 (Non-Goals, "Applicant self-service edit after submission"): "v1 answer: applicant
-- contacts CRRD, CRRD edits the application." This is the policy that makes that answer
-- possible. The same three roles, so a reviewer cannot edit what they cannot read.
--
-- The DECISION path is NOT this policy: approve_application() and reject_application()
-- (0023, 0024) are SECURITY DEFINER and carry their own guards and their own state-machine
-- trigger. S4-T4 narrows the editable surface further with a column-level GRANT — status,
-- person_id, reviewed_* and the proof pointers are withheld there, so the decision cannot be
-- routed around by a hand-written UPDATE. That narrowing is S4's lane and is not done here.
create policy applications_update on public.applications
  for update to authenticated
  using      (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'))
  with check (public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator'));

-- NO applications INSERT policy for `authenticated`, deliberately. A membership application
-- comes from an applicant; approve_application() creates the person. An admin who needs to
-- enter an application on someone's behalf does it through the public form.
--
-- NO DELETE POLICY, here or anywhere (PRD Reliability NFR, CLAUDE.md). An application that
-- should not have been submitted is redacted (0020), never removed.

-- ── renewal_submissions_read ───────────────────────────────────────────────────────
-- See the collision note in the header: this ships now so 026's SELECT-policy invariant
-- holds, and it is correct on its own terms. The three operational roles read renewals
-- because reviewing one is their job (PRD US-G7); a person reads their OWN because they
-- submitted it (PRD US-H4 — the renewal form is the one surface a departed member keeps).
create policy renewal_submissions_read on public.renewal_submissions
  for select to authenticated
  using (
    public.auth_role() in ('exec_admin', 'crrd_admin', 'moderator')
    or person_id = public.auth_person_id()
  );

-- NO INSERT and NO UPDATE policy on renewal_submissions. v1.2 adds the member INSERT policy
-- — "a person with ANY past membership may insert exactly one renewal row while a renewal
-- window is open" (ARCHITECTURE.md §4.3) — deliberately, with its own pgTAP assertions.
-- Until then the table is unwritable by every human role, which is the correct state for a
-- table nothing in v1.0 writes.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 6 — privileges
-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0015_grants.sql's DO loop revokes DELETE from anon and authenticated across every table
-- that existed WHEN IT APPLIED — and it applies after this file, so both tables here are
-- covered by it. The revokes below are therefore belt to that brace, and they are repeated
-- explicitly because a reader asking "what can the anonymous role do to applications?"
-- should find the answer in the migration that creates the table.
--
-- anon KEEPS its default INSERT and SELECT privileges, and both are deliberate:
--   INSERT  the public form genuinely writes as the `anon` database role (the Server Action
--           holds no session), so the privilege is required and the POLICY above is the
--           control.
--   SELECT  kept so that an anonymous `select ... from applications` returns ZERO ROWS
--           rather than raising 42501. Both refuse, but a silent empty set is the better
--           anti-enumeration answer: it is the same response whether or not the table has
--           rows, and it makes the missing policy — not a missing grant — the mechanism
--           under test in 041/042.
--
-- renewal_submissions is revoked the same way and for the same reason: anon keeps only the
-- SELECT privilege it inherits, so an anonymous read of it is refused by the MISSING POLICY
-- and returns zero rows rather than raising. Two tables, one mechanism, one thing for a
-- future reader to learn.
revoke update, delete on public.applications                from anon;
revoke insert, update, delete on public.applications        from authenticated;
revoke insert, update, delete on public.renewal_submissions from anon;
revoke insert, update, delete on public.renewal_submissions from authenticated;

-- ⚠ NOTE ON THE `authenticated` INSERT/UPDATE REVOKE ABOVE: there IS an applications_update
-- POLICY for the three reviewer roles, and a policy without a privilege grants nothing. The
-- UPDATE privilege is re-granted, narrowed to five editable columns, by S4-T4's
-- 0027_applications_review_grants.sql — which is where the "CRRD edits the application"
-- surface is actually defined, and which is written to inspect what this file shipped before
-- it grants anything. Between this migration and that one, `applications` is readable by the
-- three reviewer roles and writable only through SECURITY DEFINER functions. That is the
-- correct failure direction and it is stated here so S4 does not read the missing privilege
-- as an oversight.


-- ═══════════════════════════════════════════════════════════════════════════════════
-- 7 — sensitive-column registrations  (CONVENTIONS.md §13 rule 4)
-- ═══════════════════════════════════════════════════════════════════════════════════
-- "A new sensitive column is registered in the SAME migration that creates it. Forgetting is
-- how PII leaks into the audit log." ONE registry drives TWO mechanisms — mask_sensitive()
-- redacts these keys before an audit row is written (0011), and the purges NULL them (0020,
-- and redact_expired_pii() at the five-year mark) — so the two can never disagree about what
-- sensitive means.
--
-- 0016_seed.sql already carries FORWARD ROWS for four of these six pairs, written before this
-- table existed. 0016 applies AFTER this file and uses `on conflict do nothing`, so those
-- four become no-ops there and this migration is where they actually land. That is the right
-- way round: the classification is now stated by the migration that creates the columns, and
-- 0016's forward rows degrade into documentation. `submit_token_hash` is NEW and appears
-- nowhere else — it is not in DATA_MODEL.md §8.1 because the column is a S3-T4 divergence.
--
-- ⚠ FOR THE 0016 / S7-T26 OWNER: 0016's header flags that its forward rows would fail
-- 099_security_invariants.sql assertion (5) — "every registered pair names a column that
-- actually exists" — until the tables ship. Four of the six named there ship HERE, so the
-- residual is now exactly two pairs on email_recipients (v1.1) plus renewal_submissions,
-- which also ships here. Only email_recipients remains outstanding.
insert into public.sensitive_column_registry (table_name, column_name, rationale) values
  ('applications', 'applicant_email',
   'Raw applicant contact address, captured before any people row exists.'),
  ('applications', 'payload',
   'The entire validated application body: birthdate, address, contact number, school ID. The densest PII object in the schema.'),
  ('applications', 'proof_web_view_link',
   'Pointer to the proof-of-enrollment document. Must never reach a browser; PRD US-J2 forbids any unauthenticated link to it.'),
  ('applications', 'proof_drive_file_id',
   'Provider-side identifier for the proof-of-enrollment document. Addresses a file containing a student number and address.'),
  ('applications', 'submit_token_hash',
   'Digest of the one-time submit capability for an application row. Not personal data itself, but a live authorization secret: masked so it can never be reconstructed from an audit row, and cleared by the abandoned-draft sweep.'),
  ('renewal_submissions', 'payload',
   'Renewal form body. Same shape and same sensitivity as an application payload.')
on conflict (table_name, column_name) do nothing;
