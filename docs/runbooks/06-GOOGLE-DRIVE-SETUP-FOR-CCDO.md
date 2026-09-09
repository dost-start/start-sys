# Setting up the Google Drive connection — step by step

**Who this is for:** Danielle (CCDO). No technical background needed.
**How long:** about 20 minutes.
**What you need:** the START-DOST Gmail account — the same one the system sends email from.
**What you'll end up with:** three values to send Ethan.

At the end, START-SYS will be able to place approved members' documents into a Google
Drive folder that you own and can open normally.

> **Before you start:** make sure you are signed into Google as the **START-DOST account**,
> not your personal one. Everything below attaches to whichever account you're signed in
> as, and it is very hard to move afterwards. If you're not sure, sign out of everything
> and sign back in with just the org account.

---

## Part 1 — Make the folder (2 minutes)

1. Go to **drive.google.com**
2. Click **+ New** → **New folder**
3. Name it **START-SYS Member Documents**
4. Open the folder by double-clicking it
5. Look at the web address bar at the top of your browser. It looks like:

   ```
   https://drive.google.com/drive/folders/1a2B3cD4eFgHiJkLmNoPqRsTuVwXyZ
   ```

6. **Copy the part after `folders/`** — in the example that's `1a2B3cD4eFgHiJkLmNoPqRsTuVwXyZ`

   Paste it somewhere safe. This is **Value 1 — Folder ID**.

Leave the folder empty. The system fills it.

---

## Part 2 — Create the project (3 minutes)

1. Go to **console.cloud.google.com**
2. If it asks you to agree to terms, agree
3. At the very top of the page, next to "Google Cloud", click the **project dropdown**
   (it may say "Select a project")
4. Click **NEW PROJECT** in the top right of the popup
5. Project name: **START-SYS**
6. Leave everything else as it is. Click **CREATE**
7. Wait about 20 seconds. A notification appears when it's done — click **SELECT PROJECT**

You should now see "START-SYS" at the top of the page. If you don't, click the project
dropdown again and pick it. **Nothing below works unless START-SYS is the selected project.**

---

## Part 3 — Turn on Google Drive access (2 minutes)

1. In the search bar at the very top, type **Google Drive API**
2. Click the result named **Google Drive API** (under "Marketplace")
3. Click the blue **ENABLE** button
4. Wait for it to finish

---

## Part 4 — Set up the permission screen (6 minutes)

This is the screen that appears once, later, asking permission for START-SYS to use Drive.

1. In the search bar at the top, type **OAuth consent screen** and click that result
2. Choose **External**, then click **CREATE**

   *(External sounds wrong but is correct — "Internal" only exists for paid Google
   Workspace accounts, and ours is a regular Gmail account.)*

3. Fill in the form:
   - **App name:** `START-SYS`
   - **User support email:** pick the START-DOST address from the dropdown
   - Skip the logo and all the optional boxes
   - **Developer contact information:** type the START-DOST email address again
4. Click **SAVE AND CONTINUE**
5. On the **Scopes** page, click **ADD OR REMOVE SCOPES**
6. In the filter box, type: `drive.file`
7. Tick the checkbox on the row that ends in **`.../auth/drive.file`**

   The description reads roughly *"See, edit, create and delete only the specific Google
   Drive files you use with this app."* That is exactly what we want — it means START-SYS
   can only touch files it created itself, and can never see the rest of your Drive.

   > ⚠️ Do **not** tick any other Drive row. The ones called `drive` or `drive.readonly`
   > give access to your whole Drive and we specifically don't want that.

8. Click **UPDATE**, then **SAVE AND CONTINUE**
9. On the **Test users** page, just click **SAVE AND CONTINUE**
10. Click **BACK TO DASHBOARD**

---

## Part 5 — Publish it ⚠️ (1 minute — do not skip)

**This is the most important step on the page.** If it's skipped, the connection silently
stops working after 7 days and nobody gets an error message.

1. You should be on the **OAuth consent screen** page
2. Find **Publishing status**. It currently says **Testing**
3. Click **PUBLISH APP**
4. A confirmation box appears — click **CONFIRM**
5. Check that Publishing status now says **In production**

If it asks anything about "verification" or "submit for verification" — **ignore it and
close it.** We don't need verification, because the permission we asked for in Part 4 is
a limited one. The app works published-but-unverified.

---

## Part 6 — Create the keys (4 minutes)

1. In the search bar at the top, type **Credentials** and click that result
2. Click **+ CREATE CREDENTIALS** at the top → choose **OAuth client ID**
3. **Application type:** choose **Desktop app**
4. **Name:** `START-SYS Setup`
5. Click **CREATE**
6. A box pops up showing **Client ID** and **Client secret**

   Copy both.
   - **Value 2 — Client ID** (long, ends in `.apps.googleusercontent.com`)
   - **Value 3 — Client secret** (shorter, usually starts `GOCSPX-`)

   You can also click **DOWNLOAD JSON** to save them. If you lose them, come back to this
   Credentials page and click the client name — the Client ID is always visible and you
   can generate a new secret.

---

## Part 7 — Send Ethan the three values

Send these **privately** — a direct message to Ethan, not a group chat, not a Messenger
group, not a public channel:

1. **Folder ID** (from Part 1)
2. **Client ID** (from Part 6)
3. **Client secret** (from Part 6)

The Client secret is a password. Anyone who has it plus the Client ID can ask for access
to that Drive folder. Treat it the way you'd treat the account password.

---

## What happens next

Ethan runs a one-time step that opens a Google permission page. You may need to be signed
in as the START-DOST account for that, or hand him access — coordinate with him.

On that page you'll see **"Google hasn't verified this app."** This is expected. Click
**Advanced**, then **Go to START-SYS (unsafe)**. It is safe — it's the app you just
created, and it can only touch its own files.

After that it's done permanently. No weekly renewal, no re-doing this.

---

## If something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| "To view this page, select a project" | START-SYS isn't the selected project | Click the project dropdown at the top and pick START-SYS |
| Publishing status still says **Testing** | Part 5 didn't take | Redo Part 5. This one matters — it breaks after 7 days otherwise |
| Can't find `drive.file` in the scopes list | Drive API isn't enabled | Redo Part 3, then come back |
| Asked to "submit for verification" | Normal for our kind of app | Close it. Not needed |
| You accidentally used your personal account | Everything attached to the wrong account | Tell Ethan before going further — easier to redo than to move |
