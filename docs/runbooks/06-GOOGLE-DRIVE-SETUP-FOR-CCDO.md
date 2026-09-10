# Connecting START-SYS to Google Drive

**Who this is for:** the CCDO, or whoever holds the START-DOST Google account.
**How long:** about 15 minutes.
**What you need:** the START-DOST Google account — the same one the system sends email from.
**What you'll end up with:** three values to send the CTO.

> **Rewritten 2026-09-10 after an outage.** The previous version of this page produced a
> credential the code cannot use and a folder the code cannot see, and applications were
> unsubmittable for eleven hours as a result. Two things changed, and both matter:
>
> 1. **You create a *Web application* client, not a Desktop one.** Google removed the flow
>    desktop clients used for this.
> 2. **You do NOT create the Drive folder yourself.** The app creates it. A folder made by
>    hand in the Drive website is invisible to the app — it can only see files it made —
>    and every call returns `404 File not found`. The folder still shows up in your Drive
>    normally and you can open, rename and move it.
>
> Full reasoning: `docs/decisions/0018-drive-oauth-user-credential.md`.

> **Before you start:** make sure you are signed into Google as the **START-DOST account**,
> not your personal one. Everything below attaches to whichever account you're signed in as,
> and it is very hard to move afterwards. If you're not sure, sign out of everything and
> sign back in with just the org account.

---

## Part 1 — Open the project (1 minute)

1. Go to **console.cloud.google.com**
2. At the very top, click the **project dropdown** and pick **START-SYS**

If START-SYS isn't there, it was created on a different account. Stop and check before
making a second one.

---

## Part 2 — Turn on Google Drive access (2 minutes)

1. In the search bar at the top, type **Google Drive API**
2. Click the result named **Google Drive API**
3. Click the blue **ENABLE** button

If it already says **MANAGE** or "API enabled", it's on. Move on.

---

## Part 3 — The permission screen (5 minutes)

Search for **OAuth consent screen**. Google is part-way through a redesign, so you'll land
on one of two things: an older single page, or **Google Auth Platform** with **Branding**,
**Audience** and **Data Access** in the left sidebar. Three things to get right either way.

**3a — User type must be External.**
(New UI: *Audience*. Old UI: the External/Internal radio.) External sounds wrong but is
correct — "Internal" only exists for paid Google Workspace accounts, and ours is a regular
Gmail account.

**3b — Publishing status must be "In production".** ⚠️ **This is the one that bites.**
(New UI: *Audience*. Old UI: top of the consent screen page.) If it says **Testing**, click
**PUBLISH APP → CONFIRM**.

> On "Testing", Google throws the connection away after **7 days**. There is no error and
> no email — uploads simply start failing again. If you ever see a button that says
> **"Back to testing"**, that means you are correctly published. Do not press it.

**3c — The scope must be `drive.file`, and nothing else.**
(New UI: *Data Access → ADD OR REMOVE SCOPES*. Old UI: the Scopes section.) Filter for
`drive.file` and tick the row ending `.../auth/drive.file`. Then **UPDATE → SAVE**.

The description reads roughly *"See, edit, create and delete only the specific Google Drive
files you use with this app"* — which is exactly right. It means START-SYS can only ever
touch files it created, and can never see the rest of your Drive.

> ⚠️ Do **not** tick `drive` or `drive.readonly`. Both hand over your entire Drive, and
> both force a Google review that takes days.

**If you see a banner saying the app "requires verification" — ignore it.** With only
`drive.file` there is nothing to submit, and it blocks nothing. Do not go to the
Verification Center.

---

## Part 4 — Create the credential (3 minutes)

1. Search for **Credentials** (new UI: **Clients** in the left sidebar)
2. **+ CREATE CREDENTIALS → OAuth client ID** (new UI: **+ CREATE CLIENT**)
3. **Application type: Web application** ← not Desktop
4. **Name:** `START-SYS Drive`
5. Scroll to **Authorised redirect URIs** → **+ ADD URI** → paste exactly:

   ```
   https://developers.google.com/oauthplayground
   ```

   No trailing slash. A slash gives you `redirect_uri_mismatch` in the next part.

6. Leave **Authorised JavaScript origins** empty
7. Click **CREATE**

A box appears with **Client ID** and **Client secret**. Copy both now — the secret is only
shown once. If you lose it, reopen the client and add a new secret.

- **Value 1 — Client ID** (long, ends `.apps.googleusercontent.com`)
- **Value 2 — Client secret** (starts `GOCSPX-`)

---

## Part 5 — Get the long-lived key (4 minutes)

1. Go to **developers.google.com/oauthplayground**
2. Click the **gear icon** at the top right. Set:
   - ✅ **Use your own OAuth credentials** — then paste the Client ID and secret from Part 4
   - **Access type: Offline** ← without this you get no long-lived key at all
   - ✅ **Force prompt: Consent screen**
3. In the left panel, scroll to the bottom box labelled **"Input your own scopes"** and paste:

   ```
   https://www.googleapis.com/auth/drive.file
   ```

4. Click **Authorize APIs**, and sign in as the **START-DOST account**
5. Approve the permission screen
6. Back on the Playground, click **Exchange authorization code for tokens**
7. Copy the **Refresh token** — it starts `1//`

- **Value 3 — Refresh token**

**Check before you move on:** in the Request/Response panel on the right, the `client_id=`
must be **your** Client ID from Part 4. If it says `407408718192`, the gear setting in step
2 didn't take — set it again and redo from step 4.

**If the Refresh token box comes back empty:** this account has already approved the app
once, and Google only issues the long-lived key on a fresh approval. Go to
**myaccount.google.com → Security → Your connections to third-party apps**, remove
**START-SYS**, then redo from step 4.

**Leave "Auto-refresh the token before it expires" unticked.** It only affects the
Playground's own browser tab.

---

## Part 6 — Send the CTO three values

1. **Client ID**
2. **Client secret**
3. **Refresh token**

Send these **privately** — a direct message, not a group chat, not Messenger, not a public
channel. The secret and the refresh token together are full access to the folder the app
creates. Treat them the way you'd treat the account password.

**Do not send a folder ID, and do not create a folder.** The app makes its own the first
time it runs, and tells the CTO the id. It will appear in your Drive as
**START-SYS Member Documents**.

---

## What happens next

The CTO puts the three values into the system's settings. From then on, every scholar's
registration form and Notice of Award lands in that folder automatically. You can open it
like any other Drive folder.

Nobody outside START-SYS can reach those documents: they are never shared, never given a
public link, and inside the system they can only be opened by a reviewer who is signed in —
and every single view is written to the audit log.

---

## If something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| `redirect_uri_mismatch` | The URI in Part 4 has a typo or a trailing slash | Fix it, wait two minutes, retry |
| `client_id=407408718192` in the Playground | The gear setting didn't take | Part 5 step 2, then redo from step 4 |
| Refresh token box empty | This account already approved the app once | Revoke at myaccount.google.com, then redo Part 5 |
| `unauthorized_client` | You changed the credentials but reused the old code | Redo **Authorize APIs**, then Exchange straight away — codes expire in about 60 seconds |
| Only Client ID shows, no secret | The box was closed | Reopen the client → **ADD SECRET** |
| Uploads worked, then stopped about a week later | Publishing status went back to "Testing" | Part 3b. Then redo Part 5 — the old key is dead |
| "Your app requires verification" banner | Normal for `drive.file` | Ignore it. Do not submit for review |
