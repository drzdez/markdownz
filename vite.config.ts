import { defineConfig } from "vite";

// Tauri expects a fixed dev server port and serves the built files from ../dist.
export default defineConfig({
  clearScreen: false,
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
