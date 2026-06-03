import type { Message } from "../shared/messages.js";
import type { Region, RecordingState } from "../shared/types.js";

declare const __BROWSER__: "chrome" | "firefox";
const isFirefox = __BROWSER__ === "firefox";

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
let selectedRegion: Region | undefined;
let gifDataUrl = "";

// Firefox capture imports (lazy)
let firefoxCapture: typeof import("../capture/capture-firefox.js") | null = null;

function showView(newState: RecordingState) {
  state = newState;
  viewIdle.classList.toggle("hidden", state !== "idle");
  viewRecording.classList.toggle("hidden", state !== "recording");
  viewEncoding.classList.toggle("hidden", state !== "encoding");
  viewPreview.classList.toggle("hidden", state !== "preview");
  errorBar.classList.add("hidden");
}

function showError(msg: string) {
  errorBar.textContent = msg;
  errorBar.classList.remove("hidden");
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function startTimer() {
  recordingStartTime = Date.now();
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

// Button handlers
btnStart.addEventListener("click", async () => {
  if (useRegion.checked) {
    // Ask background to inject region selector
    chrome.runtime.sendMessage({ type: "SHOW_REGION_SELECTOR" } satisfies Message);
    showView("selecting-region");
    // Wait for REGION_SELECTED message, then start
    return;
  }
  await startRecording();
});

btnStop.addEventListener("click", async () => {
  await stopRecording();
});

btnDownload.addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = gifDataUrl;
  a.download = `recording-${Date.now()}.gif`;
  a.click();
});

btnCopy.addEventListener("click", async () => {
  try {
    const resp = await fetch(gifDataUrl);
    const blob = await resp.blob();
    // Clipboard API doesn't support GIF, so we try PNG fallback
    // Most browsers will reject image/gif in clipboard
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
    } catch {
      // Fallback: download instead
      const a = document.createElement("a");
      a.href = gifDataUrl;
      a.download = `recording-${Date.now()}.gif`;
      a.click();
      showError("Clipboard doesn't support GIF — file downloaded instead");
    }
  } catch (err) {
    showError("Copy failed");
  }
});

btnNew.addEventListener("click", () => {
  gifDataUrl = "";
  gifPreview.src = "";
  selectedRegion = undefined;
  useRegion.checked = false;
  showView("idle");
});

// Recording control
async function startRecording(region?: Region) {
  showView("recording");
  startTimer();

  if (isFirefox) {
    // Firefox: capture from popup
    if (!firefoxCapture) {
      firefoxCapture = await import("../capture/capture-firefox.js");
    }
    await firefoxCapture.startFirefoxCapture(
      region,
      onEncodingProgress,
      onGifReady,
      onError
    );
  } else {
    // Chrome: tell background to start
    chrome.runtime.sendMessage({
      type: "START_RECORDING",
      region,
    } satisfies Message);
  }
}

async function stopRecording() {
  stopTimer();
  showView("encoding");

  if (isFirefox) {
    if (firefoxCapture) {
      await firefoxCapture.stopFirefoxCapture(
        onEncodingProgress,
        onGifReady,
        onError
      );
    }
    // Also tell background to clear badge
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" } satisfies Message);
  } else {
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" } satisfies Message);
  }
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
  showView("preview");
}

function onError(msg: string) {
  showError(msg);
  stopTimer();
  showView("idle");
}

// Listen for messages from background (Chrome flow)
chrome.runtime.onMessage.addListener((message: Message) => {
  switch (message.type) {
    case "RECORDING_STARTED":
      // Already showing recording view
      break;

    case "ENCODING_PROGRESS":
      onEncodingProgress(message.progress);
      break;

    case "GIF_READY":
      onGifReady(message.dataUrl, message.size);
      break;

    case "ERROR":
      onError(message.message);
      break;

    case "REGION_SELECTED":
      selectedRegion = message.region;
      startRecording(selectedRegion);
      break;

    case "REGION_CANCELLED":
      showView("idle");
      break;
  }
});
