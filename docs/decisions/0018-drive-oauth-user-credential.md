# ADR 0018 — Drive authenticates as the org's Google account, not a service account

**Date:** 2026-09-10
**Author:** Ethan Baltazar (CTO), with Claude
**Status:** Accepted
**Supersedes the credential half of:** ADR 0005 (document-store fallback). The fallback
itself — `DOCUMENT_STORE=supabase_storage` — is untouched and still one env var away.
**Deviates from:** `.env.example` as written, which documented a
`GOOGLE_DRIVE_SHARED_DRIVE_ID` the organization cannot have.

---

## Context

On 2026-09-10 the document store was switched to Google Drive in Vercel Production. For
the next eleven hours **no application could be submitted**. Five real applicants tried
between 22:21 and 22:27 PHT and all five failed. Separately, every proof-of-enrollment
document already on file became unreadable, because the Drive driver was being asked to
fetch Supabase Storage paths.

The QA that afternoon found two independent causes. Both were fatal on their own, and the
second was hidden behind the first.

### Cause 1 — a service account owns no Drive storage

`lib/documents/drive-store.ts` authenticated with `google.auth.JWT`. The service account
could authenticate, could mint a resumable upload session, and could stream the bytes.
The **commit** was refused:

```
403 { "error": { "code": 403, "message":
  "Service Accounts do not have storage quota. Leverage shared drives ..." } }
```

Google's documented answer is a **Shared Drive**, which the drive itself owns rather than
a person. Shared Drives exist only on paid Google Workspace. START-DOST runs on a
consumer `@gmail.com`. **There was no configuration of the service-account path that
could have worked**, and it had never worked: every successfully stored document in the
system was a Supabase Storage path, never a Drive file id.

A second, quieter symptom of the same mismatch: `GOOGLE_DRIVE_PROOF_FOLDER_ID` pointed at
a folder created by hand in the Drive web UI. Under the `drive.file` scope an app can only
see files **it created**, so `files.get` on that folder returned `404 File not found` no
matter how it was shared — which is also why the health check could never tell a working
Drive from a broken one.

`docs/runbooks/06-GOOGLE-DRIVE-SETUP-FOR-CCDO.md` had in fact walked the CCDO through
creating an **OAuth Desktop client** (Part 6) — a completely different credential that
nothing in the codebase read. The setup work was real; it was done against a code path
that did not exist.

### Cause 2 — Google binds upload CORS to the initiating origin

Even with a credential that has quota, the browser could not complete the upload. Google
binds CORS on a resumable session to the origin named on the **initiation** request, not
on the PUT. Measured against the live API, same folder, same credential:

```
initiate WITHOUT Origin:  PUT 200  ACAO=(none)        ← browser discards the response
initiate WITH    Origin:  PUT 200  ACAO=<the origin>  ← browser accepts
```

The upload was **succeeding server-side and being thrown away by the browser**, which
reported it as a CORS failure. The applicant saw *"The upload did not complete. Check your
connection"* — for a server-side configuration error they could do nothing about.

This is worth dwelling on: an error response from that endpoint carries no
`Access-Control-Allow-Origin` either. So a genuine 403 and a missing Origin binding look
**identical** from the browser. Cause 1 masked cause 2 completely.

---

## Decision

**The app acts as the START-DOST Google account.** `driveConfig()` builds a
`google.auth.OAuth2` client from a refresh token minted once at setup. Files are owned by
that account and consume its quota, which exists (5.4 TB, 14 GB used at the time of
writing).

**The scope does not change.** Still `drive.file`, still least privilege, still no
`permissions.create`, still no `webViewLink` returned to a caller. Every rule in the
`drive-store.ts` header stands.

**The initiation request carries `Origin`.** Resolved per request in
`lib/documents/request-origin.ts` — not from an env var, because every Vercel preview has
its own hostname and a single `APP_BASE_URL` would be right in production and silently
wrong everywhere else. `browserOrigin` is a **required** field on
`CreateUploadSessionInput`: optional would let a future caller reintroduce cause 2 without
noticing.

**The folder is created through the API**, never by hand. Runbook 06 changes accordingly.

New environment variables, replacing `GOOGLE_SA_CLIENT_EMAIL` and `GOOGLE_SA_PRIVATE_KEY`:

| Variable | Notes |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Web application client; redirect URI is the OAuth Playground |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Bitwarden: "Google — START-SYS Drive — OAuth client" |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Does not expire **only because the consent screen is published** |
| `GOOGLE_DRIVE_PROOF_FOLDER_ID` | Must be an API-created folder |

---

## Consequences

### What this buys

Uploads work. Verified end to end against production on 2026-09-10: browser upload →
server-side metadata re-verification → reviewer read-back through the audited proxy, every
step a 200, file owned by `startdost.community@gmail.com`, named
`<applicationId>-<kind>.pdf` in the app-created folder.

The health check now catches this class of failure. `pingDrive()` checks folder
visibility, `canAddChildren`, **and storage quota** — a principal with no quota reports no
quota block at all, and that absence is the signal. The old probe would have passed a
service account right up to the moment it refused every upload.

### What it costs, and this does not go away

**The documents live in one Google account.** `ARCHITECTURE.md` §10 names personal-account
ownership as the likeliest cause of system death at handover, and this is exactly that
shape — mitigated only by the account being org-owned rather than a student's. Two
consequences to carry:

- `docs/runbooks/03-CREDENTIAL_ROTATION.md` gains the refresh token. Rotating it means
  redoing the consent, and a stale token fails **silently** — uploads simply stop.
- `docs/ANNUAL_HANDOVER.md` gains the account itself. If the next officers cannot sign in
  to `startdost.community@gmail.com`, every proof-of-enrollment document is unreachable
  and there is no recovery path in the app.

**The refresh token dies after 7 days if the consent screen is ever set back to
"Testing."** Silently, and it would look exactly like the 2026-09-10 outage. The
**Back to testing** button sits directly under the publishing status in the Google Auth
Platform console. Do not press it.

**A `drive.file` app still cannot see a folder it did not create.** If anyone ever pastes
a hand-made folder id into `GOOGLE_DRIVE_PROOF_FOLDER_ID`, this breaks again in exactly
the same way, and the health check will say `404` without saying why. That is why runbook
06 no longer tells anyone to make a folder in the Drive web UI.

### What was rejected

| Option | Why not |
|---|---|
| Google Workspace + a real Shared Drive | The correct long-term answer, and still open. It costs money, needs a domain, and Workspace for Nonprofits' base tier excludes Shared Drives. Nobody could apply while it was arranged. |
| Stay on `supabase_storage` | Works today and was the running configuration until this morning. Rejected by the project head: the PRD addendum names Drive, and CRRD wants a folder they can open. Still one env var away if this credential becomes a problem. |
| Keep the service account, share the folder with it | Does not help. The 403 is about quota, not access. A service account cannot own a file anywhere outside a Shared Drive. |
| Widen the scope to `drive` or `drive.readonly` | Would not have fixed the quota error, and both are sensitive scopes that trigger Google app verification and grant the whole Drive. Explicitly banned in the `drive-store.ts` header. |
