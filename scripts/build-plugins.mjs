// Builds the format plugins (plugins/<id>/) into dist-plugins/markdownz-plugin-<id>.js,
// signs them with the updater key when TAURI_SIGNING_PRIVATE_KEY is set, and writes
// dist-plugins/plugins.json, the index the app reads from the release.
//
//   node scripts/build-plugins.mjs [--base <url of the release download folder>] [--only id,id] [--sign]
//
// Without --base the URLs point to the GitHub release of the version in package.json.
// --sign fails when the signing key is missing (the release workflow uses it).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-plugins");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const api = Number(/export const PLUGIN_API = (\d+)/.exec(readFileSync(join(root, "src/plugins/api.ts"), "utf-8"))[1]);
const base = (arg("--base") ?? `https://github.com/drzdez/markdownz/releases/download/v${version}`).replace(/\/$/, "");
const only = arg("--only")?.split(",");
if (process.argv.includes("--sign") && !process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("--sign needs TAURI_SIGNING_PRIVATE_KEY (and _PASSWORD)");

const ids = readdirSync(join(root, "plugins")).filter((id) => existsSync(join(root, "plugins", id, "manifest.json")) && (!only || only.includes(id)));
// Type errors stop the build (the app's own tsc run leaves plugins/ out: their libraries are not installed there).
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", join(root, "plugins")], { cwd: root, stdio: "inherit" });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const plugins = [];
for (const id of ids) {
  const manifest = JSON.parse(readFileSync(join(root, "plugins", id, "manifest.json"), "utf-8"));
  const file = `markdownz-plugin-${id}.js`;
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    // Libraries check process.env.NODE_ENV; the plugin runs in the app, not in Node.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      target: ["es2022", "chrome110", "safari16"],
      outDir: out,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      lib: { entry: join(root, "plugins", id, "index.ts"), formats: ["es"], fileName: () => file },
      rollupOptions: { output: { codeSplitting: false, minify: true } },
    },
  });
  const path = join(out, file);
  let signature = "";
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
    // Writes <file>.sig; the signed trusted comment names the file, which the app checks.
    execFileSync(process.execPath, [join(root, "node_modules/@tauri-apps/cli/tauri.js"), "signer", "sign", path], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
    signature = readFileSync(`${path}.sig`, "utf-8").trim();
  }
  plugins.push({ id, ...manifest, api, version, size: statSync(path).size, url: `${base}/${file}`, signature });
  console.log(`${file}: ${(statSync(path).size / 1024).toFixed(0)} kB${signature ? ", signed" : ""}`);
}

writeFileSync(join(out, "plugins.json"), JSON.stringify({ version, api, plugins }, null, 2) + "\n");
console.log(`plugins.json: ${plugins.length} plugins, api ${api}, ${base}`);
