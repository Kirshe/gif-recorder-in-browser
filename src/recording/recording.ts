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
const btnShare = document.getElementById("btn-share") as HTMLButtonElement;
const btnNew = document.getElementById("btn-new") as HTMLButtonElement;

const regionStatus = document.getElementById("region-status")!;
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
let gifBlob: Blob | null = null;
let selectedRegion: Region | undefined;

// Web Share with files reaches the OS share sheet (WhatsApp, Slack, Teams, Mail,
// …) carrying the real animated GIF. Supported on Chrome/Edge (desktop + mobile)
// but not Firefox desktop — hide the button there and let Download stand alone.
function canShareGif(): boolean {
  try {
    const probe = new File([new Blob()], "probe.gif", { type: "image/gif" });
    return (
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [probe] })
    );
  } catch {
    return false;
  }
}

// Show the *actual* configured stop-recording shortcut (it may differ from the
// suggested default if the user remapped it, or be unset). Reveal the hint copy
// only when a shortcut is assigned.
async function renderStopHint() {
  let shortcut = "";
  try {
    const commands = await chrome.commands.getAll();
    shortcut = commands.find((c) => c.name === "stop-recording")?.shortcut ?? "";
  } catch {
    // commands.getAll unavailable — leave the hint hidden.
  }
  if (!shortcut) return;
  document.querySelectorAll<HTMLElement>(".stop-hint").forEach((el) => {
    el.textContent = shortcut;
  });
  document.querySelectorAll(".needs-shortcut").forEach((el) => {
    el.classList.remove("hidden");
  });
}
void renderStopHint();

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

function onGifReady(dataUrl: string, blob: Blob) {
  gifDataUrl = dataUrl;
  gifBlob = blob;
  gifPreview.src = dataUrl;
  gifSize.textContent = formatBytes(blob.size);
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
  // The stream is live: show the recording view and let the background raise the
  // REC badge and minimize this window out of the capture. Await the reply so
  // frame grabbing only begins once the minimize animation has settled.
  onStart: async () => {
    showView("recording");
    startTimer();
    await chrome.runtime
      .sendMessage({ type: "START_RECORDING" })
      .catch(() => {});
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

function gifFilename(): string {
  return `recording-${Date.now()}.gif`;
}

function downloadGif() {
  const a = document.createElement("a");
  a.href = gifDataUrl;
  a.download = gifFilename();
  a.click();
}

btnDownload.addEventListener("click", downloadGif);

// Reveal Share only where the OS share sheet can take a file; otherwise Download
// is the lone, full-width action.
if (canShareGif()) {
  btnShare.classList.remove("hidden");
}

// Hand the real animated GIF to the native share sheet so it can go straight to
// WhatsApp/Slack/Teams/email. Falls back to a download if sharing is rejected.
btnShare.addEventListener("click", async () => {
  if (!gifBlob) return;
  const file = new File([gifBlob], gifFilename(), { type: "image/gif" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "GIF Recording" });
      return;
    }
    downloadGif();
    showError("Sharing isn't available here — file downloaded instead.");
  } catch (err) {
    // The user dismissing the share sheet throws AbortError — not a failure.
    if (err instanceof Error && err.name === "AbortError") return;
    downloadGif();
    showError("Couldn't share — file downloaded instead.");
  }
});

btnNew.addEventListener("click", () => {
  gifDataUrl = "";
  gifBlob = null;
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
