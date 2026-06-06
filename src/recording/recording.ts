import { startFirefoxCapture, stopFirefoxCapture } from "../capture/capture-firefox.js";
import type { Region } from "../shared/types.js";

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

type State = "idle" | "recording" | "encoding" | "preview";

let state: State = "idle";
let recordingStartTime = 0;
let timerInterval: number | null = null;
let gifDataUrl = "";
let selectedRegion: Region | undefined;

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

async function startRecording() {
  showView("recording");
  startTimer();
  // Let the background show the recording badge.
  chrome.runtime.sendMessage({ type: "START_RECORDING" });
  await startFirefoxCapture(selectedRegion, onEncodingProgress, onGifReady, onError);
}

async function doStop() {
  stopTimer();
  showView("encoding");
  onEncodingProgress(0);
  // Clear the badge in the background.
  chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
  await stopFirefoxCapture(onEncodingProgress, onGifReady, onError);
}

// A region is chosen on the page from the popup, then handed to this window via
// session storage. Reflect it here; the checkbox isn't interactive in this
// context (the page overlay can't run from the recording window).
useRegion.disabled = true;
useRegion.title = "Choose a region from the toolbar popup before recording";

async function loadPendingRegion() {
  try {
    const data = await chrome.storage.session.get("pendingRegion");
    if (data.pendingRegion) {
      selectedRegion = data.pendingRegion as Region;
      useRegion.checked = true;
      await chrome.storage.session.remove("pendingRegion");
    }
  } catch {
    // No region available — full-tab capture.
  }
}

btnStart.addEventListener("click", async () => {
  await startRecording();
});

btnStop.addEventListener("click", async () => {
  await doStop();
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
  selectedRegion = undefined;
  useRegion.checked = false;
  showView("idle");
});

void loadPendingRegion();
