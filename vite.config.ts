import { defineConfig } from "vite";

// `tauri android dev` sets this to the address a device reaches the dev server at.
const host = process.env.TAURI_DEV_HOST;

// Tauri expects a fixed dev server port and serves the built files from ../dist.
export default defineConfig({
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
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
