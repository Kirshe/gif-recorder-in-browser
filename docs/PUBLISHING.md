# Publishing GIF Recorder

This guide covers building the store-ready packages and registering the extension
on the **Chrome Web Store** and **Firefox Add-ons (AMO)**.

## 1. Get the packages

You can build them locally or let CI do it.

### Option A — Local

```bash
npm ci
npm run build:chrome   # → dist/chrome/
npm run build:firefox  # → dist/firefox/

# Zip the contents (manifest.json must be at the zip root, not nested)
cd dist/chrome  && zip -r ../../gif-recorder-chrome.zip  . && cd ../..
cd dist/firefox && zip -r ../../gif-recorder-firefox.zip . && cd ../..
```

### Option B — GitHub Actions

The [`build-extensions`](../.github/workflows/build-extensions.yml) workflow builds
and packages both targets automatically:

- **On every push / PR to `master`** — builds, type-checks, and uploads the two
  ZIPs as workflow **artifacts** (download them from the run's summary page).
- **On a `v*` tag** — additionally attaches both ZIPs to the matching GitHub
  **Release**.

To cut a release:

```bash
# bump "version" in manifest.json first, then:
git tag v0.1.0
git push origin v0.1.0
```

The packaged ZIPs are named `gif-recorder-chrome-v<version>.zip` and
`gif-recorder-firefox-v<version>.zip`.

## 2. Pre-flight checklist

Do these once before your first submission:

- [ ] **Firefox add-on ID** — set the `FIREFOX_ADDON_ID` repository secret to an ID
      you own (e.g. `gif-recorder@yourdomain.com`). The CI build injects it into the
      Firefox manifest's `gecko.id`; local builds fall back to the
      `gif-recorder@example.com` placeholder. It's permanent once published.
      Set the secret with:

      ```bash
      gh secret set FIREFOX_ADDON_ID --body "gif-recorder@yourdomain.com"
      ```
- [ ] **Version bump** — both stores reject re-uploads of an existing version, so
      increment `version` in `manifest.json` for every release.
- [ ] **Privacy policy URL** — required by Chrome because the extension captures
      tab/screen content via `tabCapture` / `getDisplayMedia()`. State whether any
      data leaves the device (it doesn't — encoding is fully local).
- [ ] **Store assets** — a 128×128 icon (already in `icons/`) and at least one
      screenshot (Chrome: 1280×800 or 640×400).
- [ ] **Smoke test the builds** unpacked (see README "Load the Extension").

## 3. Chrome Web Store

1. Register a developer account at
   <https://chrome.google.com/webstore/devconsole> — a **one-time $5 USD** fee.
2. **Add new item** → upload `gif-recorder-chrome.zip`.
3. Complete the store listing: name, description, category, screenshots, and the
   128×128 icon.
4. **Privacy** tab — provide a single-purpose description, a justification for each
   requested permission, and the privacy policy URL:

   | Permission             | Justification |
   |------------------------|---------------|
   | `tabCapture`           | Capture the active tab's video to encode into a GIF. |
   | `offscreen`            | Run frame capture + encoding in a hidden offscreen document. |
   | `activeTab`            | Operate on the tab the user is recording. |
   | `scripting`            | Inject the region-selector overlay on demand. |
   | `storage`              | Persist recording settings and in-progress state. |
   | `http://*/*`, `https://*/*` (host) | Inject the region-selector overlay into the page being recorded; `activeTab` alone can't cover the background injection. |

5. Submit for review. Turnaround is usually a few hours to a few days.

## 4. Firefox Add-ons (AMO)

1. Create a free account at <https://addons.mozilla.org/developers/>.
2. *(Recommended)* Validate locally first:

   ```bash
   npx web-ext lint  --source-dir dist/firefox
   npx web-ext build --source-dir dist/firefox   # produces a clean store-ready zip
   ```

3. **Submit a New Add-on** → upload `gif-recorder-firefox.zip`.
4. **Source code submission is required.** Because the package is built with Vite,
   AMO reviewers need to reproduce it. Upload a source archive and provide build
   instructions:

   > Build with Node 20: `npm ci && npm run build:firefox`. The reviewable output
   > is `dist/firefox/`.

5. Choose **listed** (public on AMO) or **unlisted** (self-distributed but still
   signed). MV3 extensions must be signed by Mozilla to install in release Firefox.
6. Submit. Mozilla signs the add-on on approval.

## 5. After publishing

- Keep `manifest.json` `version` as the single source of truth — the CI workflow
  derives the package names and release assets from it.
- For each update: bump the version, push a `v*` tag, download the CI-built ZIPs
  from the Release, and upload them in each store's developer dashboard.
