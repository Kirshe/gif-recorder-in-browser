# GIF Recorder

A cross-browser (Chrome + Firefox) Manifest V3 browser extension that records the
current tab as an animated GIF, with optional region cropping.

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

1. Click the GIF Recorder icon in the toolbar to open the popup.
2. *(Optional)* Check **Select region** to crop a specific area — you'll draw a
   rectangle on the page.
3. Click **Start Recording**.
   - **Chrome:** recording starts immediately via tab capture. It runs in the
     background, so you can close the popup and keep using the page — reopen the
     popup any time to see the timer or stop.
   - **Firefox:** a small **recording window** opens. Click **Start Recording**
     in it, then choose the tab/window to share when Firefox prompts you. This
     window must stay open for the duration of the recording.
4. Click **Stop Recording** when done (Chrome: reopen the popup first if you
   closed it).
5. Wait for encoding to finish (progress bar). Encoding runs incrementally during
   recording, so this is usually quick.
6. **Download** the GIF, or click **Copy**. Clipboards can't hold animated GIFs,
   so **Copy** places a PNG of the first frame (and downloads the GIF if the
   clipboard write is rejected).
7. Click **New Recording** to start over.

Recording auto-stops after 30 seconds. On Chrome, state lives in the background,
so closing and reopening the popup restores the in-progress recording, encoding
progress, or finished result.

## Why Firefox shows an extra window

The two browsers expose tab capture differently, so the extension takes the best
path for each:

| | Chrome | Firefox |
|---|---|---|
| Capture API | `tabCapture` + offscreen document | `getDisplayMedia()` |
| Screen-share prompt | none | yes — you pick the tab |
| Where recording runs | hidden offscreen document | visible recording window |
| Can you close the popup? | yes, recording continues | the recording window must stay open |

Firefox doesn't support `tabCapture` for MV3 extensions, and its only capture API
(`getDisplayMedia()`) requires a user gesture and opens a share picker that steals
focus. A toolbar popup auto-closes when it loses focus, so Firefox needs a
dedicated window that survives the picker and stays alive to run the capture.

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
Popup (UI) ←→ Service Worker (orchestration) ←→ Offscreen Doc (Chrome)
                     ↓                       ↘   Recording Window (Firefox)
              Content Script (region selector, injected on demand)
```

- **Chrome:** the service worker owns recording state and gets a `tabCapture`
  stream ID, which a hidden **offscreen document** uses to capture frames and
  encode them in Web Workers. The popup is stateless — it asks the service worker
  for the current state on open, so it can be closed and reopened freely.
- **Firefox:** a dedicated **recording window** calls `getDisplayMedia()` and
  handles capture + encoding. Region selection runs in the page from the popup,
  then is handed to the window via session storage. The service worker opens the
  window (the popup can't reliably do so before it auto-closes).
- **GIF encoding:** the `gifenc` library running in a pool of Web Workers. Frames
  are quantized as they're captured (streaming), keeping memory bounded instead of
  buffering every raw frame until you stop.

## Development

```bash
npx tsc --noEmit       # type-check
npm run build:chrome   # build the Chrome target first
npx playwright test    # Playwright tests (run against dist/chrome)
```
