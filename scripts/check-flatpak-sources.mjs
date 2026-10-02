// Fails when flatpak/node-sources.json or flatpak/cargo-sources.json miss a
// dependency from package-lock.json or src-tauri/Cargo.lock. The Flatpak build
// runs offline, so a forgotten `flatpak/update-sources.sh` breaks the release.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const missing = [];

const nodeUrls = new Set(JSON.parse(read("flatpak/node-sources.json")).map((s) => s.url).filter(Boolean));
for (const [name, pkg] of Object.entries(JSON.parse(read("package-lock.json")).packages ?? {})) {
  if (name && pkg.resolved && !pkg.link && !nodeUrls.has(pkg.resolved)) missing.push(`npm ${name} (${pkg.version})`);
}

const cargoUrls = JSON.parse(read("flatpak/cargo-sources.json")).map((s) => s.url ?? "").join("\n");
const lock = read("src-tauri/Cargo.lock");
for (const block of lock.split("[[package]]").slice(1)) {
  const name = block.match(/^name = "(.+)"$/m)?.[1];
  const version = block.match(/^version = "(.+)"$/m)?.[1];
  const source = block.match(/^source = "(.+)"$/m)?.[1];
  if (!source?.startsWith("registry+")) continue; // the app itself and path dependencies
  if (!cargoUrls.includes(`/${name}/${name}-${version}.crate`)) missing.push(`crate ${name} ${version}`);
}

if (missing.length) {
  console.error(`Flatpak offline sources are out of date (${missing.length} missing). Run flatpak/update-sources.sh:`);
  for (const m of missing.slice(0, 20)) console.error(`  - ${m}`);
  process.exit(1);
}
console.log("Flatpak offline sources cover all locked dependencies.");
