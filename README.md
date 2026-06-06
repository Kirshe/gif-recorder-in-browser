# GIF Recorder

A cross-browser (Chrome + Firefox) Manifest V3 extension that records the current tab as an animated GIF with optional region cropping.

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

Build output goes to `dist/chrome/` or `dist/firefox/`.

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
4. Select the `dist/chrome` folder

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `dist/firefox/manifest.json`

## Usage

1. Click the GIF Recorder icon in the toolbar to open the popup
2. (Optional) Check **Select region** to crop a specific area — draw a rectangle on the page
3. Click **Start Recording**
   - Chrome: recording happens via tab capture. The background runs the recording, so you can close the popup and keep using the page — reopen the popup any time to see the timer and stop.
   - Firefox: a small recording window opens. You'll be prompted to share your screen — select the current tab. The recording window handles capture, so it must stay open.
4. Click **Stop Recording** when done (Chrome: reopen the popup first if you closed it)
5. Wait for encoding to finish (progress bar shown). Encoding runs incrementally during recording, so this is usually quick.
6. **Download** the GIF or click **Copy**. Clipboards can't hold animated GIFs, so **Copy** places a PNG of the first frame (and downloads the GIF if the clipboard write is rejected).
7. Click **New Recording** to start over

Recording auto-stops after 30 seconds. State is kept in the background, so closing and reopening the popup (Chrome) restores the current recording, encoding progress, or finished result.

## Settings

These defaults are in `src/shared/constants.ts`:

| Setting | Default | Description |
|---------|---------|-------------|
| `DEFAULT_FPS` | 10 | Capture frame rate |
| `MAX_WIDTH` | 800 | Max output width in pixels (maintains aspect ratio) |
| `MAX_RECORDING_SECONDS` | 30 | Auto-stop limit |
| `MAX_COLORS` | 256 | GIF palette size |
| `WORKER_COUNT` | 4 | Parallel encoding workers |

## Architecture

```
Popup (UI) ←→ Service Worker (orchestration) ←→ Offscreen Doc (Chrome only)
                     ↓
              Content Script (region selector, injected on demand)
```

- **Chrome**: Service worker owns recording state, gets a `tabCapture` stream ID → offscreen document captures frames and encodes via Web Workers. The popup is stateless: it queries the service worker for the current state on open, so it can be closed and reopened freely.
- **Firefox**: A dedicated recording window calls `getDisplayMedia()` and handles capture + encoding (the window must stay open). Region selection runs in the page from the popup, then is handed to the window via session storage.
- **GIF encoding**: `gifenc` library running in a pool of Web Workers. Frames are quantized as they're captured (streaming), keeping memory bounded rather than buffering all raw frames until stop.
