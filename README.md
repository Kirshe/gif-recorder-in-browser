# GIF Recorder

A cross-browser (Chrome + Firefox) Manifest V3 browser extension that records a
screen, window, or tab as an animated GIF, with optional region cropping. Both
browsers use the same flow: a small **pop-out player** window that captures via
`getDisplayMedia()`, minimizes itself out of the recording, and shows the preview
when you stop.

## Install

```bash
npm install
```

## Build

```bash
# Chrome
npm run build:chrome

# Firefox
npm run build:firefox
```

Build output goes to `dist/chrome/` or `dist/firefox/`. Each target gets its own
manifest and bundle — **load the folder that matches your browser**.

To package and submit the extension to the Chrome Web Store and Firefox Add-ons,
see [docs/PUBLISHING.md](docs/PUBLISHING.md). The
[`build-extensions`](.github/workflows/build-extensions.yml) GitHub Action builds
and packages both targets automatically.

### Development (watch mode)

```bash
npm run dev:chrome
npm run dev:firefox
```

## Load the Extension

### Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **`dist/chrome`** folder

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select **`dist/firefox/manifest.json`**

> ⚠️ Make sure you pick the manifest inside **`dist/firefox/`** — not the source
> `manifest.json` or the Chrome build. Loading the wrong one is the most common
> reason the extension misbehaves.

Temporary add-ons are removed when Firefox restarts; just load it again.

## Usage

1. Click the GIF Recorder icon in the toolbar. The **pop-out player** window opens.
2. *(Optional)* Click **Select region** to crop a specific area — your page comes
   to the front and you draw a rectangle on it. The player shows the chosen size;
   click the status line to clear it and record the full surface instead.
3. Click **Start Recording**, then choose the screen, window, or tab to share when
   the browser prompts you.
4. The player **minimizes itself** so it stays out of the recording. Stop any time
   with:
   - the **`Alt+Shift+G`** keyboard shortcut, or
   - the browser's native **Stop sharing** control.

   (You can also restore the player window and click **Stop Recording**.)
5. The player reappears and shows the encoding progress, then the **preview**.
   Encoding runs incrementally during recording, so this is usually quick.
6. **Download** the GIF, or click **Copy**. Clipboards can't hold animated GIFs,
   so **Copy** places a PNG of the first frame (and downloads the GIF if the
   clipboard write is rejected).
7. Click **New Recording** to start over.

Recording auto-stops after 30 seconds. The keyboard shortcut can be changed at
`chrome://extensions/shortcuts` (Chrome) or via **Manage Extension Shortcuts** in
`about:addons` (Firefox).

## Settings

These defaults are in `src/shared/constants.ts`:

| Setting | Default | Description |
|---|---|---|
| `DEFAULT_FPS` | 10 | Capture frame rate |
| `MAX_WIDTH` | 800 | Max output width in pixels (aspect ratio preserved) |
| `MAX_RECORDING_SECONDS` | 30 | Auto-stop limit |
| `MAX_COLORS` | 256 | GIF palette size |
| `WORKER_COUNT` | 4 | Parallel encoding workers |

## Architecture

```
Toolbar icon → Service Worker → Pop-out Player window (capture + encode + UI)
                     ↓
              Content Script (region selector, injected on demand)
```

One flow for both browsers:

- **Pop-out player** (`src/recording/`): the only UI. It calls `getDisplayMedia()`
  from the user's click, grabs frames, and encodes the GIF. It holds the entire
  recording, so there's no separate popup and no background state to rehydrate.
- **Service worker** (`src/background/`): narrow glue. It opens/focuses the player
  on the toolbar `action.onClicked`, relays the **stop-recording** keyboard
  command to the player, injects the region overlay into the page you launched
  from, and toggles the **REC** badge while minimizing/restoring the player around
  the capture.
- **Region selection** (`src/content/region-selector.ts`): injected on demand into
  your active page; the drawn rectangle is relayed back to the player, which crops
  each captured frame to it.
- **GIF encoding** (`src/encoding/`): the `gifenc` library running in a pool of Web
  Workers. Frames are quantized as they're captured (streaming), keeping memory
  bounded instead of buffering every raw frame until you stop. A worker-driven
  clock keeps the frame rate steady even while the player is minimized.

## Development

```bash
npx tsc --noEmit       # type-check
npm run build:chrome   # build the Chrome target first
npx playwright test    # Playwright tests (run against dist/chrome)
```
