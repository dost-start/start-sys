# ADR 0005 — One document-store interface, and the price of the Supabase Storage fallback

**Date:** 2026-09-03
**Author:** START-SYS build, S3 document-boundary lane (BUILD_PLAN S3-T9 … S3-T12)
**Status:** Accepted
**Affects:** `lib/documents/**`, `app/api/fake-upload/[ref]/route.ts`, `supabase/migrations/0021_proof_storage_bucket.sql`, `.env.example` (`DOCUMENT_STORE`), `docs/RUNBOOK.md`, and — if the fallback is ever taken — `.github/workflows/scheduled.yml`

---

## Context

The PRD Addendum and MVP item 6 require proof of enrollment to be "stored via Google Drive
integration, with the file link stored against the applicant's record." ARCHITECTURE.md §4.1
specifies the mechanism: the browser PUTs directly to a server-minted resumable session URI,
because Vercel caps a function request body at 4.5MB and a phone photo of a Certificate of
Registration routinely exceeds it.

**But OQ-1 is unanswered.** We do not know whether START-DOST has a Google Workspace tenant
that supports Shared Drives, and Workspace for Nonprofits' base tier does not include them.
BUILD_PLAN S3 therefore hard-timeboxes the Drive integration to 12:00 on Day 3 with a
pre-agreed fallback — which is only genuinely cheap if taking it costs no code and no
migration. A fallback that needs a build is a fallback nobody takes at 12:00 on the day it
is needed; they keep debugging instead, and lose the afternoon.

Two further constraints shaped this:

- Whatever ships must be testable without credentials. CI cannot hold a Google service-account
  key, and a Playwright run needs a browser that can really PUT bytes somewhere.
- `applications.proof_drive_file_id` already exists (migration 0008) and is documented there
  as **provider-opaque**. Nothing outside `lib/documents/` may interpret it.

## Decision

**One interface, `DocumentStore` (`lib/documents/types.ts`), with three implementations behind
one selector.** No signature in the interface contains provider vocabulary — no `fileId`, no
`bucket`, no `webViewLink` parameter. Callers hold a `storageRef`, an opaque string.

| Driver | `DOCUMENT_STORE` | Role |
|---|---|---|
| `drive-store.ts` | `drive` | Primary. Google Drive v3, `drive.file` scope only. **The only file in the repository that may import `googleapis`.** |
| `supabase-storage-store.ts` | `supabase_storage` | The fallback. Private bucket `proof-of-enrollment`, migration 0021. |
| `fake-store.ts` | `fake` | Unit contract suite and CI e2e. Filesystem-backed so Next's server process and the Playwright process see the same bytes. |

Three supporting decisions:

1. **The bucket migration ships on Day 3 whether or not it is used.** An empty private bucket
   costs nothing and removes the last migration from the swap path. Taking the fallback is then
   one environment variable in the Vercel Production scope plus a redeploy.
2. **The Drive driver pre-allocates its file id with `files.generateIds`.** A resumable session
   does not return an id until the bytes finish moving, which would mean the server learning
   the ref *from the client*. Pre-allocating keeps `storageRef` known before a byte moves, so
   no client claim is ever load-bearing, and a retried upload is idempotent.
3. **One shared contract suite runs against every available driver** (`contract.test.ts`). The
   fallback's whole value rests on the claim that the drivers behave identically, and a claim
   nothing checks is false within a fortnight. The fake driver enforces the same allowlist and
   performs the same magic-byte sniff as the real ones — a permissive fake makes a green suite
   mean nothing.

### `getDocumentStore()` stays synchronous

This was drafted async, loading the selected driver with a dynamic `import()` to keep
`googleapis` out of the cold start of every function that touches this module — `/apply` never
reads a document and would still have paid to parse it. That was reverted: the S3 intake lane
had already written `getDocumentStore().createUploadSession(...)` against the synchronous
contract, and a cheaper cold start is not worth a shape the rest of the slice has to bend
around. If the parse cost shows up in the S7 benchmark, the fix is a lazy driver behind the
same synchronous signature — not a change to the signature.

Two consequences of the resulting static imports, both acceptable and both worth knowing:

- `lib/documents/index.ts` reaches `lib/server/admin-client.ts` through the Storage driver,
  which imports `server-only`. **Importing the module from a Client Component is therefore a
  build error** — the correct direction, since every legitimate caller is a Server Action, a
  Route Handler or a job.
- For the same reason it cannot be imported from a Vitest suite. `contract.test.ts` imports the
  drivers directly, which is also what lets it parameterise over them.

## Consequences

### The price of taking the fallback, as five numbered costs (BUILD_PLAN S3-T12)

1. **Zero code changes.** Nothing in `lib/applications/`, `app/(public)/apply/`, S4's proof
   proxy, or the schema moves. `proof_drive_file_id` holds an object path instead of a Drive
   file id, and nothing outside `lib/documents/` interprets it either way.

2. **It forces the Supabase Pro upgrade earlier.** Free gives 1 GB of storage. At roughly 600
   applicants and ~2 MB per Certificate of Registration, one application period is ~1.2 GB —
   over the limit before the period closes. Pro is already a launch requirement for backups and
   the 7-day auto-pause (BUILD_PLAN S7-T15); this makes it a requirement for *intake* too, and
   it lands during application week rather than before it.

3. **⚠️ Storage objects are NOT included in `supabase db dump`, so the nightly backup job must
   gain an object-sync step or the proof documents fall outside the entire Backup & Recovery
   NFR.** This is the cost most likely to be missed, because everything keeps working: the
   database backs up nightly, the restore drill passes, and the documents are silently
   uncovered the whole time. Under Drive the files live in a separate provider with its own
   durability; under Storage they live in the same Supabase project the backup exists to
   survive the loss of. **If the fallback is taken, adding the object sync to
   `.github/workflows/scheduled.yml` is a blocker, not a follow-up.**

4. **The PRD Addendum names Google Drive explicitly**, so v1.0 item 6 would be met in shape but
   not in vendor. The submission must say so plainly rather than letting "stored via Google
   Drive integration" stand. The privacy notice and the RA 10173 processing register must also
   name the processor that actually holds the data — `pingDocumentStore()` reports the active
   driver for exactly this reason. **A notice that names Google Drive while the files are in
   Supabase Storage misstates where personal data lives, which is worse than no notice.**

5. **Swapping back is a one-time copy job, not a schema change — but it must run before the
   bucket is torn down.** Copy every object to Drive, rewrite each `proof_drive_file_id` in one
   audited transaction, flip `DOCUMENT_STORE`, verify, and only then delete the bucket.
   Deleting first strands every document, and there is no DELETE path anywhere in this schema
   to un-strand them.

### Costs of the interface itself

- A third place to keep the MIME allowlist and the 10MB cap in step: `lib/documents/types.ts`,
  `finalize_application()` (migration 0019), and `storage.buckets` (migration 0021). Deliberate
  — each is the last gate on its own side of a trust boundary — but it is three files to change
  together, and the contract suite does not catch a drift in the SQL half.
- The fake store writes to a temp directory. It is unreachable unless `DOCUMENT_STORE=fake`,
  and the PUT route 404s otherwise, but it is a filesystem write in a repository that otherwise
  has none.
- `storage.objects` gains an INSERT policy for `anon`, which permits storage-quota abuse by any
  holder of the (public) anon key. Bounded by the bucket's size and MIME limits, by there being
  no read path without a reviewer role, and by orphan reconciliation in the abandoned-draft
  sweep. Flagged in migration 0021 for the S7 security review; if signed uploads prove not to
  need the grant, dropping it strictly narrows the surface.

### What this decision does not touch

Authorization is unchanged. A document is read through `GET /api/applications/[id]/proof`,
which does an ordinary RLS-checked SELECT with the caller's own JWT first and writes an audit
row before streaming. `getProofStream()` is a byte pipe that performs no authorization and no
audit write, and says so in its own doc comment. No driver ever creates a sharing permission on
a file, under any provider — PRD US-J2 and CBL Art. VIII §6.
