-- ═══════════════════════════════════════════════════════════════════════════════════
-- 0019_finalize_application.sql
--
-- WHAT:      finalize_application(app_id, token, file_ref, mime, size) — the token-gated
--            SECURITY DEFINER function that flips an application from `draft` to `pending`
--            after the browser has PUT its proof-of-enrollment document straight to the
--            document store.
--
-- WHY IT EXISTS AT ALL — THE ONE SENTENCE THAT MATTERS:
--            **THIS FUNCTION IS HERE SO THAT NO ANON UPDATE POLICY HAS TO BE.**
--            The intake flow is three steps and step three updates a row on behalf of an
--            anonymous caller (ARCHITECTURE.md §4.1). The obvious implementation is an anon
--            UPDATE policy on `applications`; it is wrong, because any anon UPDATE policy is
--            a predicate a stranger can probe against every row in the table. Instead the
--            caller presents a bearer capability scoped to EXACTLY ONE ROW, verified in here
--            where the check cannot be reached any other way. 0008 ships no anon UPDATE
--            policy, and 042_applications_read_rls.sql asserts that absence.
--
-- WHY THE BYTES DO NOT COME THROUGH US: Vercel caps a function request body at 4.5MB and a
--            phone photo of a Certificate of Registration routinely exceeds it, so streaming
--            the upload through a Route Handler fails in the field rather than in testing.
--            The browser PUTs to a server-minted, short-lived, single-file upload session and
--            reports back the reference. Which means the client is telling us what it
--            uploaded, and the client is not to be believed — the caller (S3-T16) re-fetches
--            the provider's OWN metadata and sniffs magic bytes before calling this function,
--            and passes the VERIFIED size and MIME here rather than the declared ones. This
--            function re-checks them against the allowlist anyway: it is the last gate before
--            the row becomes reviewable, and a gate that trusts its caller is not a gate.
--
-- ═══════════════════════════════════════════════════════════════════════════════════
-- ANTI-ENUMERATION IS THE DESIGN, NOT A FEATURE. THREE PLACES IT SHOWS UP:
-- ═══════════════════════════════════════════════════════════════════════════════════
--   1. A NON-EXISTENT application id RETURNS SILENTLY. It does not raise. If "no such row"
--      and "wrong token" were distinguishable, this function would be an oracle for whether
--      a given application id exists — and application ids appear in URLs.
--   2. A duplicate (term_id, applicant_email) UNIQUE VIOLATION IS SWALLOWED and the call
--      returns success, leaving the row as a draft for the sweep to redact. So the response
--      to "this person already applied" is byte-identical to the response to a first-time
--      submission. Without this, the public form tells a stranger which email addresses have
--      already applied — which is exactly why 0008 defers uniqueness to the non-draft rows
--      in the first place.
--   3. It RETURNS VOID. Deliberately. A return value is a channel, and a function reachable
--      by anon should have as few channels as possible. The applicant sees a success screen
--      rendered in place — no per-application URL, no reference number, no email echo — so
--      there is nothing for this function to hand back.
--
-- ON "CONSTANT TIME", HONESTLY: Postgres text `=` short-circuits. What defends the secret
--      here is not comparison timing but the shape of the comparison — both sides are
--      fixed-length sha256 hex, so length leaks nothing; the compared value is a DIGEST, so
--      the best a timing oracle yields is digest bytes rather than token bytes; and the token
--      is 32 bytes of CSPRNG output, single-purpose and short-lived, so a digest-prefix
--      oracle buys an attacker nothing before it expires. Claiming a constant-time compare
--      we do not have would be worse than saying this.
--
-- ERROR CODES, so the TS lane maps them deliberately rather than by discovery
-- (lib/action-result.ts mapDbError):
--      42501  insufficient_privilege        bad / missing / expired token; window closed
--      23514  check_violation  -> validation  disallowed MIME, oversize, missing file ref
--      55000  object_not_in_prerequisite_state  the row is approved or rejected already.
--             Semantically exact, and unreachable in practice — a decided application cannot
--             be finalized by a public caller who somehow holds an unexpired token. It maps
--             to `unknown` today; special-case it in the action if a nicer message is wanted.
--
-- CITATION:  BUILD_PLAN S3-T6; ARCHITECTURE.md §4.1 steps 3-5, §5; DATA_MODEL.md §3.2, §9;
--            PRD §3 v1.0 items 5, 6, 7; PRD US-B1, US-B2, US-B3, US-B4, US-J2.
--
-- ROLLBACK:  Forward-only. `create or replace` in a NEW file is the sanctioned way to change
--            this later — never by editing an applied migration (CONVENTIONS.md §3.4).
-- ═══════════════════════════════════════════════════════════════════════════════════

create or replace function public.finalize_application(
  p_app_id   uuid,
  p_token    text,
  p_file_ref text,
  p_mime     text,
  p_size     bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a          public.applications;
  v_expected text;
begin
  -- ── 1. Load and lock ─────────────────────────────────────────────────────────────
  -- FOR UPDATE, so two finalize calls for the same row (a double-clicked submit, a retried
  -- request) serialize here rather than racing on the status flip.
  select * into a
    from public.applications
   where id = p_app_id
     for update;

  -- ── 2. Unknown id: RETURN SILENTLY ───────────────────────────────────────────────
  -- Anti-enumeration point 1. Never distinguish "no such application" from "wrong token".
  if a.id is null then
    return;
  end if;

  -- ── 3. The capability check ──────────────────────────────────────────────────────
  -- sha256() is core in PG13+ — do NOT add pgcrypto for this (0001_extensions.sql
  -- enumerates the two extensions this system has, and adding a third is an ADR).
  -- convert_to(text, 'UTF8') rather than a ::bytea cast, which Postgres does not permit on a
  -- text VALUE even though it permits it on a literal.
  --
  -- All four failure modes below raise the SAME error with the SAME message. A caller must
  -- not be able to tell "there is no token on this row" from "your token is wrong" from
  -- "you are too late" — each distinction is a probe.
  v_expected := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');

  if a.submit_token_hash is null
     or a.submit_token_expires_at is null
     or a.submit_token_expires_at <= now()
     or v_expected <> a.submit_token_hash
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- ── 4. Idempotent success ────────────────────────────────────────────────────────
  -- A retried finalize — the browser's response was lost, the applicant hit the button
  -- twice — must not be an error. Same row, same document, already pending: nothing to do.
  --
  -- Checked AFTER the token gate, never before, so this branch cannot be used to ask whether
  -- an application is pending. `is not distinct from` rather than `=` so two NULLs would
  -- match, though pending_has_proof (0008) makes that unreachable.
  --
  -- ⚠ THIS BRANCH IS WHY THE TOKEN IS NOT CLEARED ON SUCCESS (see step 6). Clearing it would
  -- make the second call fail the gate at step 3 and never reach here.
  if a.status = 'pending' and a.proof_drive_file_id is not distinct from p_file_ref then
    return;
  end if;

  -- ── 5. State machine ─────────────────────────────────────────────────────────────
  -- DATA_MODEL.md §3.2: draft -> pending is the only edge this function may traverse.
  -- `approved` and `rejected` are terminal and reversing them would orphan a minted member
  -- ID (PRD US-C3).
  if a.status <> 'draft' then
    raise exception 'application % is %, not draft', p_app_id, a.status
      using errcode = '55000';
  end if;

  -- ── 6. Re-assert the window ──────────────────────────────────────────────────────
  -- PRD US-B4, applied to the SECOND half of the flow. The anon INSERT policy (0008) checked
  -- the window when the draft was created; between then and now the applicant uploaded a
  -- file, which takes real time on Philippine mobile data. A submission straddling the
  -- closing instant is refused HERE, at the data layer — not by a hidden button, and not by
  -- whatever the browser believed the closing time to be.
  --
  -- 42501 with a descriptive message rather than a distinct SQLSTATE: the closure of an
  -- application period is public information, so the message may say so, but the transport
  -- code stays the same as every other refusal on this surface.
  if not exists (
    select 1
    from public.application_windows w
    where w.term_id   = a.term_id
      and w.form_kind = 'membership_application'
      and now() between w.opens_at and w.closes_at
  ) then
    raise exception 'the application period is not open'
      using errcode = '42501';
  end if;

  -- ── 7. Validate the verified metadata ────────────────────────────────────────────
  -- These four values are the ALLOWLIST from lib/documents/types.ts, restated in SQL. They
  -- are restated rather than shared because this is the last gate: if the TypeScript
  -- allowlist is ever widened by accident, the database still refuses.
  --
  -- image/heic is on the list because it is what an iPhone produces, and a photo of a
  -- Certificate of Registration is the single most likely file an applicant uploads. No
  -- browser RENDERS it, which is the reviewer's problem (S4-T20 shows a notice and a
  -- new-tab link) — not a reason to refuse the upload and lose the applicant.
  if p_file_ref is null or length(btrim(p_file_ref)) = 0 then
    raise exception 'a proof-of-enrollment document is required'
      using errcode = '23514';
  end if;

  if p_mime is null
     or p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')
  then
    raise exception 'unsupported proof-of-enrollment document type'
      using errcode = '23514';
  end if;

  -- 10 MiB, matching MAX_PROOF_BYTES. p_size is the size the PROVIDER reported, re-fetched
  -- server-side — never the size the client claimed (ARCHITECTURE.md §4.1 step 5).
  if p_size is null or p_size <= 0 or p_size > 10485760 then
    raise exception 'proof-of-enrollment document exceeds the maximum size'
      using errcode = '23514';
  end if;

  -- ── 8. The flip, with the duplicate swallowed ────────────────────────────────────
  -- Anti-enumeration point 2. The partial unique index on (term_id, applicant_email) covers
  -- non-draft rows only, so it is THIS statement — the moment the row stops being a draft —
  -- that can collide with an existing live application from the same address.
  --
  -- The sub-block gives the UPDATE its own subtransaction, so catching the violation rolls
  -- back the UPDATE and nothing else: the row stays `draft`, keeps its payload, and is
  -- redacted by purge_abandoned_drafts() (0020) thirty days later. The caller gets the same
  -- void return it would get from a first-time submission, so the two are indistinguishable.
  --
  -- submit_token_hash is DELIBERATELY LEFT IN PLACE (see step 4). It is a digest, it is
  -- registered sensitive so it is masked out of every audit row, it expires on its own, and
  -- the only thing it can still do is re-trigger the idempotent no-op above. Clearing it
  -- would break retry-safety, which is a real failure mode on mobile data, in exchange for
  -- shortening the life of a value that already cannot be used for anything.
  --
  -- proof_verified_at records that the SERVER checked the provider's metadata, and
  -- submitted_at is the applicant-facing "submitted" moment (DATA_MODEL.md §3.2: "submitted"
  -- is prose for this flip; `pending` is the enum value).
  --
  -- This UPDATE fires trg_applications_audit, so the flip is attributable, with the four
  -- sensitive columns masked out by mask_sensitive() before the row is written.
  begin
    update public.applications
       set status            = 'pending',
           proof_drive_file_id = p_file_ref,
           proof_mime_type     = p_mime,
           proof_size_bytes    = p_size,
           proof_verified_at   = now(),
           submitted_at        = now()
     where id = p_app_id;
  exception
    when unique_violation then
      -- A live application already exists for this (term, email). Stay silent, stay draft.
      return;
  end;

  return;
end;
$$;

comment on function public.finalize_application(uuid, text, text, text, bigint) is
  'Token-gated draft -> pending flip for the public application form. Exists so that NO ANON '
  'UPDATE POLICY has to exist on public.applications. Silent on an unknown id, generic 42501 '
  'on a bad/expired/absent token or a closed window, idempotent on retry, and it SWALLOWS the '
  'duplicate-email unique violation so a repeat submission is indistinguishable from a first '
  'one. Returns void on purpose. BUILD_PLAN S3-T6; PRD US-B2, US-B3, US-B4.';

-- The public form's Server Action holds no session, so it calls as `anon`. Already
-- executable by PUBLIC (Postgres grants EXECUTE on a new function to PUBLIC), so this is a
-- statement of intent rather than a change of ACL — the same reasoning as the
-- current_term_id() grant in 0018. The function's own guards are what authorize the call;
-- the grant only says who may attempt it.
grant execute on function public.finalize_application(uuid, text, text, text, bigint) to anon;
