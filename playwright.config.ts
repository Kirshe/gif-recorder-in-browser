import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "dist/chrome");

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: {
    headless: false,
    channel: undefined,
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    },
  },
  projects: [
    {
      name: "chromium-extension",
      use: {
        ...devices["Desktop Chrome"],
        channel: undefined,
      },
    },
  ],
});
