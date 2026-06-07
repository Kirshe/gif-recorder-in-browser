import type { Message } from "../shared/messages.js";
import type { Region, RecordingState, SessionSnapshot } from "../shared/types.js";

declare const __BROWSER__: "chrome" | "firefox";

const isChrome = __BROWSER__ === "chrome";

// ---------------------------------------------------------------------------
// Recording state lives here (not in the transient popup) so a recording — and
// its result — survive the popup closing or the service worker restarting.
// ---------------------------------------------------------------------------
interface Session {
  state: RecordingState;
  recordingStartTime?: number;
  progress: number;
  gifDataUrl?: string;
  size?: number;
  error?: string;
  region?: Region;
}

let session: Session = { state: "idle", progress: 0 };

async function saveSession(): Promise<void> {
  try {
    await chrome.storage.session.set({ session });
  } catch {
    // Quota exceeded (large GIF data URL) or unavailable — the in-memory copy
    // still serves the common case where the worker stays alive.
  }
}

function snapshot(): SessionSnapshot {
  return {
    state: session.state,
    recordingStartTime: session.recordingStartTime,
    progress: session.progress,
    gifDataUrl: session.gifDataUrl,
    size: session.size,
    error: session.error,
  };
}

async function resetSession(): Promise<void> {
  session = { state: "idle", progress: 0 };
  await saveSession();
}

// Rehydrate after a service-worker restart, then reconcile against reality.
async function rehydrate(): Promise<void> {
  try {
    const data = await chrome.storage.session.get("session");
    if (data.session) session = data.session as Session;
  } catch {
    return;
  }

  // If we think we're recording but the offscreen document is gone, the
  // recording was lost when the worker died — fall back to idle.
  if (isChrome && (session.state === "recording" || session.state === "encoding")) {
    const ctx = await (chrome as any).offscreen
      .getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
      .catch(() => []);
    if (!ctx.length) await resetSession();
  }
  // A "preview" state with no retained data URL is unusable.
  if (session.state === "preview" && !session.gifDataUrl) await resetSession();
}
void rehydrate();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Best-effort message to the popup. The popup is frequently closed, which makes
// sendMessage reject with "Could not establish connection" — swallow it.
function notifyPopup(message: Message): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function setBadgeRecording() {
  chrome.action.setBadgeText({ text: "REC" });
  chrome.action.setBadgeBackgroundColor({ color: "#e53e3e" });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

// Resolves when the offscreen document reports it has registered its message
// listener (see OFFSCREEN_READY). Reset whenever we create a fresh document.
let offscreenReady = false;
let offscreenReadyWaiters: Array<() => void> = [];

function markOffscreenReady(): void {
  offscreenReady = true;
  const waiters = offscreenReadyWaiters;
  offscreenReadyWaiters = [];
  for (const resolve of waiters) resolve();
}

function whenOffscreenReady(timeoutMs = 3000): Promise<void> {
  if (offscreenReady) return Promise.resolve();
  return new Promise<void>((resolve) => {
    offscreenReadyWaiters.push(resolve);
    // Fall back after a timeout so a missed READY can't hang recording forever;
    // the worst case is the original race, which is no worse than before.
    setTimeout(resolve, timeoutMs);
  });
}

async function ensureOffscreenDocument(): Promise<void> {
  if (!isChrome) return;

  const contexts = await (chrome as any).offscreen.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length > 0) {
    // Reusing a live document — its listener is already registered.
    offscreenReady = true;
    return;
  }

  offscreenReady = false;
  await (chrome as any).offscreen.createDocument({
    url: "src/offscreen/offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Recording tab capture stream and encoding GIF",
  });
}

async function closeOffscreenDocument(): Promise<void> {
  if (!isChrome) return;

  offscreenReady = false;
  try {
    await (chrome as any).offscreen.closeDocument();
  } catch {
    // Already closed
  }
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ error: err.message });
    });
  return true;
});

async function handleMessage(
  message: Message,
  _sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case "OFFSCREEN_READY":
      markOffscreenReady();
      return { ok: true };

    case "GET_STATE":
      return snapshot();

    case "RESET":
      await resetSession();
      return { ok: true };

    case "OPEN_RECORDING_WINDOW":
      // Firefox, full-tab: no region, so clear any stale one and open the window.
      try {
        await chrome.storage.session.remove("pendingRegion");
      } catch {
        // ignore
      }
      await openRecordingWindow();
      return { ok: true };

    case "START_RECORDING":
      return handleStartRecording(message.region);

    case "STOP_RECORDING":
      return handleStopRecording();

    case "SHOW_REGION_SELECTOR":
      return handleShowRegionSelector();

    case "REGION_SELECTED":
      return handleRegionSelected(message.region);

    case "REGION_CANCELLED":
      // Selection aborted by the user — return to idle.
      if (session.state === "selecting-region") await resetSession();
      notifyPopup(message);
      return { ok: true };

    // Chrome: offscreen reports the finished GIF
    case "CAPTURE_GIF_READY":
      session.state = "preview";
      session.gifDataUrl = message.dataUrl;
      session.size = message.size;
      session.error = undefined;
      await saveSession();
      notifyPopup({ type: "GIF_READY", dataUrl: message.dataUrl, size: message.size });
      clearBadge();
      await closeOffscreenDocument();
      return { ok: true };

    case "CAPTURE_ENCODING_PROGRESS":
      session.state = "encoding";
      session.progress = message.progress;
      await saveSession();
      notifyPopup({ type: "ENCODING_PROGRESS", progress: message.progress });
      return { ok: true };

    case "ERROR":
      session.state = "idle";
      session.error = message.message;
      await saveSession();
      notifyPopup(message);
      clearBadge();
      await closeOffscreenDocument();
      return { ok: true };

    default:
      return { ok: true };
  }
}

async function handleStartRecording(region?: Region): Promise<unknown> {
  if (session.state === "recording") return { error: "Already recording" };

  if (isChrome) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { error: "No active tab" };
    }

    let streamId: string;
    try {
      streamId = await new Promise<string>((resolve, reject) => {
        (chrome as any).tabCapture.getMediaStreamId(
          { targetTabId: tab.id },
          (id: string) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(id);
            }
          }
        );
      });
    } catch (err) {
      session.state = "idle";
      session.error = err instanceof Error ? err.message : "Capture failed";
      await saveSession();
      notifyPopup({ type: "ERROR", message: session.error });
      return { error: session.error };
    }

    await ensureOffscreenDocument();
    // Wait until the offscreen document's listener is live; otherwise this
    // START_CAPTURE can be dropped and the recording silently never starts —
    // which later leaves the popup stuck on the encoding view with no result.
    await whenOffscreenReady();

    session = {
      state: "recording",
      progress: 0,
      recordingStartTime: Date.now(),
      region,
    };
    setBadgeRecording();
    await saveSession();

    notifyPopup({ type: "START_CAPTURE", streamId, region });
    return { type: "RECORDING_STARTED", recordingStartTime: session.recordingStartTime };
  } else {
    // Firefox: capture is performed by the recording window. This path is hit
    // when that window tells us recording began, so we just track the badge.
    session = { state: "recording", progress: 0, recordingStartTime: Date.now() };
    setBadgeRecording();
    await saveSession();
    return { type: "RECORDING_STARTED" };
  }
}

async function handleStopRecording(): Promise<unknown> {
  if (isChrome) {
    notifyPopup({ type: "STOP_CAPTURE" });
    // Badge clears when CAPTURE_GIF_READY arrives.
  } else {
    // Firefox: recording window handles the stop; just clear the badge.
    clearBadge();
  }
  return { type: "RECORDING_STOPPED" };
}

async function handleShowRegionSelector(): Promise<unknown> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { error: "No active tab" };

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/region-selector.js"],
    });
  } catch (err) {
    // e.g. chrome:// pages, the Web Store, the PDF viewer — injection is denied.
    const msg =
      err instanceof Error
        ? `Can't select a region on this page (${err.message})`
        : "Can't select a region on this page";
    session.state = "idle";
    session.error = msg;
    await saveSession();
    notifyPopup({ type: "ERROR", message: msg });
    return { error: msg };
  }

  session.state = "selecting-region";
  await saveSession();
  return { ok: true };
}

async function handleRegionSelected(region: Region): Promise<unknown> {
  notifyPopup({ type: "REGION_SELECTED", region });

  if (isChrome) {
    // Drive the recording from here — the popup has almost certainly closed
    // because the user clicked into the page to drag the selection.
    return handleStartRecording(region);
  }

  // Firefox: stash the region for the recording window and open it. The window
  // provides the user gesture getDisplayMedia() needs.
  try {
    await chrome.storage.session.set({ pendingRegion: region });
  } catch {
    // If we can't persist it, the window will fall back to full-tab capture.
  }
  await openRecordingWindow();
  return { ok: true };
}

// Firefox: the id of the dedicated recording window, so we can tell when the
// user closes it (rather than clicking Stop) and tear down the recording.
let recordingWindowId: number | null = null;

async function openRecordingWindow(): Promise<void> {
  const win = await (chrome as any).windows.create({
    url: chrome.runtime.getURL("src/recording/recording.html"),
    type: "popup",
    width: 360,
    height: 320,
  });
  recordingWindowId = win?.id ?? null;
}

// If the recording window is closed without stopping, the capture goes with it,
// but the badge and session would otherwise stay stuck in "recording" — which
// makes the toolbar popup show a still-running timer. Reconcile to idle.
if (!isChrome) {
  chrome.windows.onRemoved.addListener(async (windowId) => {
    if (windowId !== recordingWindowId) return;
    recordingWindowId = null;
    clearBadge();
    if (session.state === "recording" || session.state === "encoding") {
      await resetSession();
    }
  });
}
