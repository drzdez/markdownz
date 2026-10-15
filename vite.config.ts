import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

// Tauri expects a fixed dev server port and serves the built files from ../dist.
export default defineConfig({
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: ["es2022", "chrome110", "safari16"],
    chunkSizeWarningLimit: 4096,
  },
  test: {
    environment: "jsdom",
  },
});
