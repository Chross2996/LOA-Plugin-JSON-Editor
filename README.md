# JSON Airspace Configurator

Open `index.html` in a browser (or serve it with a tiny local server — see below).

## Connecting to GitHub

This configurator reads and writes directly to the private repo
**Chross2996/LOA-Plugin-Files** (branch `main`) using the GitHub REST API.
Each region's three files live in their own ICAO-coded folder, e.g.:

```
EDWW/LOA.json
EDWW/sector_ownership.json
EDWW/volumes.json
EDMM/LOA.json
EDMM/sector_ownership.json
EDMM/volumes.json
```

To use it:

1. Create a **fine-grained Personal Access Token** at
   https://github.com/settings/personal-access-tokens/new
   - Resource owner: `Chross2996`
   - Repository access: only `LOA-Plugin-Files`
   - Permissions: **Contents → Read and write**
2. Paste the token into the **GitHub token** field at the top of the page.
3. Pick the region (e.g. `EDWW` or `EDMM`) from the dropdown.
4. Click **Connect & load**. This pulls the three JSON files straight from
   the repo.
5. Edit as usual in the LOA / Ownership / Volumes / Raw JSON tabs.
6. When you're ready to save, use the commit bar above the tabs:
   - **Commit `<file>.json`** pushes just that file.
   - **Commit all changed files** pushes everything that's been edited.

Each commit goes straight to `main` in the repo with a message noting which
file and region changed. There's no draft/PR step — committed changes are
live immediately, so double check the **Validate** tab before committing.

**Your token only lives in the browser tab's memory.** It's never saved to
disk, never sent anywhere except `api.github.com`, and disappears when you
close or refresh the page (or click **Forget token**). Each person using
this configurator needs their own token.

If two people edit the same file at the same time, GitHub will reject the
second commit (a 409 conflict) rather than silently overwrite the first —
reconnect to pull the latest version before retrying.

## Working offline / without GitHub

You can still load JSON files from your own computer using the file inputs
below the GitHub panel. Files loaded this way use the **Download all
(local)** button to save edits back to disk instead of committing to
GitHub — they're tracked separately from the GitHub-loaded copy.

Features:
- Structured LOA rule editor by sector and destination/departure rules
- Ownership and priority list editor
- Volume editor with polygon preview
- Raw JSON editor for each file
- Validation for common issues
- Commit straight to GitHub, or export/download JSON files locally

If your browser blocks local `fetch()` from files, run a tiny local server
from this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
