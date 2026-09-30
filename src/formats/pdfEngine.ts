// Loaded lazily the first time a PDF is opened (pdf.js is ~1.8 MB).
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

// The viewer components read the core library from this global.
(globalThis as { pdfjsLib?: typeof pdfjs }).pdfjsLib = pdfjs;
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");

/** pdf.js data files copied to /pdfjs by scripts/copy-pdfjs.mjs. */
const data = `${import.meta.env.BASE_URL}pdfjs/`;

export const documentOptions = {
  cMapUrl: `${data}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${data}standard_fonts/`,
  wasmUrl: `${data}wasm/`,
  iccUrl: `${data}iccs/`,
  // Documents must not run code: no eval, no XFA forms, no PDF JavaScript.
  isEvalSupported: false,
  enableXfa: false,
};

export { pdfjs, viewer };
