import type { Message } from "../shared/messages.js";

declare const __BROWSER__: "chrome" | "firefox";

const isChrome = __BROWSER__ === "chrome";

let isRecording = false;

// Badge management
function setBadgeRecording() {
  chrome.action.setBadgeText({ text: "REC" });
  chrome.action.setBadgeBackgroundColor({ color: "#e53e3e" });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

// Offscreen document lifecycle (Chrome only)
async function ensureOffscreenDocument(): Promise<void> {
  if (!isChrome) return;

  const contexts = await (chrome as any).offscreen.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length > 0) return;

  await (chrome as any).offscreen.createDocument({
    url: "src/offscreen/offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Recording tab capture stream and encoding GIF",
  });
}

async function closeOffscreenDocument(): Promise<void> {
  if (!isChrome) return;

  try {
    await (chrome as any).offscreen.closeDocument();
  } catch {
    // Already closed
  }
}

// Message routing
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(
  message: Message,
  _sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case "START_RECORDING":
      return handleStartRecording(message.region);

    case "STOP_RECORDING":
      return handleStopRecording();

    case "SHOW_REGION_SELECTOR":
      return handleShowRegionSelector();

    case "REGION_SELECTED":
      // Forward to popup
      chrome.runtime.sendMessage(message);
      return { ok: true };

    case "REGION_CANCELLED":
      chrome.runtime.sendMessage(message);
      return { ok: true };

    // Chrome: forward offscreen results to popup
    case "CAPTURE_GIF_READY":
      chrome.runtime.sendMessage({
        type: "GIF_READY",
        dataUrl: message.dataUrl,
        size: message.size,
      });
      clearBadge();
      await closeOffscreenDocument();
      isRecording = false;
      return { ok: true };

    case "CAPTURE_ENCODING_PROGRESS":
      chrome.runtime.sendMessage({
        type: "ENCODING_PROGRESS",
        progress: message.progress,
      });
      return { ok: true };

    case "ERROR":
      chrome.runtime.sendMessage(message);
      clearBadge();
      isRecording = false;
      return { ok: true };

    default:
      return { ok: true };
  }
}

async function handleStartRecording(
  region?: { x: number; y: number; w: number; h: number }
): Promise<unknown> {
  if (isRecording) return { error: "Already recording" };
  isRecording = true;
  setBadgeRecording();

  if (isChrome) {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      isRecording = false;
      clearBadge();
      return { error: "No active tab" };
    }

    // Get media stream ID via tabCapture
    const streamId = await new Promise<string>((resolve, reject) => {
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

    await ensureOffscreenDocument();

    // Send to offscreen document
    chrome.runtime.sendMessage({
      type: "START_CAPTURE",
      streamId,
      region,
    } satisfies Message);

    return { type: "RECORDING_STARTED", streamId };
  } else {
    // Firefox: popup handles capture directly
    return { type: "RECORDING_STARTED" };
  }
}

async function handleStopRecording(): Promise<unknown> {
  if (!isRecording && !isChrome) {
    // Firefox: popup handles stop directly, just update badge
    clearBadge();
    return { ok: true };
  }

  if (isChrome) {
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" } satisfies Message);
  }

  // Badge is cleared when GIF_READY arrives (Chrome) or by popup (Firefox)
  return { type: "RECORDING_STOPPED" };
}

async function handleShowRegionSelector(): Promise<unknown> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { error: "No active tab" };

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/region-selector.js"],
  });

  return { ok: true };
}
