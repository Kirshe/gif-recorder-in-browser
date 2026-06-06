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

const input: Record<string, string> = {
  "popup/popup": resolve(__dirname, "src/popup/index.html"),
  "background/service-worker": resolve(
    __dirname,
    "src/background/service-worker.ts"
  ),
  "content/region-selector": resolve(
    __dirname,
    "src/content/region-selector.ts"
  ),
};

if (isChrome) {
  input["offscreen/offscreen"] = resolve(
    __dirname,
    "src/offscreen/offscreen.html"
  );
} else {
  input["recording/recording"] = resolve(
    __dirname,
    "src/recording/recording.html"
  );
}

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
          action: {
            default_popup: "src/popup/index.html",
            default_icon: manifestTemplate.icons,
          },
          permissions: isChrome
            ? ["tabCapture", "offscreen", "activeTab", "scripting", "storage"]
            : ["activeTab", "scripting", "storage"],
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
            gecko: { id: "gif-recorder@example.com" },
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
