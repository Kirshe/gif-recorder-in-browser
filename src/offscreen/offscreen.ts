import { startChromeCapture, stopChromeCapture } from "../capture/capture-chrome.js";
import type { Message } from "../shared/messages.js";

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === "START_CAPTURE") {
    startChromeCapture(
      message.streamId,
      message.region,
      (progress) => {
        chrome.runtime.sendMessage({ type: "CAPTURE_ENCODING_PROGRESS", progress });
      },
      (dataUrl, size) => {
        chrome.runtime.sendMessage({ type: "CAPTURE_GIF_READY", dataUrl, size });
      },
      (msg) => {
        chrome.runtime.sendMessage({ type: "ERROR", message: msg });
      }
    );
    sendResponse({ ok: true });
  }

  if (message.type === "STOP_CAPTURE") {
    stopChromeCapture(
      (progress) => {
        chrome.runtime.sendMessage({ type: "CAPTURE_ENCODING_PROGRESS", progress });
      },
      (dataUrl, size) => {
        chrome.runtime.sendMessage({ type: "CAPTURE_GIF_READY", dataUrl, size });
      },
      (msg) => {
        chrome.runtime.sendMessage({ type: "ERROR", message: msg });
      }
    );
    sendResponse({ ok: true });
  }

  return true;
});

// Tell the background the listener above is now registered. The background waits
// for this before sending START_CAPTURE — otherwise a START_CAPTURE broadcast
// the instant after createDocument() resolves can land before this script runs
// and be lost, leaving the recording silently never started.
chrome.runtime.sendMessage({ type: "OFFSCREEN_READY" }).catch(() => {});
