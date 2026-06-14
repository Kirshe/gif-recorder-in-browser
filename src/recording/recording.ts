import { startCapture, stopCapture, type CaptureCallbacks } from "../capture/capture.js";
import type { Message } from "../shared/messages.js";
import type { Region } from "../shared/types.js";

// Elements
const viewIdle = document.getElementById("view-idle")!;
const viewRecording = document.getElementById("view-recording")!;
const viewEncoding = document.getElementById("view-encoding")!;
const viewPreview = document.getElementById("view-preview")!;

const btnRegion = document.getElementById("btn-region") as HTMLButtonElement;
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnDownload = document.getElementById("btn-download") as HTMLButtonElement;
const btnCopy = document.getElementById("btn-copy") as HTMLButtonElement;
const btnNew = document.getElementById("btn-new") as HTMLButtonElement;

const regionStatus = document.getElementById("region-status")!;
const stopHint = document.getElementById("stop-hint");
const timer = document.getElementById("timer")!;
const progressFill = document.getElementById("progress-fill")!;
const progressText = document.getElementById("progress-text")!;
const gifPreview = document.getElementById("gif-preview") as HTMLImageElement;
const gifSize = document.getElementById("gif-size")!;
const errorBar = document.getElementById("error-bar")!;

type State = "idle" | "recording" | "encoding" | "preview";

let state: State = "idle";
let recordingStartTime = 0;
let timerInterval: number | null = null;
let gifDataUrl = "";
let selectedRegion: Region | undefined;

// Reflect the platform's modifier in the stop-shortcut hint.
if (stopHint && navigator.platform.toLowerCase().includes("mac")) {
  stopHint.textContent = "⌘⇧S";
}

function showView(newState: State) {
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

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Region ---------------------------------------------------------------
function renderRegion() {
  if (selectedRegion) {
    regionStatus.textContent = `Region: ${selectedRegion.w}×${selectedRegion.h} — click to clear`;
    regionStatus.classList.remove("hidden");
    btnRegion.textContent = "Re-select region…";
  } else {
    regionStatus.classList.add("hidden");
    btnRegion.textContent = "Select region…";
  }
}

function clearRegion() {
  selectedRegion = undefined;
  renderRegion();
}

// --- Capture callbacks ----------------------------------------------------
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
  stopTimer();
  // The background restored + may have minimized this window; STOP_RECORDING
  // also clears the badge if a recording was in flight.
  chrome.runtime.sendMessage({ type: "STOP_RECORDING" }).catch(() => {});
  // showView() clears the error bar, so surface the message *after* switching
  // back to idle — otherwise the error flashes and disappears instantly.
  showView("idle");
  showError(msg);
}

const captureCallbacks: CaptureCallbacks = {
  // The stream is live: show the recording view and let the background minimize
  // this window out of the capture and raise the REC badge.
  onStart: () => {
    showView("recording");
    startTimer();
    chrome.runtime.sendMessage({ type: "START_RECORDING" }).catch(() => {});
  },
  // Any stop path (button, shortcut, 30s auto-stop, native "Stop sharing").
  onStopBegin: () => {
    stopTimer();
    // Clears the badge and restores + focuses this window.
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" }).catch(() => {});
    showView("encoding");
    onEncodingProgress(0);
  },
  onProgress: onEncodingProgress,
  onComplete: onGifReady,
  onError,
};

async function startRecording() {
  // getDisplayMedia must run from this click's user gesture, so call it before
  // touching any view — onStart() handles the UI once the stream is acquired.
  await startCapture(selectedRegion, captureCallbacks);
}

async function doStop() {
  await stopCapture(captureCallbacks);
}

// --- Buttons --------------------------------------------------------------
btnRegion.addEventListener("click", async () => {
  if (selectedRegion) {
    clearRegion();
    return;
  }
  const res = (await chrome.runtime
    .sendMessage({ type: "SHOW_REGION_SELECTOR" })
    .catch(() => undefined)) as { error?: string } | undefined;
  if (res?.error) showError(res.error);
});

regionStatus.addEventListener("click", clearRegion);

btnStart.addEventListener("click", () => {
  void startRecording();
});

btnStop.addEventListener("click", () => {
  void doStop();
});

function downloadGif() {
  const a = document.createElement("a");
  a.href = gifDataUrl;
  a.download = `recording-${Date.now()}.gif`;
  a.click();
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

btnDownload.addEventListener("click", downloadGif);

// Clipboards can't hold animated GIFs, so copy a PNG of the first frame.
btnCopy.addEventListener("click", async () => {
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
});

btnNew.addEventListener("click", () => {
  gifDataUrl = "";
  gifPreview.src = "";
  clearRegion();
  showView("idle");
});

// --- Messages from the background -----------------------------------------
chrome.runtime.onMessage.addListener((message: Message) => {
  switch (message.type) {
    case "REGION_SELECTED":
      selectedRegion = message.region;
      renderRegion();
      break;
    case "REGION_CANCELLED":
      showError("Region selection cancelled — recording the full surface.");
      break;
    case "STOP_REQUESTED":
      if (state === "recording") void doStop();
      break;
  }
});
