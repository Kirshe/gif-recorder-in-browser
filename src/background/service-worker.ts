import type { Message } from "../shared/messages.js";

// ---------------------------------------------------------------------------
// The recording lives entirely in the pop-out player window (recording.html):
// it acquires the getDisplayMedia stream, grabs frames, and encodes the GIF.
// The background's job is narrow — open/focus that window, track the page the
// user wants to region-select on, relay the stop shortcut, and toggle the badge
// + minimize the player out of a full-screen capture.
// ---------------------------------------------------------------------------

// The pop-out player window.
let playerWindowId: number | null = null;

// The tab the user launched the recorder from, used as the region-selection
// target (the player window itself is a popup and must be skipped).
let targetTabId: number | null = null;
let targetWindowId: number | null = null;

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
function setBadgeRecording(): void {
  chrome.action.setBadgeText({ text: "REC" });
  chrome.action.setBadgeBackgroundColor({ color: "#e53e3e" });
}

function clearBadge(): void {
  chrome.action.setBadgeText({ text: "" });
}

// ---------------------------------------------------------------------------
// Player window
// ---------------------------------------------------------------------------
async function openPlayer(): Promise<void> {
  if (playerWindowId !== null) {
    try {
      await chrome.windows.update(playerWindowId, {
        focused: true,
        state: "normal",
      });
      return;
    } catch {
      // The stored window is gone; fall through and create a fresh one.
      playerWindowId = null;
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("src/recording/recording.html"),
    type: "popup",
    width: 380,
    height: 380,
  });
  playerWindowId = win?.id ?? null;
}

async function minimizePlayer(): Promise<void> {
  if (playerWindowId === null) return;
  try {
    await chrome.windows.update(playerWindowId, { state: "minimized" });
  } catch {
    // Non-fatal: the player just stays visible and may appear in the capture.
  }
}

async function restorePlayer(): Promise<void> {
  if (playerWindowId === null) return;
  try {
    await chrome.windows.update(playerWindowId, {
      state: "normal",
      focused: true,
    });
  } catch {
    // Non-fatal: the user can restore the window manually.
  }
}

async function focusPlayer(): Promise<void> {
  if (playerWindowId === null) return;
  try {
    await chrome.windows.update(playerWindowId, { focused: true });
  } catch {
    // Non-fatal.
  }
}

// Best-effort message to the player window.
function notifyPlayer(message: Message): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ---------------------------------------------------------------------------
// Entry points: toolbar icon + keyboard shortcut
// ---------------------------------------------------------------------------
chrome.action.onClicked.addListener(async (tab) => {
  // Remember where the user came from so region selection targets their page,
  // not the player popup we're about to open/focus.
  if (tab?.id != null) {
    targetTabId = tab.id;
    targetWindowId = tab.windowId ?? null;
  }
  await openPlayer();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "stop-recording") {
    // The player is minimized mid-recording, so route the stop to it directly.
    notifyPlayer({ type: "STOP_REQUESTED" });
  }
});

// If the player window is closed (rather than stopping cleanly), the capture
// goes with it — clear the badge and forget the window.
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId !== playerWindowId) return;
  playerWindowId = null;
  clearBadge();
});

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message: Message): Promise<unknown> {
  switch (message.type) {
    case "START_RECORDING":
      setBadgeRecording();
      await minimizePlayer();
      return { ok: true };

    case "STOP_RECORDING":
      clearBadge();
      await restorePlayer();
      return { ok: true };

    case "SHOW_REGION_SELECTOR":
      return handleShowRegionSelector();

    case "REGION_SELECTED":
      // From the content script: hand the region to the player and bring it
      // back to the front so the user can start recording.
      notifyPlayer(message);
      await focusPlayer();
      return { ok: true };

    case "REGION_CANCELLED":
      notifyPlayer(message);
      await focusPlayer();
      return { ok: true };

    default:
      return { ok: true };
  }
}

async function handleShowRegionSelector(): Promise<unknown> {
  const tab = await resolveTargetTab();
  if (!tab?.id) {
    return { error: "Open a normal browser tab first, then select a region." };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/region-selector.js"],
    });
  } catch (err) {
    // e.g. chrome:// pages, the add-on store, the PDF viewer — injection denied.
    const msg =
      err instanceof Error
        ? `Can't select a region on this page (${err.message})`
        : "Can't select a region on this page";
    return { error: msg };
  }

  // Bring the user's page to the front so they can draw the rectangle (the
  // player will be re-focused once REGION_SELECTED comes back).
  if (tab.windowId != null) {
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch {
      // Non-fatal.
    }
  }
  return { ok: true };
}

// Resolve the page to inject the region overlay into: prefer the tab the user
// launched from, else the active tab of a normal (non-popup) window.
async function resolveTargetTab(): Promise<chrome.tabs.Tab | undefined> {
  if (targetTabId != null) {
    try {
      const tab = await chrome.tabs.get(targetTabId);
      if (tab) return tab;
    } catch {
      // The remembered tab was closed; fall back to a live lookup.
    }
  }

  const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
  if (targetWindowId != null) {
    const match = tabs.find((t) => t.windowId === targetWindowId);
    if (match) return match;
  }
  return tabs[0];
}
