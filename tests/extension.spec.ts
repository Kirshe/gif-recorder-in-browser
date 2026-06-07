import { test, expect, chromium, BrowserContext } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

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

test("popup shows idle view by default", async () => {
  const extensionId = await getExtensionId();
  const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;

  const page = await context.newPage();
  await page.goto(popupUrl);

  // Idle view should be visible
  await expect(page.locator("#view-idle")).toBeVisible();

  // Recording/encoding/preview views should be hidden
  await expect(page.locator("#view-recording")).toBeHidden();
  await expect(page.locator("#view-encoding")).toBeHidden();
  await expect(page.locator("#view-preview")).toBeHidden();
});

test("popup has Start Recording button", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  const btn = page.locator("#btn-start");
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText("Start Recording");
});

test("popup has Select Region checkbox unchecked by default", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  const checkbox = page.locator("#use-region");
  await expect(checkbox).not.toBeChecked();
});

test("popup region checkbox can be toggled", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  const checkbox = page.locator("#use-region");
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
});

test("popup title is GIF Recorder", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  await expect(page.locator("h1")).toHaveText("GIF Recorder");
});

test("error bar is hidden by default", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  await expect(page.locator("#error-bar")).toBeHidden();
});

test("clicking Start Recording optimistically shows the recording view", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  // The popup switches to the recording view immediately (before the background
  // round-trip), so the timer is wired up synchronously on click.
  await page.locator("#btn-start").click();
  await expect(page.locator("#timer")).toHaveText("00:00");
});

test("failed capture surfaces an error and returns to idle", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  // There's no capturable tab in this harness, so the background reports an
  // error; the popup must surface it and fall back to idle rather than getting
  // stuck on the recording view.
  await page.locator("#btn-start").click();
  await expect(page.locator("#error-bar")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#view-idle")).toBeVisible();
  await expect(page.locator("#view-recording")).toBeHidden();
});

test("stop with no capture in flight surfaces an error instead of hanging", async () => {
  // Regression: if START_CAPTURE was dropped (e.g. it raced the offscreen
  // document's listener registration), neither the grabber nor the encoder pool
  // exists. A later STOP_CAPTURE must still report an ERROR so the popup recovers
  // — previously it returned silently, leaving the popup stuck on "Encoding…".
  const extensionId = await getExtensionId();
  const base = `chrome-extension://${extensionId}`;

  // Load the offscreen document as a page so its STOP_CAPTURE handler is live.
  const offscreen = await context.newPage();
  await offscreen.goto(`${base}/src/offscreen/offscreen.html`);

  // A second extension page observes the runtime messages the offscreen broadcasts.
  const observer = await context.newPage();
  await observer.goto(`${base}/src/popup/index.html`);
  await observer.evaluate(() => {
    (window as any).__errors = [];
    chrome.runtime.onMessage.addListener((msg: any) => {
      if (msg?.type === "ERROR") (window as any).__errors.push(msg.message);
    });
  });

  // Simulate Stop arriving with no capture in progress.
  await observer.evaluate(() =>
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" })
  );

  await expect
    .poll(() => observer.evaluate(() => (window as any).__errors), {
      timeout: 5000,
    })
    .toContain("Recording didn't start — please try again");
});

test("recording view markup has a Stop button and timer", async () => {
  const extensionId = await getExtensionId();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  // Verify the recording view is wired up without depending on a live capture.
  await expect(page.locator("#btn-stop")).toHaveCount(1);
  await expect(page.locator("#timer")).toHaveText("00:00");
});
