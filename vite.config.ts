import { defineConfig } from "vite";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
} from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = process.env.TARGET || "chrome";
const isChrome = target === "chrome";

// One flow for both browsers: the toolbar icon opens the pop-out player
// (recording.html), which captures via getDisplayMedia and encodes the GIF.
const input: Record<string, string> = {
  "background/service-worker": resolve(
    __dirname,
    "src/background/service-worker.ts"
  ),
  "content/region-selector": resolve(
    __dirname,
    "src/content/region-selector.ts"
  ),
  "recording/recording": resolve(__dirname, "src/recording/recording.html"),
};

export default defineConfig({
  base: "./",
  define: {
    __BROWSER__: JSON.stringify(target),
  },
  build: {
    outDir: `dist/${target}`,
    emptyOutDir: true,
    rollupOptions: {
      input,
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
    target: "es2022",
    minify: false,
    sourcemap: true,
  },
  plugins: [
    {
      name: "generate-manifest",
      writeBundle() {
        const manifestTemplate = JSON.parse(
          readFileSync(resolve(__dirname, "manifest.json"), "utf-8")
        );

        const manifest: Record<string, unknown> = {
          manifest_version: 3,
          name: manifestTemplate.name,
          version: manifestTemplate.version,
          description: manifestTemplate.description,
          icons: manifestTemplate.icons,
          // No default_popup: clicking the toolbar icon fires action.onClicked
          // in the background, which opens the pop-out player window.
          action: {
            default_icon: manifestTemplate.icons,
          },
          // A global shortcut to stop recording while the player is minimized
          // out of the capture.
          commands: {
            "stop-recording": {
              // Alt+Shift+G to avoid clashes with built-ins (Ctrl+Shift+S is
              // Firefox's screenshot tool).
              suggested_key: {
                default: "Alt+Shift+G",
                mac: "Alt+Shift+G",
              },
              description: "Stop the current GIF recording",
            },
          },
          permissions: ["activeTab", "scripting"],
          // Region selection injects an overlay into the current web page via
          // scripting.executeScript. activeTab alone is unreliable here: the
          // injection runs from the background while the player window is
          // focused, and the activeTab grant doesn't consistently cover it — so
          // request host access to web pages outright. Restricted schemes
          // (chrome://, about:, the add-on store) still can't be injected and
          // are handled gracefully.
          host_permissions: ["http://*/*", "https://*/*"],
          content_security_policy: {
            extension_pages: "script-src 'self'; object-src 'self'",
          },
        };

        if (isChrome) {
          manifest.background = {
            service_worker: "background/service-worker.js",
            type: "module",
          };
          manifest.minimum_chrome_version = "116";
        } else {
          manifest.background = {
            scripts: ["background/service-worker.js"],
            type: "module",
          };
          manifest.browser_specific_settings = {
            gecko: {
              id: process.env.FIREFOX_ADDON_ID || "gif-recorder@example.com",
            },
          };
        }

        const outDir = resolve(__dirname, `dist/${target}`);
        writeFileSync(
          join(outDir, "manifest.json"),
          JSON.stringify(manifest, null, 2)
        );

        // Copy icons
        const iconsDir = resolve(__dirname, "icons");
        const outIcons = join(outDir, "icons");
        if (existsSync(iconsDir)) {
          mkdirSync(outIcons, { recursive: true });
          for (const file of readdirSync(iconsDir)) {
            copyFileSync(join(iconsDir, file), join(outIcons, file));
          }
        }
      },
    },
  ],
});
