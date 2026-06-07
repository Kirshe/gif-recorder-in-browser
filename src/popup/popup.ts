import type { Message } from "../shared/messages.js";
import type { RecordingState, SessionSnapshot } from "../shared/types.js";

declare const __BROWSER__: "chrome" | "firefox";
const isFirefox = __BROWSER__ === "firefox";

// Firefox WebExtensions: the `browser` global with promise-based APIs.
declare const browser: typeof chrome & {
  windows: {
    create(options: {
      url: string;
      type?: string;
      width?: number;
      height?: number;
    }): Promise<unknown>;
  };
};

// Elements
const viewIdle = document.getElementById("view-idle")!;
const viewRecording = document.getElementById("view-recording")!;
const viewEncoding = document.getElementById("view-encoding")!;
const viewPreview = document.getElementById("view-preview")!;

const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnDownload = document.getElementById("btn-download") as HTMLButtonElement;
const btnCopy = document.getElementById("btn-copy") as HTMLButtonElement;
const btnNew = document.getElementById("btn-new") as HTMLButtonElement;
const useRegion = document.getElementById("use-region") as HTMLInputElement;

const timer = document.getElementById("timer")!;
const progressFill = document.getElementById("progress-fill")!;
const progressText = document.getElementById("progress-text")!;
const gifPreview = document.getElementById("gif-preview") as HTMLImageElement;
const gifSize = document.getElementById("gif-size")!;
const errorBar = document.getElementById("error-bar")!;

// State
let state: RecordingState = "idle";
let recordingStartTime = 0;
let timerInterval: number | null = null;
let gifDataUrl = "";
// Set once the user interacts, so the async initial GET_STATE can't clobber a
// state the user just changed.
let interacted = false;

function showView(newState: RecordingState) {
  state = newState;
  viewIdle.classList.toggle("hidden", state !== "idle");
  viewRecording.classList.toggle("hidden", state !== "recording");
  viewEncoding.classList.toggle("hidden", state !== "encoding");
  viewPreview.classList.toggle("hidden", state !== "preview");
}

function showError(msg: string) {
  errorBar.textContent = msg;
  errorBar.classList.remove("hidden");
}

function clearError() {
  errorBar.classList.add("hidden");
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function startTimer(from: number) {
  recordingStartTime = from;
  timer.textContent = formatTime(Date.now() - recordingStartTime);
  stopTimer();
  timerInterval = window.setInterval(() => {
    timer.textContent = formatTime(Date.now() - recordingStartTime);
  }, 200);
}

function stopTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sendMessage(message: Message): Promise<any> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

// --- Restore state on open ------------------------------------------------
// The background owns the recording state, so re-render from its snapshot.
async function init() {
  const snap = (await sendMessage({ type: "GET_STATE" })) as
    | SessionSnapshot
    | undefined;
  applySnapshot(snap);
}

function applySnapshot(snap: SessionSnapshot | undefined) {
  // The user already started/changed something while we were fetching state.
  if (interacted) return;
  if (!snap) {
    showView("idle");
    return;
  }
  if (snap.error) showError(snap.error);

  switch (snap.state) {
    case "recording":
      showView("recording");
      startTimer(snap.recordingStartTime ?? Date.now());
      break;
    case "encoding":
      showView("encoding");
      onEncodingProgress(snap.progress ?? 0);
      break;
    case "preview":
      if (snap.gifDataUrl) onGifReady(snap.gifDataUrl, snap.size ?? 0);
      else showView("idle");
      break;
    case "selecting-region":
      // A selection is in progress in the page; nothing useful to show here.
      showView("idle");
      break;
    default:
      showView("idle");
  }
}

// --- Button handlers ------------------------------------------------------
btnStart.addEventListener("click", async () => {
  interacted = true;
  clearError();

  if (useRegion.checked) {
    // Region selection happens on the page. Interacting with the page closes
    // this popup anyway, and the background drives the rest (Chrome: starts the
    // recording; Firefox: opens the recording window with the chosen region),
    // so close to let the user draw the rectangle — but only once the overlay
    // actually injected. On restricted pages (chrome://, the add-on store, the
    // new-tab page) injection is denied; keep the popup open and show why,
    // instead of silently closing and appearing to do nothing.
    const res = (await sendMessage({ type: "SHOW_REGION_SELECTOR" })) as
      | { error?: string }
      | undefined;
    if (res?.error) {
      showError(res.error);
      return;
    }
    window.close();
    return;
  }

  if (isFirefox) {
    // Open a dedicated window that survives the focus loss from
    // getDisplayMedia(); it performs the capture. The background opens it: this
    // popup auto-closes the instant it loses focus, which would otherwise cancel
    // a windows.create() call issued from here before the window appears.
    await sendMessage({ type: "OPEN_RECORDING_WINDOW" });
    window.close();
    return;
  }

  // Chrome, full tab: tell the background to start; render optimistically.
  showView("recording");
  startTimer(Date.now());
  await sendMessage({ type: "START_RECORDING" });
});

btnStop.addEventListener("click", async () => {
  interacted = true;
  stopTimer();
  showView("encoding");
  onEncodingProgress(0);
  await sendMessage({ type: "STOP_RECORDING" });
});

btnDownload.addEventListener("click", () => {
  downloadGif();
});

btnCopy.addEventListener("click", copyGif);

btnNew.addEventListener("click", async () => {
  interacted = true;
  gifDataUrl = "";
  gifPreview.src = "";
  useRegion.checked = false;
  clearError();
  await sendMessage({ type: "RESET" });
  showView("idle");
});

// --- Result helpers -------------------------------------------------------
function downloadGif() {
  const a = document.createElement("a");
  a.href = gifDataUrl;
  a.download = `recording-${Date.now()}.gif`;
  a.click();
}

// Clipboards can't hold animated GIFs, so copy a PNG of the first frame.
async function copyGif() {
  clearError();
  try {
    const pngBlob = await gifToPngBlob(gifDataUrl);
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": pngBlob }),
    ]);
    showError("Copied first frame as PNG (clipboards can't hold animated GIFs)");
  } catch {
    downloadGif();
    showError("Couldn't copy — file downloaded instead");
  }
}

function gifToPngBlob(dataUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("No 2D context"));
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("toBlob failed"));
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = dataUrl;
  });
}

function onEncodingProgress(progress: number) {
  if (state !== "encoding") showView("encoding");
  const pct = Math.round(progress * 100);
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${pct}%`;
}

function onGifReady(dataUrl: string, size: number) {
  gifDataUrl = dataUrl;
  gifPreview.src = dataUrl;
  gifSize.textContent = formatBytes(size);
  stopTimer();
  showView("preview");
}

// --- Live updates while the popup is open ---------------------------------
chrome.runtime.onMessage.addListener((message: Message) => {
  switch (message.type) {
    case "RECORDING_STARTED":
      if (message.recordingStartTime) startTimer(message.recordingStartTime);
      break;
    case "ENCODING_PROGRESS":
      onEncodingProgress(message.progress);
      break;
    case "GIF_READY":
      onGifReady(message.dataUrl, message.size);
      break;
    case "ERROR":
      stopTimer();
      showError(message.message);
      showView("idle");
      break;
    case "REGION_CANCELLED":
      showView("idle");
      break;
  }
});

void init();
