import { test, expect, chromium, BrowserContext } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import type { AddressInfo } from "net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "../dist/chrome");

let context: BrowserContext;

test.beforeEach(async () => {
  context = await chromium.launchPersistentContext("", {
    headless: false,
    executablePath:
      process.env.CHROMIUM_PATH ||
      `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });
});

test.afterEach(async () => {
  await context.close();
});

async function getExtensionId(): Promise<string> {
  // Get the service worker page for the extension
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent("serviceworker");
  }
  const extensionId = background.url().split("/")[2];
  return extensionId;
}

// The single pop-out player drives every browser now; load it directly.
function playerUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/recording/recording.html`;
}

test("player shows idle view by default", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(playerUrl(extensionId));

  // Idle view should be visible
  await expect(page.locator("#view-idle")).toBeVisible();

  // Recording/encoding/preview views should be hidden
  await expect(page.locator("#view-recording")).toBeHidden();
  await expect(page.locator("#view-encoding")).toBeHidden();
  await expect(page.locator("#view-preview")).toBeHidden();
});

test("player has Start Recording button", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(playerUrl(extensionId));

  const btn = page.locator("#btn-start");
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText("Start Recording");
});

test("player has a Select region button", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(playerUrl(extensionId));

  const btn = page.locator("#btn-region");
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText("Select region…");
  // No region chosen yet, so the status line stays hidden.
  await expect(page.locator("#region-status")).toBeHidden();
});

test("player title is GIF Recorder", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(playerUrl(extensionId));

  await expect(page.locator("h1")).toHaveText("GIF Recorder");
});

test("error bar is hidden by default", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(playerUrl(extensionId));

  await expect(page.locator("#error-bar")).toBeHidden();
});

test("recording view markup has a Stop button and timer", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(playerUrl(extensionId));

  // Verify the recording view is wired up without depending on a live capture.
  await expect(page.locator("#btn-stop")).toHaveCount(1);
  await expect(page.locator("#timer")).toHaveText("00:00");
});

test("REGION_SELECTED from the background updates the player's region status", async () => {
  // The background relays the chosen region to the player as a runtime message;
  // the player should reflect it in the idle view's status line. A page's own
  // sendMessage doesn't reach its own listener, so broadcast from the worker.
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(playerUrl(extensionId));
  await expect(page.locator("#view-idle")).toBeVisible();

  let [bg] = context.serviceWorkers();
  if (!bg) bg = await context.waitForEvent("serviceworker");

  await bg.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "REGION_SELECTED",
      region: { x: 0, y: 0, w: 320, h: 240, viewportW: 1280, viewportH: 720 },
    })
  );

  await expect(page.locator("#region-status")).toContainText("320×240");
});

test("region overlay injects into a web page and a drag clears it", async () => {
  // Region selection injects an overlay via scripting.executeScript. With only
  // activeTab, that background injection was denied ("must request permission to
  // access the host") on web pages. host_permissions for http/https must make
  // the overlay inject reliably; a valid drag then removes it (and emits
  // REGION_SELECTED to the background).
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      "<!doctype html><html><body style='height:2000px'><h1>page</h1></body></html>"
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;

  let [bg] = context.serviceWorkers();
  if (!bg) bg = await context.waitForEvent("serviceworker");

  const page = await context.newPage();
  await page.goto(`http://localhost:${port}/`);

  // Inject exactly like the background's handleShowRegionSelector does.
  const tabId = await bg.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t?.id;
  });
  const injectError = await bg.evaluate(async (id) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: id as number },
        files: ["content/region-selector.js"],
      });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, tabId);
  expect(injectError).toBeNull();

  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => !!document.getElementById("gif-recorder-overlay"))
  ).toBe(true);

  // Drag a selection larger than the 10px threshold.
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(400, 350, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // A valid selection removes the overlay (and sends REGION_SELECTED).
  expect(
    await page.evaluate(() => !!document.getElementById("gif-recorder-overlay"))
  ).toBe(false);

  await page.close();
  // Force-close keep-alive sockets so server.close() can actually resolve.
  (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});
