// TIFF plugin: decodes with UTIF.js. One page shows in the picture view; several pages
// (scans, faxes) become a document with one picture per page, so each prints on its own sheet.

import UTIF from "utif";
import type { PluginApi, PluginInstance } from "../../src/plugins/api";

export { PLUGIN_API as api } from "../../src/plugins/api";

type Ifd = Record<string, number[]> & { width: number; height: number };

/** Main images of the file; reduced-size previews (NewSubfileType bit 0) are left out. */
function pages(data: Uint8Array): Ifd[] {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const ifds = (UTIF.decode(buffer) as Ifd[]).filter((ifd) => ifd.t256 && !(ifd.t254 && ifd.t254[0] & 1));
  for (const ifd of ifds) UTIF.decodeImage(buffer, ifd);
  return ifds;
}

/** Dots per inch from XResolution / YResolution and ResolutionUnit (2 inch, 3 cm). */
function dpi(ifd: Ifd): { x: number; y: number } | undefined {
  const unit = ifd.t296?.[0] ?? 2;
  const factor = unit === 3 ? 2.54 : unit === 2 ? 1 : 0;
  const x = (ifd.t282?.[0] ?? 0) * factor;
  const y = (ifd.t283?.[0] ?? x) * factor || x;
  return x >= 30 && x <= 10000 ? { x, y: y >= 30 ? y : x } : undefined;
}

function toCanvas(ifd: Ifd): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = ifd.width;
  canvas.height = ifd.height;
  const rgba = new Uint8ClampedArray(UTIF.toRGBA8(ifd));
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, ifd.width, ifd.height), 0, 0);
  return canvas;
}

const pngOf = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("cannot convert the picture"))), "image/png"));

export default function activate(api: PluginApi): PluginInstance {
  return {
    async createView(host, path) {
      const count = pages(await api.readBinary(path)).length;
      if (count <= 1) {
        return api.createImageView(async (data) => {
          const [page] = pages(data);
          if (!page) throw new Error("no picture found in this TIFF file");
          return { image: await pngOf(toCanvas(page)), dpi: dpi(page), label: "TIFF" };
        });
      }
      return api.createMarkdownView(host, (data) =>
        pages(data)
          .map((page, i) => {
            const d = dpi(page);
            // At the stored resolution the page prints at its real size; wider ones shrink to the paper.
            const width = d ? `${Math.round((page.width / d.x) * 96)}px` : "100%";
            return `## Page ${i + 1} of ${count}\n\n<img src="${toCanvas(page).toDataURL("image/png")}" alt="Page ${i + 1}" style="width: ${width}; max-width: 100%">\n`;
          })
          .join("\n<!-- markdownz: page break -->\n\n"),
      );
    },
  };
}
