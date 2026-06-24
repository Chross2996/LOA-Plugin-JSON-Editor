# GitHub "Connect & Go" — OAuth Device Flow setup

This replaces the old paste-a-token step with a **Connect GitHub** button.
Each person clicks it, enters a short code on github.com, authorizes, and they're in.
No tokens to create, copy, or paste. GitHub decides who can read/write the repo
based on who they signed in as — so "anyone with repo access" just works.

You only have to do this setup **once**. After that, every user just clicks a button.

---

## Step 1 — Register a GitHub OAuth App (one time, ~2 minutes)

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
   (For an org-owned app instead, use
   `https://github.com/organizations/Chross2996/settings/applications`.)
2. Fill in:
   - **Application name:** `JSON Airspace Configurator` (anything you like)
   - **Homepage URL:** your Worker URL, e.g. `https://airspace-configurator.<you>.workers.dev`
     (you'll get the exact URL in Step 3 — you can edit this field afterwards)
   - **Authorization callback URL:** the same Worker URL is fine. Device Flow
     doesn't use the callback, but GitHub requires the field to be non-empty.
3. Click **Register application**.
4. On the next page, **check the box "Enable Device Flow"** and **Update application**.
   *(This is essential — without it the device flow returns an error.)*
5. Copy the **Client ID** shown at the top. (You do **not** need a client secret —
   device flow doesn't use one.)

---

## Step 2 — Put your Client ID into the project

Open `wrangler.toml` and replace the placeholder:

```toml
[vars]
GITHUB_CLIENT_ID = "Iv1.abc123yourclientid"
```

The Client ID is **not secret** — it's safe to commit and safe in the browser.

---

## Step 3 — Deploy to Cloudflare Workers

You need a free Cloudflare account and Node.js installed.

```bash
# from the airspace-oauth/ folder
npm install -g wrangler      # one time
wrangler login               # opens a browser to authorize Cloudflare (one time)
wrangler deploy
```

Wrangler prints your live URL, something like:

```
https://airspace-configurator.<your-subdomain>.workers.dev
```

Open that URL — that's your app, now with a **Connect GitHub** button.

If you registered the OAuth app before knowing this URL, go back to the OAuth
app settings and paste this URL into **Homepage URL** (callback can stay as-is).

---

## Step 4 — Use it

1. Open your Worker URL.
2. Click **Connect GitHub**.
3. A code appears (e.g. `WDJB-MJHT`). Click the github.com/login/device link,
   enter the code, click **Authorize**.
4. Back on the app it flips to "Signed in as @you".
5. Pick a region → **Load region** → edit → commit. Done.

Each teammate does the same with their own GitHub login. Anyone who has write
access to `Chross2996/LOA-Plugin-Files` can commit; anyone who doesn't will be
able to read but GitHub will refuse their commits (403) — which is exactly the
access control you want.

---

## How it works (so you can maintain it)

- **`worker/worker.js`** — a tiny Cloudflare Worker. It serves the static site
  *and* exposes two endpoints, `/api/device/code` and `/api/device/token`, that
  forward to GitHub. They exist only because GitHub's device endpoints don't send
  CORS headers, so the browser can't call them directly. No secrets live here.
- **`public/app.js`** — the `ghStartDeviceFlow` / `ghPollForToken` functions call
  those two endpoints, then store the returned user token **in memory only**
  (same as before — it's gone on refresh). Everything downstream (load, commit)
  was already token-based, so it kept working untouched.
- **No client secret anywhere.** That's the security advantage of device flow and
  why a single Worker variable is the entire configuration.

## Switching repos or adding regions

Still edited at the top of `public/app.js`:

```js
const GH_OWNER   = 'Chross2996';
const GH_REPO    = 'LOA-Plugin-Files';
const GH_BRANCH  = 'main';
const GH_REGIONS = ['EDWW', 'EDMM'];
```

Re-run `wrangler deploy` after any change to push it live.

## Local testing before deploy

```bash
wrangler dev
```

This runs the Worker + site locally (usually at http://localhost:8787) with the
real device-flow proxy, so you can test the whole login end-to-end on your machine.
