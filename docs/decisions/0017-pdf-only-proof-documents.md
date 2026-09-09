# ADR 0017 — Proof-of-enrollment documents are PDF only

## Context

Intake accepted four types for the two proof-of-enrollment documents (the Certificate of
Registration and the DOST-SEI Notice of Award): `application/pdf`, `image/jpeg`,
`image/png` and `image/heic`. `image/heic` was on the list deliberately — it is what an
iPhone produces by default, and a phone photo of a Certificate of Registration was assumed
to be the majority submission (PRD Addendum).

Two decisions on 2026-09-09 changed the picture, both from Ethan relaying the CCDO:

1. **The documents are PDFs.** *"It's not photo, it will be a PDF … most of the documents
   right now is online."* Schools issue the registration form and DOST-SEI issues the
   Notice of Award as PDFs.
2. **Rejection is final for the term.** A rejected applicant cannot resubmit. The
   `one_application_per_email_per_term` index already enforced this; the decision was to
   keep it rather than narrow it.

Taken together those create a trap that neither creates alone. **No browser renders HEIC.**
The review screen could not display one, so the designed response (BUILD_PLAN S4-T20) was
an explicit notice plus a *suggested rejection reason asking for a re-upload*. With
rejection final, there is nowhere for that re-upload to go: the applicant is rejected
permanently, for owning an iPhone, having submitted a genuine document.

There is also no rejection email in v1.0 or v1.1, so that applicant is never told.

## Decision

**Narrow intake to `application/pdf` alone**, enforced at four gates — because a gate that
trusts its caller is not a gate, and each of these is the last one on its own side of a
trust boundary:

| Gate | Where | Bypassable? |
|---|---|---|
| `accept` attribute + `validateProofFile` | `components/applications/proof-upload-field.tsx` | Yes — UX only |
| `DECLARED_ALLOWED_MIME` in the shared zod schema | `lib/applications/schema.ts`, re-run in the Server Action | Yes, if PostgREST is called directly |
| `ALLOWED_MIME` / `assertAcceptableUpload()` | `lib/documents/types.ts` | Yes, same |
| `finalize_application()`, `finalize_renewal()` | migration `0060` | **No** |
| `storage.buckets.allowed_mime_types` | migration `0021`, narrowed by `0060` | **No** |

**And keep the READ path wider than the intake path.** `SERVABLE_MIME` — a third constant
beside `ALLOWED_MIME` and `SNIFFABLE_MIME` — carries the historical four, and both proof
proxies (`/api/applications/[id]/proof`, `/api/renewals/[id]/proof`) guard the served
`Content-Type` on it.

This is the part most likely to be "tidied up" by a later reader, so the reasoning is
recorded plainly: **narrowing what we accept must never retroactively destroy what we
already hold.** Rows submitted before 2026-09-09 legitimately carry a JPEG, PNG or HEIC.
Those are real applicants' documents, and they are the sole evidence an approve/reject
decision rests on. Guarding the read path on `ALLOWED_MIME` turns every one of them into
an HTTP 500 — which, with rejection final, is the same failure class this ADR exists to
remove.

`SERVABLE_MIME` is **frozen and can only ever shrink.** Nothing can enter it: a new type
would have to pass `ALLOWED_MIME` first, and PDF is already there. Entries leave only when
no stored row can carry them — after the five-year purge (`DATA_MODEL.md` §8.2), not
before. It is written as a literal list, never derived from `SNIFFABLE_MIME`, so that
teaching the sniffer a new format cannot silently widen what the proxy hands a browser.

Nothing script-bearing may ever join it. `image/svg+xml` and `text/html` are excluded by
name — the constant is the source of a `Content-Type` on a route that streams
user-uploaded bytes, which is precisely a stored-XSS delivery mechanism.

### Rejected alternatives

- **Keep the four types and add HEIC conversion.** A runtime image dependency, a new
  failure mode and a conversion step, to serve a case the CCDO says will not arise.
- **Keep the four types and allow reapply after rejection.** Coherent, and it was on the
  table — but the decision on rejection was made independently and the CCDO wants finality.
- **Guard the read path on `ALLOWED_MIME` and accept that legacy rows 500.** Destroys
  access to already-submitted documents to save one constant.
- **Reuse `SNIFFABLE_MIME` for the read path.** Same members today, different question.
  The sniffer's list is an error-message aid and may grow; the proxy's is a response-header
  allowlist and must not follow it.
- **Grandfather by `submitted_at`.** Redundant: three independent gates already make a
  post-narrowing non-PDF unstorable, so the date could only ever confirm what is already
  guaranteed, at the cost of a clock dependency in an auth-adjacent path.

## Consequences

**Good.**
- The HEIC trap is removed at the source rather than documented.
- Every document renders in the browser's own sandboxed PDF viewer — one branch, no `<img>`
  fallback, no unviewable notice for anything submitted from now on.
- One accepted type is a smaller surface for the sniffer, the drivers and the reviewer UI.
- Documents already stored stay reviewable, and there is a test that fails if that breaks.

**Costs, accepted.**
- An applicant who only has a photo must convert it. Every phone can print-to-PDF, and the
  form says so, but it is one more step for someone on a phone on mobile data.
- Three constants now exist where one did, and the difference between them is not
  self-evident. Mitigated by `lib/documents/types.test.ts`, which asserts the relationships
  rather than the coincidence — including that `isAllowedMime("image/jpeg")` is `false`,
  the assertion that catches someone "fixing" this by reaching for the wrong constant at
  intake.
- The viewer's `IMAGE_MIMES` and `UNVIEWABLE_MIMES` branches are now legacy-only. They look
  like dead code and are not; both carry a comment saying when they may actually be deleted.

**⚠ A gap this ADR records but does not fix.** Rejection is final for the term, and **there
is no rejection email in v1.0 or v1.1.** A rejected applicant is therefore never told they
were rejected, never told why, and cannot reapply. PDF-only removes the most likely
*avoidable* cause of rejection, which narrows the blast radius — it does not close it. If
the CCDO's intent is "we reject people who do not qualify" rather than "we reject bad
submissions", a rejection email should ship before the application period opens. Written
here rather than left in a chat log.

## Date and author

2026-09-09 — Ethan Baltazar (project head), implemented by Claude Opus 5.
Supersedes the four-type allowlist established in migrations `0019` / `0021` / `0040` /
`0044` / `0045`. Related: ADR 0005 (document-store fallback), PRD US-B2, US-C1, US-J2.
