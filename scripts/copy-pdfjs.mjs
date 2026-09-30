// Copies pdf.js data files (CMaps, standard fonts, WASM decoders, ICC profiles)
// to public/pdfjs so they are served next to the app. Runs before dev and build.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const target = join(import.meta.dirname, "..", "public", "pdfjs");
rmSync(target, { recursive: true, force: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(root, dir), join(target, dir), { recursive: true });
}
